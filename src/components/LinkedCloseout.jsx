// Close-Out Calculator for a deal where we have both sides (other_side_id):
// one screen with a tab per side and the whole sale's commission on top.
// Each side still saves on its own (its own agent payout, Xero bills and
// closeout email) — saving one side moves straight to the other.
import { useState } from "react";
import CloseoutCalculator from "./CloseoutCalculator";
import { useToast } from "../lib/ToastContext";

const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function expectedCommission(tx) {
  const co = one(tx?.closeouts) || {};
  if (co.anticipated_commission != null) return Number(co.anticipated_commission);
  const pct = Number(one(tx?.commission_data)?.commission_pct ?? co.commission_pct ?? 0);
  return tx?.price && pct ? Math.round(tx.price * pct) / 100 : null;
}

const sideLabel = (tx) => `${tx.side === "Buy" ? "Buyer side" : tx.side === "Sell" ? "Listing side" : "Split"}${tx.agent?.name ? ` · ${tx.agent.name.split(" ")[0]}` : ""}`;
const isDone = (tx) => tx.stage === "closed" && Boolean(one(tx.closeouts)?.calculated_at);

export default function LinkedCloseout({ transaction, transactions = [], onCancel, onSaved }) {
  const other = transaction.other_side_id ? transactions.find((t) => t.id === transaction.other_side_id) : null;
  const [activeId, setActiveId] = useState(transaction.id);
  const [savedIds, setSavedIds] = useState([]);
  const showToast = useToast();

  if (!other) return <CloseoutCalculator transaction={transaction} onCancel={onCancel} onSaved={onSaved} />;

  // Listing side first.
  const sides = [transaction, other].sort((a, b) => (a.side === "Sell" ? -1 : b.side === "Sell" ? 1 : 0));
  const active = sides.find((t) => t.id === activeId) || transaction;
  const done = (tx) => savedIds.includes(tx.id) || isDone(tx);
  const amounts = sides.map(expectedCommission);
  const total = amounts.every((a) => a != null) ? amounts.reduce((s, a) => s + a, 0) : null;

  function handleSaved() {
    const next = sides.find((t) => t.id !== active.id);
    const nowSaved = [...savedIds, active.id];
    setSavedIds(nowSaved);
    if (next && !nowSaved.includes(next.id) && !isDone(next)) {
      showToast(`${sideLabel(active)} saved — now the ${sideLabel(next).split(" · ")[0].toLowerCase()}`);
      setActiveId(next.id);
    } else {
      onSaved();
    }
  }

  return (
    <div className="linked-closeout">
      <div className="linked-closeout-bar">
        <div className="linked-closeout-tabs" role="tablist">
          {sides.map((t, i) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === active.id} className={`trust-tab ${t.id === active.id ? "trust-tab--on" : ""}`} onClick={() => setActiveId(t.id)}>
              {done(t) ? "✓ " : ""}
              {sideLabel(t)}
              {amounts[i] != null ? ` · ${money(amounts[i])}` : ""}
            </button>
          ))}
        </div>
        <div className="field-help linked-closeout-total">
          We have both sides of this sale{total != null ? <> — whole sale commission about <strong>{money(total)}</strong></> : ""}. Save each side; saving one opens the other.
        </div>
      </div>
      <CloseoutCalculator key={active.id} transaction={active} onCancel={savedIds.length ? onSaved : onCancel} onSaved={handleSaved} />
    </div>
  );
}
