const defaultPool = require("../db/pool");

// Keeps the Collection Center in step with invoices so nothing has to be
// entered twice:
//   - an issued (non-draft) invoice with money still owed gets a linked
//     collection entry automatically (if it doesn't already have one);
//   - when an invoice becomes fully paid, its entries are marked
//     "payment_confirmed" and their follow-up date is cleared.
// Linked entries already read amount / paid / due date from the invoice, so
// this never creates a second source of truth.
//
// Never throws: a sync problem must not make saving an invoice fail.
async function syncCollectionForInvoice(invoiceId, userId = null, db = defaultPool) {
  try {
    const { rows } = await db.query(
      `SELECT i.*, c.name AS client_name, s.name AS service_name
         FROM invoices i
         LEFT JOIN clients c ON c.id = i.client_id
         LEFT JOIN services s ON s.id = i.service_id
        WHERE i.id = $1`,
      [invoiceId]
    );
    const inv = rows[0];
    if (!inv) return null;

    const amount = Number(inv.amount) || 0;
    const paid = Number(inv.paid_amount) || 0;
    const remaining = amount - paid;

    const existing = await db.query(
      "SELECT id, follow_up_status FROM collection_entries WHERE invoice_id = $1",
      [invoiceId]
    );

    if (existing.rows.length === 0) {
      if (inv.status === "draft" || remaining <= 0) return null;
      const created = await db.query(
        `INSERT INTO collection_entries
           (client_id, invoice_id, company_name, service, expected_amount, amount_paid, currency,
            due_date, follow_up_status, created_by, agency_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'not_contacted',$9,$10) RETURNING id`,
        [inv.client_id, inv.id, inv.client_name || null, inv.service_name || inv.description || null,
         amount, paid, inv.currency, inv.due_date, userId, inv.agency_id]
      );
      await db.query(
        "INSERT INTO collection_timeline (collection_entry_id, date, label, note) VALUES ($1, CURRENT_DATE, $2, $3)",
        [created.rows[0].id, "تم إنشاء سجل التحصيل تلقائيًا من الفاتورة", inv.number]
      );
      return { created: created.rows[0].id };
    }

    // Keep the stored copy aligned with the invoice (display already overlays it).
    await db.query(
      `UPDATE collection_entries
          SET expected_amount = $2, amount_paid = $3, due_date = $4, currency = $5, updated_at = now()
        WHERE invoice_id = $1`,
      [invoiceId, amount, paid, inv.due_date, inv.currency]
    );

    if (amount > 0 && remaining <= 0) {
      const toConfirm = existing.rows.filter((e) => e.follow_up_status !== "payment_confirmed");
      for (const e of toConfirm) {
        await db.query(
          "UPDATE collection_entries SET follow_up_status = 'payment_confirmed', next_follow_up_date = NULL WHERE id = $1",
          [e.id]
        );
        await db.query(
          "INSERT INTO collection_timeline (collection_entry_id, date, label, note) VALUES ($1, CURRENT_DATE, $2, $3)",
          [e.id, "تم تأكيد السداد من الفاتورة", inv.number]
        );
      }
      return { confirmed: toConfirm.length };
    }
    return { updated: existing.rows.length };
  } catch (err) {
    console.error("[collection-sync] failed for invoice", invoiceId, err.message);
    return null;
  }
}

// One-time backfill for invoices that existed before auto-linking: gives every
// issued invoice that still has a balance a collection entry. Guarded by a
// marker row so entries a user later deletes are not recreated on restart.
async function backfillCollectionEntries(db = defaultPool) {
  await db.query("CREATE TABLE IF NOT EXISTS app_migrations (name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
  const done = await db.query("SELECT 1 FROM app_migrations WHERE name = 'collection_autolink_backfill'");
  if (done.rows.length) return 0;

  const { rows } = await db.query(
    `SELECT i.id FROM invoices i
      WHERE i.status <> 'draft' AND i.amount > i.paid_amount
        AND NOT EXISTS (SELECT 1 FROM collection_entries ce WHERE ce.invoice_id = i.id)
      ORDER BY i.id`
  );
  let created = 0;
  for (const r of rows) {
    const res = await syncCollectionForInvoice(r.id, null, db);
    if (res && res.created) created++;
  }
  await db.query("INSERT INTO app_migrations (name) VALUES ('collection_autolink_backfill') ON CONFLICT DO NOTHING");
  return created;
}

module.exports = { syncCollectionForInvoice, backfillCollectionEntries };
