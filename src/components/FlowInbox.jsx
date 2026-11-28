// Main screen (brokers): closeout paperwork emailed to flow@hallcollins.com
// (or uploaded here), read by Claude and matched to a deal. One tap files it
// into the deal's Dropbox folder and pre-fills the commission check amount.
import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, UploadCloud, FileText, X, RefreshCw } from "lucide-react";
import { useToast } from "../lib/ToastContext";
import { INBOX_ADDRESS, INBOX_CHANGED, fetchInbox, pollInbox, fileInboxDoc, dismissInboxDoc, viewInboxDoc, uploadToInbox, defaultDocName } from "../lib/inbox";

const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
// One background check at a time, at most every 2 minutes (the main screen remounts often).
let lastPoll = 0;

function expectedCommission(tx) {
  const co = one(tx?.closeouts) || {};
  if (co.anticipated_commission != null) return Number(co.anticipated_commission);
  const pct = Number(one(tx?.commission_data)?.commission_pct ?? co.commission_pct ?? 0);
  return tx?.price && pct ? Math.round(tx.price * pct) / 100 : null;
}

export default function FlowInbox({ agent, transactions, open, onClose, onOpenDetail, onCount }) {
  const isBroker = agent?.role === "broker";
  const [state, setState] = useState({ docs: [], missing: false });
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);
  const showToast = useToast();

  const load = () =>
    fetchInbox().then((r) => {
      setState(r);
      onCount?.(r.docs.length);
    });

  async function check({ quiet } = {}) {
    if (quiet && Date.now() - lastPoll < 120000) return load();
    lastPoll = Date.now();
    setChecking(true);
    try {
      await pollInbox();
    } catch (e) {
      if (!quiet) setError(e.message);
    } finally {
      setChecking(false);
      load();
    }
  }

  useEffect(() => {
    if (!isBroker) return;
    load().then(() => check({ quiet: true }));
    const t = setInterval(() => check({ quiet: true }), 5 * 60 * 1000);
    const onChange = () => load();
    window.addEventListener(INBOX_CHANGED, onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener(INBOX_CHANGED, onChange);
    };
  }, [isBroker]);

  // Deals a document could go on: open + closed in the last ~4 months.
  const dealOptions = useMemo(() => {
    const cutoff = Date.now() - 120 * 86400000;
    return (transactions || [])
      .filter((t) => !t.terminated_at && (t.stage === "contract" || (t.stage === "closed" && new Date(t.updated_at || t.next_date || 0).getTime() > cutoff)))
      .sort((a, b) => String(a.address).localeCompare(String(b.address)));
  }, [transactions]);

  async function upload(files) {
    setError(null);
    setUploading(true);
    try {
      for (const f of [...files]) {
        await uploadToInbox(f);
      }
      showToast("Read and matched — check the suggestion below");
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!isBroker || state.missing) return null;
  if (!open && !state.docs.length) return null;

  return (
    <div className="inbox-panel">
      <div className="inbox-head">
        <strong>
          <Inbox size={16} style={{ verticalAlign: -3 }} /> Closeout Inbox {state.docs.length > 0 && <span className="trust-flag-count">{state.docs.length}</span>}
        </strong>
        <span className="inbox-head-actions">
          <button type="button" className="license-mini-btn" onClick={() => check()} disabled={checking} title={`Check ${INBOX_ADDRESS} now`}>
            <RefreshCw size={13} className={checking ? "spin" : ""} /> {checking ? "Checking…" : "Check now"}
          </button>
          <button type="button" className="license-mini-btn" onClick={() => fileRef.current?.click()} disabled={uploading} title="Upload a PDF or photo of a check / closing docs">
            <UploadCloud size={13} /> {uploading ? "Reading…" : "Upload"}
          </button>
          {onClose && open && (
            <button type="button" className="license-mini-btn" onClick={onClose} aria-label="Hide" title="Hide">
              <X size={13} />
            </button>
          )}
        </span>
        <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>
      <p className="field-help inbox-help">
        Scan or email commission checks and closing docs to <strong>{INBOX_ADDRESS}</strong>. Each one is read and matched to its deal; tap File to save it to that deal's Dropbox folder.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {state.docs.length === 0 && <p className="field-help">Nothing waiting.</p>}
      <ul className="trust-list">
        {state.docs.map((d) => (
          <InboxRow key={d.id} doc={d} dealOptions={dealOptions} transactions={transactions} onDone={load} onOpenDetail={onOpenDetail} />
        ))}
      </ul>
    </div>
  );
}

