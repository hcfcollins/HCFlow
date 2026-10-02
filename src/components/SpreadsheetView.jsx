import { useEffect, useMemo, useState } from "react";
import { updateTransactionFields, upsertCommissionData, fetchAllAgents } from "../lib/transactions";
import { useToast } from "../lib/ToastContext";
import { PROPERTY_STYLES } from "../lib/compFieldOptions";
import { CLIENT_SOURCES } from "./UnderContractForm";
import { formatDate } from "./DealDetail";

const STAGE_OPTIONS = [
  { value: "comps", label: "Comp" },
  { value: "won", label: "Listing Won" },
  { value: "market", label: "On Market" },
  { value: "contract", label: "Under Contract" },
  { value: "closed", label: "Closed" },
];
const SIDE_OPTIONS = ["Buy", "Sell", "Split"];
const REGION_OPTIONS = ["VT", "NH"];
const SIGN_STATUS_OPTIONS = ["Yes", "No", "Seller Declined"];
const LEAD_TYPE_OPTIONS = ["Organic", "Provided"];
const YES_NO_OPTIONS = ["Yes", "No"];

// Each column pulls from one of three places on a transaction row:
// "tx" (the transactions table directly, via updateTransactionFields),
// "commission" (commission_data, via upsertCommissionData — upsert-safe even
// when no row exists yet for an early-stage deal), or "closeout" (view-only —
// see the plan's note on why editing these here would risk bypassing the real
// Close-Out Calculator's "mark as closed" side effect).
const COLUMNS = [
  { key: "address", label: "Address", source: "tx", type: "text" },
  { key: "town", label: "Town", source: "tx", type: "text" },
  { key: "region", label: "Region", source: "tx", type: "select", options: REGION_OPTIONS },
  { key: "side", label: "Side", source: "tx", type: "select", options: SIDE_OPTIONS },
  { key: "stage", label: "Stage", source: "tx", type: "select", options: STAGE_OPTIONS },
  { key: "property_style", label: "Property Style", source: "tx", type: "select", options: PROPERTY_STYLES },
  { key: "price", label: "Price", source: "tx", type: "number" },
  // Stored as a plain YYYY-MM-DD string (not a real date column — see the Next/
  // Closing Date tooltip) but edited with a native date picker and displayed
  // formatted, same as inspection/financing dates below.
  { key: "next_date", label: "Next / Closing Date", source: "tx", type: "date", format: formatDate },
  { key: "sign_status", label: "Sign Status", source: "tx", type: "select", options: SIGN_STATUS_OPTIONS },
  { key: "seller_name", label: "Seller Name", source: "tx", type: "text" },
  { key: "buyer_name", label: "Buyer Name", source: "tx", type: "text" },
  { key: "notes", label: "Notes", source: "tx", type: "text" },
  { key: "lead_type", label: "Lead Type", source: "commission", type: "select", options: LEAD_TYPE_OPTIONS },
  { key: "client_source", label: "Client Source", source: "commission", type: "select", options: CLIENT_SOURCES },
  { key: "referral_owed_to", label: "Referral Owed To", source: "commission", type: "text" },
  { key: "referral_pct", label: "Referral %", source: "commission", type: "number" },
  { key: "hold_deposit", label: "Hold Deposit?", source: "commission", type: "select", options: YES_NO_OPTIONS },
  { key: "deposit_amount", label: "Deposit Amount", source: "commission", type: "number" },
  { key: "inspection_date", label: "Inspection Date", source: "commission", type: "date", format: formatDate },
  { key: "financing_date", label: "Financing Date", source: "commission", type: "date", format: formatDate },
  { key: "appraiser", label: "Appraiser", source: "commission", type: "text" },
  { key: "commission_pct", label: "Commission %", source: "closeout", readOnly: true },
  { key: "agent_split_pct", label: "Agent Split %", source: "closeout", readOnly: true },
  { key: "commission_after_referral", label: "Comm. After Referral", source: "closeout", readOnly: true },
  { key: "agent_commission", label: "Agent Commission", source: "closeout", readOnly: true },
  { key: "holly_commission", label: "Holly Commission", source: "closeout", readOnly: true },
  { key: "fran_commission", label: "Fran Commission", source: "closeout", readOnly: true },
  { key: "bank_amount", label: "Bank Amount", source: "closeout", readOnly: true },
];

function getValue(tx, col) {
  if (col.source === "tx") return tx[col.key];
  if (col.source === "commission") return tx.commission_data?.[col.key];
  return tx.closeouts?.[col.key];
}

/** Select columns can use either a plain string array (side, sign status, ...) or
 * {value, label} objects (stage, agent) — resolve whichever was used to its label
 * for the closed-cell display instead of showing the raw stored value. */
function optionLabelFor(options, val) {
  if (!options) return val;
  const match = options.find((o) => (o.value ?? o) === val);
  return match ? match.label ?? match : val;
}

