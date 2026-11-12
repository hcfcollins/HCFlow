import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Search } from "lucide-react";
import { listDropboxFolders } from "../lib/transactions";

// Folder lists cached for a few minutes per agent/side, so adding a pile of
// listings for one agent doesn't reload the same folder list every time.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();
function loadFolders(agentId, side) {
  const key = `${agentId}|${side}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = listDropboxFolders(agentId, side);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

const tokens = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 || /\d/.test(t));

/** How well a folder name matches the deal's address — the street number
 * counts most, then each matching word. Folders are named
 * "{Seller Last Name} - {Address}", so the address words are in there. */
function matchScore(folderName, address) {
  const name = ` ${tokens(folderName).join(" ")} `;
  let score = 0;
  for (const t of tokens(address)) {
    if (name.includes(` ${t} `)) score += /^\d+$/.test(t) ? 3 : 1;
  }
  return score;
}

/** Pick one of the agent's existing Dropbox folders (best matches for the
 * address float to the top), or paste a share link / folder path.
 * onPick({ folderId, name }) or onPick({ link }). */
export default function DropboxFolderPicker({ agentId, side, address, onPick, onCancel, busy }) {
  const [state, setState] = useState({ loading: true, folders: [], root: "", error: null });
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!agentId) {
      setState({ loading: false, folders: [], root: "", error: "Pick the agent first." });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    loadFolders(agentId, side)
      .then((d) => !cancelled && setState({ loading: false, folders: d.folders || [], root: d.root, error: null }))
      .catch((e) => !cancelled && setState({ loading: false, folders: [], root: "", error: e.message }));
    return () => {
      cancelled = true;
    };
  }, [agentId, side]);

  const ranked = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = state.folders
      .filter((f) => !q || f.name.toLowerCase().includes(q))
      .map((f) => ({ ...f, score: matchScore(f.name, address) }));
    list.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return list;
  }, [state.folders, query, address]);

  return (
    <div className="dbx-picker" onClick={(e) => e.stopPropagation()}>
      <div className="dbx-picker-head">
        <strong>Pair an existing Dropbox folder</strong>
        {state.root && <span className="field-help">from {state.root}</span>}
      </div>

      {state.loading ? (
        <p className="field-help">Loading folders…</p>
      ) : state.error ? (
        <p className="field-help dbx-picker-error">{state.error}</p>
      ) : (
        <>
          <div className="dbx-picker-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search folders…" />
          </div>
          <ul className="dbx-picker-list">
            {ranked.slice(0, 60).map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  disabled={busy}
                  className={f.score >= 3 && !query ? "dbx-picker-item dbx-picker-item--match" : "dbx-picker-item"}
                  onClick={() => onPick({ folderId: f.id, name: f.name })}
                  title={`Pair ${f.path}`}
                >
                  <FolderOpen size={14} /> <span>{f.name}</span>
                  {f.score >= 3 && !query && <span className="dbx-picker-badge">Best match</span>}
                </button>
              </li>
            ))}
            {!ranked.length && <li className="field-help">No folders match.</li>}
          </ul>
        </>
      )}

      <div className="dbx-picker-link">
        <span className="field-help">Or paste a Dropbox folder link (or path):</span>
        <div className="dbx-picker-link-row">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/…" />
          <button type="button" disabled={busy || !link.trim()} onClick={() => onPick({ link: link.trim() })} title="Pair the folder at this link">
            Pair
          </button>
        </div>
      </div>

      {onCancel && (
        <button type="button" className="dbx-picker-cancel" onClick={onCancel} disabled={busy} title="Close without pairing">
          Cancel
        </button>
      )}
    </div>
  );
}
