import React from 'react';

/**
 * Step-by-step sign-in for an added account's Claude window, by email code.
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
        <h2>Sign in to {account.label}</h2>
        <p>
          The new Claude window is open. Sign in there with an email code. It takes a minute,
          and the account stays signed in.
        </p>

        <ol className="guide-steps">
          <li>
            In the Claude window, click <strong>Get started</strong>.
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
            Paste the code into the Claude window. Done.
          </li>
        </ol>

        <div className="guide-warn">
          Don't click <strong>Continue with Google</strong> in this window. It finishes in your
          browser and goes to your default Claude, so this account would stay signed out.
        </div>

        <div className="buttons">
          <button className="link guide-reopen" onClick={onOpenClaude}>Claude window closed? Open it again</button>
          <span className="spacer" />
          <button onClick={onLater}>Later</button>
          <button className="primary" onClick={onDone}>I'm signed in</button>
        </div>
      </div>
    </div>
  );
}
