'use strict';
// One Claude account per profile: the check that keeps the side-by-side setup
// honest.
//
// Each profile's current account is a fingerprint (desktop-signin.js
// readDesktopAccountKey), never the id itself. The first account seen signed
// in to a profile is remembered as its own (account.accountKey in
// accounts.json). Then:
//   mismatch  the profile is now signed in to a different account
//   shared    another profile is signed in to the same account right now
// Same idea as KeyboardCowboy/multi-claude's accounts.js; Multi-Claude stores
// a hash where that app stores the id. Pure: no files here.

/**
 * Remember the current account for profiles that have none yet. A profile
 * whose account is also signed in elsewhere is left for the user to sort out.
 * Mutates accounts; returns true if any changed.
 */
function bindNewAccounts(accounts, current) {
  let changed = false;
  for (const a of accounts) {
    const key = current.get(a.id);
    if (a.accountKey || !key) continue;
    const taken = accounts.some((o) => o !== a && (current.get(o.id) === key || o.accountKey === key));
    if (taken) continue;
    a.accountKey = key;
    changed = true;
  }
  return changed;
}

/**
 * Each account's situation, by account id:
 *   { kind: 'none' | 'ok' | 'mismatch', sharedWith: [account ids] }
 */
function accountStates(accounts, current) {
  const out = new Map();
  for (const a of accounts) {
    const key = current.get(a.id) || null;
    const kind = !key ? 'none' : a.accountKey && a.accountKey !== key ? 'mismatch' : 'ok';
    const sharedWith = key ? accounts.filter((o) => o !== a && current.get(o.id) === key).map((o) => o.id) : [];
    out.set(a.id, { kind, sharedWith });
  }
  return out;
}

module.exports = { bindNewAccounts, accountStates };
