import React from 'react';

const PATHS = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  accounts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  usage: 'M3 3v18h18M7 15l4-5 4 3 5-7',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  storage: 'M3 6a9 3 0 1 0 18 0A9 3 0 1 0 3 6M3 6v12a9 3 0 0 0 18 0V6M3 12a9 3 0 0 0 18 0'
};

export default function Icon({ name, size = 15 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg className="nav-icon" width={size} height={size} viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
