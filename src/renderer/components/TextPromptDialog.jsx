import React, { useEffect, useRef, useState } from 'react';

export default function TextPromptDialog({
  title, description, label, placeholder, initialValue = '',
  confirmText, onConfirm, onCancel
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await onConfirm(value.trim());
    } catch {
      setBusy(false); // the error is surfaced by the caller's toast
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {description && <p>{description}</p>}

        <label htmlFor="prompt-input">{label}</label>
        <input
          id="prompt-input"
          type="text"
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          maxLength={60}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onCancel();
          }}
        />

        <div className="buttons">
          <button onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!value.trim() || busy}>
            {busy ? 'Working…' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
