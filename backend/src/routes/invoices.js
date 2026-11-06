const express = require("express");
const pool = require("../db/pool");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { renderInvoicePdf } = require("../pdf/renderInvoicePdf");
const { generateMonthlyInvoices } = require("../jobs/monthlyInvoices");
const { resolveDateRange } = require("../utils/dateRange");

const { normalizeInvoicePayment } = require("../lib/invoicePayment");
const { syncCollectionForInvoice } = require("../lib/collectionSync");
const { audit, fetchBefore } = require("../lib/audit");
const { ownsAll } = require("../lib/tenant");
const events = require("../lib/events");

const router = express.Router();
router.use(requireAuth);

function decodeAttachment(base64) {
  const match = base64.match(/^data:(.+);base64,(.*)$/);
  if (match) return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
  return { mime: null, buffer: Buffer.from(base64, "base64") };
}

const RETURNING = `id, client_id, number, description, amount, currency, issue_date, due_date, status,
                 service_id, paid_amount, is_auto_generated, for_month, created_by, created_at,
                 (receipt_data IS NOT NULL) AS has_receipt`;

// GET /api/invoices
// Optional query params (Global Filter System): client_id, service_id,
// client_status, date_range (+ from/to for "custom")
router.get("/", requirePermission("invoices", "view"), async (req, res) => {
  const { client_id, service_id, client_status, date_range, from: customFrom, to: customTo } = req.query;
  const conditions = ["i.agency_id = $1"];
  const params = [req.user.agencyId];

  if (client_id && client_id !== "all") {
    params.push(client_id);
    conditions.push(`i.client_id = $${params.length}`);
  }
  if (service_id && service_id !== "all") {
    params.push(service_id);
    conditions.push(`i.service_id = $${params.length}`);
  }
  if (client_status && client_status !== "all") {
    params.push(client_status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (date_range && date_range !== "all") {
    const { from, to } = resolveDateRange(date_range, customFrom, customTo);
    if (from) { params.push(from); conditions.push(`i.issue_date >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`i.issue_date <= $${params.length}`); }
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const result = await pool.query(
    `SELECT i.id, i.client_id, i.number, i.description, i.amount, i.currency, i.issue_date,
            i.due_date, i.status, i.service_id, i.paid_amount, i.is_auto_generated, i.for_month,
            i.created_by, i.created_at,
            c.name AS client_name, c.status AS client_status,
            (i.receipt_data IS NOT NULL) AS has_receipt
     FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
     ${where}
     ORDER BY i.issue_date DESC`,
    params
  );
  res.json(result.rows);
});

// GET /api/invoices/:id/receipt — serves the stored payment receipt (image or PDF)
router.get("/:id/receipt", requirePermission("invoices", "view"), async (req, res) => {
  const result = await pool.query(
    "SELECT receipt_data, receipt_mime, receipt_filename FROM invoices WHERE id = $1 AND agency_id = $2",
    [req.params.id, req.user.agencyId]
  );
  const row = result.rows[0];
  if (!row || !row.receipt_data) return res.status(404).json({ error: "No receipt attached to this invoice" });
  res.setHeader("Content-Type", row.receipt_mime || "application/octet-stream");
  if (row.receipt_filename) {
    res.setHeader("Content-Disposition", `inline; filename="${row.receipt_filename}"`);
  }
  res.send(row.receipt_data);
});

// POST /api/invoices
// Optional fields: receipt_base64 (data URI), receipt_filename
router.post("/", requirePermission("invoices", "create"), async (req, res) => {
  const i = req.body;
  try {
    if (!(await ownsAll([["clients", i.client_id], ["services", i.service_id]], req.user.agencyId))) {
      return res.status(400).json({ error: "Invalid client or service" });
    }
    let receiptBuffer = null, receiptMime = null;
    if (i.receipt_base64) {
      const decoded = decodeAttachment(i.receipt_base64);
      receiptBuffer = decoded.buffer;
      receiptMime = decoded.mime || i.receipt_mime || null;
    }

    const pay = normalizeInvoicePayment({ amount: i.amount, paid_amount: i.paid_amount, status: i.status });
    const result = await pool.query(
      `INSERT INTO invoices
        (client_id, number, description, amount, currency, issue_date, due_date, status, service_id,
         paid_amount, receipt_data, receipt_mime, receipt_filename, created_by, agency_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING ${RETURNING}`,
      [
        i.client_id || null, i.number, i.description, i.amount || 0,
        i.currency || "EGP", i.issue_date || new Date().toISOString().slice(0, 10),
        i.due_date || null, pay.status, i.service_id || null,
        pay.paid_amount, receiptBuffer, receiptMime, i.receipt_filename || null, req.user.id, req.user.agencyId,
      ]
    );
    await syncCollectionForInvoice(result.rows[0].id, req.user.id);
    audit(req, { action: "invoice.create", entity: "invoice", entityId: result.rows[0].id, after: result.rows[0], summary: result.rows[0].number });
    events.invoiceCreated(req, result.rows[0]);
    if (result.rows[0].status === "paid") events.invoicePaid(req, result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error creating invoice" });
  }
});

// PUT /api/invoices/:id
// If receipt_base64 is omitted, the existing receipt (if any) is kept as-is.
router.put("/:id", requirePermission("invoices", "edit"), async (req, res) => {
  const i = req.body;
  try {
    if (!(await ownsAll([["clients", i.client_id], ["services", i.service_id]], req.user.agencyId))) {
      return res.status(400).json({ error: "Invalid client or service" });
    }
    const before = await fetchBefore("invoices", req.params.id, req.user.agencyId);
    let setReceipt = false, receiptBuffer = null, receiptMime = null;
    if (i.receipt_base64) {
      setReceipt = true;
      const decoded = decodeAttachment(i.receipt_base64);
      receiptBuffer = decoded.buffer;
      receiptMime = decoded.mime || i.receipt_mime || null;
    }

    const pay = normalizeInvoicePayment({ amount: i.amount, paid_amount: i.paid_amount, status: i.status });
    const result = await pool.query(
      `UPDATE invoices SET client_id=$1, number=$2, description=$3, amount=$4, currency=$5,
        issue_date=$6, due_date=$7, status=$8, service_id=$9, paid_amount=$10,
        receipt_data = CASE WHEN $11 THEN $12 ELSE receipt_data END,
        receipt_mime = CASE WHEN $11 THEN $13 ELSE receipt_mime END,
        receipt_filename = CASE WHEN $11 THEN $14 ELSE receipt_filename END
       WHERE id=$15 AND agency_id=$16
       RETURNING ${RETURNING}`,
      [
        i.client_id || null, i.number, i.description, i.amount || 0, i.currency || "EGP",
        i.issue_date, i.due_date || null, pay.status, i.service_id || null,
        pay.paid_amount, setReceipt, receiptBuffer, receiptMime, i.receipt_filename || null,
        req.params.id, req.user.agencyId,
      ]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Invoice not found" });
    await syncCollectionForInvoice(result.rows[0].id, req.user.id);
    audit(req, { action: "invoice.update", entity: "invoice", entityId: req.params.id, before, after: result.rows[0], summary: result.rows[0].number });
    if (before && before.status !== "paid" && result.rows[0].status === "paid") events.invoicePaid(req, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error updating invoice" });
  }
});

// POST /api/invoices/:id/record-payment — quick partial/full payment entry
router.post("/:id/record-payment", requirePermission("invoices", "edit"), async (req, res) => {
  const { amount } = req.body;
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "A positive amount is required" });
  try {
    const invResult = await pool.query("SELECT * FROM invoices WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
    const invoice = invResult.rows[0];
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const newPaid = Number(invoice.paid_amount) + Number(amount);
    const newStatus = newPaid >= Number(invoice.amount) ? "paid" : (invoice.status === "draft" ? "sent" : invoice.status);

    const result = await pool.query(
      "UPDATE invoices SET paid_amount = $1, status = $2 WHERE id = $3 AND agency_id = $4 RETURNING *",
      [newPaid, newStatus, req.params.id, req.user.agencyId]
    );
    await syncCollectionForInvoice(result.rows[0].id, req.user.id);
    audit(req, {
      action: "invoice.payment", entity: "invoice", entityId: req.params.id,
      before: { paid_amount: invoice.paid_amount, status: invoice.status }, after: { paid_amount: result.rows[0].paid_amount, status: result.rows[0].status },
      summary: `${invoice.number}: +${amount}`,
    });
    events.paymentRecorded(req, result.rows[0], amount);
    if (invoice.status !== "paid" && result.rows[0].status === "paid") events.invoicePaid(req, result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error recording payment" });
  }
});

// DELETE /api/invoices/:id
router.delete("/:id", requirePermission("invoices", "delete"), async (req, res) => {
  const before = await fetchBefore("invoices", req.params.id, req.user.agencyId);
  if (!before) return res.status(404).json({ error: "Invoice not found" });
  // Drop auto-linked collection entries that have no follow-up history, so
  // deleting an invoice doesn't leave a stray "owed" row behind. Entries with
  // real follow-ups are kept (they unlink and keep their stored amounts).
  await pool.query(
    `DELETE FROM collection_entries ce
      WHERE ce.invoice_id = $1 AND ce.agency_id = $2
        AND NOT EXISTS (SELECT 1 FROM collection_follow_ups f WHERE f.collection_entry_id = ce.id)`,
    [req.params.id, req.user.agencyId]
  );
  await pool.query("DELETE FROM invoices WHERE id = $1 AND agency_id = $2", [req.params.id, req.user.agencyId]);
  audit(req, { action: "invoice.delete", entity: "invoice", entityId: req.params.id, before, summary: before.number });
  res.status(204).send();
});

// GET /api/invoices/:id/pdf — generates a branded PDF on the fly
router.get("/:id/pdf", requirePermission("invoices", "view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT i.id, i.number, i.description, i.amount, i.currency, i.issue_date,
              i.due_date, i.status, i.client_id, c.name AS client_name
       FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1 AND i.agency_id = $2`,
      [req.params.id, req.user.agencyId]
    );
    const invoice = result.rows[0];
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const client = invoice.client_id ? { name: invoice.client_name } : null;
    // language: the one the UI asked for, else the agency default
    const lang = ["ar", "en"].includes(req.query.lang) ? req.query.lang : (req.user.agencyLanguage === "en" ? "en" : "ar");
    const pdfBuffer = await renderInvoicePdf(invoice, client, req.user.agencyId, lang);
    audit(req, { action: "invoice.pdf", entity: "invoice", entityId: invoice.id, summary: invoice.number });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${invoice.number}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating invoice PDF" });
  }
});

// POST /api/invoices/generate-monthly — manual trigger for THIS agency
// (also runs automatically via cron at 00:05 on the 1st of every month, for every active agency)
router.post("/generate-monthly", requirePermission("invoices", "create"), async (req, res) => {
  try {
    const created = await generateMonthlyInvoices(req.user.agencyId);
    audit(req, { action: "invoice.generate_monthly", entity: "invoice", summary: `${created.length} invoice(s)`, after: { count: created.length } });
    res.json({ created: created.length, invoices: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error generating monthly invoices" });
  }
});

module.exports = router;
