import React from 'react';

// The levels a user can pick. 100% ("limit reached") is always on with alerts.
const LEVELS = [50, 60, 70, 80, 90, 95];

/**
 * Limit alerts, on the Accounts page: on/off, which levels alert, the reset
 * alert, and a test notification. The rules themselves live in the main
 * process (alerts.js).
 */
export default function AlertSettings({ settings, actions }) {
  if (!settings || !settings.alertsSupported || !settings.alerts) return null;
  const { on, thresholds, reset } = settings.alerts;

  const toggle = (n) => {
    const next = thresholds.includes(n) ? thresholds.filter((t) => t !== n) : [...thresholds, n];
    actions.setAlerts({ thresholds: next });
  };

  return (
    <div className="setting-row setting-block">
      <input
        id="alerts-on"
        type="checkbox"
        checked={on}
        onChange={(e) => actions.setAlerts({ on: e.target.checked })}
      />
      <span className="setting-body">
        <label htmlFor="alerts-on"><strong>Limit alerts</strong></label>
        <span className="setting-hint">
          A notification when an account's Session or Weekly usage passes a level you pick, and when
          it reaches its limit. Each level alerts once, then again only after that limit resets.
          Works while Multi-Claude is open, even minimised.
        </span>

        {on && (
          <>
            <span className="alert-levels" role="group" aria-label="Alert at">
              <span className="alert-levels-label">Alert at</span>
              {LEVELS.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={thresholds.includes(n) ? 'level on' : 'level'}
                  aria-pressed={thresholds.includes(n)}
                  onClick={() => toggle(n)}
                >
                  {n}%
                </button>
              ))}
              <span className="level fixed" title="Always on while limit alerts are on">100% · limit reached</span>
            </span>

            <label className="setting-sub">
              <input
                type="checkbox"
                checked={reset}
                onChange={(e) => actions.setAlerts({ reset: e.target.checked })}
              />
              Also tell me when a limit resets after it was reached
            </label>
          </>
        )}

        <span className="setting-actions">
          <button type="button" className="ghost" onClick={actions.testAlert}>Send a test alert</button>
        </span>
      </span>
    </div>
  );
}
