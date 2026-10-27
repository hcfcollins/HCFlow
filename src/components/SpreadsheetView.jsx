import { useEffect, useMemo, useState } from "react";
import { DollarSign, Ban, RotateCcw } from "lucide-react";
import {
  updateTransactionFields,
  upsertCommissionData,
  updateCloseoutFields,
  updateTransactionAttorneys,
  fetchAllAgents,
  fetchAttorneys,
  resolveAttorneyId,
  terminateTransaction,
  reactivateTransaction,
} from "../lib/transactions";
import { useToast } from "../lib/ToastContext";
import { PROPERTY_STYLES } from "../lib/compFieldOptions";
import { CLIENT_SOURCES } from "./UnderContractForm";
import { formatDate } from "./DealDetail";
import { TC_FEE_AMOUNTS, calculateCloseout, applyTcFee, round2 } from "../lib/commissionCalc";
import CloseoutCalculator from "./CloseoutCalculator";
import ConfirmDialog from "./ConfirmDialog";

// Just for the Closing Date column — kept separate from the shared formatDate
// (used everywhere else in the app) since this request was specifically
// scoped to this one column's display, not every date in the app.
function formatDateShort(dateStr) {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  return `${m}/${d}/${y}`;
}

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
// when no row exists yet for an early-stage deal), or "closeout" (via
// updateCloseoutFields — most closeout columns are still readOnly here, see
// the plan's note on why editing the calculated ones would risk bypassing the
// real Close-Out Calculator's "mark as closed" side effect; check_received is
// a plain status flag, not a calculated figure, so it's the one exception).
//
// The first 3 columns (Closing Date, Check Received, Address) are frozen —
// kept visible while scrolling right — see FROZEN_COLUMN_COUNT below. Keep
// them first in this array if that ever needs to change.
const COLUMNS = [
  // Stored as a plain YYYY-MM-DD string (not a real date column — see the
  // tooltip below) but edited with a native date picker and displayed
  // formatted, same as inspection/financing dates further down.
  { key: "next_date", label: "Closing Date", source: "tx", type: "date", format: formatDateShort },
  { key: "address", label: "Address", source: "tx", type: "text" },
  // The two most-glanced-at commission figures lead the scrolling section
  // (right after Agent) rather than sitting buried at the far right.
  { key: "agent_commission", label: "Agent Commission", source: "closeout", readOnly: true },
  { key: "bank_amount", label: "Brokerage Keeps", source: "closeout", readOnly: true },
  { key: "town", label: "Town", source: "tx", type: "text" },
  { key: "region", label: "Region", source: "tx", type: "select", options: REGION_OPTIONS },
  { key: "side", label: "Side", source: "tx", type: "select", options: SIDE_OPTIONS },
  { key: "stage", label: "Stage", source: "tx", type: "select", options: STAGE_OPTIONS },
  { key: "property_style", label: "Property Style", source: "tx", type: "select", options: PROPERTY_STYLES },
  { key: "price", label: "Price", source: "tx", type: "number" },
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
  { key: "tc_fee_type", label: "TC Fee", source: "commission", type: "select", options: Object.keys(TC_FEE_AMOUNTS) },
  { key: "commission_pct", label: "Commission %", source: "closeout", readOnly: true },
  { key: "agent_split_pct", label: "Agent Split %", source: "closeout", readOnly: true },
  { key: "commission_after_referral", label: "Comm. After Referral", source: "closeout", readOnly: true },
  { key: "holly_commission", label: "Holly Commission", source: "closeout", readOnly: true },
  { key: "fran_commission", label: "Fran Commission", source: "closeout", readOnly: true },
];

// Closing Date and Address come straight from COLUMNS; Check Received (now a
// computed status, not an editable field — see checkReceivedLabel) and the
// Close Out/Terminate actions are hardcoded cells slotted in between them,
// not generic COLUMNS entries, so they're tracked separately here rather
// than through FROZEN_COLUMN_COUNT/widths alone.
const FROZEN_COLUMN_COUNT = 2; // Closing Date, Address
const FROZEN_WIDTHS = { nextDate: 86, checkReceived: 74, actions: 54, address: 170 };
const FROZEN_LEFTS = {
  nextDate: 0,
  checkReceived: FROZEN_WIDTHS.nextDate,
  actions: FROZEN_WIDTHS.nextDate + FROZEN_WIDTHS.checkReceived,
  address: FROZEN_WIDTHS.nextDate + FROZEN_WIDTHS.checkReceived + FROZEN_WIDTHS.actions,
};

