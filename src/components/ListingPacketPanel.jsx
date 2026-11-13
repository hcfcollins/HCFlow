import { useEffect, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { listListingPhotos, fetchAllAgents } from "../lib/transactions";
import { coverPlan, formatPhone, listShowingDocs, buildCoverSheet, buildPacket, savePacketToDropbox, packetFileName } from "../lib/listingPacket";
import { PhotoThumbGrid } from "./SocialPostPanels";

// Create Listing Packet: pick the cover photo → check the cover + which
// Showing Docs go in → build → saved to Showing Docs as "<address> - Packet.pdf".
export default function ListingPacketPanel({ transaction, onClose, onSaved }) {
  const [step, setStep] = useState("loading"); // loading | photo | review | building | done | error
  const [photos, setPhotos] = useState([]);
  const [files, setFiles] = useState([]);
  const [plan, setPlan] = useState(null);
  const [photo, setPhoto] = useState(null); // { name, url, blob }
  const [coverUrl, setCoverUrl] = useState(null);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState(null); // { url, problems, savedPath, saveError }
  const [error, setError] = useState(null);
  const urls = useRef([]);

  useEffect(() => {
    let live = true;
    Promise.all([listListingPhotos(transaction.id), listShowingDocs(transaction.id), fetchAllAgents()])
      .then(([p, f, agents]) => {
        if (!live) return;
        setPhotos(p.photos || []);
        setFiles(f);
        setPlan(coverPlan(transaction, agents));
        setStep("photo");
      })
      .catch((e) => {
        if (!live) return;
        setError(e.message);
        setStep("error");
      });
    return () => {
      live = false;
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    };
    // Only when the deal changes — not on every background refresh mid-flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.id]);

  const keep = (u) => {
    urls.current.push(u);
    return u;
  };

  async function pickPhoto(p, thumb) {
    keep(thumb.url);
    setPhoto({ ...p, ...thumb });
    setStep("review");
    setCoverUrl(null);
    try {
      const bytes = await buildCoverSheet({ tx: transaction, plan, photoBlob: thumb.blob });
      setCoverUrl(keep(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))));
    } catch (e) {
      setError(`Couldn't make the cover: ${e.message}`);
    }
  }

  async function build() {
    setStep("building");
    try {
      const { bytes, problems } = await buildPacket({ tx: transaction, plan, photoBlob: photo.blob, files, onProgress: setProgress });
      const url = keep(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
      setProgress("Saving to Dropbox…");
      let savedPath = null;
      let saveError = null;
      try {
        savedPath = await savePacketToDropbox(transaction, bytes);
        onSaved?.();
      } catch (e) {
        saveError = e.message;
      }
      setResult({ url, problems, savedPath, saveError });
      setStep("done");
    } catch (e) {
      setError(e.message);
      setStep("error");
    }
  }

  const included = files.filter((f) => !f.skip);
  const missingPhone = plan?.agents.filter((a) => a && !a.phone) || [];

  return (
    <div className="confirm-dialog-overlay" onClick={step === "building" ? undefined : onClose}>
      <div className="confirm-dialog social-post-panel packet-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">Listing Packet — {transaction.address}</h2>

        {step === "loading" && <p className="field-help">Looking in Dropbox for photos and Showing Docs…</p>}
        {step === "error" && <p className="field-note">{error}</p>}

        {step === "photo" && (
          <>
            <p className="confirm-dialog-message">Pick the cover photo.</p>
            {photos.length ? (
              <PhotoThumbGrid transactionId={transaction.id} photos={photos} onPick={pickPhoto} />
            ) : (
              <p className="field-note">No photos found in this listing's “4) Photos” folder yet.</p>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <div className="packet-review">
              <div className="packet-cover-preview">
                {coverUrl ? (
                  <iframe src={`${coverUrl}#toolbar=0&navpanes=0&view=FitH`} title="Cover sheet preview" />
                ) : error ? (
                  <p className="field-note">{error}</p>
                ) : (
                  <p className="field-help">Making the cover…</p>
                )}
              </div>
              <div className="packet-review-info">
                <div className="packet-review-label">Cover</div>
                <div>
                  {plan.label}
                  {plan.agents.length > 0 && ` — ${plan.agents.map((a) => a.name).join(" & ")}`}
                </div>
                {plan.agents.map((a) => (
                  <div key={a.id} className="field-help">
                    {a.name}: {a.phone ? formatPhone(a.phone) : "no phone on file"} · {a.email || "no email"}
                  </div>
                ))}
                {missingPhone.length > 0 && (
                  <p className="field-note">
                    No phone number for {missingPhone.map((a) => a.name).join(" & ")} — add it on Manage Agents, or the cover will leave it blank.
                  </p>
                )}

                <div className="packet-review-label">After the cover, in this order (from 3) Showing Docs)</div>
                {files.length === 0 && <p className="field-note">Showing Docs is empty — the packet will just be the cover.</p>}
                <ol className="packet-file-list">
                  {files.map((f) => (
                    <li key={f.path} className={f.skip ? "packet-file--skip" : ""}>
                      {f.skip ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />} {f.name}
                      {f.skip && <span className="field-help"> — skipped ({f.skip})</span>}
                    </li>
                  ))}
                </ol>
                <p className="field-help">
                  Saves to Showing Docs as <strong>{packetFileName(transaction)}</strong>, replacing an older copy with that name.
                </p>
              </div>
            </div>
            <div className="confirm-dialog-actions">
              <button type="button" onClick={() => setStep("photo")} title="Pick a different cover photo">
                Different Photo
              </button>
              <button type="button" className="google-btn confirm-dialog-confirm" disabled={!coverUrl} onClick={build} title="Combine the cover and Showing Docs into one PDF">
                Create Packet ({included.length + 1} part{included.length ? "s" : ""})
              </button>
            </div>
          </>
        )}

        {step === "building" && (
          <div className="packet-building">
            <div className="won-setup-spinner" aria-hidden="true" />
            <p className="confirm-dialog-message">{progress || "Working…"}</p>
            <p className="field-help">Keep this open — big packets can take a minute.</p>
          </div>
        )}

        {step === "done" && result && (
          <>
            {result.savedPath ? (
              <p className="review-complete">✓ Saved to Showing Docs as {result.savedPath.split("/").pop()}. The Packet ➤ button will send this one.</p>
            ) : (
              <p className="field-note">Made the packet, but couldn't save it to Dropbox ({result.saveError}). Download it below and drop it into Showing Docs.</p>
            )}
            {result.problems.length > 0 && (
              <div className="field-note">
                Left out (couldn't read):
                <ul>
                  {result.problems.map((p) => (
                    <li key={p.name}>
                      {p.name} — {p.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="confirm-dialog-actions">
              <a className="cma-export-btn" href={result.url} target="_blank" rel="noreferrer" title="Open the packet">
                <FileText size={14} /> Open
              </a>
              <a className="google-btn confirm-dialog-confirm" href={result.url} download={packetFileName(transaction)} title="Download the packet">
                Download
              </a>
            </div>
          </>
        )}

        {step !== "building" && (
          <div className="confirm-dialog-actions">
            <button type="button" onClick={onClose} title="Close">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
