const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { resolveDateRange } = require("../utils/dateRange");
const { audit, fetchBefore } = require("../lib/audit");
const { ownsAll } = require("../lib/tenant");
const events = require("../lib/events");
const { sendEmail } = require("../lib/mailer");
const { getCompany } = require("../lib/company");

const router = express.Router();
router.use(requireAuth);

async function addTimelineEvent(entryId, label, note) {
  await pool.query(
    "INSERT INTO collection_timeline (collection_entry_id, date, label, note) VALUES ($1, CURRENT_DATE, $2, $3)",
    [entryId, label, note || null]
  );
}

// When an entry is linked to an invoice, the invoice's amount/paid_amount/
// due_date are the source of truth — this overlays them onto the entry row
// so the rest of the app (and the frontend) never has to think about the
// difference between a linked and a standalone entry.
function mergeInvoiceFields(row) {
  if (row.invoice_id) {
    return {
      ...row,
      expected_amount: row.inv_amount !== null && row.inv_amount !== undefined ? row.inv_amount : row.expected_amount,
      amount_paid: row.inv_paid_amount !== null && row.inv_paid_amount !== undefined ? row.inv_paid_amount : row.amount_paid,
      due_date: row.inv_due_date || row.due_date,
    };
  }
  return row;
}

const ENTRY_SELECT = `
  ce.*, c.name AS client_name, c.status AS client_status, u.name AS account_manager_name,
  i.number AS invoice_number, i.amount AS inv_amount, i.paid_amount AS inv_paid_amount, i.due_date AS inv_due_date
`;

const ENTRY_FROM = `
  FROM collection_entries ce
  LEFT JOIN clients c ON c.id = ce.client_id
  LEFT JOIN users u ON u.id = ce.account_manager_id
  LEFT JOIN invoices i ON i.id = ce.invoice_id
`;

async function loadEntry(entryId, agencyId) {
  const { rows } = await pool.query(
    `SELECT ${ENTRY_SELECT} ${ENTRY_FROM} WHERE ce.id = $1 AND ce.agency_id = $2`,
    [entryId, agencyId]
  );
  return rows[0] ? mergeInvoiceFields(rows[0]) : null;
}

