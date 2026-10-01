import { useEffect, useRef, useState } from "react";
import { listListingPhotos, fetchListingFile } from "../lib/transactions";
import { composeNewListingGraphic } from "../lib/instagramPost";

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

/** The one-time branded "New Listing" Instagram announcement graphic. Holly picks
 * the hero photo herself (this is the first-impression announcement, worth the
 * extra tap vs. auto-picking) from a thumbnail grid, with a tap-to-preview-large
 * step before it's actually used, since small Dropbox thumbnails are hard to tell
 * apart on a phone. */
function NewListingGraphicPanel({ transaction, onClose }) {
  const [step, setStep] = useState("loading"); // loading | picking | previewing | composing | result | error
  const [photos, setPhotos] = useState([]);
  const [thumbs, setThumbs] = useState({}); // path -> { url, blob }
  const [candidate, setCandidate] = useState(null); // { name, path, url }
  const [resultUrl, setResultUrl] = useState(null);
  const [error, setError] = useState(null);
  const blobUrls = useRef([]);

  useEffect(() => {
    let cancelled = false;
    listListingPhotos(transaction.id)
      .then(async (list) => {
        if (cancelled) return;
        setPhotos(list);
        setStep("picking");
        // Loaded sequentially (not Promise.all) so a big folder doesn't fire a
        // burst of concurrent Dropbox reads — thumbnails just pop in one by one.
        for (const photo of list) {
          if (cancelled) return;
          try {
            const blob = await fetchListingFile(transaction.id, photo.path);
            if (cancelled) return;
            const url = URL.createObjectURL(blob);
            blobUrls.current.push(url);
            setThumbs((prev) => ({ ...prev, [photo.path]: { url, blob } }));
          } catch {
            // One bad photo shouldn't block the rest of the grid from loading.
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message);
          setStep("error");
        }
      });
    return () => {
      cancelled = true;
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [transaction.id]);

  function handlePick(photo) {
    const thumb = thumbs[photo.path];
    if (!thumb) return;
    setCandidate({ ...photo, ...thumb });
    setStep("previewing");
  }

  async function handleConfirm() {
    setStep("composing");
    try {
      const resultBlob = await composeNewListingGraphic({
        photoBlob: candidate.blob,
        address: transaction.address,
        cityState: [transaction.town, transaction.region].filter(Boolean).join(", "),
      });
      const url = URL.createObjectURL(resultBlob);
      blobUrls.current.push(url);
      setResultUrl(url);
      setStep("result");
    } catch (e) {
      setError(e.message);
      setStep("error");
    }
  }

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="confirm-dialog social-post-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">New Listing Graphic — {transaction.address}</h2>

        {step === "loading" && <p className="field-help">Loading photos…</p>}
        {step === "error" && <p className="field-note">{error}</p>}

        {step === "picking" && (
          <>
            <p className="confirm-dialog-message">Pick the hero photo for the announcement graphic.</p>
            {photos.length === 0 ? (
              <p className="empty-state">No photos found in this listing's Dropbox Photos folder.</p>
            ) : (
              <div className="social-photo-grid">
                {photos.map((p) =>
                  thumbs[p.path] ? (
                    <button
                      key={p.path}
                      type="button"
                      className="social-photo-thumb social-photo-thumb--btn"
                      onClick={() => handlePick(p)}
                    >
                      <img src={thumbs[p.path].url} alt={p.name} />
                    </button>
                  ) : (
                    <div key={p.path} className="social-photo-thumb social-photo-thumb--loading" />
                  )
                )}
              </div>
            )}
          </>
        )}

        {step === "previewing" && candidate && (
          <>
            <p className="confirm-dialog-message">Use this photo?</p>
            <img src={candidate.url} alt={candidate.name} className="social-photo-preview-large" />
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setStep("picking")}>
                Back
              </button>
              <button type="button" className="google-btn confirm-dialog-confirm" onClick={handleConfirm}>
                Use This Photo
              </button>
            </div>
          </>
        )}

        {step === "composing" && <p className="field-help">Generating graphic…</p>}

        {step === "result" && resultUrl && (
          <>
            <img src={resultUrl} alt="New listing graphic" className="social-photo-preview-large" />
            <div className="confirm-dialog-actions">
              <a
                className="google-btn confirm-dialog-confirm"
                href={resultUrl}
                download={`${transaction.address} - New Listing - Instagram.png`}
              >
                Download
              </a>
            </div>
          </>
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
      {graphicTx && <NewListingGraphicPanel transaction={graphicTx} onClose={() => setGraphicTx(null)} />}
    </div>
  );
}