function EditableCell({ value, displayValue, type, options, format, readOnly, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => setDraft(value ?? ""), [value]);

  const shown = displayValue ?? (format ? format(value) : type === "select" ? optionLabelFor(options, value) : value);
  const display = shown === null || shown === undefined || shown === "" ? "—" : String(shown);

  if (readOnly) {
    return <span className="sv-cell-readonly">{display}</span>;
  }

  function commit() {
    setEditing(false);
    const normalized = draft === "" ? null : draft;
    if (normalized !== (value ?? null)) onSave(normalized);
  }

  if (!editing) {
    return (
      <button type="button" className="sv-cell-btn" onClick={() => setEditing(true)}>
        {display}
      </button>
    );
  }

  if (type === "select") {
    return (
      <select autoFocus className="sv-cell-input" value={draft ?? ""} onChange={(e) => setDraft(e.target.value)} onBlur={commit}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value ?? o} value={o.value ?? o}>
            {o.label ?? o}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      type={type}
      className="sv-cell-input"
      value={draft ?? ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
    />
  );
}

function thisMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function SpreadsheetView({ transactions, onBack, onOpenDetail, onRefresh }) {
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [sortKey, setSortKey] = useState("address");
  const [sortDir, setSortDir] = useState("asc");
  const [summaryMonth, setSummaryMonth] = useState(""); // "" = all time, else "YYYY-MM"
  const showToast = useToast();

  useEffect(() => {
    fetchAllAgents().then(setAgents).catch(() => {});
  }, []);

  const agentOptions = agents.map((a) => ({ value: a.id, label: a.name }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (agentFilter && tx.agent_id !== agentFilter) return false;
      if (stageFilter && tx.stage !== stageFilter) return false;
      if (q && ![tx.address, tx.seller_name, tx.buyer_name].some((f) => f?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [transactions, search, agentFilter, stageFilter]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortKey === "agent" ? a.agent?.name : col ? getValue(a, col) : a[sortKey];
      const bv = sortKey === "agent" ? b.agent?.name : col ? getValue(b, col) : b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  // Independent of the table's own search/agent/stage filters above — this answers
  // a specific financial question (what's the brokerage keeping / what's Fran owed
  // for deals closing in X), not "what's currently visible in the table." Based on
  // next_date (the closing date) falling in the selected month, not on stage, so a
  // future month naturally only ever includes deals that haven't closed yet.
  const summary = useMemo(() => {
    let bankTotal = 0;
    let franTotal = 0;
    let count = 0;
    for (const tx of transactions) {
      const co = tx.closeouts;
      if (!co || (co.bank_amount == null && co.fran_commission == null)) continue;
      if (summaryMonth) {
        const txMonth = tx.next_date && /^\d{4}-\d{2}/.test(tx.next_date) ? tx.next_date.slice(0, 7) : null;
        if (txMonth !== summaryMonth) continue;
      }
      bankTotal += Number(co.bank_amount) || 0;
      franTotal += Number(co.fran_commission) || 0;
      count++;
    }
    return { bankTotal, franTotal, count };
  }, [transactions, summaryMonth]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  async function handleSaveTx(tx, key, value) {
    try {
      await updateTransactionFields(tx.id, { [key]: value });
      onRefresh();
      showToast("Saved");
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    }
  }

  async function handleSaveCommission(tx, key, value) {
    try {
      await upsertCommissionData(tx.id, { [key]: value });
      onRefresh();
      showToast("Saved");
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    }
  }

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Broker Tools</div>
          <h1>Spreadsheet View</h1>
        </div>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      <div className="sv-filters">
        <input
          type="text"
          className="sv-filter-search"
          placeholder="Search address or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)}>
          <option value="">All Agents</option>
          {agentOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
          <option value="">All Stages</option>
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sv-table-wrap">
        <table className="sv-table">
          <thead>
            <tr>
              <th className="sv-th-sortable" onClick={() => handleSort("agent")}>
                Agent{sortKey === "agent" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="sv-th-sortable"
                  onClick={() => handleSort(col.key)}
                  title={col.key === "next_date" ? "The deal's next key date — its closing date once Under Contract, used informally before that." : undefined}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((tx) => (
              <tr key={tx.id}>
                <td>
                  <EditableCell
                    value={tx.agent_id}
                    displayValue={tx.agent?.name}
                    type="select"
                    options={agentOptions}
                    onSave={(v) => handleSaveTx(tx, "agent_id", v)}
                  />
                </td>
                {COLUMNS.map((col) => (
                  <td key={col.key}>
                    <EditableCell
                      value={getValue(tx, col)}
                      type={col.type}
                      options={col.options}
                      format={col.format}
                      readOnly={col.readOnly}
                      onSave={(v) => (col.source === "tx" ? handleSaveTx(tx, col.key, v) : handleSaveCommission(tx, col.key, v))}
                    />
                  </td>
                ))}
                <td className="sv-row-actions">
                  <button type="button" className="comps-minimize-btn" onClick={() => onOpenDetail(tx)}>
                    Open →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <p className="empty-state">No deals match these filters.</p>}

      <div className="sv-summary">
        <h2 className="comps-section-title">Commission Summary</h2>
        <div className="sv-filters">
          <button type="button" className="comps-minimize-btn" onClick={() => setSummaryMonth("")}>
            All Time
          </button>
          <button type="button" className="comps-minimize-btn" onClick={() => setSummaryMonth(thisMonthStr())}>
            This Month
          </button>
          <input type="month" value={summaryMonth} onChange={(e) => setSummaryMonth(e.target.value)} />
        </div>
        <div className="sv-summary-stats">
          <div className="sv-summary-stat">
            <span className="sv-summary-stat-value">${summary.bankTotal.toLocaleString()}</span>
            <span className="sv-summary-stat-label">Brokerage Keeps</span>
          </div>
          <div className="sv-summary-stat">
            <span className="sv-summary-stat-value">${summary.franTotal.toLocaleString()}</span>
            <span className="sv-summary-stat-label">Fran's Commission</span>
          </div>
        </div>
        <p className="field-help">
          Across {summary.count} closed-out deal{summary.count === 1 ? "" : "s"}
          {summaryMonth ? ` closing in ${monthLabel(summaryMonth)}` : " (all time)"}. Only counts deals that have
          actually been run through the Close-Out Calculator — figures aren't estimated for deals that haven't yet.
        </p>
      </div>
    </div>
  );
}