// GET /api/collection — list all entries with client name + account manager name
// Optional query params (Global Filter System): client_id, client_status, date_range (+ from/to)
router.get("/", requirePermission("collection", "view"), async (req, res) => {
  const { client_id, client_status, date_range, from: customFrom, to: customTo } = req.query;
  const conditions = ["ce.agency_id = $1"];
  const params = [req.user.agencyId];

  if (client_id && client_id !== "all") {
    params.push(client_id);
    conditions.push(`ce.client_id = $${params.length}`);
  }
  if (client_status && client_status !== "all") {
    params.push(client_status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (date_range && date_range !== "all") {
    const { from, to } = resolveDateRange(date_range, customFrom, customTo);
    // Linked entries follow the invoice's issue date (same rule as the rest of
    // the system); standalone entries fall back to their own due date.
    if (from) { params.push(from); conditions.push(`COALESCE(i.issue_date, ce.due_date) >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`COALESCE(i.issue_date, ce.due_date) <= $${params.length}`); }
  }

  const result = await pool.query(
    `SELECT ${ENTRY_SELECT} ${ENTRY_FROM}
     WHERE ${conditions.join(" AND ")}
     ORDER BY ce.due_date ASC NULLS LAST`,
    params
  );
  res.json(result.rows.map(mergeInvoiceFields));
});

// GET /api/collection/report/summary — dashboard + performance report data
// (declared before "/:id" so "report" is never taken for an id)
router.get("/report/summary", requirePermission("collection", "view"), async (req, res) => {
  const currency = req.query.currency || "EGP";
  const agencyId = req.user.agencyId;
  try {
    const entriesResult = await pool.query(
      `SELECT ce.*, i.amount AS inv_amount, i.paid_amount AS inv_paid_amount, i.due_date AS inv_due_date
       FROM collection_entries ce
       LEFT JOIN invoices i ON i.id = ce.invoice_id
       WHERE ce.currency = $1 AND ce.agency_id = $2`,
      [currency, agencyId]
    );
    const entries = entriesResult.rows.map(mergeInvoiceFields);

    const today = new Date().toISOString().slice(0, 10);
    let totalOutstanding = 0, totalOverdue = 0, pendingCount = 0, overdueCount = 0;

    const isPaid = (e) => Number(e.amount_paid) >= Number(e.expected_amount) && Number(e.expected_amount) > 0;
    const dueDateStr = (e) => (e.due_date instanceof Date ? e.due_date.toISOString().slice(0, 10) : e.due_date);
    const isOverdue = (e) => !isPaid(e) && e.due_date && dueDateStr(e) < today;

    entries.forEach((e) => {
      const remaining = Number(e.expected_amount) - Number(e.amount_paid);
      if (!isPaid(e)) {
        totalOutstanding += remaining;
        if (isOverdue(e)) { totalOverdue += remaining; overdueCount++; }
        else pendingCount++;
      }
    });

    const totalDue = entries.reduce((s, e) => s + Number(e.expected_amount), 0);
    const totalCollected = entries.reduce((s, e) => s + Number(e.amount_paid), 0);
    const rate = totalDue > 0 ? (totalCollected / totalDue) * 100 : 0;

    // manager performance (uses the merged, invoice-aware amounts too)
    const managerRows = await pool.query(
      `SELECT ce.account_manager_id, u.name AS manager_name,
              COUNT(*) AS clients,
              COALESCE(SUM(COALESCE(i.paid_amount, ce.amount_paid)),0) AS collected,
              COALESCE(SUM(COALESCE(i.amount, ce.expected_amount) - COALESCE(i.paid_amount, ce.amount_paid)),0) AS outstanding
       FROM collection_entries ce
       LEFT JOIN users u ON u.id = ce.account_manager_id
       LEFT JOIN invoices i ON i.id = ce.invoice_id
       WHERE ce.currency = $1 AND ce.agency_id = $2
       GROUP BY ce.account_manager_id, u.name
       ORDER BY collected DESC`,
      [currency, agencyId]
    );

    res.json({
      totalOutstanding, totalOverdue, pendingCount, overdueCount,
      totalDue, totalCollected, rate,
      managerPerformance: managerRows.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating collection report" });
  }
});

// GET /api/collection/:id — full detail incl. follow-ups + timeline
router.get("/:id", requirePermission("collection", "view"), async (req, res) => {
  const entry = await loadEntry(req.params.id, req.user.agencyId);
  if (!entry) return res.status(404).json({ error: "Entry not found" });

  const followUps = await pool.query(
    "SELECT * FROM collection_follow_ups WHERE collection_entry_id = $1 ORDER BY date DESC",
    [entry.id]
  );
  const timeline = await pool.query(
    "SELECT * FROM collection_timeline WHERE collection_entry_id = $1 ORDER BY date DESC",
    [entry.id]
  );

  res.json({ ...entry, follow_ups: followUps.rows, timeline: timeline.rows });
});

// POST /api/collection — create a new collection entry
// Optional field: invoice_id — links this entry to an existing invoice.
router.post("/", requirePermission("collection", "create"), async (req, res) => {
  const e = req.body;
  const agencyId = req.user.agencyId;
  try {
    if (!(await ownsAll([["clients", e.client_id], ["invoices", e.invoice_id], ["users", e.account_manager_id]], agencyId))) {
      return res.status(400).json({ error: "Invalid client, invoice or account manager" });
    }
    let expectedAmount = e.expected_amount || 0;
    let amountPaid = e.amount_paid || 0;
    let dueDate = e.due_date || null;

    if (e.invoice_id) {
      const invResult = await pool.query("SELECT * FROM invoices WHERE id = $1 AND agency_id = $2", [e.invoice_id, agencyId]);
      const inv = invResult.rows[0];
      if (inv) {
        expectedAmount = inv.amount;
        amountPaid = inv.paid_amount;
        dueDate = inv.due_date;
      }
    }

    const result = await pool.query(
      `INSERT INTO collection_entries
        (client_id, invoice_id, company_name, service, expected_amount, amount_paid, currency, due_date,
         account_manager_id, follow_up_status, next_follow_up_date, last_communication_notes, created_by, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        e.client_id || null, e.invoice_id || null, e.company_name, e.service, expectedAmount, amountPaid,
        e.currency || "EGP", dueDate, e.account_manager_id || null,
        e.follow_up_status || "not_contacted", e.next_follow_up_date || null,
        e.last_communication_notes || null, req.user.id, agencyId,
      ]
    );
    const label = e.invoice_id ? "تم إنشاء سجل التحصيل (مرتبط بفاتورة)" : "تم إنشاء سجل التحصيل";
    await addTimelineEvent(result.rows[0].id, label);
    audit(req, { action: "collection.create", entity: "collection_entry", entityId: result.rows[0].id, after: result.rows[0], summary: result.rows[0].company_name });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating collection entry" });
  }
});

// PUT /api/collection/:id — update entry fields (including linking/unlinking an invoice)
router.put("/:id", requirePermission("collection", "edit"), async (req, res) => {
  const e = req.body;
  const agencyId = req.user.agencyId;
  try {
    if (!(await ownsAll([["clients", e.client_id], ["invoices", e.invoice_id], ["users", e.account_manager_id]], agencyId))) {
      return res.status(400).json({ error: "Invalid client, invoice or account manager" });
    }
    const before = await fetchBefore("collection_entries", req.params.id, agencyId);
    const result = await pool.query(
      `UPDATE collection_entries SET
        client_id=$1, invoice_id=$2, company_name=$3, service=$4, expected_amount=$5, amount_paid=$6, currency=$7,
        due_date=$8, account_manager_id=$9, follow_up_status=$10, next_follow_up_date=$11,
        last_communication_notes=$12, updated_at=now()
       WHERE id=$13 AND agency_id=$14 RETURNING *`,
      [
        e.client_id || null, e.invoice_id || null, e.company_name, e.service, e.expected_amount || 0, e.amount_paid || 0,
        e.currency || "EGP", e.due_date || null, e.account_manager_id || null,
        e.follow_up_status || "not_contacted", e.next_follow_up_date || null,
        e.last_communication_notes || null, req.params.id, agencyId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Entry not found" });
    audit(req, { action: "collection.update", entity: "collection_entry", entityId: req.params.id, before, after: result.rows[0], summary: result.rows[0].company_name });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating entry" });
  }
});

// DELETE /api/collection/:id
router.delete("/:id", requirePermission("collection", "delete"), async (req, res) => {
  const before = await fetchBefore("collection_entries", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Entry not found" });
  await pool.query("DELETE FROM collection_entries WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  audit(req, { action: "collection.delete", entity: "collection_entry", entityId: req.params.id, before, summary: before.company_name });
  res.status(204).send();
});

// POST /api/collection/:id/follow-ups — add a follow-up record
router.post("/:id/follow-ups", requirePermission("collection", "edit"), async (req, res) => {
  const f = req.body;
  const agencyId = req.user.agencyId;
  try {
    const owned = await pool.query("SELECT id FROM collection_entries WHERE id = $1 AND agency_id = $2", [req.params.id, agencyId]);
    if (!owned.rows[0]) return res.status(404).json({ error: "Entry not found" });
    if (!(await ownsAll([["users", f.employee_id]], agencyId))) return res.status(400).json({ error: "Invalid employee" });
    const entryId = owned.rows[0].id;

    const result = await pool.query(
      `INSERT INTO collection_follow_ups
        (collection_entry_id, date, method, employee_id, client_response, notes, next_follow_up_date, payment_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        entryId, f.date || new Date().toISOString().slice(0, 10), f.method,
        f.employee_id || req.user.id, f.client_response, f.notes,
        f.next_follow_up_date || null, f.payment_amount || null,
      ]
    );

    // keep parent entry's last/next follow-up + notes in sync
    await pool.query(
      `UPDATE collection_entries SET
        last_follow_up_date = $1,
        next_follow_up_date = COALESCE($2, next_follow_up_date),
        last_communication_notes = COALESCE($3, last_communication_notes),
        updated_at = now()
       WHERE id = $4 AND agency_id = $5`,
      [f.date || new Date().toISOString().slice(0, 10), f.next_follow_up_date || null, f.notes || f.client_response || null, entryId, agencyId]
    );

    await addTimelineEvent(entryId, `متابعة عبر ${f.method || "غير محدد"}`, f.client_response);
    audit(req, { action: "collection.follow_up", entity: "collection_entry", entityId: entryId, after: { method: f.method, client_response: f.client_response }, summary: f.method || "" });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error adding follow-up" });
  }
});

// POST /api/collection/:id/quick-action — reminder | contacted | confirm_payment
// If the entry is linked to an invoice, "confirm_payment" marks the INVOICE
// as fully paid (source of truth) instead of the entry's own columns.
router.post("/:id/quick-action", requirePermission("collection", "edit"), async (req, res) => {
  const { action } = req.body;
  const entryId = req.params.id;
  const agencyId = req.user.agencyId;
  try {
    const entryResult = await pool.query("SELECT * FROM collection_entries WHERE id = $1 AND agency_id = $2", [entryId, agencyId]);
    const entry = entryResult.rows[0];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (action === "reminder") {
      await pool.query(
        `UPDATE collection_entries SET last_follow_up_date = CURRENT_DATE,
          last_communication_notes = 'تم إرسال تذكير دفع', updated_at = now() WHERE id = $1 AND agency_id = $2`,
        [entryId, agencyId]
      );
      await addTimelineEvent(entryId, "تم إرسال تذكير بالدفع");
    } else if (action === "email_reminder") {
      // Real email to the client's address, in the language the UI asked for.
      const full = await loadEntry(entryId, agencyId);
      const cl = full.client_id ? (await pool.query("SELECT name, contact_name, contact_email FROM clients WHERE id = $1 AND agency_id = $2", [full.client_id, agencyId])).rows[0] : null;
      if (!cl || !cl.contact_email) return res.status(400).json({ error: "العميل ملوش إيميل مسجّل" });
      const company = await getCompany(agencyId);
      const remaining = Number(full.expected_amount) - Number(full.amount_paid);
      const due = full.due_date ? new Date(full.due_date).toISOString().slice(0, 10) : "";
      const sent = await sendEmail({
        agencyId, to: cl.contact_email, template: "reminder", brand: company.name, wait: true,
        lang: req.body.lang === "en" ? "en" : req.user.agencyLanguage === "en" ? "en" : "ar",
        vars: { name: cl.contact_name || cl.name, number: full.invoice_number || `#${full.id}`, amount: `${remaining.toLocaleString("en-US")} ${full.currency || ""}`.trim(), due },
      });
      if (!sent.ok) return res.status(400).json({ error: sent.error === "no_smtp" ? "مفيش إعدادات SMTP مفعّلة — فعّلها من الإعدادات ← البريد" : `فشل الإرسال: ${sent.error}` });
      await pool.query("UPDATE collection_entries SET last_follow_up_date = CURRENT_DATE, last_communication_notes = 'تم إرسال تذكير بالإيميل', updated_at = now() WHERE id = $1 AND agency_id = $2", [entryId, agencyId]);
      await addTimelineEvent(entryId, "تم إرسال تذكير بالدفع بالإيميل", cl.contact_email);
    } else if (action === "contacted") {
      await pool.query(
        `UPDATE collection_entries SET follow_up_status = 'needs_followup',
          last_follow_up_date = CURRENT_DATE, updated_at = now() WHERE id = $1 AND agency_id = $2`,
        [entryId, agencyId]
      );
      await addTimelineEvent(entryId, "تم وضع علامة (تم التواصل)");
    } else if (action === "confirm_payment") {
      if (entry.invoice_id) {
        const invResult = await pool.query("SELECT * FROM invoices WHERE id = $1 AND agency_id = $2", [entry.invoice_id, agencyId]);
        const inv = invResult.rows[0];
        const remaining = inv ? Number(inv.amount) - Number(inv.paid_amount) : 0;
        await pool.query("UPDATE invoices SET paid_amount = amount, status = 'paid' WHERE id = $1 AND agency_id = $2", [entry.invoice_id, agencyId]);
        await pool.query(
          `UPDATE collection_entries SET follow_up_status = 'payment_confirmed', updated_at = now() WHERE id = $1 AND agency_id = $2`,
          [entryId, agencyId]
        );
        await pool.query(
          `INSERT INTO collection_follow_ups (collection_entry_id, date, method, employee_id, client_response, notes, payment_amount)
           VALUES ($1, CURRENT_DATE, 'other', $2, 'تم الدفع', 'دفعة كاملة (عبر الفاتورة المرتبطة)', $3)`,
          [entryId, req.user.id, remaining]
        );
        await addTimelineEvent(entryId, `تم تأكيد استلام الدفعة بالكامل (فاتورة ${inv ? inv.number : ""})`);
        if (inv) {
          const paidInv = { ...inv, paid_amount: inv.amount, status: "paid" };
          events.paymentRecorded(req, paidInv, remaining);
          if (inv.status !== "paid") events.invoicePaid(req, paidInv);
        }
      } else {
        const remaining = Number(entry.expected_amount) - Number(entry.amount_paid);
        await pool.query(
          `UPDATE collection_entries SET amount_paid = expected_amount,
            follow_up_status = 'payment_confirmed', updated_at = now() WHERE id = $1 AND agency_id = $2`,
          [entryId, agencyId]
        );
        await pool.query(
          `INSERT INTO collection_follow_ups (collection_entry_id, date, method, employee_id, client_response, notes, payment_amount)
           VALUES ($1, CURRENT_DATE, 'other', $2, 'تم الدفع', 'دفعة كاملة', $3)`,
          [entryId, req.user.id, remaining]
        );
        await addTimelineEvent(entryId, "تم تأكيد استلام الدفعة بالكامل");
      }
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }

    audit(req, { action: `collection.${action}`, entity: "collection_entry", entityId: entryId, summary: entry.company_name });
    res.json(await loadEntry(entryId, agencyId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error performing quick action" });
  }
});

// POST /api/collection/:id/partial-payment
// If linked to an invoice, the payment is applied to the INVOICE's
// paid_amount (source of truth) rather than the entry's own column.
router.post("/:id/partial-payment", requirePermission("collection", "edit"), async (req, res) => {
  const { amount } = req.body;
  const entryId = req.params.id;
  const agencyId = req.user.agencyId;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "A positive amount is required" });

  try {
    const entryResult = await pool.query("SELECT * FROM collection_entries WHERE id = $1 AND agency_id = $2", [entryId, agencyId]);
    const entry = entryResult.rows[0];
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    if (entry.invoice_id) {
      const invResult = await pool.query("SELECT * FROM invoices WHERE id = $1 AND agency_id = $2", [entry.invoice_id, agencyId]);
      const inv = invResult.rows[0];
      if (!inv) return res.status(404).json({ error: "Linked invoice not found" });

      const newPaid = Number(inv.paid_amount) + Number(amount);
      const newInvStatus = newPaid >= Number(inv.amount) ? "paid" : (inv.status === "draft" ? "sent" : inv.status);
      await pool.query("UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3 AND agency_id = $4", [newPaid, newInvStatus, entry.invoice_id, agencyId]);

      const newFollowUpStatus = newPaid >= Number(inv.amount) ? "payment_confirmed" : entry.follow_up_status;
      await pool.query(
        "UPDATE collection_entries SET follow_up_status = $1, updated_at = now() WHERE id = $2 AND agency_id = $3",
        [newFollowUpStatus, entryId, agencyId]
      );
      await pool.query(
        `INSERT INTO collection_follow_ups (collection_entry_id, date, method, employee_id, client_response, payment_amount)
         VALUES ($1, CURRENT_DATE, 'other', $2, 'دفعة جزئية (عبر الفاتورة المرتبطة)', $3)`,
        [entryId, req.user.id, amount]
      );
      await addTimelineEvent(entryId, `تم تسجيل دفعة جزئية: ${amount} ${inv.currency} (فاتورة ${inv.number})`);
      const updInv = { ...inv, paid_amount: newPaid, status: newInvStatus };
      events.paymentRecorded(req, updInv, amount);
      if (inv.status !== "paid" && newInvStatus === "paid") events.invoicePaid(req, updInv);
    } else {
      const newPaid = Number(entry.amount_paid) + Number(amount);
      const newStatus = newPaid >= Number(entry.expected_amount) ? "payment_confirmed" : entry.follow_up_status;

      await pool.query(
        "UPDATE collection_entries SET amount_paid = $1, follow_up_status = $2, updated_at = now() WHERE id = $3 AND agency_id = $4",
        [newPaid, newStatus, entryId, agencyId]
      );
      await pool.query(
        `INSERT INTO collection_follow_ups (collection_entry_id, date, method, employee_id, client_response, payment_amount)
         VALUES ($1, CURRENT_DATE, 'other', $2, 'دفعة جزئية', $3)`,
        [entryId, req.user.id, amount]
      );
      await addTimelineEvent(entryId, `تم تسجيل دفعة جزئية: ${amount} ${entry.currency}`);
    }

    audit(req, { action: "collection.payment", entity: "collection_entry", entityId: entryId, after: { amount }, summary: `${entry.company_name}: +${amount}` });
    res.json(await loadEntry(entryId, agencyId));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error recording partial payment" });
  }
});

module.exports = router;
