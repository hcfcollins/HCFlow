// Main screen (brokers): closeout paperwork emailed to flow@hallcollins.com
// (or uploaded here), read by Claude and matched to a deal. One tap files it
// into the deal's Dropbox folder and pre-fills the commission check amount.
// Several documents for the same sale are grouped, with "File all" and
// "File all & close out" for the group.
import { useEffect, useMemo, useRef, useState } from "react";
import { Inbox, UploadCloud, FileText, X, RefreshCw } from "lucide-react";
import { useToast } from "../lib/ToastContext";
import { INBOX_ADDRESS, INBOX_CHANGED, fetchInbox, pollInbox, fileInboxDoc, dismissInboxDoc, viewInboxDoc, uploadToInbox, defaultDocName } from "../lib/inbox";

const money = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const today = () => new Date().toISOString().slice(0, 10);
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
  const [choices, setChoices] = useState({}); // per document: { dealId, docName, bothSides }
  const [checking, setChecking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [groupBusy, setGroupBusy] = useState(null);
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

  const byId = (id) => (transactions || []).find((t) => t.id === id) || null;
  const choiceFor = (d) => ({ dealId: d.suggested_transaction_id || "", docName: defaultDocName(d), bothSides: true, ...choices[d.id] });
  const setChoice = (d, patch) => setChoices((c) => ({ ...c, [d.id]: { ...choiceFor(d), ...c[d.id], ...patch } }));

  // Same sale = same deal, or the two linked sides of it.
  const saleKey = (deal) => (deal ? [deal.id, deal.other_side_id].filter(Boolean).sort()[0] : null);

  const groups = useMemo(() => {
    const out = [];
    const index = new Map();
    for (const d of state.docs) {
      const deal = byId(choiceFor(d).dealId);
      const key = d.status === "pending" && deal ? saleKey(deal) : `solo:${d.id}`;
      if (!index.has(key)) {
        index.set(key, out.length);
        out.push({ key, deal, docs: [] });
      }
      out[index.get(key)].docs.push(d);
    }
    return out;
  }, [state.docs, choices, transactions]);

  /** File one document with its current choices → what to show on the Close-Out screen. */
  async function fileOne(d) {
    const c = choiceFor(d);
    const deal = byId(c.dealId);
    if (!deal) throw new Error("Pick the deal first.");
    const other = deal.other_side_id ? byId(deal.other_side_id) : null;
    const both = Boolean(other && c.bothSides);
    const r = await fileInboxDoc(d.id, deal.id, c.docName, both);
    return { deal, both, docName: c.docName, path: r.path, prefilled: r.prefilled, amount: r.amount, isCheck: c.docName === "Commission Check" || /check/.test(d.doc_type || "") };
  }

  /** Open the deal's Close-Out Calculator already knowing what was just filed. */
  function openCloseout(deal, filed) {
    const co = { ...(deal.closeouts || {}) };
    let docs = [...(deal.documents || [])];
    for (const f of filed) {
      docs = [...docs.filter((x) => x.name !== f.docName), { name: f.docName, file_name: f.path, status: "complete", doc_date: today() }];
      if (f.isCheck) {
        co.check_received = "Yes";
        if (f.prefilled && !co.check_amount) co.check_amount = f.amount;
      }
    }
    onOpenDetail?.({ ...deal, closeouts: co, documents: docs, _openCloseout: Date.now() });
  }

  function afterFiling(filed) {
    window.dispatchEvent(new Event("hcflow:refresh"));
    load();
    const amt = filed.find((f) => f.prefilled);
    showToast(
      `Filed ${filed.length === 1 ? filed[0].docName : `${filed.length} documents`} to ${filed[0].deal.address}${filed.some((f) => f.both) ? " (both sides)" : ""}${amt ? ` — check amount ${money(amt.amount)} filled in` : ""}`
    );
  }

  async function fileGroup(group, closeOut) {
    setGroupBusy(group.key);
    setError(null);
    const filed = [];
    try {
      for (const d of group.docs) filed.push(await fileOne(d));
      afterFiling(filed);
      if (closeOut) openCloseout(group.deal, filed);
    } catch (e) {
      if (filed.length) afterFiling(filed);
      setError(`${filed.length ? `Filed ${filed.length} of ${group.docs.length}, then: ` : ""}${e.message}`);
    } finally {
      setGroupBusy(null);
    }
  }

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
        Scan or email commission checks and closing docs to <strong>{INBOX_ADDRESS}</strong>. Only attachments are read (signatures and photos in the email itself are ignored). Each one is matched to its deal; tap File to save it to that deal's Dropbox folder.
      </p>
      {error && <div className="error-banner">{error}</div>}
      {state.docs.length === 0 && <p className="field-help">Nothing waiting.</p>}
      {groups.map((g) => {
        const multi = g.deal && g.docs.length > 1;
        const rows = g.docs.map((d) => (
          <InboxRow
            key={d.id}
            doc={d}
            choice={choiceFor(d)}
            onChoice={(patch) => setChoice(d, patch)}
            dealOptions={dealOptions}
            byId={byId}
            inGroup={multi}
            disabled={groupBusy === g.key}
            fileOne={fileOne}
            afterFiling={afterFiling}
            openCloseout={openCloseout}
            onDone={load}
            onOpenDetail={onOpenDetail}
          />
        ));
        if (!multi) return <ul key={g.key} className="trust-list inbox-list">{rows}</ul>;
        return (
          <div key={g.key} className="inbox-group">
            <div className="inbox-group-head">
              <span>
                <strong>{g.docs.length} documents</strong> for {g.deal.address}
                {g.deal.other_side_id ? " (both sides)" : ""}
              </span>
              <span className="inbox-controls" style={{ marginTop: 0 }}>
                <button type="button" className="google-btn" onClick={() => fileGroup(g, false)} disabled={Boolean(groupBusy)}>
                  {groupBusy === g.key ? "Filing…" : `File all ${g.docs.length}`}
                </button>
                {g.deal.stage !== "closed" && (
                  <button type="button" className="google-btn inbox-closeout-btn" onClick={() => fileGroup(g, true)} disabled={Boolean(groupBusy)} title="File them all, then open this deal's Close-Out Calculator">
                    File all &amp; close out
                  </button>
                )}
              </span>
            </div>
            <ul className="trust-list inbox-list">{rows}</ul>
          </div>
        );
      })}
    </div>
  );
}

