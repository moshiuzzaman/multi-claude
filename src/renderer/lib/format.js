// Display formatting. Kept apart from the API wrapper so it can be reasoned
// about (and changed) without touching anything that talks to the main process.

export function compact(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(abs >= 1e13 ? 0 : 1) + 'T';
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(n));
}

export function full(n) {
  return typeof n === 'number' && isFinite(n) ? Math.round(n).toLocaleString() : '0';
}

export function bytes(b) {
  if (typeof b !== 'number' || b <= 0) return '0 MB';
  const mb = b / (1024 * 1024);
  if (mb < 1) return '<1 MB';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function duration(ms) {
  if (typeof ms !== 'number' || ms <= 0) return '0m';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** How long until a limit window resets, e.g. "1d 3h remaining". */
export function timeLeft(resetsAt, now = Date.now()) {
  if (!resetsAt) return '';
  const left = resetsAt - now;
  if (left <= 0) return 'Resetting now';
  return `${duration(left)} remaining`;
}

/** A release's publish date for display, or '' when it is missing or malformed. */
export function releaseDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

export function usd(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '$0.00';
  return '$' + n.toFixed(2);
}

/** "2026-11-09" -> "9 Nov" */
export function shortDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  if (!y || !m || !d) return key;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}

export function relativeTime(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function clockTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** Short, readable model name: "claude-opus-5-5" -> "Opus 5.5" */
export function modelName(id) {
  if (!id) return 'Unknown';
  const m = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  const family = m[1][0].toUpperCase() + m[1].slice(1);
  return `${family} ${m[2]}${m[3] ? '.' + m[3] : ''}`;
}

export const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)'
];

/** Fixed-order assignment. Never cycle: a 7th entity folds into "Other". */
export function seriesColor(i) {
  return SERIES[i] || 'var(--faint)';
}

/**
 * Keep the top `n` entries and roll everything else into a single "Other" row,
 * rather than handing a 7th series a colour the palette does not have.
 */
export function foldOther(items, n = 6) {
  if (!items || items.length <= n) return items || [];
  const head = items.slice(0, n);
  const rest = items.slice(n);
  const value = rest.reduce((a, b) => a + b.value, 0);
  if (value <= 0) return head;
  return [...head, { key: '__other', label: `Other (${rest.length})`, value, other: true }];
}
