import { useEffect, useRef, useState } from "react";
import { BoostPostPanel, ListingGraphicPanel } from "./SocialPostPanels";
import { listListingPhotos, fetchListingFile } from "../lib/transactions";

const CALENDAR_DAYS = 14;
const LONG_PRESS_MS = 350;
const MOVE_CANCEL_THRESHOLD = 10;
const SOCIAL_RECENCY_DAYS = 14;

function daysSince(dateStr) {
  if (!dateStr) return "Never";
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// Same red/blue/green priority language as the Active Listings Social Rotation
// filter: red = never posted (most urgent), blue = due for rotation, green =
// posted recently — leave it alone so the same listing doesn't get overexposed.
function socialRecencyClass(dateStr) {
  if (!dateStr) return "social-row--never";
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  return days >= SOCIAL_RECENCY_DAYS ? "social-row--stale" : "social-row--recent";
}

/** The top photo from whichever folder the Boost Post/graphic pickers would also
 * use first (Chosen Ones, falling back to Compressed_MLS, falling back to the
 * whole Photos folder) — just enough to recognize which listing this is without
 * opening it. */
function ListingThumbnail({ transactionId }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let blobUrl = null;

    listListingPhotos(transactionId)
      .then(({ photos }) => {
        if (cancelled) return;
        if (!photos.length) {
          setFailed(true);
          return;
        }
        return fetchListingFile(transactionId, photos[0].path).then((blob) => {
          if (cancelled) return;
          blobUrl = URL.createObjectURL(blob);
          setUrl(blobUrl);
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [transactionId]);

  if (failed) return null;
  return <div className={`social-thumb ${url ? "" : "social-thumb--loading"}`}>{url && <img src={url} alt="" />}</div>;
}

function calendarLabel(dayOffset) {
  if (dayOffset === 0) return "Today";
  if (dayOffset === 1) return "Tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function SocialScheduler({ transactions, onBack, onMarkPosted, onMarkClosingPosted, onReorder }) {
  const [view, setView] = useState("queue");
  const [boostPostTx, setBoostPostTx] = useState(null);
  const [graphicTx, setGraphicTx] = useState(null);
  const dragIndex = useRef(null); // desktop mouse drag (native HTML5 DnD)
  const touchDrag = useRef({ index: null, startX: 0, startY: 0, timer: null, dragging: false }); // touch drag
  const [draggingIndex, setDraggingIndex] = useState(null);
  const [dragDelta, setDragDelta] = useState(null);
  const [dropTargetIndex, setDropTargetIndex] = useState(null);

  const rotation = transactions
    .filter((tx) => !tx.terminated_at && (tx.stage === "won" || tx.stage === "market") && tx.social_queue_order != null)
    .sort((a, b) => a.social_queue_order - b.social_queue_order);

  const closingDue = transactions.filter(
    (tx) => (tx.stage === "contract" || tx.stage === "closed") && tx.social_went_live_at && !tx.social_closing_posted_at
  );

  function handleDrop(targetIndex, sourceIndex = dragIndex.current) {
    if (sourceIndex === null || sourceIndex === targetIndex) return;
    const reordered = [...rotation];
    const [moved] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    dragIndex.current = null;
    onReorder(reordered.map((tx) => tx.id));
  }

  // Native HTML5 drag-and-drop (desktop mouse) has no touch equivalent, so
  // press-and-hold-to-drag on phone/iPad is handled by hand below instead.
  function handleCardTouchStart(e, index) {
    const touch = e.touches[0];
    touchDrag.current = {
      index,
      startX: touch.clientX,
      startY: touch.clientY,
      dragging: false,
      timer: setTimeout(() => {
        touchDrag.current.dragging = true;
        setDraggingIndex(index);
        setDragDelta({ x: 0, y: 0 });
      }, LONG_PRESS_MS),
    };
  }

  function handleCardTouchMove(e) {
    const drag = touchDrag.current;
    if (drag.index === null) return;
    const touch = e.touches[0];
    const dx = touch.clientX - drag.startX;
    const dy = touch.clientY - drag.startY;

    if (!drag.dragging) {
      // Moved before the long-press fired — this is a scroll, not a drag;
      // cancel so the page scrolls normally.
      if (Math.abs(dx) > MOVE_CANCEL_THRESHOLD || Math.abs(dy) > MOVE_CANCEL_THRESHOLD) {
        clearTimeout(drag.timer);
        touchDrag.current = { index: null, startX: 0, startY: 0, timer: null, dragging: false };
      }
      return;
    }

    e.preventDefault();
    setDragDelta({ x: dx, y: dy });
    const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest("[data-day-index]");
    setDropTargetIndex(target ? Number(target.dataset.dayIndex) : null);
  }

  function handleCardTouchEnd() {
    const drag = touchDrag.current;
    if (drag.timer) clearTimeout(drag.timer);
    if (drag.dragging && dropTargetIndex !== null && dropTargetIndex !== drag.index) {
      handleDrop(dropTargetIndex, drag.index);
    }
    touchDrag.current = { index: null, startX: 0, startY: 0, timer: null, dragging: false };
    setDraggingIndex(null);
    setDragDelta(null);
    setDropTargetIndex(null);
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
            <li key={tx.id} className={`social-queue-row ${socialRecencyClass(tx.social_last_posted_at)}`}>
              <ListingThumbnail transactionId={tx.id} />
              <div>
                <span className="tx-address">{tx.address}</span>
                <span className="tx-sub"> — {daysSince(tx.social_last_posted_at)}</span>
              </div>
              <div className="social-row-actions">
                <button type="button" className="comps-minimize-btn" onClick={() => setBoostPostTx(tx)}>
                  Boost Post
                </button>
                <button type="button" className="comps-minimize-btn" onClick={() => setGraphicTx(tx)}>
                  New Listing Graphic
                </button>
                <label className="social-mark-posted">
                  <input type="checkbox" checked={false} onChange={() => onMarkPosted(tx.id)} />
                  Mark Posted
                </label>
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
                data-day-index={i}
                className={`social-calendar-day ${dropTargetIndex === i && draggingIndex !== null ? "social-calendar-day--drop-target" : ""}`}
                onDragOver={(e) => tx && e.preventDefault()}
                onDrop={() => tx && handleDrop(i)}
              >
                <div className="timeframe-group-title">{calendarLabel(i)}</div>
                {tx ? (
                  <div
                    className={`social-calendar-card ${socialRecencyClass(tx.social_last_posted_at)} ${
                      draggingIndex === i ? "social-calendar-card--dragging" : ""
                    }`}
                    draggable
                    onDragStart={() => {
                      dragIndex.current = i;
                    }}
                    onTouchStart={(e) => handleCardTouchStart(e, i)}
                    onTouchMove={handleCardTouchMove}
                    onTouchEnd={handleCardTouchEnd}
                    style={
                      draggingIndex === i && dragDelta
                        ? { transform: `translate(${dragDelta.x}px, ${dragDelta.y}px) rotate(-2deg) scale(1.05)` }
                        : undefined
                    }
                  >
                    <ListingThumbnail transactionId={tx.id} />
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
