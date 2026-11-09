// Fixed order, largest-typical first. Colours are the validated categorical
// slots in order — never reassigned by rank, so a profile with no VM bundles
// does not repaint the remaining categories.
export const STORAGE_CATEGORIES = [
  { key: 'vm', label: 'VM bundles', color: 'var(--series-1)' },
  { key: 'runtime', label: 'Code runtime', color: 'var(--series-2)' },
  { key: 'cache', label: 'Cache', color: 'var(--series-3)' },
  { key: 'sessions', label: 'Sessions', color: 'var(--series-4)' },
  { key: 'data', label: 'Profile data', color: 'var(--series-5)' }
];
