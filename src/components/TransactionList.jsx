import { useState } from "react";
import { Signpost, Percent, Lock, Mail } from "lucide-react";
import TodoList from "./TodoList";

const PROPERTY_STYLE_TAGS = {
  Residential: { emoji: "🏠", label: "Single Family", className: "tx-tag--residential" },
  Land: { emoji: "🌲", label: "Land", className: "tx-tag--land" },
  "Multi Family": { emoji: "🏘️", label: "Multi Family", className: "tx-tag--multifamily" },
  Commercial: { emoji: "🏢", label: "Commercial", className: "tx-tag--commercial" },
};

export default function TransactionList({
  transactions,
  stages,
  currentAgent,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onOpenDetail,
}) {
  const isBroker = currentAgent.role === "broker";

  if (transactions.length === 0) {
    return <p className="empty-state">No transactions yet.</p>;
  }

  return (
    <div className="tx-list">
      {transactions.map((tx) => (
        <TxCard
          key={tx.id}
          tx={tx}
          stages={stages}
          isBroker={isBroker}
          onStageChange={onStageChange}
          onNotesChange={onNotesChange}
          onCompsStatusChange={onCompsStatusChange}
          onAddTodo={onAddTodo}
          onToggleTodo={onToggleTodo}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}

function TxCard({
  tx,
  stages,
  isBroker,
  onStageChange,
  onNotesChange,
  onCompsStatusChange,
  onAddTodo,
  onToggleTodo,
  onOpenDetail,
}) {
  const [lockboxOpen, setLockboxOpen] = useState(false);
  const [signNoteOpen, setSignNoteOpen] = useState(false);
  const isActiveListing = tx.stage === "won" || tx.stage === "market";
  const isBuySide = tx.side === "Buy";
  const signDeclined = tx.sign_status === "Seller Declined";

  return (
    <div className={`tx-card ${tx.terminated_at ? "tx-card--terminated" : ""}`} onClick={() => onOpenDetail && onOpenDetail(tx)}>
      <div className="tx-card-top">
        <div>
          <div className="tx-address">
            {tx.address}
            {tx.terminated_at && <span className="tx-terminated-badge">Terminated</span>}
          </div>
          <div className="tx-sub">
            {tx.town}
            {isActiveListing ? "" : ` · ${tx.side} side`}
            {isBroker && tx.agent ? ` · ${tx.agent.name}` : ""}
          </div>
        </div>
        <select
          value={tx.stage}
          onChange={(e) => onStageChange(tx, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          className="tx-stage-select"
        >
          {stages.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {isActiveListing && PROPERTY_STYLE_TAGS[tx.property_style] && (
        <div className="tx-tag-row" onClick={(e) => e.stopPropagation()}>
          <span className={`tx-icon-badge tx-tag ${PROPERTY_STYLE_TAGS[tx.property_style].className}`}>
            {PROPERTY_STYLE_TAGS[tx.property_style].emoji} {PROPERTY_STYLE_TAGS[tx.property_style].label}
          </span>
        </div>
      )}

      {(isActiveListing || (tx.ba_comp && !isBuySide)) && (
        <div className="tx-icons-row" onClick={(e) => e.stopPropagation()}>
          {isActiveListing && tx.sign_status === "Yes" && (
            <span className="tx-icon-badge tx-icon-badge--sign-yes" title="Sign is installed">
              <Signpost size={14} /> Sign
            </span>
          )}
          {isActiveListing && signDeclined && (
            <button
              type="button"
              className="tx-icon-badge tx-icon-badge--btn tx-icon-badge--declined"
              onClick={() => setSignNoteOpen((o) => !o)}
            >
              <Signpost size={14} /> Sign
            </button>
          )}
          {isActiveListing && !signDeclined && tx.sign_status !== "Yes" && (
            <span className="tx-icon-badge tx-icon-badge--sign-need" title="Sign not installed yet">
              <Signpost size={14} /> Need Sign
            </span>
          )}
          {tx.ba_comp && !isBuySide && (
            <span className="tx-icon-badge" title="Buyer agency commission">
              <Percent size={14} /> {tx.ba_comp}
            </span>
          )}
          {isActiveListing && tx.has_lockbox && (
            <button type="button" className="tx-icon-badge tx-icon-badge--btn" onClick={() => setLockboxOpen((o) => !o)}>
              <Lock size={14} /> Lockbox
            </button>
          )}
        </div>
      )}

      {isActiveListing && signNoteOpen && (
        <div className="lockbox-popover" onClick={(e) => e.stopPropagation()}>
          Seller does not want a sign.
        </div>
      )}

      {isActiveListing && lockboxOpen && (
        <div className="lockbox-popover" onClick={(e) => e.stopPropagation()}>
          <div>
            <strong>Code:</strong> {tx.lockbox_code || "—"}
          </div>
          {tx.lockbox_note && (
            <div>
              <strong>Notes/Location:</strong> {tx.lockbox_note}
            </div>
          )}
        </div>
      )}

      {tx.stage === "comps" && onCompsStatusChange && (
        <div className="comps-status-toggle" onClick={(e) => e.stopPropagation()}>
          <span className="comps-status-toggle-label">Move to:</span>
          {tx.comps_status === "Waiting to List" ? (
            <button
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(tx.id, "Need to Send Comp")}
            >
              Need to Send Comp
            </button>
          ) : (
            <button
              type="button"
              className="comps-status-btn"
              onClick={() => onCompsStatusChange(tx.id, "Waiting to List")}
            >
              Waiting to List
            </button>
          )}
          <button type="button" className="comps-status-btn" onClick={() => onStageChange(tx, "won")}>
            Won Listing
          </button>
        </div>
      )}

      {tx.stage === "comps" ? (
        <textarea
          defaultValue={tx.notes || ""}
          placeholder="Notes…"
          onBlur={(e) => onNotesChange(tx.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          rows={2}
          className="tx-notes"
        />
      ) : (
        onAddTodo && (
          <div onClick={(e) => e.stopPropagation()}>
            <TodoList todos={tx.todos} onAdd={(text) => onAddTodo(tx.id, text)} onToggle={(id, done) => onToggleTodo(id, done)} />
          </div>
        )
      )}

      {tx.seller_emails?.length > 0 && (
        <a
          href={`mailto:${tx.seller_emails.join(",")}`}
          className="tx-email-client-btn"
          title={`Email ${tx.seller_emails.join(", ")}`}
          onClick={(e) => e.stopPropagation()}
        >
          <Mail size={14} /> Email Client
        </a>
      )}
    </div>
  );
}