function InboxRow({ doc, choice, onChoice, dealOptions, byId, inGroup, disabled, fileOne, afterFiling, openCloseout, onDone, onOpenDetail }) {
  const x = doc.extracted || {};
  const { dealId, docName, bothSides } = choice;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const deal = byId(dealId);
  const otherSide = deal?.other_side_id ? byId(deal.other_side_id) : null;
  // One check for both sides of the sale → compare with both sides' commission.
  const expected = otherSide && bothSides && expectedCommission(deal) != null && expectedCommission(otherSide) != null ? expectedCommission(deal) + expectedCommission(otherSide) : expectedCommission(deal);
  const amount = Number(x.check_amount) || null;
  const isCheck = /check/.test(doc.doc_type || "");
  const options = deal && !dealOptions.some((t) => t.id === deal.id) ? [deal, ...dealOptions] : dealOptions;

  async function file({ closeOut = false } = {}) {
    if (!dealId) return setError("Pick the deal first.");
    setBusy(true);
    setError(null);
    try {
      const f = await fileOne(doc);
      afterFiling([f]);
      if (closeOut) openCloseout(f.deal, [f]);
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
  const off = busy || disabled;
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
          <select value={dealId} onChange={(e) => onChoice({ dealId: e.target.value })} aria-label="Deal" disabled={off}>
            <option value="">— Pick the deal —</option>
            {options.map((t) => (
              <option key={t.id} value={t.id}>
                {t.address}
                {t.other_side_id ? ` · ${t.side === "Buy" ? "buyer side" : t.side === "Sell" ? "listing side" : "split"}` : ""}
                {t.buyer_name ? ` · ${t.buyer_name.split(/,| and /)[0]}` : ""}
                {t.stage === "closed" ? " (closed)" : ""}
              </option>
            ))}
          </select>
          <select value={docName} onChange={(e) => onChoice({ docName: e.target.value })} aria-label="File as" disabled={off}>
            <option>Commission Check</option>
            <option>Closing Docs</option>
          </select>
        </div>
        {otherSide && (
          <label className="inbox-both">
            <input type="checkbox" checked={bothSides} onChange={(e) => onChoice({ bothSides: e.target.checked })} disabled={off} />
            Also file to the other side ({otherSide.side === "Buy" ? "buyer" : otherSide.side === "Sell" ? "listing" : "other"} side, {otherSide.agent?.name || "agent"})
          </label>
        )}
        {deal && isCheck && amount && expected != null && Math.abs(amount - expected) > 1 && (
          <div className="field-help" style={{ color: "#9a6a12" }}>
            Expected commission {otherSide && bothSides ? "for both sides" : "on this deal"} is about {money(expected)} — the check is {money(amount)}
            {amount < expected ? " (a deposit we held may cover the difference)" : ""}.
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <div className="inbox-controls">
          <button type="button" className={inGroup ? "comps-status-btn" : "google-btn"} onClick={() => file()} disabled={off || !dealId}>
            {busy ? "Filing…" : inGroup ? "File just this" : "File it"}
          </button>
          {!inGroup && deal && deal.stage !== "closed" && (
            <button type="button" className="google-btn inbox-closeout-btn" onClick={() => file({ closeOut: true })} disabled={off} title="File it, then open this deal's Close-Out Calculator">
              File &amp; close out
            </button>
          )}
          <button type="button" className="comps-status-btn" onClick={view} disabled={off}>
            View
          </button>
          {deal && !inGroup && (
            <button type="button" className="comps-status-btn" onClick={() => onOpenDetail?.(deal)} disabled={off}>
              Open deal
            </button>
          )}
          <button type="button" className="comps-status-btn" onClick={dismiss} disabled={off}>
            Dismiss
          </button>
        </div>
      </div>
    </li>
  );
}
