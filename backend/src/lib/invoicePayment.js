// Keeps an invoice's `status` and `paid_amount` consistent.
//
// Payment Center, Collection Center (linked entries), aging and every
// financial report read `paid_amount`, while the invoice form also has a
// separate "status" dropdown. Picking status "paid" without typing the paid
// amount used to leave paid_amount at 0, so the other screens kept showing
// the invoice as unpaid. This makes the two always agree.
function normalizeInvoicePayment({ amount, paid_amount, status }) {
  const total = Number(amount) || 0;
  let paid = Number(paid_amount) || 0;
  let nextStatus = status || "draft";

  if (nextStatus === "paid") {
    if (paid < total) paid = total;
  } else if (total > 0 && paid >= total) {
    nextStatus = "paid";
  }
  return { paid_amount: paid, status: nextStatus };
}

module.exports = { normalizeInvoicePayment };
