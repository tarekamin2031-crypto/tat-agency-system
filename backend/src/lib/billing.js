// Pure helpers for the automatic monthly invoicing job.

// How many months a renewal cycle spans. "once" contracts are never
// auto-billed — they're one-time and shouldn't get a recurring invoice.
function cycleMonths(cycle) {
  if (cycle === "monthly") return 1;
  if (cycle === "quarterly") return 3;
  if (cycle === "yearly") return 12;
  return null;
}

function firstOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// True when `client` should be billed in the month starting `monthFirst`:
// monthly clients every month, quarterly every 3rd month counted from their
// anchor (contract_end, else contract_start), yearly every 12th.
function isBillingDue(client, monthFirst) {
  const cm = cycleMonths(client.renewal_cycle);
  if (!cm) return false;
  const anchorRaw = client.contract_end || client.contract_start;
  if (!anchorRaw) return false;
  const anchorFirst = firstOfMonth(new Date(anchorRaw));
  const diffMonths =
    (monthFirst.getFullYear() - anchorFirst.getFullYear()) * 12 +
    (monthFirst.getMonth() - anchorFirst.getMonth());
  return diffMonths >= 0 && diffMonths % cm === 0;
}

module.exports = { cycleMonths, firstOfMonth, isBillingDue };
