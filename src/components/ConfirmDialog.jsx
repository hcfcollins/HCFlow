import { useState } from "react";

/** Branded replacement for window.confirm/window.prompt — a centered modal,
 * optionally with a reason textarea (pass promptLabel to show it). */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  promptLabel,
  promptPlaceholder,
  onConfirm,
  onCancel,
}) {
  const [reasonText, setReasonText] = useState("");

  if (!open) return null;

  function handleConfirm() {
    onConfirm(promptLabel ? reasonText : undefined);
    setReasonText("");
  }

  function handleCancel() {
    setReasonText("");
    onCancel();
  }

  return (
    <div className="confirm-dialog-overlay" onClick={handleCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">{title}</h2>
        {message && <p className="confirm-dialog-message">{message}</p>}
        {promptLabel && (
          <label className="confirm-dialog-prompt-label">
            {promptLabel}
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder={promptPlaceholder}
              rows={3}
              autoFocus
            />
          </label>
        )}
        <div className="confirm-dialog-actions">
          <button type="button" onClick={handleCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "comps-status-btn comps-status-btn--danger confirm-dialog-confirm" : "google-btn confirm-dialog-confirm"}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
