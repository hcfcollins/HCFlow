// Spreadsheet View → Trust Account Reconciliation. Upload Xero's "Earnest
// Money Held (Trust Acct Liability) Transactions" report (the Trust Account
// Audit PDF, VT and/or NH); lists every client whose trust money isn't
// squared up, flags the ones whose deal is already closed/terminated, and
// keeps the latest upload per account as the running list.
import { useEffect, useMemo, useRef, useState } from "react";
import { Landmark, UploadCloud, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { useToast } from "../lib/ToastContext";
import { readPdfPages, parseTrustPages, analyzeTrust, saveTrustReport, fetchTrustReports, accountsDueThisMonth, money } from "../lib/trustReport";

export const TRUST_CHANGED = "hcflow:trust-changed";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function TrustReconciliation({ transactions, currentAgent, onOpenDetail, startOpen = false }) {
  const [open, setOpen] = useState(startOpen);
  const [state, setState] = useState({ byAccount: {}, missing: false, loading: true });
  const [account, setAccount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showOk, setShowOk] = useState(false);
  const fileRef = useRef(null);
  const rootRef = useRef(null);
  const showToast = useToast();

  const load = () =>
    fetchTrustReports().then((r) => {
      setState({ ...r, loading: false });
      setAccount((a) => (a && r.byAccount[a] ? a : Object.keys(r.byAccount).sort()[0] || null));
    });
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (startOpen) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [startOpen]);

  async function upload(files) {
    setError(null);
    setBusy(true);
    try {
      let last = null;
      for (const file of [...files]) {
        if (!/\.pdf$/i.test(file.name)) throw new Error(`${file.name}: upload the PDF from Xero (Export → PDF).`);
        const report = parseTrustPages(await readPdfPages(file));
        if (!report.clients.length) throw new Error(`${file.name} doesn't look like Xero's "Earnest Money Held (Trust Acct Liability) Transactions" report.`);
        if (!report.account) throw new Error(`${file.name}: couldn't tell if this is the VT or NH trust account — the report title should say VT or NH.`);
        await saveTrustReport(currentAgent?.id || null, file.name, report);
        last = report.account;
        showToast(`${report.account} trust report read — ${report.clients.length} clients`);
      }
      await load();
      if (last) setAccount(last);
      setOpen(true);
      window.dispatchEvent(new Event(TRUST_CHANGED));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const reports = state.byAccount[account] || [];
  const latest = reports[0];
  const previous = reports[1];
  const rows = useMemo(() => (latest ? analyzeTrust({ account: latest.account, clients: latest.clients }, transactions) : []), [latest, transactions]);
  const prevKeys = useMemo(() => (previous ? new Set(analyzeTrust({ account: previous.account, clients: previous.clients }, transactions).filter((r) => !r.nonClient).map((r) => r.key)) : null), [previous, transactions]);
  const clientRows = rows.filter((r) => !r.nonClient);
  const flagged = clientRows.filter((r) => r.flagged);
  const attention = clientRows.filter((r) => !r.flagged && (r.balance < 0 || r.warn || !r.deal));
  const open_ = clientRows.filter((r) => !r.flagged && !(r.balance < 0 || r.warn || !r.deal));
  const brokerage = rows.filter((r) => r.nonClient);
  const cleared = prevKeys ? [...prevKeys].filter((k) => !clientRows.some((r) => r.key === k)).map((k) => k.split("|")[1]) : [];
  const held = round2(clientRows.reduce((s, r) => s + Math.max(r.balance, 0), 0));
  const due = accountsDueThisMonth(state.byAccount);

  const row = (r) => (
    <li key={r.key} className={`trust-row ${r.flagged ? "trust-row--flag" : r.balance < 0 || r.warn ? "trust-row--warn" : ""}`}>
      <div className="trust-row-main">
        <div className="trust-row-top">
          <strong>{r.name}</strong>
          {prevKeys && !prevKeys.has(r.key) && <span className="trust-new">New</span>}
          <span className={`trust-amt ${r.balance < 0 ? "trust-amt--neg" : ""}`}>{money(r.balance)}</span>
        </div>
        <div className="trust-row-deal">
          {r.deal ? (
            <button type="button" className="trust-deal-link" onClick={() => onOpenDetail?.(r.deal)} title="Open this deal">
              {r.deal.address}
            </button>
          ) : (
            <span className="field-help">No matching deal in the app</span>
          )}
          {r.status && <span className={`trust-status trust-status--${r.status.replace(/\s+/g, "-").toLowerCase()}`}>{r.status}</span>}
        </div>
        <ul className="trust-issues">
          {r.flagged && (r.status === "Closed" || r.status === "Terminated" || r.status === "Expired") && (
            <li className="trust-issue--flag">
              <AlertTriangle size={12} /> Deal is {r.status.toLowerCase()} but the trust account doesn't net to zero
            </li>
          )}
          {r.issues.map((i) => (
            <li key={i.kind} className={i.kind === "account" ? "trust-issue--flag" : ""}>
              {i.text}
            </li>
          ))}
          {r.warn && <li>Description mentions closing/termination/refund — check it's finished</li>}
        </ul>
        {r.last && (
          <div className="field-help trust-last">
            Last: {r.last.date} — {r.last.description || r.last.reference}
          </div>
        )}
      </div>
    </li>
  );

  return (
    <div className="detail-section trust-recon" ref={rootRef}>
      <div className="comps-section-header">
        <button type="button" className="trust-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Landmark size={16} />
          <h2 className="comps-section-title">
            Trust Account Reconciliation
            {latest && flagged.length > 0 && <span className="trust-flag-count">{flagged.length} flagged</span>}
          </h2>
        </button>
        <button type="button" className="sv-export-btn" disabled={busy} onClick={() => fileRef.current?.click()} title="Xero → Reports → Account Transactions (Earnest Money Held / Trust Acct Liability), grouped by contact → Export → PDF">
          <UploadCloud size={14} /> {busy ? "Reading…" : "Upload Xero Report"}
        </button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => upload(e.target.files)} />
      </div>

      {due.length > 0 && !state.loading && !state.missing && (
        <p className="trust-due">
          {due.join(" & ")} trust report{due.length > 1 ? "s" : ""} not uploaded yet this month.
        </p>
      )}
      {error && <div className="error-banner">{error}</div>}
      {state.missing && <p className="field-help">Turns on once the trust reconciliation SQL is run (end of supabase/schema.sql).</p>}

      {open && !state.missing && (
        <>
          {!latest ? (
            <p className="field-help">
              In Xero: Reports → Account Transactions → Earnest Money Held (Trust Acct Liability), grouped by contact → Export → PDF. Upload the VT and NH reports here once a month.
            </p>
          ) : (
            <>
              {Object.keys(state.byAccount).length > 1 && (
                <div className="trust-tabs">
                  {Object.keys(state.byAccount)
                    .sort()
                    .map((a) => (
                      <button key={a} type="button" className={`trust-tab ${a === account ? "trust-tab--on" : ""}`} onClick={() => setAccount(a)}>
                        {a} Trust
                      </button>
                    ))}
                </div>
              )}
              <p className="trust-summary">
                <strong>{latest.account} trust</strong> · report {latest.report_date ? fmtDate(latest.report_date + "T12:00:00") : ""} · uploaded {fmtDate(latest.uploaded_at)} · {money(held)} held for {clientRows.filter((r) => r.balance > 0).length} clients
              </p>

              {flagged.length > 0 && (
                <>
                  <h3 className="trust-h3 trust-h3--flag">Flagged — deal closed/terminated or wrong account ({flagged.length})</h3>
                  <ul className="trust-list">{flagged.map(row)}</ul>
                </>
              )}
              {attention.length > 0 && (
                <>
                  <h3 className="trust-h3">Needs a look ({attention.length})</h3>
                  <ul className="trust-list">{attention.map(row)}</ul>
                </>
              )}
              <button type="button" className="trust-more" onClick={() => setShowOk((v) => !v)}>
                {showOk ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Holding for open deals ({open_.length}){brokerage.length ? ` · brokerage entries (${brokerage.length})` : ""}
              </button>
              {showOk && (
                <>
                  <ul className="trust-list">{open_.map(row)}</ul>
                  {brokerage.length > 0 && (
                    <>
                      <h3 className="trust-h3">Brokerage / interest entries</h3>
                      <ul className="trust-list">{brokerage.map(row)}</ul>
                    </>
                  )}
                </>
              )}
              {cleared.length > 0 && (
                <p className="field-help trust-cleared">✓ Squared up since the last upload: {cleared.join(", ")}</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Main-screen reminder for Fran: monthly, until this month's report(s) are uploaded. */
export function TrustReminderCard({ agent, onOpen }) {
  const [due, setDue] = useState([]);
  useEffect(() => {
    if (String(agent?.email || "").toLowerCase() !== "fran.collins@hallcollins.com") return;
    const check = () =>
      fetchTrustReports().then((r) => setDue(r.missing || r.error ? [] : accountsDueThisMonth(r.byAccount)));
    check();
    window.addEventListener(TRUST_CHANGED, check);
    return () => window.removeEventListener(TRUST_CHANGED, check);
  }, [agent?.email]);
  if (!due.length) return null;
  const month = new Date().toLocaleDateString("en-US", { month: "long" });
  return (
    <div className="ce-review-card">
      <div>
        <strong>@Fran — monthly trust reconciliation</strong>
        <div>
          Run the {due.join(" & ")} Earnest Money Held report{due.length > 1 ? "s" : ""} in Xero and upload {due.length > 1 ? "them" : "it"} for {month}.
        </div>
      </div>
      <button type="button" className="google-btn" onClick={onOpen} title="Opens Spreadsheet View → Trust Account Reconciliation">
        Upload
      </button>
    </div>
  );
}
