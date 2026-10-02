import { useRef, useState } from "react";
import { BoostPostPanel, ListingGraphicPanel } from "./SocialPostPanels";

const CALENDAR_DAYS = 14;

function daysSince(dateStr) {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function calendarLabel(dayOffset) {
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function SocialScheduler({ transactions, onBack, onMarkPosted, onSetLastPosted, onMarkClosingPosted, onReorder }) {
  const [view, setView] = useState("queue");
  const [boostPostTx, setBoostPostTx] = useState(null);
  const [graphicTx, setGraphicTx] = useState(null);
  const dragIndex = useRef(null);

  const rotation = transactions
    .filter((tx) => !tx.terminated_at && (tx.stage === "won" || tx.stage === "market") && tx.social_queue_order != null)
    .sort((a, b) => a.social_queue_order - b.social_queue_order);

  const closingDue = transactions.filter(
    (tx) => (tx.stage === "contract" || tx.stage === "closed") && tx.social_went_live_at && !tx.social_closing_posted_at
  );

  function handleDrop(targetIndex) {
    if (dragIndex.current === null || dragIndex.current === targetIndex) return;
    const reordered = [...rotation];
    const [moved] = reordered.splice(dragIndex.current, 1);
    reordered.splice(targetIndex, 0, moved);
    dragIndex.current = null;
    onReorder(reordered.map((tx) => tx.id));
  }

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Broker Tools</div>
          <h1>Social Scheduler</h1>
        </div>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      {closingDue.length > 0 && (
        <div className="detail-section">
          <h2 className="comps-section-title">Closing Shoutout Due</h2>
          <p className="field-help">One last promotion once a deal goes under contract or closes.</p>
          <ul className="detail-list">
            {closingDue.map((tx) => (
              <li key={tx.id} className="social-queue-row">
                <span className="tx-address">{tx.address}</span>
                <button type="button" className="comps-minimize-btn" onClick={() => onMarkClosingPosted(tx.id)}>
                  Mark Posted
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button type="button" className="sign-inventory-toggle" onClick={() => setView((v) => (v === "queue" ? "calendar" : "queue"))}>
        {view === "queue" ? "Show Calendar" : "Show Queue"}
      </button>

      {rotation.length === 0 ? (
        <p className="empty-state">
          Nothing in rotation yet — check "Go Live" on a Won Listing's to-do list to add it.
        </p>
      ) : view === "queue" ? (
        <ul className="detail-list">
          {rotation.map((tx) => (
            <li key={tx.id} className="social-queue-row">
              <div>
                <span className="tx-address">{tx.address}</span>
                <span className="tx-sub"> — {daysSince(tx.social_last_posted_at)}</span>
              </div>
              <label className="social-last-posted">
                Last Posted
                <input
                  type="date"
                  value={tx.social_last_posted_at ? tx.social_last_posted_at.slice(0, 10) : ""}
                  onChange={(e) => onSetLastPosted(tx.id, e.target.value)}
                />
              </label>
              <div className="social-row-actions">
                <button type="button" className="comps-minimize-btn" onClick={() => setBoostPostTx(tx)}>
                  Boost Post
                </button>
                <button type="button" className="comps-minimize-btn" onClick={() => setGraphicTx(tx)}>
                  New Listing Graphic
                </button>
                <button type="button" className="comps-minimize-btn" onClick={() => onMarkPosted(tx.id)}>
                  Mark Posted
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="social-calendar">
          {Array.from({ length: CALENDAR_DAYS }).map((_, i) => {
            const tx = rotation[i];
            return (
              <div
                key={i}
                className="social-calendar-day"
                onDragOver={(e) => tx && e.preventDefault()}
                onDrop={() => tx && handleDrop(i)}
              >
                <div className="timeframe-group-title">{calendarLabel(i)}</div>
                {tx ? (
                  <div
                    className="social-calendar-card"
                    draggable
                    onDragStart={() => {
                      dragIndex.current = i;
                    }}
                  >
                    <span className="tx-address">{tx.address}</span>
                    <span className="tx-sub">{daysSince(tx.social_last_posted_at)}</span>
                    <div className="social-row-actions">
                      <button type="button" className="comps-minimize-btn" onClick={() => setBoostPostTx(tx)}>
                        Boost Post
                      </button>
                      <button type="button" className="comps-minimize-btn" onClick={() => onMarkPosted(tx.id)}>
                        Mark Posted
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="field-help">No listing scheduled</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {boostPostTx && <BoostPostPanel transaction={boostPostTx} onClose={() => setBoostPostTx(null)} />}
      {graphicTx && <ListingGraphicPanel transaction={graphicTx} postType="newListing" onClose={() => setGraphicTx(null)} />}
    </div>
  );
}
