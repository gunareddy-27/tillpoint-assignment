/** Format integer cents as a readable dollar string: 1234 → "$12.34" */
export function fmt(cents) {
  if (cents == null) return '—';
  return '$' + (cents / 100).toFixed(2);
}

/** Today as YYYY-MM-DD in local time */
export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Pretty-print a UTC ISO timestamp */
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short'
  });
}
