import { useState } from "react";
import { Signpost, Percent, Lock } from "lucide-react";
import TodoList from "./TodoList";

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
  const isActiveListing = tx.stage === "won" || tx.stage === "market";

  return (
    <div className="tx-card" onClick={() => onOpenDetail && onOpenDetail(tx)}>
      <div className="tx-card-top">
        <div>
          <div className="tx-address">{tx.address}</div>
          <div className="tx-sub">
            {tx.town} · {tx.side} side
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

      {isActiveListing && (tx.has_sign || tx.ba_comp || tx.has_lockbox) && (
        <div className="tx-icons-row" onClick={(e) => e.stopPropagation()}>
          {tx.has_sign && (
            <span className="tx-icon-badge" title="Sign is up">
              <Signpost size={14} /> Sign
            </span>
          )}
          {tx.ba_comp && (
            <span className="tx-icon-badge" title="Buyer agency commission">
              <Percent size={14} /> {tx.ba_comp}
            </span>
          )}
          {tx.has_lockbox && (
            <button type="button" className="tx-icon-badge tx-icon-badge--btn" onClick={() => setLockboxOpen((o) => !o)}>
              <Lock size={14} /> Lockbox
            </button>
          )}
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
          {["Need to Send Comp", "Waiting to List"].map((status) => (
            <button
              key={status}
              type="button"
              className={`comps-status-btn ${tx.comps_status === status ? "active" : ""}`}
              onClick={() => onCompsStatusChange(tx.id, status)}
            >
              {status}
            </button>
          ))}
        </div>
      )}

      <textarea
        defaultValue={tx.notes || ""}
        placeholder="Notes…"
        onBlur={(e) => onNotesChange(tx.id, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        rows={2}
        className="tx-notes"
      />

      {tx.stage === "won" && onAddTodo && (
        <div onClick={(e) => e.stopPropagation()}>
          <TodoList todos={tx.todos} onAdd={(text) => onAddTodo(tx.id, text)} onToggle={(id, done) => onToggleTodo(id, done)} />
        </div>
      )}
    </div>
  );
}
