import { useEffect, useState } from "react";
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
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return dateStr;
  const [, y, m, d] = match;
  return `${m}/${d}/${y}`;
}

function money(n) {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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
        {value ? (type === "date" ? formatDateShort(value) : value) : <span className="field-help">— add —</span>}
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
    .filter(Boolean);

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

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">My Deals</div>
          <h1>My Spreadsheet</h1>
        </div>
        <button type="button" onClick={onBack}>
          Back
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
                  <th>Closing Date</th>
                  <th>Address</th>
                  <th>Stage</th>
                  <th>Price</th>
                  <th>Seller Attorney</th>
                  <th>Buyer Attorney</th>
                  <th>Appraiser</th>
                  <th>Inspection Date</th>
                  <th>Financing Date</th>
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
        </>
      )}
    </div>
  );
}
