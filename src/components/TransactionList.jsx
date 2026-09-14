import TodoList from "./TodoList";

export default function TransactionList({
  transactions,
  stages,
  currentAgent,
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
      {transactions.map((tx) => {
        const stageLabel = stages.find((s) => s.key === tx.stage)?.label || tx.stage;
        return (
          <div key={tx.id} className="tx-card">
            <div className="tx-card-top">
              <div>
                <div className="tx-address">{tx.address}</div>
                <div className="tx-sub">
                  {tx.town} · {tx.side} side
                  {isBroker && tx.agent ? ` · ${tx.agent.name}` : ""}
                </div>
              </div>
              <button
                type="button"
                className="tx-stage-pill tx-stage-pill--btn"
                onClick={() => onOpenDetail && onOpenDetail(tx)}
              >
                {stageLabel}
              </button>
            </div>

            {tx.stage === "comps" && onCompsStatusChange && (
              <div className="comps-status-toggle">
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
              rows={2}
              className="tx-notes"
            />

            {tx.stage === "won" && onAddTodo && (
              <TodoList
                todos={tx.todos}
                onAdd={(text) => onAddTodo(tx.id, text)}
                onToggle={(id, done) => onToggleTodo(id, done)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
