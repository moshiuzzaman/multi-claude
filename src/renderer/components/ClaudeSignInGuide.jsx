import React from 'react';

/**
 * The one-time sign-in for an account's own Claude window, by email code.
 *
 * Shown right after an account is created, and on Launch while its window is
 * still signed out. Once signed in, Claude Desktop keeps the sign-in in the
 * account's profile, so Launch opens it signed in from then on.
 *
 * Continue with Google can't be used for an added account: it finishes in the
 * browser, and Windows hands Claude's return link to the default Claude, which
 * ignores it because it didn't start that sign-in. The email code is typed into
 * the account's own window, so it never leaves it. Multi-Claude never sees the
 * code or the sign-in; this dialog only explains the steps.
 */
export default function ClaudeSignInGuide({ account, onOpenClaude, onOpenGmail, onDone, onLater }) {
  return (
    <div className="overlay">
      <div className="modal signin-guide" role="dialog" aria-modal="true"
           onKeyDown={(e) => { if (e.key === 'Escape') onLater(); }}>
        <h2>Sign in to {account.label} once</h2>
        <p>
          Sign in to this account's own Claude window one time. Claude keeps the sign-in, so
          after this <strong>Launch</strong> opens it already signed in.
        </p>

        <ol className="guide-steps">
          <li>
            Open the account's Claude window and click <strong>Get started</strong>.
            <span className="guide-actions">
              <button className="primary" onClick={onOpenClaude}>Open Claude window</button>
            </span>
          </li>
          <li>
            Type the account's email address in <strong>Enter your email</strong>, then
            click <strong>Continue with email</strong>.
            <span className="guide-hint">
              If you normally use Continue with Google, type that same Google email. It's
              the same Claude account.
            </span>
          </li>
          <li>
            Open the email from Anthropic and copy the code.
            <span className="guide-actions">
              <button className="ghost" onClick={onOpenGmail}>Open Gmail</button>
            </span>
            <span className="guide-hint">
              Signed in to several Google accounts? Switch to the right one in Gmail.
            </span>
          </li>
          <li>
            Paste the code into the Claude window. Done, for good.
          </li>
        </ol>

        <div className="guide-warn">
          Don't click <strong>Continue with Google</strong> in this window. It finishes in your
          browser and goes to your default Claude, so this account would stay signed out.
        </div>

        <div className="buttons">
          <span className="spacer" />
          <button onClick={onLater}>Later</button>
          <button className="primary" onClick={onDone}>I'm signed in</button>
        </div>
      </div>
    </div>
  );
}
