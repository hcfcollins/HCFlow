import { useEffect, useMemo, useRef, useState } from "react";
import { listListingPhotos, fetchListingFile, extractListingDescription } from "../lib/transactions";
import { composeListingGraphic, POST_TYPES } from "../lib/instagramPost";
import { useToast } from "../lib/ToastContext";
import RadioGroup from "./RadioGroup";

const OPEN_HOUSE_TIME_OPTIONS = ["10:00 AM - 12:00 PM", "12:00 PM - 2:00 PM", "Other"];

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

/** Progressively loads and shows thumbnails for `photos`, one request at a time
 * (not Promise.all) so a big folder doesn't fire a burst of concurrent Dropbox
 * reads — thumbnails just pop in as they're ready. Tapping a loaded one calls
 * onPick(photo, {url, blob}). Shared by the hero-photo picker and the Boost Post
 * redo picker so both get the same progressive-load behavior for free. */
function PhotoThumbGrid({ transactionId, photos, onPick }) {
  const [thumbs, setThumbs] = useState({});
  const blobUrls = useRef([]);

  useEffect(() => {
    let cancelled = false;
    setThumbs({});
    async function load() {
      for (const photo of photos) {
        if (cancelled) return;
        try {
          const blob = await fetchListingFile(transactionId, photo.path);
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          blobUrls.current.push(url);
          setThumbs((prev) => ({ ...prev, [photo.path]: { url, blob } }));
        } catch {
          // One bad photo shouldn't block the rest of the grid from loading.
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
      blobUrls.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, photos]);

  if (photos.length === 0) {
    return <p className="empty-state">No other photos available in this folder.</p>;
  }

  return (
    <div className="social-photo-grid">
      {photos.map((p) =>
        thumbs[p.path] ? (
          <button
            key={p.path}
            type="button"
            className="social-photo-thumb social-photo-thumb--btn"
            onClick={() => onPick(p, thumbs[p.path])}
          >
            <img src={thumbs[p.path].url} alt={p.name} />
          </button>
        ) : (
          <div key={p.path} className="social-photo-thumb social-photo-thumb--loading" />
        )
      )}
    </div>
  );
}

/** Starts with 5 random photos from the listing's Dropbox Photos folder (Chosen
 * Ones, falling back to Compressed_MLS, falling back to the whole folder). Each
 * one has its own Redo button — picks a replacement from the rest of the folder
 * (your choice, not just another random one) without touching the other 4.
 * Tapping a photo opens it full-size in a new tab so Holly can use the phone's
 * native share/save sheet, rather than forcing a multi-file download (which iOS
 * Safari routinely breaks). Shared between the Social Scheduler and the deal
 * detail screen's social post menu. */
export function BoostPostPanel({ transaction, onClose }) {
  const [allPhotos, setAllPhotos] = useState(null);
  const [photoSource, setPhotoSource] = useState(null);
  const [selected, setSelected] = useState([]); // [{name, path, url, blob}]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [swapIndex, setSwapIndex] = useState(null); // index into `selected` currently being redone
  const [caption, setCaption] = useState("");
  const [captionNote, setCaptionNote] = useState(null);
  const [captionLoading, setCaptionLoading] = useState(true);
  const blobUrls = useRef([]);
  const showToast = useToast();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const { photos, source } = await listListingPhotos(transaction.id);
        if (cancelled) return;
        setAllPhotos(photos);
        setPhotoSource(source);
        const picked = sampleRandom(photos, Math.min(BOOST_POST_PHOTO_COUNT, photos.length));
        const withUrls = [];
        for (const photo of picked) {
          if (cancelled) return;
          const blob = await fetchListingFile(transaction.id, photo.path);
          const url = URL.createObjectURL(blob);
          blobUrls.current.push(url);
          withUrls.push({ ...photo, url, blob });
        }
        if (!cancelled) setSelected(withUrls);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();

    extractListingDescription(transaction.id)
      .then((result) => {
        if (cancelled) return;
        if (result.description) {
          setCaption(result.description);
          if (result.source === "fallback") {
            setCaptionNote("Couldn't find a clear description in the packet — here's the top of the sheet, edit as needed.");
          }
        } else {
          setCaptionNote(result.note || "Couldn't draft a caption — write your own below.");
        }
      })
      .catch((e) => setCaptionNote(`Couldn't draft a caption: ${e.message}`))
      .finally(() => {
        if (!cancelled) setCaptionLoading(false);
      });

    return () => {
      cancelled = true;
      blobUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [transaction.id]);

  function handleCopyCaption() {
    navigator.clipboard.writeText(caption).then(() => showToast("Caption copied"));
  }

  async function handleSwapPick(photo, thumb) {
    blobUrls.current.push(thumb.url);
    setSelected((prev) => prev.map((p, i) => (i === swapIndex ? { ...photo, url: thumb.url, blob: thumb.blob } : p)));
    setSwapIndex(null);
  }

  // Memoized so PhotoThumbGrid's effect (keyed on this array's identity) doesn't
  // re-fetch and reload every thumbnail on every unrelated re-render while the
  // swap picker is open.
  const selectedPathsKey = selected.map((s) => s.path).join(",");
  const swapCandidates = useMemo(
    () => (allPhotos || []).filter((p) => !selectedPathsKey.split(",").includes(p.path)),
    [allPhotos, selectedPathsKey]
  );

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="confirm-dialog social-post-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">Boost Post — {transaction.address}</h2>

        {swapIndex !== null ? (
          <>
            <p className="confirm-dialog-message">Pick a different photo for this slot.</p>
            <PhotoThumbGrid transactionId={transaction.id} photos={swapCandidates} onPick={handleSwapPick} />
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setSwapIndex(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="confirm-dialog-message">
              Tap a photo to open it full-size, then use your phone's share/save option. Don't like one? Hit Redo for a
              different pick.
              {photoSource && photoSource !== "Chosen Ones" && (
                <span className="field-note"> (No photos in "Chosen Ones" yet — showing {photoSource} instead.)</span>
              )}
            </p>
            {loading && <p className="field-help">Loading photos…</p>}
            {error && <p className="field-note">{error}</p>}
            {selected.length === 0 && !loading && (
              <p className="empty-state">No photos found in this listing's Dropbox Photos folder.</p>
            )}
            {selected.length > 0 && (
              <div className="social-photo-grid">
                {selected.map((p, i) => (
                  <div key={p.path} className="social-photo-thumb-wrap">
                    <a href={p.url} target="_blank" rel="noreferrer" className="social-photo-thumb">
                      <img src={p.url} alt={p.name} />
                    </a>
                    <button
                      type="button"
                      className="social-photo-redo-btn"
                      onClick={() => setSwapIndex(i)}
                      disabled={swapCandidates.length === 0}
                      title="Pick a different photo"
                    >
                      ↻ Redo
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="confirm-dialog-prompt-label">
              Caption{captionLoading ? " (drafting…)" : ""}
              <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} placeholder="Write a caption…" />
            </label>
            {captionNote && <p className="field-help">{captionNote}</p>}
            <div className="comp-edit-all-actions">
              <button type="button" className="comps-minimize-btn" onClick={handleCopyCaption} disabled={!caption}>
                Copy Caption
              </button>
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

/** The branded Instagram announcement graphic — New Listing, Under Contract, or
 * Sold, per `postType` (see POST_TYPES in lib/instagramPost.js). Holly picks the
 * hero photo herself (worth the extra tap vs. auto-picking, since this is a public
 * announcement) from a thumbnail grid, with a tap-to-preview-large step before
 * it's actually used, since small Dropbox thumbnails are hard to tell apart on a
 * phone. Shared between the Social Scheduler and the deal detail screen's menu. */
export function ListingGraphicPanel({ transaction, postType, onClose }) {
  const [step, setStep] = useState("loading"); // loading | picking | previewing | composing | result | error
  const [photos, setPhotos] = useState([]);
  const [candidate, setCandidate] = useState(null); // { name, path, url, blob }
  const [resultUrl, setResultUrl] = useState(null);
  const [error, setError] = useState(null);
  const blobUrls = useRef([]);
  const postLabel = POST_TYPES[postType]?.label || "Listing";

  useEffect(() => {
    let cancelled = false;
    listListingPhotos(transaction.id)
      .then(({ photos: list }) => {
        if (cancelled) return;
        setPhotos(list);
        setStep("picking");
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

  function handlePick(photo, thumb) {
    blobUrls.current.push(thumb.url);
    setCandidate({ ...photo, ...thumb });
    setStep("previewing");
  }

  async function handleConfirm() {
    setStep("composing");
    try {
      const resultBlob = await composeListingGraphic({
        postType,
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
        <h2 className="confirm-dialog-title">{postLabel} Graphic — {transaction.address}</h2>

        {step === "loading" && <p className="field-help">Loading photos…</p>}
        {step === "error" && <p className="field-note">{error}</p>}

        {step === "picking" && (
          <>
            <p className="confirm-dialog-message">Pick the hero photo for the announcement graphic.</p>
            <PhotoThumbGrid transactionId={transaction.id} photos={photos} onPick={handlePick} />
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
            <img src={resultUrl} alt={`${postLabel} graphic`} className="social-photo-preview-large" />
            <div className="confirm-dialog-actions">
              <a
                className="google-btn confirm-dialog-confirm"
                href={resultUrl}
                download={`${transaction.address} - ${postLabel} - Instagram.png`}
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

/** Captures the open house date/time — the branded graphic itself is on hold
 * until Fran provides the Open House template (the ported combiner repo never
 * had one; Under Contract/Sold reused existing templates, this one doesn't
 * exist yet). Collecting date/time now means nothing has to be re-asked once
 * the template's in and this wires up to composeListingGraphic like the rest. */
export function OpenHousePanel({ transaction, onClose }) {
  const [date, setDate] = useState("");
  const [timeChoice, setTimeChoice] = useState(OPEN_HOUSE_TIME_OPTIONS[0]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const timeLabel = timeChoice === "Other" ? (customStart && customEnd ? `${customStart} – ${customEnd}` : "") : timeChoice;
  const dateLabel = date
    ? new Date(`${date}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
    : "";

  return (
    <div className="confirm-dialog-overlay" onClick={onClose}>
      <div className="confirm-dialog social-post-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">Open House — {transaction.address}</h2>

        {!confirmed ? (
          <>
            <label>
              Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <fieldset>
              <legend>Time</legend>
              <RadioGroup name="openHouseTime" value={timeChoice} onChange={setTimeChoice} options={OPEN_HOUSE_TIME_OPTIONS} />
              {timeChoice === "Other" && (
                <div className="comp-edit-all-actions">
                  <input type="time" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
                  <input type="time" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
                </div>
              )}
            </fieldset>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="google-btn confirm-dialog-confirm"
                disabled={!date || !timeLabel}
                onClick={() => setConfirmed(true)}
              >
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="confirm-dialog-message">
              Open house: <strong>{dateLabel}</strong>, {timeLabel}.
            </p>
            <p className="field-help">
              The branded Open House graphic isn't built yet — Fran still needs to provide the
              template for it. Once that's in, this will generate it the same way New Listing,
              Under Contract, and Closed already do.
            </p>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
