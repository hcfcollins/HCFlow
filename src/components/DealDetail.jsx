import { useState } from "react";
import TodoList from "./TodoList";

export default function DealDetail({
  transaction,
  stages,
  currentAgent,
  onBack,
  onStageChange,
  onRequestUnderContract,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onLockboxChange,
}) {
  const isBroker = currentAgent.role === "broker";
  const [lockboxCode, setLockboxCode] = useState(transaction.lockbox_code || "");
  const [lockboxNote, setLockboxNote] = useState(transaction.lockbox_note || "");

  function handleStageChange(newStage) {
    if (newStage === "contract" && transaction.stage !== "contract") {
      onRequestUnderContract(transaction);
    } else {
      onStageChange(transaction.id, newStage);
    }
  }

  function handleHasLockboxToggle(checked) {
    onLockboxChange(transaction.id, { hasLockbox: checked, lockboxCode, lockboxNote });
  }

  function handleLockboxBlur() {
    onLockboxChange(transaction.id, {
      hasLockbox: transaction.has_lockbox,
      lockboxCode,
      lockboxNote,
    });
  }

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">{transaction.town || transaction.side}</div>
          <h1>{transaction.address}</h1>
        </div>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      <label>
        Stage
        <select value={transaction.stage} onChange={(e) => handleStageChange(e.target.value)} className="stage-select">
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      {transaction.stage === "comps" && onCompsStatusChange && (
        <div className="comps-status-toggle">
          {["Need to Send Comp", "Waiting to List"].map((status) => (
            <button
              key={status}
              type="button"
              className={`comps-status-btn ${transaction.comps_status === status ? "active" : ""}`}
              onClick={() => onCompsStatusChange(transaction.id, status)}
            >
              {status}
            </button>
          ))}
        </div>
      )}

      <div className="detail-section">
        <h2 className="comps-section-title">Deal Info</h2>
        <div className="detail-grid">
          <div>
            <div className="detail-label">Side</div>
            <div>{transaction.side}</div>
          </div>
          <div>
            <div className="detail-label">Property Style</div>
            <div>{transaction.property_style || "—"}</div>
          </div>
          <div>
            <div className="detail-label">Price</div>
            <div>{transaction.price ? `$${Number(transaction.price).toLocaleString()}` : "—"}</div>
          </div>
          {isBroker && (
            <div>
              <div className="detail-label">Agent</div>
              <div>{transaction.agent?.name || "—"}</div>
            </div>
          )}
          <div>
            <div className="detail-label">Buyer Attorney</div>
            <div>{transaction.buyer_attorney?.name || "TBD"}</div>
          </div>
          <div>
            <div className="detail-label">Seller Attorney</div>
            <div>{transaction.seller_attorney?.name || "TBD"}</div>
          </div>
        </div>
      </div>

      <div className="detail-section">
        <h2 className="comps-section-title">Lockbox</h2>
        <label className="tbd-toggle">
          <input
            type="checkbox"
            checked={!!transaction.has_lockbox}
            onChange={(e) => handleHasLockboxToggle(e.target.checked)}
          />
          Has a lockbox
        </label>
        {transaction.has_lockbox && (
          <>
            <input
              placeholder="Lockbox code"
              value={lockboxCode}
              onChange={(e) => setLockboxCode(e.target.value)}
              onBlur={handleLockboxBlur}
            />
            <input
              placeholder="Lockbox note"
              value={lockboxNote}
              onChange={(e) => setLockboxNote(e.target.value)}
              onBlur={handleLockboxBlur}
            />
          </>
        )}
      </div>

      <div className="detail-section">
        <h2 className="comps-section-title">Notes</h2>
        <textarea
          defaultValue={transaction.notes || ""}
          placeholder="Notes…"
          onBlur={(e) => onNotesChange(transaction.id, e.target.value)}
          rows={3}
          className="tx-notes"
        />
      </div>

      {transaction.stage === "won" && (
        <div className="detail-section">
          <h2 className="comps-section-title">To-Do</h2>
          <TodoList
            todos={transaction.todos}
            onAdd={(text) => onAddTodo(transaction.id, text)}
            onToggle={onToggleTodo}
          />
        </div>
      )}

      <div className="detail-section">
        <h2 className="comps-section-title">Documents</h2>
        <p className="field-help">Files live in Dropbox — this list tracks status only.</p>
        {transaction.documents?.length ? (
          <ul className="detail-list">
            {transaction.documents.map((d) => (
              <li key={d.id}>
                {d.name} — {d.status}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No documents tracked yet.</p>
        )}
      </div>

      <div className="detail-section">
        <h2 className="comps-section-title">Activity</h2>
        {transaction.activity_log?.length ? (
          <ul className="detail-list">
            {[...transaction.activity_log]
              .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              .map((a) => (
                <li key={a.id}>
                  <strong>{a.label}</strong>
                  {a.detail ? ` — ${a.detail}` : ""}
                </li>
              ))}
          </ul>
        ) : (
          <p className="empty-state">No activity yet.</p>
        )}
      </div>
    </div>
  );
}
