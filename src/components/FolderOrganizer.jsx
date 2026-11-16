import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, FolderOpen } from "lucide-react";
import { listDealFiles, renameDealFiles } from "../lib/transactions";
import { planRenames, renumber, streetOf } from "../lib/folderOrganizer";

// "Organize Deal Folder" (Close-Out Calculator): proposes consistent, numbered
// names for every file in the deal's Dropbox folder except Photos, in the
// order things happened, ending with Closing Docs and the Commission Check.
// Review → move files up/down, edit a description, or uncheck to leave a file
// alone → Rename. Nothing changes in Dropbox until then.
export default function FolderOrganizer({ transaction, onClose, onDone }) {
  const [step, setStep] = useState("loading"); // loading | review | renaming | done | error
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const street = streetOf(transaction).replace(/[\\/:*?"<>|]/g, "");

  useEffect(() => {
    let live = true;
    listDealFiles(transaction.id)
      .then(({ files }) => {
        if (!live) return;
        setGroups(planRenames(files, transaction));
        setStep("review");
      })
      .catch((e) => {
        if (!live) return;
        setError(e.message);
        setStep("error");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction.id]);

  const update = (gi, fn) => setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, items: renumber(fn(g.items), street) } : g)));
  // Keep the file you're moving (and its arrow) under the mouse: after it
  // moves, scroll the list by however far it moved, so you can keep clicking
  // the same arrow without chasing it.
  const pendingScroll = useRef(null);
  useLayoutEffect(() => {
    const p = pendingScroll.current;
    if (!p) return;
    pendingScroll.current = null;
    const btn = document.querySelector(`[data-org-path="${CSS.escape(p.path)}"] [data-arrow="${p.dir}"]`);
    if (!btn) return;
    const delta = btn.getBoundingClientRect().top - p.top;
    if (!delta) return;
    let el = btn.parentElement;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
      el = el.parentElement;
    }
    if (el && el !== document.body) el.scrollTop += delta;
    else window.scrollBy(0, delta);
  }, [groups]);

  const move = (gi, ii, dir, e) => {
    const path = groups[gi]?.items[ii]?.path;
    if (e?.currentTarget && path) pendingScroll.current = { path, dir, top: e.currentTarget.getBoundingClientRect().top };
    return update(gi, (items) => {
      const next = [...items];
      const j = ii + dir;
      if (j < 0 || j >= next.length) return items;
      [next[ii], next[j]] = [next[j], next[ii]];
      return next;
    });
  };
  const setDesc = (gi, ii, desc) => update(gi, (items) => items.map((it, k) => (k === ii ? { ...it, desc } : it)));
  const toggle = (gi, ii) => update(gi, (items) => items.map((it, k) => (k === ii && !it.skip ? { ...it, include: !it.include } : it)));

  const changes = groups.flatMap((g) => g.items.filter((it) => it.include && it.newName !== it.oldName));

  async function apply() {
    setStep("renaming");
    try {
      const r = await renameDealFiles(
        transaction.id,
        changes.map((it) => ({ from: it.path, toName: it.newName })),
        transaction.documents || []
      );
      setResult(r);
      setStep("done");
      onDone?.();
    } catch (e) {
      setError(e.message);
      setStep("error");
    }
  }

  return (
    <div className="confirm-dialog-overlay" onClick={step === "renaming" ? undefined : onClose}>
      <div className="confirm-dialog social-post-panel packet-panel" onClick={(e) => e.stopPropagation()}>
        <h2 className="confirm-dialog-title">
          <FolderOpen size={18} /> Organize Deal Folder
        </h2>

        {step === "loading" && <p className="field-help">Reading the deal's Dropbox folder…</p>}
        {step === "error" && <p className="field-note">{error}</p>}

        {step === "review" && (
          <>
            <p className="confirm-dialog-message">
              Every file except Photos, numbered in the order it was added, with Closing Docs and the Commission Check last. Use the arrows to
              reorder, edit any description, or uncheck a file to leave it as is. Nothing changes until you tap Rename.
            </p>
            {groups.length === 0 && <p className="field-note">No files found in this deal's folder.</p>}
            {groups.map((g, gi) => (
              <div key={g.folder || "top"} className="organizer-group">
                <div className="packet-review-label">{g.folder || "Deal folder"}</div>
                <ul className="organizer-list">
                  {g.items.map((it, ii) => (
                    <li key={it.path} data-org-path={it.path} className={it.include ? "" : "organizer-item--off"}>
                      <input type="checkbox" checked={it.include} disabled={Boolean(it.skip)} onChange={() => toggle(gi, ii)} title={it.skip ? `Left as is: ${it.skip}` : "Include in the rename"} />
                      <div className="organizer-names">
                        {it.include ? (
                          <div className="organizer-new">
                            <span className="organizer-prefix">{it.newName.slice(0, it.newName.indexOf(" - ") + 3)}</span>
                            <input value={it.desc} onChange={(e) => setDesc(gi, ii, e.target.value)} aria-label="Description" />
                          </div>
                        ) : (
                          <div className="organizer-new">{it.oldName}</div>
                        )}
                        <div className="organizer-old">{it.skip ? `Left as is — ${it.skip}` : `was: ${it.oldName}`}</div>
                      </div>
                      <div className="organizer-arrows">
                        <button type="button" data-arrow={-1} onClick={(e) => move(gi, ii, -1, e)} disabled={ii === 0} title="Move up" aria-label="Move up">
                          <ChevronUp size={16} />
                        </button>
                        <button type="button" data-arrow={1} onClick={(e) => move(gi, ii, 1, e)} disabled={ii === g.items.length - 1} title="Move down" aria-label="Move down">
                          <ChevronDown size={16} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="confirm-dialog-actions">
              <button type="button" onClick={onClose} title="Close without renaming anything">
                Cancel
              </button>
              <button type="button" className="google-btn confirm-dialog-confirm" disabled={!changes.length} onClick={apply} title="Rename these files in Dropbox">
                Rename {changes.length} file{changes.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}

        {step === "renaming" && (
          <div className="packet-building">
            <div className="won-setup-spinner" aria-hidden="true" />
            <p className="confirm-dialog-message">Renaming files in Dropbox…</p>
          </div>
        )}

        {step === "done" && result && (
          <>
            <p className="review-complete">✓ Renamed {result.renamed} file{result.renamed === 1 ? "" : "s"}.</p>
            {result.failed?.length > 0 && (
              <div className="field-note">
                Couldn't rename:
                <ul>
                  {result.failed.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="confirm-dialog-actions">
              <button type="button" className="google-btn confirm-dialog-confirm" onClick={onClose} title="Done">
                Done
              </button>
            </div>
          </>
        )}

        {(step === "loading" || step === "error") && (
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
