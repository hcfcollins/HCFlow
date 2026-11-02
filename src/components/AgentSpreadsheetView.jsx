import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  fetchMyEarnings,
  upsertCommissionData,
  updateTransactionAttorneys,
  fetchAttorneys,
  resolveAttorneyId,
} from "../lib/transactions";
import { useToast } from "../lib/ToastContext";
import { formatDate } from "./DealDetail";
import { SkeletonList } from "./Skeleton";

const STAGE_LABELS = { contract: "Under Contract", closed: "Closed" };

function formatDateShort(dateStr) {
  if (!dateStr) return null;
  // \d{1,2} (not a strict \d{2}) so a non-zero-padded stored value like
  // "2026-9-5" still displays correctly instead of falling through to the
  // raw, unformatted string. Deliberately regex-based, not Date-parsed —
  // parsing a bare "YYYY-MM-DD" with `new Date()` reads it as UTC midnight,
  // which can display as the previous day once formatted back out in a
  // timezone behind UTC (most of the US) — this reformats the digits
  // directly instead, so the calendar date on screen never shifts.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr);
  if (iso) {
    const [, y, m, d] = iso;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
  }
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(dateStr);
  if (us) {
    const [, m, d, y] = us;
    return `${m.padStart(2, "0")}/${d.padStart(2, "0")}/${y}`;
  }
  return dateStr;
}

// next_date is plain text, not a real date column, and this data mixes
// several sources (the native date picker, old seed/test rows, early manual
// entry) that don't all agree on format. Date.parse handles ISO (padded or
// not), US slash format, and most other reasonable variants in one pass;
// returns a timestamp (a number), which compares correctly regardless of
// source string shape — falls back to the raw string only if Date can't
// parse it at all.
function normalizeDateForSort(dateStr) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? dateStr : t;
}

