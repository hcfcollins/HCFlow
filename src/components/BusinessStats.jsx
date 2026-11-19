import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

// Spreadsheet View → "Business Snapshot": headline numbers for the whole book
// (or one agent, following the spreadsheet's agent filter).
//
// Counting rules:
//  - A "transaction" is a side. An in-house deal (both sides ours, linked by
//    other_side_id) is 2 transactions — that's how a brokerage counts them.
//  - Dollar volume counts each PROPERTY once, so an in-house deal's price
//    isn't doubled.
//  - Closed and terminated deals follow the year picker (closing date /
//    termination date). Under contract and active listings are always "right
//    now". Comps (leads) aren't transactions and are left out.

const TYPES = ["Residential", "Land", "Commercial"];
const typeOf = (tx) => (TYPES.includes(tx.property_style) ? tx.property_style : "Other");
const yearOf = (d) => (/^\d{4}/.test(String(d || "")) ? String(d).slice(0, 4) : null);
const price = (tx) => Number(tx.price) || 0;
const sideOf = (tx) => (tx.side === "Split" ? "Split" : tx.side === "Buy" ? "Buy" : "Sell");
const money = (n) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
  return `$${v.toLocaleString()}`;
};
const fullMoney = (n) => `$${Math.round(n || 0).toLocaleString()}`;

