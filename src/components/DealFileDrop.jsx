import { useState } from "react";
import { UploadCloud } from "lucide-react";
import { dealSubfolders, listDealFiles, uploadToDealFolder } from "../lib/transactions";
import { describe, streetOf, suggestFolder, isPhoto, highestNumber } from "../lib/folderOrganizer";
import { useToast } from "../lib/ToastContext";

// Deal screen: drop files as they come in. Each one gets a suggested subfolder
// (from its name) and the next number in that folder — "7) 3673 Fish Hill
// Road - Waiver of Inspections.pdf". Review, adjust, then upload. Photos keep
// their own names (the folder organizer leaves Photos alone too).
export default function DealFileDrop({ transaction, onUploaded }) {
  const showToast = useToast();
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState(null); // [{ file, folder, desc }]
  const [folders, setFolders] = useState([]);
  const [existing, setExisting] = useState({}); // folder → [names]
  const [step, setStep] = useState("idle"); // idle | loading | review | uploading | error
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const street = streetOf(transaction).replace(/[\\/:*?"<>|]/g, "");

  async function start(fileList) {
    const files = [...(fileList || [])].filter((f) => f.size > 0);
    if (!files.length) return;
    setStep("loading");
    setError(null);
    try {
      const [subs, listing] = await Promise.all([dealSubfolders(transaction.id), listDealFiles(transaction.id)]);
      const byFolder = {};
      for (const f of listing.files || []) (byFolder[f.folder] ||= []).push(f.name);
      setFolders(subs);
      setExisting(byFolder);
      setRows(files.map((file) => ({ file, folder: suggestFolder(file.name, subs), desc: describe(file.name, transaction) })));
      setStep("review");
    } catch (e) {
      setError(e.message);
      setStep("error");
    }
  }

  /** Final names, numbering after what's already in each folder. */
  function named(list) {
    const next = {};
    return list.map((r) => {
      if (isPhoto(r.file.name) && /photo/i.test(r.folder)) return { ...r, name: r.file.name };
      if (next[r.folder] == null) next[r.folder] = highestNumber(existing[r.folder] || []) + 1;
      const n = next[r.folder]++;
      const ext = (r.file.name.match(/\.([a-z0-9]{2,5})$/i) || [])[1];
      return { ...r, name: `${n}) ${street} - ${(r.desc || "Document").replace(/[\\/:*?"<>|]/g, "").trim()}${ext ? `.${ext.toLowerCase()}` : ""}` };
    });
  }

  async function uploadAll() {
    const list = named(rows);
    setStep("uploading");
    const failed = [];
    for (let i = 0; i < list.length; i++) {
      setProgress(`Uploading ${i + 1} of ${list.length}: ${list[i].name}`);
      try {
        await uploadToDealFolder(transaction.id, list[i].folder, list[i].name, list[i].file);
      } catch (e) {
        failed.push(`${list[i].file.name}: ${e.message}`);
      }
    }
    setRows(null);
    setStep("idle");
    onUploaded?.();
    if (failed.length) {
      setError(`Couldn't upload: ${failed.join("; ")}`);
      setStep("error");
    } else {
      showToast(`${list.length} file${list.length === 1 ? "" : "s"} added to Dropbox`);
    }
  }

  const preview = rows ? named(rows) : [];
  const setRow = (i, patch) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  return (
    <>
      <label
        className={`check-dropzone deal-dropzone ${dragging ? "check-dropzone--over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          start(e.dataTransfer.files);
        }}
        title="Drop files for this deal — they're named and filed in Dropbox for you"
      >
        <input type="file" multiple hidden onChange={(e) => start(e.target.files)} />
        <span>
          <UploadCloud size={18} style={{ verticalAlign: -4 }} /> <strong>Drop files for this deal</strong> or click to choose
          <br />
          <span className="field-help">Named “1) {street} - …” and put in the right folder — you'll check before they upload</span>
        </span>
      </label>
      {step === "loading" && <p className="field-help">Looking at the deal's folders…</p>}
      {step === "error" && error && (
        <p className="field-note">
          {error}{" "}
          <button type="button" className="import-link-btn" onClick={() => setStep("idle")}>
            OK
          </button>
        </p>
      )}

      {(step === "review" || step === "uploading") && rows && (
        <div className="confirm-dialog-overlay" onClick={step === "uploading" ? undefined : () => setStep("idle")}>
          <div className="confirm-dialog social-post-panel packet-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="confirm-dialog-title">Add {rows.length} file{rows.length === 1 ? "" : "s"} to the deal</h2>
            {step === "uploading" ? (
              <div className="packet-building">
                <div className="won-setup-spinner" aria-hidden="true" />
                <p className="confirm-dialog-message">{progress}</p>
              </div>
            ) : (
              <>
                <ul className="organizer-list">
                  {preview.map((r, i) => (
                    <li key={i} className="drop-row">
                      <div className="organizer-names">
                        <select value={r.folder} onChange={(e) => setRow(i, { folder: e.target.value })} aria-label="Folder">
                          <option value="">Deal folder (top level)</option>
                          {folders.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                        {r.name === r.file.name ? (
                          <div className="organizer-new">{r.name}</div>
                        ) : (
                          <div className="organizer-new">
                            <span className="organizer-prefix">{r.name.slice(0, r.name.indexOf(" - ") + 3)}</span>
                            <input value={r.desc} onChange={(e) => setRow(i, { desc: e.target.value })} aria-label="Description" />
                          </div>
                        )}
                        <div className="organizer-old">was: {r.file.name}</div>
                      </div>
                      <button type="button" className="import-link-btn" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))} title="Don't upload this one">
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="confirm-dialog-actions">
                  <button type="button" onClick={() => setStep("idle")} title="Cancel — nothing is uploaded">
                    Cancel
                  </button>
                  <button type="button" className="google-btn confirm-dialog-confirm" disabled={!rows.length} onClick={uploadAll} title="Upload to Dropbox with these names">
                    Upload {rows.length}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
