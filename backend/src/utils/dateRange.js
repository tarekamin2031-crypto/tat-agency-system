function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeek(d) {
  const day = d.getDay(); // 0 = Sunday
  const result = new Date(d);
  result.setDate(d.getDate() - day);
  return result;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
}

/**
 * Resolves a named date_range (as sent by the Global Filter Bar) into a
 * concrete { from, to } ISO date pair. Returns { from: null, to: null } for
 * "all" / unrecognized ranges, meaning "no date filter".
 */
function resolveDateRange(range, customFrom, customTo) {
  const today = new Date();

  switch (range) {
    case "today":
      return { from: toISO(today), to: toISO(today) };
    case "this_week":
      return { from: toISO(startOfWeek(today)), to: toISO(today) };
    case "this_month":
      return { from: toISO(startOfMonth(today)), to: toISO(today) };
    case "last_month": {
      const lm = addMonths(today, -1);
      return { from: toISO(startOfMonth(lm)), to: toISO(endOfMonth(lm)) };
    }
    case "last_3_months":
      return { from: toISO(startOfMonth(addMonths(today, -3))), to: toISO(today) };
    case "last_6_months":
      return { from: toISO(startOfMonth(addMonths(today, -6))), to: toISO(today) };
    case "this_year":
      return { from: `${today.getFullYear()}-01-01`, to: toISO(today) };
    case "this_quarter": {
      const q = Math.floor(today.getMonth() / 3);
      const qStart = new Date(today.getFullYear(), q * 3, 1);
      return { from: toISO(qStart), to: toISO(today) };
    }
    case "last_year":
      return { from: `${today.getFullYear() - 1}-01-01`, to: `${today.getFullYear() - 1}-12-31` };
    case "custom":
      return { from: customFrom || null, to: customTo || null };
    default:
      return { from: null, to: null };
  }
}

module.exports = { resolveDateRange };