function InboxRow({ doc, dealOptions, transactions, onDone, onOpenDetail }) {
  const x = doc.extracted || {};
  const [dealId, setDealId] = useState(doc.suggested_transaction_id || "");
  const [docName, setDocName] = useState(defaultDocName(doc));
  const [bothSides, setBothSides] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const showToast = useToast();
  const deal = transactions.find((t) => t.id === dealId) || null;
  const otherSide = deal?.other_side_id ? transactions.find((t) => t.id === deal.other_side_id) || null : null;
  const expected = expectedCommission(deal);
  const amount = Number(x.check_amount) || null;
  const isCheck = /check/.test(doc.doc_type || "");
  const options = deal && !dealOptions.some((t) => t.id === deal.id) ? [deal, ...dealOptions] : dealOptions;

  async function file({ closeOut = false } = {}) {
    if (!dealId) return setError("Pick the deal first.");
    setBusy(true);
    setError(null);
    try {
      const both = Boolean(otherSide && bothSides);
      const r = await fileInboxDoc(doc.id, dealId, docName, both);
      showToast(`Filed to ${deal?.address}${both ? " (both sides)" : ""}${r.prefilled ? ` — check amount ${money(r.amount)} filled in` : ""}`);
      window.dispatchEvent(new Event("hcflow:refresh"));
      onDone();
      if (closeOut && deal) {
        // Straight into the Close-Out Calculator, with the check amount just filed.
        const co = deal.closeouts || {};
        const isCheckDoc = docName === "Commission Check" || /check/.test(doc.doc_type || "");
        onOpenDetail?.({
          ...deal,
          closeouts: isCheckDoc ? { ...co, check_received: "Yes", ...(r.prefilled ? { check_amount: r.amount } : {}) } : co,
          documents: [...(deal.documents || []).filter((d) => d.name !== docName), { name: docName, file_name: r.path, status: "complete", doc_date: new Date().toISOString().slice(0, 10) }],
          _openCloseout: Date.now(),
        });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    if (!window.confirm("Dismiss this one without filing it?")) return;
    setBusy(true);
    try {
      await dismissInboxDoc(doc.id);
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function view() {
    const tab = window.open("", "_blank");
    try {
      const blob = await viewInboxDoc(doc.id);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      if (tab) tab.close();
      setError(e.message);
    }
  }

  if (doc.status === "processing") {
    return (
      <li className="trust-row">
        <div className="trust-row-main">
          <strong>{doc.file_name}</strong>
          <span className="field-help">Reading it…</span>
        </div>
      </li>
    );
  }

  const conf = doc.confidence || "none";
  return (
    <li className={`trust-row ${conf === "high" ? "" : "trust-row--warn"}`}>
      <div className="trust-row-main">
        <div className="trust-row-top">
          <FileText size={14} />
          <strong>{x.summary || doc.file_name}</strong>
          {amount && <span className="trust-amt">{money(amount)}</span>}
        </div>
        <span className="field-help">
          {doc.from_email ? `${doc.from_email.replace(/<.*>/, "").trim() || doc.from_email} · ` : ""}
          {doc.received_at ? new Date(doc.received_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : ""} · {doc.file_name}
        </span>
        {doc.error && <div className="field-help" style={{ color: "var(--color-danger-text)" }}>{doc.error}</div>}
        {x.reason && (
          <div className="field-help">
            <span className={`inbox-conf inbox-conf--${conf}`}>{conf === "none" ? "No match" : `${conf} match`}</span> {x.reason}
          </div>
        )}
        <div className="inbox-controls">
          <select value={dealId} onChange={(e) => setDealId(e.target.value)} aria-label="Deal">
            <option value="">— Pick the deal —</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.address}
                {t.buyer_name ? ` · ${t.buyer_name.split(/,| and /)[0]}` : ""}
                {t.stage === "closed" ? " (closed)" : ""}
              </option>
            ))}
          </select>
          <select value={docName} onChange={(e) => setDocName(e.target.value)} aria-label="File as">
            <option>Commission Check</option>
            <option>Closing Docs</option>
          </select>
        </div>
        {otherSide && (
          <label className="inbox-both">
            <input type="checkbox" checked={bothSides} onChange={(e) => setBothSides(e.target.checked)} />
            Also file to the other side ({otherSide.side === "Buy" ? "buyer" : otherSide.side === "Sell" ? "listing" : "other"} side, {otherSide.agent?.name || "agent"})
          </label>
        )}
        {deal && isCheck && amount && expected != null && Math.abs(amount - expected) > 1 && (
          <div className="field-help" style={{ color: "#9a6a12" }}>
            Expected commission on this deal is about {money(expected)} — the check is {money(amount)}
            {amount < expected ? " (a deposit we held may cover the difference)" : ""}.
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="inbox-controls">
          <button type="button" className="google-btn" onClick={() => file()} disabled={busy || !dealId}>
            {busy ? "Filing…" : "File it"}
          </button>
          {deal && deal.stage !== "closed" && (
            <button type="button" className="google-btn inbox-closeout-btn" onClick={() => file({ closeOut: true })} disabled={busy} title="File it, then open this deal's Close-Out Calculator">
              File &amp; close out
            </button>
          )}
          <button type="button" className="comps-status-btn" onClick={view} disabled={busy}>
            View
          </button>
          {deal && (
            <button type="button" className="comps-status-btn" onClick={() => onOpenDetail?.(deal)} disabled={busy}>
              Open deal
            </button>
          )}
          <button type="button" className="comps-status-btn" onClick={dismiss} disabled={busy}>
            Dismiss
          </button>
        </div>
      </div>
    </li>
  );
}
