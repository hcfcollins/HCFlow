// Buyer Packets page: street address + drop files (PDFs, photos, zips) →
// one merged "<street> - Buyer Packet.pdf" download, plus a history of
// packets made.
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUp, ArrowDown, X, UploadCloud, FileText, Image as ImageIcon, Package, Download } from "lucide-react";
import { useToast } from "../lib/ToastContext";
import { expandFiles, mergePacket, packetFileName, downloadPdf, recordPacket, fetchPacketHistory } from "../lib/buyerPacket";

export default function BuyerPackets({ currentAgent, onBack }) {
  const isBroker = currentAgent?.role === "broker";
  const [address, setAddress] = useState("");
  const [items, setItems] = useState([]);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState(null); // { bytes, fileName, pageCount, skipped }
  const [error, setError] = useState(null);
  const [history, setHistory] = useState({ rows: [], missing: false });
  const [everyone, setEveryone] = useState(false);
  const showToast = useToast();

  const loadHistory = () => fetchPacketHistory().then(setHistory);
  useEffect(() => {
    loadHistory();
  }, []);

  async function addFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    setError(null);
    setResult(null);
    setReading(true);
    try {
      const expanded = await expandFiles(files);
      setItems((cur) => [...cur, ...expanded]);
    } catch (e) {
      setError(e.message);
    } finally {
      setReading(false);
    }
  }

  const move = (i, d) =>
    setItems((cur) => {
      const next = [...cur];
      const j = i + d;
      if (j < 0 || j >= next.length) return cur;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  async function build() {
    setError(null);
    if (!address.trim()) return setError("Add the street address first — it names the file.");
    const usable = items.filter((it) => it.kind === "pdf" || it.kind === "image");
    if (!usable.length) return setError("Drop in the PDFs, photos or zip files for the packet.");
    setBuilding(true);
    try {
      const { bytes, pageCount, skipped } = await mergePacket(items);
      const fileName = packetFileName(address);
      downloadPdf(bytes, fileName);
      setResult({ bytes, fileName, pageCount, skipped });
      showToast(`${fileName} downloaded — ${pageCount} pages`);
      await recordPacket(currentAgent.id, { address: address.trim(), fileName, fileCount: usable.length, pageCount });
      loadHistory();
    } catch (e) {
      setError(e.message);
    } finally {
      setBuilding(false);
    }
  }

  function startOver() {
    setAddress("");
    setItems([]);
    setResult(null);
    setError(null);
  }

  const shown = history.rows.filter((r) => everyone || r.agent_id === currentAgent.id);

  return (
    <div className="ce-page">
      <header className="app-header">
        <button type="button" className="header-icon-btn" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="brand-eyebrow">For your buyers</div>
          <h1>
            <Package size={22} style={{ verticalAlign: -4 }} /> Buyer Packets
          </h1>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="detail-section uc-form">
        <label>
          Street address
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 12 Main St" />
        </label>
        <label
          className={`check-dropzone comp-dropzone ${over ? "check-dropzone--over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
          title="Drop files here, or click to choose"
        >
          <input type="file" multiple accept="application/pdf,.zip,application/zip,image/*" hidden onChange={(e) => addFiles(e.target.files)} />
          <span>
            <UploadCloud size={18} style={{ verticalAlign: -4 }} /> {reading ? "Opening files…" : <><strong>Drop PDFs, photos or .zip files</strong> or click to choose</>}
          </span>
        </label>
        <p className="field-help">Zips are unzipped automatically. Everything is merged in the order below into one PDF — nothing is saved or shared.</p>

        {items.length > 0 && (
          <ol className="bp-list">
            {items.map((it, i) => (
              <li key={it.id} className={it.kind === "pdf" || it.kind === "image" ? "" : "bp-item--skip"}>
                {it.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
                <span className="bp-name">{it.name}</span>
                {!(it.kind === "pdf" || it.kind === "image") && <span className="field-help">won't be included ({it.note || "not a PDF or photo"})</span>}
                <span className="license-status-actions">
                  <button type="button" className="license-mini-btn" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" aria-label="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button type="button" className="license-mini-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Move down" aria-label="Move down">
                    <ArrowDown size={13} />
                  </button>
                  <button type="button" className="license-mini-btn" onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))} title="Leave this out" aria-label="Remove">
                    <X size={13} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}

        <div className="polish-actions">
          <button type="button" className="google-btn" disabled={building || reading || !items.length} onClick={build}>
            {building ? "Merging…" : `Make ${packetFileName(address)}`}
          </button>
          {(items.length > 0 || result) && (
            <button type="button" className="comps-status-btn" onClick={startOver} title="Clear everything and start a new packet">
              Start over
            </button>
          )}
        </div>

        {result && (
          <div className="cma-suggest">
            <span>
              ✓ <strong>{result.fileName}</strong> — {result.pageCount} pages.
              {result.skipped.length > 0 && ` Left out: ${result.skipped.map((s) => `${s.name} (${s.why})`).join(", ")}.`}
            </span>
            <button type="button" className="comps-status-btn" onClick={() => downloadPdf(result.bytes, result.fileName)}>
              <Download size={14} /> Download again
            </button>
          </div>
        )}
      </div>

      <div className="detail-section">
        <div className="comps-section-header">
          <h2 className="comps-section-title">
            {everyone ? "Everyone's Packets" : "Packets You've Made"} <span className="comps-section-count">{shown.length}</span>
          </h2>
          {isBroker && (
            <button type="button" className="comps-minimize-btn" onClick={() => setEveryone((v) => !v)}>
              {everyone ? "Just mine" : "Everyone"}
            </button>
          )}
        </div>
        {history.missing ? (
          <p className="field-help">Packet history turns on once the buyer packet SQL is run.</p>
        ) : shown.length === 0 ? (
          <p className="field-help">None yet — your first one will show up here.</p>
        ) : (
          <ul className="ce-credit-list">
            {shown.map((r) => (
              <li key={r.id}>
                <Package size={14} />
                <div className="ce-credit-main">
                  <strong>{r.address}</strong>
                  <span className="field-help">
                    {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {r.page_count} pages from {r.file_count} file{r.file_count === 1 ? "" : "s"}
                    {everyone && r.agent?.name ? ` · ${r.agent.name}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