/** Total price counting each property once (in-house pairs share one price). */
function volume(list) {
  const seen = new Set();
  let total = 0;
  for (const tx of list) {
    const key = tx.other_side_id ? [tx.id, tx.other_side_id].sort().join("|") : tx.id;
    if (seen.has(key)) continue;
    seen.add(key);
    total += price(tx);
  }
  return total;
}
const propertyCount = (list) => new Set(list.map((tx) => (tx.other_side_id ? [tx.id, tx.other_side_id].sort().join("|") : tx.id))).size;

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDays(ymd, n) {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function Tile({ value, label, sub, title }) {
  return (
    <div className="bs-tile" title={title}>
      <span className="bs-tile-value">{value}</span>
      <span className="bs-tile-label">{label}</span>
      {sub && <span className="bs-tile-sub">{sub}</span>}
    </div>
  );
}

export default function BusinessStats({ transactions, agentFilter = "", agentName = "" }) {
  const [open, setOpen] = useState(true);
  const thisYear = String(new Date().getFullYear());
  const [year, setYear] = useState(thisYear); // "" = all time

  const years = useMemo(() => {
    const ys = new Set([thisYear]);
    for (const tx of transactions) {
      if (tx.stage === "closed" && yearOf(tx.next_date)) ys.add(yearOf(tx.next_date));
      if (tx.terminated_at) ys.add(yearOf(tx.terminated_at));
    }
    return [...ys].filter(Boolean).sort().reverse();
  }, [transactions, thisYear]);

  const s = useMemo(() => {
    const mine = transactions.filter((tx) => tx.stage !== "comps" && (!agentFilter || tx.agent_id === agentFilter));
    const live = mine.filter((tx) => !tx.terminated_at);
    const inYear = (d) => !year || yearOf(d) === year;

    const closed = live.filter((tx) => tx.stage === "closed" && inYear(tx.next_date));
    const contract = live.filter((tx) => tx.stage === "contract");
    const active = live.filter((tx) => tx.stage === "won" || tx.stage === "market");
    const terminated = mine.filter((tx) => tx.terminated_at && inYear(tx.terminated_at));
    const today = todayYmd();
    const soon = contract.filter((tx) => /^\d{4}-\d{2}-\d{2}/.test(tx.next_date || "") && tx.next_date.slice(0, 10) >= today && tx.next_date.slice(0, 10) <= plusDays(today, 30));

    const soldVolume = volume(closed);
    const closedProps = propertyCount(closed.filter((tx) => price(tx) > 0));
    const biggest = closed.reduce((best, tx) => (price(tx) > price(best || {}) ? tx : best), null);

    const byType = [...TYPES, "Other"].map((type) => {
      const of = (list) => list.filter((tx) => typeOf(tx) === type);
      return {
        type,
        active: of(active).length,
        contract: of(contract).length,
        closed: of(closed).length,
        terminated: of(terminated).length,
        sold: volume(of(closed)),
      };
    }).filter((r) => r.type !== "Other" || r.active + r.contract + r.closed + r.terminated > 0);

    const done = [...closed, ...contract];
    const bySide = ["Sell", "Buy", "Split"].map((side) => ({
      side,
      closed: closed.filter((tx) => sideOf(tx) === side).length,
      contract: contract.filter((tx) => sideOf(tx) === side).length,
    }));
    const inHouse = propertyCount(done.filter((tx) => tx.other_side_id));
    const byRegion = ["VT", "NH"].map((r) => ({ r, n: closed.filter((tx) => tx.region === r).length }));
    const fellThroughRate = closed.length + terminated.length ? Math.round((terminated.length / (closed.length + terminated.length)) * 100) : null;

    return {
      closed, contract, active, terminated, soon, done,
      soldVolume,
      avgSale: closedProps ? soldVolume / closedProps : 0,
      pendingVolume: volume(contract),
      activeVolume: volume(active),
      terminatedVolume: volume(terminated),
      soonVolume: volume(soon),
      biggest,
      byType, bySide, inHouse, byRegion, fellThroughRate,
    };
  }, [transactions, agentFilter, year]);

  const period = year ? `in ${year}` : "all time";

  return (
    <section className="bs-panel">
      <div className="bs-head">
        <button type="button" className="collapsible-header bs-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <h2 className="comps-section-title">📊 Business Snapshot{agentFilter && agentName ? ` — ${agentName}` : ""}</h2>
          <ChevronDown size={18} className={`collapse-chevron ${open ? "collapse-chevron--open" : ""}`} />
        </button>
        {open && (
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year for closed and terminated deals" title="Year for closed and terminated deals (by closing / termination date)">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            <option value="">All time</option>
          </select>
        )}
      </div>

      {open && (
        <>
          <div className="bs-tiles">
            <Tile
              value={s.done.length}
              label="Total Transactions"
              sub={`${s.closed.length} closed ${period} · ${s.contract.length} under contract`}
              title="Sides: closed plus currently under contract. An in-house deal counts as 2."
            />
            <Tile value={money(s.soldVolume)} label={`Sold ${year || "(all time)"}`} sub={`${s.closed.length} closed · avg ${money(s.avgSale)}`} title={fullMoney(s.soldVolume)} />
            <Tile value={money(s.pendingVolume)} label="Pending (Under Contract)" sub={`${s.contract.length} deal${s.contract.length === 1 ? "" : "s"}`} title={fullMoney(s.pendingVolume)} />
            <Tile value={s.soon.length} label="Closing in Next 30 Days" sub={money(s.soonVolume)} title={fullMoney(s.soonVolume)} />
            <Tile value={s.active.length} label="Active Listings" sub={`${money(s.activeVolume)} listed`} title="Listing Won + On Market" />
            <Tile
              value={s.terminated.length}
              label={`Terminated ${year || "(all time)"}`}
              sub={`${money(s.terminatedVolume)} fell through${s.fellThroughRate != null ? ` · ${s.fellThroughRate}% of finished deals` : ""}`}
              title="Fell-through rate = terminated ÷ (closed + terminated) for the period"
            />
          </div>

          <div className="bs-tables">
            <table className="bs-table">
              <caption>By property type</caption>
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Active</th>
                  <th scope="col">Under Contract</th>
                  <th scope="col">Closed</th>
                  <th scope="col">Terminated</th>
                  <th scope="col">Sold $</th>
                </tr>
              </thead>
              <tbody>
                {s.byType.map((r) => (
                  <tr key={r.type}>
                    <th scope="row">{r.type}</th>
                    <td>{r.active}</td>
                    <td>{r.contract}</td>
                    <td>{r.closed}</td>
                    <td>{r.terminated}</td>
                    <td title={fullMoney(r.sold)}>{r.sold ? money(r.sold) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="bs-table">
              <caption>By side</caption>
              <thead>
                <tr>
                  <th scope="col">Side</th>
                  <th scope="col">Under Contract</th>
                  <th scope="col">Closed</th>
                </tr>
              </thead>
              <tbody>
                {s.bySide.map((r) => (
                  <tr key={r.side}>
                    <th scope="row">{r.side === "Sell" ? "Listing" : r.side === "Buy" ? "Buyer" : "Split"}</th>
                    <td>{r.contract}</td>
                    <td>{r.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="bs-facts">
              <div className="bs-facts-title">Fun facts {period}</div>
              <ul>
                {s.biggest && price(s.biggest) > 0 && (
                  <li>
                    🏆 Biggest sale: <strong>{fullMoney(price(s.biggest))}</strong> — {s.biggest.address}
                  </li>
                )}
                <li>
                  🤝 In-house deals (both sides ours): <strong>{s.inHouse}</strong>
                </li>
                <li>
                  🗺️ Closed in VT / NH: <strong>{s.byRegion[0].n}</strong> / <strong>{s.byRegion[1].n}</strong>
                </li>
                <li>
                  💵 Average sale price: <strong>{s.avgSale ? fullMoney(s.avgSale) : "—"}</strong>
                </li>
              </ul>
            </div>
          </div>
          <p className="field-help bs-note">
            Transactions count sides (an in-house deal is 2); dollar totals count each property once. Closed and terminated follow the year;
            under contract and active listings are as of today.
          </p>
        </>
      )}
    </section>
  );
}
