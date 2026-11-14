import React from 'react';

/**
 * One Claude account per profile (account-check.js in the main process).
 * Two problems are shown:
 *   - another profile is signed in to the same Claude account
 *   - this profile is now signed in to a different account than before
 */

function sharedNames(account) {
  const list = (account.accountCheck && account.accountCheck.sharedWith) || [];
  return list.map((s) => s.label).filter(Boolean);
}

/** A short warning pill for cards, rows and the page title. */
export function AccountCheckPill({ account }) {
  const check = account.accountCheck;
  if (!check) return null;
  const names = sharedNames(account);
  if (names.length > 0) {
    return (
      <span className="pill warn"
            title={`${account.label} and ${names.join(', ')} are signed in to the same Claude account. Each profile should be its own account.`}>
        Same account as {names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}
      </span>
    );
  }
  if (check.kind === 'mismatch') {
    return (
      <span className="pill warn"
            title={`${account.label} is now signed in to a different Claude account than before. Open its page to keep it or switch back.`}>
        Different account
      </span>
    );
  }
  return null;
}

/** The explanation and what to do, on the account's own page. */
export function AccountCheckBanner({ account, actions }) {
  const check = account.accountCheck;
  if (!check) return null;
  const names = sharedNames(account);
  if (names.length > 0) {
    return (
      <div className="banner account-check">
        <span>
          <strong>{account.label} and {names.join(', ')} are signed in to the same Claude account.</strong>{' '}
          Their usage and limits are then one and the same, and both windows write the same account's
          chats. In one of them, sign out in Claude (your name at the bottom left → Log out) and sign in with
          another account, or delete the extra profile.
        </span>
      </div>
    );
  }
  if (check.kind === 'mismatch') {
    return (
      <div className="banner account-check">
        <span>
          <strong>{account.label} is now signed in to a different Claude account than before.</strong>{' '}
          If that's on purpose, keep it. If not, sign out in its Claude window and sign in with the account
          it had.
        </span>
        <span className="spacer" />
        <button className="subtle" onClick={() => actions.acceptAccount(account)}>Keep this account</button>
      </div>
    );
  }
  return null;
}