function money(n) {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// Pure string manipulation, deliberately not Date-parsed — same reasoning as
// Spreadsheet View's monthKeyFor: reading a parsed Date's month back out
// means picking UTC or local time, and bare ISO dates vs. "M/D/YYYY" parse
// as one or the other inconsistently, risking a date near a month boundary
// landing in the wrong bucket. This just reads the digits directly.
function monthKeyFor(dateStr) {
  if (!dateStr) return null;
  const iso = /^(\d{4})-(\d{1,2})-/.exec(dateStr);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  const us = /^(\d{1,2})\/\d{1,2}\/(\d{4})$/.exec(dateStr);
  if (us) return `${us[2]}-${us[1].padStart(2, "0")}`;
  return null;
}

function yearKeyFor(dateStr) {
  const mk = monthKeyFor(dateStr);
  return mk ? mk.slice(0, 4) : null;
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

const OWNER_NAMES = ["Fran Collins", "Holly Hall"];

// Spells out which rule actually set the number — an Organic lead always
// keeps a flat 80% (not a negotiated split, so nothing's stored for it);
// only a Provided lead has an actual agreed split, defaulting to 60% until
// a different number is entered at close-out.
function agentSplitLabel(d, currentAgent) {
  if (currentAgent?.name && OWNER_NAMES.includes(currentAgent.name)) return null;
  if (d.lead_type === "Provided") {
    const pct = d.agent_split_pct != null ? d.agent_split_pct : 60;
    return `${pct}% (Provided lead)`;
  }
  if (d.lead_type === "Organic") return "80% (Organic lead)";
  return null;
}

/** Click-to-edit text/date cell — deliberately simpler than SpreadsheetView's
 * EditableCell (no select-type support needed here), since these are plain
 * text/date fields an agent fills in themselves. */
function AgentCell({ value, type = "text", onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");

  useEffect(() => setDraft(value || ""), [value]);

  if (!editing) {
    return (
      <button type="button" className="sv-cell-btn" onClick={() => setEditing(true)}>
        {value ? (type === "date" ? formatDateShort(value) : value) : <span className="sv-cell-missing">— add —</span>}
      </button>
    );
  }

  function commit() {
    setEditing(false);
    if (draft !== (value || "")) onSave(draft || null);
  }

  return (
    <input
      autoFocus
      type={type}
      className="sv-cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()}
    />
  );
}

const MISSING_CHECKS = [
  { key: "seller_attorney", label: "Seller Attorney" },
  { key: "buyer_attorney", label: "Buyer Attorney" },
  { key: "appraiser", label: "Appraiser" },
  { key: "inspection_date", label: "Inspection Date" },
  { key: "financing_date", label: "Financing Date" },
];

function missingFieldsFor(deal) {
  return MISSING_CHECKS.filter((c) => !deal[c.key]).map((c) => c.label);
}

export default function AgentSpreadsheetView({ transactions, currentAgent, onBack, onOpenDetail }) {
  const [earnings, setEarnings] = useState(null);
  const [attorneys, setAttorneys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortDir, setSortDir] = useState("asc"); // by closing date; soonest first by default
  const [summaryMode, setSummaryMode] = useState("year"); // "year" | "thisMonth" | "nextMonth" | "custom"
  const [summaryCustomMonth, setSummaryCustomMonth] = useState(""); // "YYYY-MM", used when summaryMode is "custom"
  const showToast = useToast();

  function load() {
    setLoading(true);
    fetchMyEarnings()
      .then(setEarnings)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    fetchAttorneys().then(setAttorneys).catch(() => {});
  }, []);

  // Merge: the tx-level fields (attorneys, price, stage...) are already
  // visible to this agent via the normal transactions prop; the
  // commission_data/closeout-derived fields come from agent-earnings, since
  // RLS blocks a regular agent from reading those tables directly at all.
  const deals = (earnings?.deals || [])
    .map((d) => {
      const tx = transactions.find((t) => t.id === d.id);
      if (!tx) return null;
      return {
        ...d,
        seller_attorney: tx.seller_attorney?.name || null,
        buyer_attorney: tx.buyer_attorney?.name || null,
      };
    })
    .filter(Boolean)
    // Sorted by closing date, direction toggled by clicking the column
    // header; deals with no date yet always sort to the end regardless of
    // direction.
    .sort((a, b) => {
      const av = normalizeDateForSort(a.closing_date);
      const bv = normalizeDateForSort(b.closing_date);
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      // normalizeDateForSort can return a number (timestamp) or a string
      // (unparseable fallback) — plain comparison operators handle both.
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

  async function patchDeal(dealId, patch) {
    setEarnings((prev) => ({ ...prev, deals: prev.deals.map((d) => (d.id === dealId ? { ...d, ...patch } : d)) }));
  }

  async function handleSaveCommissionField(tx, key, value) {
    try {
      await upsertCommissionData(tx.id, { [key]: value });
      patchDeal(tx.id, { [key]: value });
      showToast("Saved");
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    }
  }

  async function handleSaveAttorney(tx, side, name) {
    try {
      const id = await resolveAttorneyId(name || "", attorneys);
      if (!attorneys.find((a) => a.id === id)) fetchAttorneys().then(setAttorneys).catch(() => {});
      await updateTransactionAttorneys(tx.id, side === "seller" ? { sellerAttorneyId: id } : { buyerAttorneyId: id });
      showToast("Saved");
      load(); // tx-level attorney name comes from the transactions prop upstream — needs a real refresh, not just local patch
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    }
  }

  const dealsMissingInfo = deals.filter((d) => d.stage === "contract" && missingFieldsFor(d).length > 0);

  const summary = useMemo(() => {
    const thisYear = String(new Date().getFullYear());
    let actualTotal = 0;
    let actualCount = 0;
    let projectedTotal = 0;
    let projectedCount = 0;

    for (const d of deals) {
      const matches =
        summaryMode === "year"
          ? yearKeyFor(d.closing_date) === thisYear
          : summaryMode === "thisMonth"
          ? monthKeyFor(d.closing_date) === monthStrOffset(0)
          : summaryMode === "nextMonth"
          ? monthKeyFor(d.closing_date) === monthStrOffset(1)
          : summaryCustomMonth && monthKeyFor(d.closing_date) === summaryCustomMonth;
      if (!matches || d.amount == null) continue;
      if (d.is_actual) {
        actualTotal += d.amount;
        actualCount++;
      } else {
        projectedTotal += d.amount;
        projectedCount++;
      }
    }

    return { actualTotal, actualCount, projectedTotal, projectedCount, totalCount: actualCount + projectedCount };
  }, [deals, summaryMode, summaryCustomMonth]);

  const summaryRangeLabel =
    summaryMode === "year"
      ? `Deals closing in ${new Date().getFullYear()}.`
      : summaryMode === "thisMonth"
      ? `Deals closing in ${monthLabel(monthStrOffset(0))}.`
      : summaryMode === "nextMonth"
      ? `Deals closing in ${monthLabel(monthStrOffset(1))}.`
      : summaryCustomMonth
      ? `Deals closing in ${monthLabel(summaryCustomMonth)}.`
      : "Pick a month above.";

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">My Deals</div>
          <h1>My Spreadsheet</h1>
        </div>
        <button type="button" className="header-icon-btn" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft size={20} />
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <SkeletonList count={4} />
      ) : (
        <>
          {dealsMissingInfo.length > 0 && (
            <div className="detail-section agent-missing-info">
              <h2 className="comps-section-title">Missing Info</h2>
              <ul className="detail-list">
                {dealsMissingInfo.map((d) => (
                  <li key={d.id} className="my-earnings-row">
                    <div>
                      <strong>{d.address}</strong>
                      <div className="tx-sub">Missing: {missingFieldsFor(d).join(", ")}</div>
                    </div>
                    <button
                      type="button"
                      className="comps-minimize-btn"
                      onClick={() => {
                        const tx = transactions.find((t) => t.id === d.id);
                        if (tx) onOpenDetail(tx);
                      }}
                    >
                      Open →
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="sv-table-wrap">
            <table className="sv-table">
              <thead>
                <tr>
                  <th className="sv-th-sortable" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
                    Closing Date{sortDir === "asc" ? " ▲" : " ▼"}
                  </th>
                  <th>Address</th>
                  <th>Stage</th>
                  <th>Price</th>
                  <th>Seller Attorney</th>
                  <th>Buyer Attorney</th>
                  <th>Appraiser</th>
                  <th>Inspection Date</th>
                  <th>Financing Date</th>
                  <th>Agent Split %</th>
                  <th>My Commission</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const tx = transactions.find((t) => t.id === d.id);
                  return (
                    <tr key={d.id}>
                      <td>{formatDateShort(d.closing_date) || "—"}</td>
                      <td>{d.address}</td>
                      <td>{STAGE_LABELS[d.stage] || d.stage}</td>
                      <td>{money(tx?.price)}</td>
                      <td>
                        <AgentCell value={d.seller_attorney} onSave={(v) => tx && handleSaveAttorney(tx, "seller", v)} />
                      </td>
                      <td>
                        <AgentCell value={d.buyer_attorney} onSave={(v) => tx && handleSaveAttorney(tx, "buyer", v)} />
                      </td>
                      <td>
                        <AgentCell value={d.appraiser} onSave={(v) => tx && handleSaveCommissionField(tx, "appraiser", v)} />
                      </td>
                      <td>
                        <AgentCell
                          type="date"
                          value={d.inspection_date}
                          onSave={(v) => tx && handleSaveCommissionField(tx, "inspection_date", v)}
                        />
                      </td>
                      <td>
                        <AgentCell
                          type="date"
                          value={d.financing_date}
                          onSave={(v) => tx && handleSaveCommissionField(tx, "financing_date", v)}
                        />
                      </td>
                      <td>{agentSplitLabel(d, currentAgent) || <span className="field-help">—</span>}</td>
                      <td>
                        {d.amount == null ? (
                          <span className="field-help">Not enough on record yet</span>
                        ) : (
                          <span className={d.is_actual ? "" : "sv-cell-projected"} title={d.is_actual ? undefined : "Estimated, will be final once closed"}>
                            {money(d.amount)}
                          </span>
                        )}
                      </td>
                      <td>
                        <button type="button" className="comps-minimize-btn" onClick={() => tx && onOpenDetail(tx)}>
                          Open →
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {deals.length === 0 && <p className="empty-state">No deals Under Contract or Closed yet.</p>}

          <div className="sv-summary">
            <h2 className="comps-section-title">Commission Summary</h2>
            <div className="sv-filters">
              <button
                type="button"
                className={`comps-minimize-btn${summaryMode === "year" ? " sv-preset-active" : ""}`}
                onClick={() => setSummaryMode("year")}
              >
                This Year
              </button>
              <button
                type="button"
                className={`comps-minimize-btn${summaryMode === "thisMonth" ? " sv-preset-active" : ""}`}
                onClick={() => setSummaryMode("thisMonth")}
              >
                This Month
              </button>
              <button
                type="button"
                className={`comps-minimize-btn${summaryMode === "nextMonth" ? " sv-preset-active" : ""}`}
                onClick={() => setSummaryMode("nextMonth")}
              >
                Next Month
              </button>
              <input
                type="month"
                value={summaryCustomMonth}
                onChange={(e) => {
                  setSummaryCustomMonth(e.target.value);
                  setSummaryMode("custom");
                }}
              />
            </div>
            <p className="field-help sv-summary-range-label">{summaryRangeLabel}</p>
            <div className="sv-summary-stats">
              <div className="sv-summary-stat">
                <span className="sv-summary-stat-value">{summary.totalCount}</span>
                <span className="sv-summary-stat-label">Transactions</span>
              </div>
              <div className="sv-summary-stat">
                <span className="sv-summary-stat-label">My Commission</span>
                <div className="sv-summary-stat-split">
                  <div className="sv-summary-stat-part">
                    <strong>{money(summary.actualTotal)}</strong>
                    <span className="field-help">closed</span>
                  </div>
                  <div className="sv-summary-stat-part">
                    <strong>{money(summary.projectedTotal)}</strong>
                    <span className="field-help">projected</span>
                  </div>
                </div>
              </div>
            </div>
            <p className="field-help">
              {summary.actualCount} closed deal{summary.actualCount === 1 ? "" : "s"}
              {summary.projectedCount > 0 && `, ${summary.projectedCount} more still under contract`}. "Projected" is
              an estimate using the same formula as the real Close-Out Calculator — the actual number may differ
              slightly once a deal is formally closed out.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
