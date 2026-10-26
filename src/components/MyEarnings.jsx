import { useEffect, useState } from "react";
import { fetchMyEarnings } from "../lib/transactions";
import { formatDate } from "./DealDetail";
import { SkeletonList } from "./Skeleton";

const STAGE_LABELS = {
  comps: "Comp",
  won: "Listing Won",
  market: "On Market",
  contract: "Under Contract",
  closed: "Closed",
};

function money(n) {
  if (n === null || n === undefined) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function MyEarnings({ onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMyEarnings()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">My Deals</div>
          <h1>My Earnings</h1>
        </div>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <SkeletonList count={4} />
      ) : data ? (
        <>
          <div className="sv-summary-stats">
            <div className="sv-summary-stat">
              <span className="sv-summary-stat-value">{money(data.actualEarned)}</span>
              <span className="sv-summary-stat-label">Earned (closed deals)</span>
            </div>
            <div className="sv-summary-stat">
              <span className="sv-summary-stat-value">{money(data.projectedEarned)}</span>
              <span className="sv-summary-stat-label">Projected (not yet closed out)</span>
            </div>
          </div>
          <p className="field-help">
            Projected figures are an estimate from the price/commission % on record, using the same formula the real
            Close-Out Calculator uses — the actual number may differ slightly once a deal is formally closed out.
          </p>

          <div className="detail-section">
            <h2 className="comps-section-title">My Deals</h2>
            {data.deals.length === 0 ? (
              <p className="empty-state">No deals on record yet.</p>
            ) : (
              <ul className="detail-list my-earnings-list">
                {data.deals.map((d) => (
                  <li key={d.address + d.closing_date} className="my-earnings-row">
                    <div>
                      <strong>{d.address}</strong>
                      <div className="tx-sub">
                        {STAGE_LABELS[d.stage] || d.stage}
                        {d.closing_date ? ` · ${formatDate(d.closing_date)}` : ""}
                      </div>
                    </div>
                    <div className="my-earnings-amount">
                      {d.amount == null ? (
                        <span className="field-help">Not enough on record yet</span>
                      ) : (
                        <>
                          <strong>{money(d.amount)}</strong>
                          {!d.is_actual && <span className="field-help"> projected</span>}
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