/** "No" unless the deal has actually been closed out (a real commission
 * figure on record) or terminated — driven entirely by the Close Out/
 * Terminate actions right next to it, not a separate manual toggle. */
function checkReceivedLabel(tx) {
  if (tx.terminated_at) return "Terminated";
  if (tx.closeouts?.commission_after_referral != null) return "Yes";
  return "No";
}

function getValue(tx, col) {
  if (col.source === "tx") return tx[col.key];
  if (col.source === "commission") return tx.commission_data?.[col.key];
  return tx.closeouts?.[col.key];
}

/** Estimates the closeout figures from whatever's already on record (price,
 * commission %, lead type, referral %) using the same formula the real
 * Close-Out Calculator uses — null if there's not enough on record yet to
 * estimate. Shaped like a closeouts row so it can stand in for one wherever
 * the real figures aren't saved yet (see EditableCell's projectedValue). */
function estimateCloseout(tx) {
  const co = tx.closeouts;
  const price = co?.price ?? tx.price;
  const commissionPct = co?.commission_pct;
  if (price == null || commissionPct == null) return null;

  const leadType = co?.lead_type ?? tx.commission_data?.lead_type ?? "Organic";
  const referralPct = Number(co?.referral_pct ?? tx.commission_data?.referral_pct ?? 0) || 0;
  const grossCommission = Number(price) * (Number(commissionPct) / 100);
  const commissionAfterReferral = grossCommission * (1 - referralPct / 100);
  const result = calculateCloseout({
    commissionAfterReferral,
    agentName: tx.agent?.name,
    side: tx.side,
    leadType,
    agentSplitPct: co?.agent_split_pct != null ? Number(co.agent_split_pct) : null,
  });

  return {
    commission_pct: commissionPct,
    agent_split_pct: result.agentPct != null ? round2(result.agentPct * 100) : null,
    commission_after_referral: round2(commissionAfterReferral),
    agent_commission: result.agentCommission,
    holly_commission: result.hollyCommission,
    fran_commission: result.franCommission,
    bank_amount: result.bankAmount,
  };
}

/** Select columns can use either a plain string array (side, sign status, ...) or
 * {value, label} objects (stage, agent) — resolve whichever was used to its label
 * for the closed-cell display instead of showing the raw stored value. */
function optionLabelFor(options, val) {
  if (!options) return val;
  const match = options.find((o) => (o.value ?? o) === val);
  return match ? match.label ?? match : val;
}

