import { useEffect, useRef, useState } from "react";
import { listListingPhotos, fetchListingFile, extractListingDescription } from "../lib/transactions";
import { composeListingGraphic, POST_TYPES } from "../lib/instagramPost";
import { useToast } from "../lib/ToastContext";

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

/** Random 4-5 photos from the listing's Dropbox Photos folder, shown as a tappable
 * grid — tapping one opens it full-size in a new tab so Holly can use the phone's
 * native share/save sheet, rather than forcing a multi-file download (which iOS
 * Safari routinely breaks). Shared between the Social Scheduler and the deal
 * detail screen's social post menu. */
export function BoostPostPanel({ transaction, onClose }) {
  const [previews, setPreviews] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [caption, setCaption] = useState("");
  const [captionNote, setCaptionNote] = useState(null);
  const [captionLoading, setCaptionLoading] = useState(true);
  const showToast = useToast();

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
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [transaction.id]);

  function handleCopyCaption() {
    navigator.clipboard.writeText(caption).then(() => showToast("Caption copied"));
  }

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
  const [thumbs, setThumbs] = useState({}); // path -> { url, blob }
  const [candidate, setCandidate] = useState(null); // { name, path, url }
  const [resultUrl, setResultUrl] = useState(null);
  const [error, setError] = useState(null);
  const blobUrls = useRef([]);
  const postLabel = POST_TYPES[postType]?.label || "Listing";

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
