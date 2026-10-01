import { useEffect, useRef, useState } from "react";
import { listListingPhotos, fetchListingFile } from "../lib/transactions";

const CALENDAR_DAYS = 14;
const BOOST_POST_PHOTO_COUNT = 5;

function sampleRandom(items, count) {
  const pool = [...items];
  const picked = [];
  while (pool.length && picked.length < count) {
    const i = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked;
}

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

/** Random 4-5 photos from the listing's Dropbox Photos folder, shown as a tappable
 * grid — tapping one opens it full-size in a new tab so Holly can use the phone's
 * native share/save sheet, rather than forcing a multi-file download (which iOS
 * Safari routinely breaks). */
function BoostPostPanel({ transaction, onClose }) {
  const [previews, setPreviews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const urls = [];

    async function load() {
      try {
        const all = await listListingPhotos(transaction.id);
        const picked = sampleRandom(all, Math.min(BOOST_POST_PHOTO_COUNT, all.length));
        const withUrls = [];
        for (const photo of picked) {
          const blob = await fetchListingFile(transaction.id, photo.path);
          const url = URL.createObjectURL(blob);
          urls.push(url);
          withUrls.push({ ...photo, url });
        }
        if (!cancelled) setPreviews(withUrls);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [transaction.id]);

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="confirm-dialog social-post-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">Boost Post — {transaction.address}</h2>
        <p className="confirm-dialog-message">
          Tap a photo to open it full-size, then use your phone's share/save option.
        </p>
        {loading && <p className="field-help">Loading photos…</p>}
        {error && <p className="field-note">{error}</p>}
        {previews && previews.length === 0 && <p className="empty-state">No photos found in this listing's Dropbox Photos folder.</p>}
        {previews && previews.length > 0 && (
          <div className="social-photo-grid">
            {previews.map((p) => (
              <a key={p.path} href={p.url} target="_blank" rel="noreferrer" className="social-photo-thumb">
                <img src={p.url} alt={p.name} />
              </a>
            ))}
          </div>
        )}
        <div className="confirm-dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SocialScheduler({ transactions, onBack, onMarkPosted, onMarkClosingPosted, onReorder }) {
  const [view, setView] = useState("queue");
  const [boostPostTx, setBoostPostTx] = useState(null);
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
              <div className="social-row-actions">
                <button type="button" className="comps-minimize-btn" onClick={() => setBoostPostTx(tx)}>
                  Boost Post
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
    </div>
  );
}