function EditableCell({ value, displayValue, type, options, format, readOnly, onSave, projectedValue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => setDraft(value ?? ""), [value]);

  const shown = displayValue ?? (format ? format(value) : type === "select" ? optionLabelFor(options, value) : value);
  const display = shown === null || shown === undefined || shown === "" ? "—" : String(shown);

  // Not an actual saved figure — an estimate from the price/commission % on
  // record, shown greyed out + italic until the deal is actually run through
  // the Close-Out Calculator, so it's clearly "for planning purposes" only.
  if ((value === null || value === undefined) && projectedValue != null) {
    return (
      <span className="sv-cell-projected" title="Estimated, will be final once closed">
        {format ? format(projectedValue) : projectedValue}
      </span>
    );
  }

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
        {display === "—" ? <span className="sv-cell-missing">— add —</span> : display}
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

function monthStrOffset(offset) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function SpreadsheetView({ transactions, onBack, onOpenDetail, onRefresh }) {
  const [agents, setAgents] = useState([]);
  const [attorneys, setAttorneys] = useState([]);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [stageFilter, setStageFilter] = useState("contract"); // defaults to Under Contract — the deals actually being actively worked day to day
  const [showTerminated, setShowTerminated] = useState(false); // swaps the table to ONLY terminated deals, with its own summary below
  const [sortKey, setSortKey] = useState("address");
  const [sortDir, setSortDir] = useState("asc");
  const [summaryMonth, setSummaryMonth] = useState(""); // "" = all time, else "YYYY-MM"
  const [pendingOnly, setPendingOnly] = useState(false); // "All Pending" — projected only, ignores summaryMonth
  const [selectedRowId, setSelectedRowId] = useState(null);
  const [closingOutTx, setClosingOutTx] = useState(null);
  const [terminatingTx, setTerminatingTx] = useState(null);
  const showToast = useToast();

  useEffect(() => {
    fetchAllAgents().then(setAgents).catch(() => {});
    fetchAttorneys().then(setAttorneys).catch(() => {});
  }, []);

  const agentOptions = agents.map((a) => ({ value: a.id, label: a.name }));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transactions.filter((tx) => {
      if (showTerminated) {
        if (!tx.terminated_at) return false;
      } else {
        if (tx.terminated_at) return false;
        if (stageFilter && tx.stage !== stageFilter) return false;
      }
      if (agentFilter && tx.agent_id !== agentFilter) return false;
      if (q && ![tx.address, tx.seller_name, tx.buyer_name].some((f) => f?.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [transactions, search, agentFilter, stageFilter, showTerminated]);

  // Shown only in the Terminated view — what was at stake on the deals that
  // fell through: actual commission if one was ever run (rare — most
  // terminations happen before closing), otherwise the same estimate the
  // table's projected-figure cells use.
  const terminatedSummary = useMemo(() => {
    if (!showTerminated) return null;
    let totalPrice = 0;
    let totalCommission = 0;
    for (const tx of filtered) {
      totalPrice += Number(tx.price) || 0;
      const co = tx.closeouts;
      if (co?.commission_after_referral != null) {
        totalCommission += Number(co.commission_after_referral) || 0;
      } else {
        const est = estimateCloseout(tx);
        if (est) totalCommission += Number(est.commission_after_referral) || 0;
      }
    }
    return { count: filtered.length, totalPrice, totalCommission };
  }, [filtered, showTerminated]);

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
    let bankActual = 0;
    let franActual = 0;
    let actualCount = 0;
    let bankProjected = 0;
    let franProjected = 0;
    let projectedCount = 0;

    for (const tx of transactions) {
      const co = tx.closeouts;
      const alreadyClosed = co && co.bank_amount != null;

      // "All Pending" is specifically about what's NOT yet closed out — ignores
      // the month filter entirely (no date limit) and skips actuals outright.
      if (pendingOnly) {
        if (alreadyClosed) continue;
      } else {
        if (summaryMonth) {
          const txMonth = tx.next_date && /^\d{4}-\d{2}/.test(tx.next_date) ? tx.next_date.slice(0, 7) : null;
          if (txMonth !== summaryMonth) continue;
        }
        if (alreadyClosed) {
          bankActual += Number(co.bank_amount) || 0;
          franActual += Number(co.fran_commission) || 0;
          actualCount++;
          continue;
        }
      }

      // Not yet closed out — project using whatever's already on record. Every
      // deal that's reached Under Contract already has an early closeouts row
      // (submitUnderContract creates it with price/commission_pct/lead_type/
      // referral_pct, just without the final split amounts) — run that through
      // the same calculateCloseout formula the real Close-Out Calculator uses,
      // so this is an estimate, not a separate guess at the math.
      const price = co?.price ?? tx.price;
      const commissionPct = co?.commission_pct;
      if (price == null || commissionPct == null) continue; // not enough on record yet to estimate
      const leadType = co?.lead_type ?? tx.commission_data?.lead_type ?? "Organic";
      const referralPct = Number(co?.referral_pct ?? tx.commission_data?.referral_pct ?? 0) || 0;
      const grossCommission = Number(price) * (Number(commissionPct) / 100);
      const commissionAfterReferral = grossCommission * (1 - referralPct / 100);
      const result = calculateCloseout({
        commissionAfterReferral,
        agentName: tx.agent?.name,
        side: tx.side,
        leadType,
        agentSplitPct: null, // not captured pre-closeout — same 60% default the real calculator falls back to
      });
      bankProjected += applyTcFee(result.bankAmount, tx.commission_data?.tc_fee_type);
      franProjected += result.franCommission;
      projectedCount++;
    }

    return {
      bankActual,
      franActual,
      actualCount,
      bankProjected,
      franProjected,
      projectedCount,
      bankTotal: bankActual + bankProjected,
      franTotal: franActual + franProjected,
    };
  }, [transactions, summaryMonth, pendingOnly]);

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

  async function handleSaveCloseout(tx, key, value) {
    try {
      await updateCloseoutFields(tx.id, { [key]: value });
      onRefresh();
      showToast("Saved");
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    }
  }

  function handleSaveCell(tx, col, value) {
    if (col.source === "tx") return handleSaveTx(tx, col.key, value);
    if (col.source === "commission") return handleSaveCommission(tx, col.key, value);
    return handleSaveCloseout(tx, col.key, value);
  }

  async function handleSaveAttorney(tx, side, name) {
    try {
      const id = await resolveAttorneyId(name || "", attorneys);
      if (!attorneys.find((a) => a.id === id)) {
        // A brand-new attorney just got created on the fly — refresh the list
        // so the next lookup/autocomplete sees it too.
        fetchAttorneys().then(setAttorneys).catch(() => {});
      }
      await updateTransactionAttorneys(tx.id, side === "seller" ? { sellerAttorneyId: id } : { buyerAttorneyId: id });
      onRefresh();
      showToast("Saved");
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    }
  }

  async function handleReactivate(tx) {
    try {
      await reactivateTransaction(tx.id);
      onRefresh();
      showToast("Deal reactivated");
    } catch (e) {
      showToast(`Couldn't reactivate: ${e.message}`);
    }
  }

  if (closingOutTx) {
    return (
      <CloseoutCalculator
        transaction={closingOutTx}
        onCancel={() => setClosingOutTx(null)}
        onSaved={() => {
          setClosingOutTx(null);
          onRefresh();
        }}
      />
    );
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
        {!showTerminated && (
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All Stages</option>
            {STAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <label className="sv-terminated-toggle">
          <input type="checkbox" checked={showTerminated} onChange={(e) => setShowTerminated(e.target.checked)} />
          Show Terminated
        </label>
      </div>

      {showTerminated && terminatedSummary && (
        <div className="sv-summary sv-summary--terminated">
          <h2 className="comps-section-title">Terminated Deals</h2>
          <div className="sv-summary-stats">
            <div className="sv-summary-stat">
              <span className="sv-summary-stat-value">{terminatedSummary.count}</span>
              <span className="sv-summary-stat-label">Terminated Deals</span>
            </div>
            <div className="sv-summary-stat">
              <span className="sv-summary-stat-value">${Math.round(terminatedSummary.totalPrice).toLocaleString()}</span>
              <span className="sv-summary-stat-label">Total Price</span>
            </div>
            <div className="sv-summary-stat">
              <span className="sv-summary-stat-value">${Math.round(terminatedSummary.totalCommission).toLocaleString()}</span>
              <span className="sv-summary-stat-label">Total Commission at Stake</span>
            </div>
          </div>
          <p className="field-help">
            Commission at stake is the actual figure if a close-out was ever run on the deal, otherwise an estimate
            from the price/commission % on record — same as the projected figures in the table above.
          </p>
        </div>
      )}

      <div className="sv-table-wrap">
        <table className="sv-table">
          <thead>
            <tr>
              <th
                className="sv-th-sortable sv-col-frozen"
                style={{ left: FROZEN_LEFTS.nextDate, width: FROZEN_WIDTHS.nextDate, minWidth: FROZEN_WIDTHS.nextDate }}
                onClick={() => handleSort("next_date")}
                title="The deal's next key date — its closing date once Under Contract, used informally before that."
              >
                Closing Date{sortKey === "next_date" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
              <th
                className="sv-col-frozen"
                style={{ left: FROZEN_LEFTS.checkReceived, width: FROZEN_WIDTHS.checkReceived, minWidth: FROZEN_WIDTHS.checkReceived }}
              >
                Check Received
              </th>
              <th
                className="sv-col-frozen"
                style={{ left: FROZEN_LEFTS.actions, width: FROZEN_WIDTHS.actions, minWidth: FROZEN_WIDTHS.actions }}
              />
              <th
                className="sv-th-sortable sv-col-frozen sv-col-frozen-last"
                style={{ left: FROZEN_LEFTS.address, width: FROZEN_WIDTHS.address, minWidth: FROZEN_WIDTHS.address }}
                onClick={() => handleSort("address")}
              >
                Address{sortKey === "address" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
              <th className="sv-th-sortable" onClick={() => handleSort("agent")}>
                Agent{sortKey === "agent" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
              <th>Seller Attorney</th>
              <th>Buyer Attorney</th>
              {COLUMNS.slice(FROZEN_COLUMN_COUNT).map((col) => (
                <th
                  key={col.key}
                  className="sv-th-sortable"
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {sorted.map((tx) => {
              const estimate = tx.terminated_at ? null : estimateCloseout(tx);
              return (
              <tr
                key={tx.id}
                className={selectedRowId === tx.id ? "sv-row-selected" : ""}
                onClick={() => setSelectedRowId(tx.id)}
              >
                <td className="sv-col-frozen" style={{ left: FROZEN_LEFTS.nextDate }}>
                  <EditableCell
                    value={tx.next_date}
                    type="date"
                    format={formatDateShort}
                    onSave={(v) => handleSaveTx(tx, "next_date", v)}
                  />
                </td>
                <td className="sv-col-frozen" style={{ left: FROZEN_LEFTS.checkReceived }}>
                  <span className={`sv-cell-readonly${tx.terminated_at ? " sv-check-received--terminated" : checkReceivedLabel(tx) === "Yes" ? " sv-check-received--yes" : ""}`}>
                    {checkReceivedLabel(tx)}
                  </span>
                </td>
                <td className="sv-col-frozen" style={{ left: FROZEN_LEFTS.actions }}>
                  <div className="sv-row-quick-actions" onClick={(e) => e.stopPropagation()}>
                    {tx.terminated_at ? (
                      <button type="button" title="Reactivate deal" onClick={() => handleReactivate(tx)}>
                        <RotateCcw size={12} />
                      </button>
                    ) : checkReceivedLabel(tx) === "Yes" ? null : (
                      <>
                        <button type="button" title="Close-Out Calculator" onClick={() => setClosingOutTx(tx)}>
                          <DollarSign size={12} />
                        </button>
                        <button type="button" title="Terminate deal" onClick={() => setTerminatingTx(tx)}>
                          <Ban size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </td>
                <td className="sv-col-frozen sv-col-frozen-last" style={{ left: FROZEN_LEFTS.address }}>
                  <EditableCell value={tx.address} onSave={(v) => handleSaveTx(tx, "address", v)} />
                </td>
                <td>
                  <EditableCell
                    value={tx.agent_id}
                    displayValue={tx.agent?.name}
                    type="select"
                    options={agentOptions}
                    onSave={(v) => handleSaveTx(tx, "agent_id", v)}
                  />
                </td>
                <td>
                  <EditableCell
                    value={tx.seller_attorney?.name || ""}
                    onSave={(v) => handleSaveAttorney(tx, "seller", v)}
                  />
                </td>
                <td>
                  <EditableCell
                    value={tx.buyer_attorney?.name || ""}
                    onSave={(v) => handleSaveAttorney(tx, "buyer", v)}
                  />
                </td>
                {COLUMNS.slice(FROZEN_COLUMN_COUNT).map((col) => (
                  <td key={col.key}>
                    <EditableCell
                      value={getValue(tx, col)}
                      type={col.type}
                      options={col.options}
                      format={col.format}
                      readOnly={col.readOnly}
                      onSave={(v) => handleSaveCell(tx, col, v)}
                      projectedValue={col.source === "closeout" && col.key !== "check_received" && estimate ? estimate[col.key] : undefined}
                    />
                  </td>
                ))}
                <td className="sv-row-actions">
                  <div className="sv-row-quick-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" title="Close-Out Calculator" onClick={() => setClosingOutTx(tx)}>
                      <DollarSign size={12} />
                    </button>
                    {tx.terminated_at ? (
                      <button type="button" title="Reactivate deal" onClick={() => handleReactivate(tx)}>
                        <RotateCcw size={12} />
                      </button>
                    ) : (
                      <button type="button" title="Terminate deal" onClick={() => setTerminatingTx(tx)}>
                        <Ban size={12} />
                      </button>
                    )}
                  </div>
                  <button type="button" className="comps-minimize-btn" onClick={() => onOpenDetail(tx)}>
                    Open →
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && <p className="empty-state">No deals match these filters.</p>}

      <div className="sv-summary">
        <h2 className="comps-section-title">Commission Summary</h2>
        <div className="sv-filters">
          <button
            type="button"
            className={`comps-minimize-btn${!pendingOnly && summaryMonth === "" ? " sv-preset-active" : ""}`}
            onClick={() => {
              setPendingOnly(false);
              setSummaryMonth("");
            }}
          >
            All Time
          </button>
          <button
            type="button"
            className={`comps-minimize-btn${!pendingOnly && summaryMonth === monthStrOffset(0) ? " sv-preset-active" : ""}`}
            onClick={() => {
              setPendingOnly(false);
              setSummaryMonth(monthStrOffset(0));
            }}
          >
            This Month
          </button>
          <button
            type="button"
            className={`comps-minimize-btn${!pendingOnly && summaryMonth === monthStrOffset(1) ? " sv-preset-active" : ""}`}
            onClick={() => {
              setPendingOnly(false);
              setSummaryMonth(monthStrOffset(1));
            }}
          >
            Next Month
          </button>
          <button
            type="button"
            className={`comps-minimize-btn${pendingOnly ? " sv-preset-active" : ""}`}
            onClick={() => {
              setPendingOnly(true);
              setSummaryMonth("");
            }}
          >
            All Pending
          </button>
          <input
            type="month"
            value={summaryMonth}
            disabled={pendingOnly}
            onChange={(e) => {
              setPendingOnly(false);
              setSummaryMonth(e.target.value);
            }}
          />
        </div>
        <p className="field-help sv-summary-range-label">
          {pendingOnly
            ? "Every deal still under contract, not yet closed out — no date limit."
            : summaryMonth
            ? `Deals closing in ${monthLabel(summaryMonth)}.`
            : "Every deal, any closing date — all time."}
        </p>
        <div className="sv-summary-stats">
          <div className="sv-summary-stat">
            <span className="sv-summary-stat-label">Brokerage Keeps</span>
            <div className="sv-summary-stat-split">
              <div className="sv-summary-stat-part">
                <strong>${Math.round(summary.bankActual).toLocaleString()}</strong>
                <span className="field-help">closed</span>
              </div>
              <div className="sv-summary-stat-part">
                <strong>${Math.round(summary.bankProjected).toLocaleString()}</strong>
                <span className="field-help">projected</span>
              </div>
            </div>
          </div>
          <div className="sv-summary-stat">
            <span className="sv-summary-stat-label">Fran's Commission</span>
            <div className="sv-summary-stat-split">
              <div className="sv-summary-stat-part">
                <strong>${Math.round(summary.franActual).toLocaleString()}</strong>
                <span className="field-help">closed</span>
              </div>
              <div className="sv-summary-stat-part">
                <strong>${Math.round(summary.franProjected).toLocaleString()}</strong>
                <span className="field-help">projected</span>
              </div>
            </div>
          </div>
        </div>
        <p className="field-help">
          {summary.actualCount} closed deal{summary.actualCount === 1 ? "" : "s"}
          {summary.projectedCount > 0 && `, ${summary.projectedCount} more still under contract`}. "Closed" is the
          real figure from the Close-Out Calculator. "Projected" uses the exact same split rules — the 20%
          brokerage floor, then the standard Organic/Provided/owner percentages — so it's not a guess, except for
          one specific case: a Provided-lead deal with a negotiated agent split that hasn't been entered into the
          Close-Out Calculator yet defaults to 60% here until it is.
        </p>
      </div>

      <ConfirmDialog
        open={!!terminatingTx}
        title={`Terminate ${terminatingTx?.address || "this deal"}?`}
        message="This can be undone later with Reactivate."
        promptLabel="Reason (optional)"
        promptPlaceholder="Why is this deal being terminated?"
        confirmLabel="Terminate Deal"
        danger
        onConfirm={async (reason) => {
          const tx = terminatingTx;
          setTerminatingTx(null);
          try {
            await terminateTransaction(tx.id, reason || "");
            onRefresh();
            showToast("Deal terminated");
          } catch (e) {
            showToast(`Couldn't terminate: ${e.message}`);
          }
        }}
        onCancel={() => setTerminatingTx(null)}
      />
    </div>
  );
}
