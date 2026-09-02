export default function TransactionList({ transactions, stages, currentAgent, onStageChange, onNotesChange }) {
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
              <span className="tx-stage-pill">{stageLabel}</span>
            </div>

            <select
              value={tx.stage}
              onChange={(e) => onStageChange(tx.id, e.target.value)}
              className="stage-select"
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>

            <textarea
              defaultValue={tx.notes || ""}
              placeholder="Notes…"
              onBlur={(e) => onNotesChange(tx.id, e.target.value)}
              rows={2}
              className="tx-notes"
            />
          </div>
        );
      })}
    </div>
  );
}
