// CE & Licenses page (every licensed agent), the slim CE progress lines on the
// main screen, and Fran's review card for agent uploads.
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Upload, Download, CheckCircle2, XCircle, Trash2, GraduationCap } from "lucide-react";
import { useToast } from "../lib/ToastContext";
import { agentLicenseUrl, fetchAgents } from "../lib/transactions";
import RadioGroup from "./RadioGroup";
import {
  REVIEWER_EMAIL,
  STATE_NAMES,
  fetchRequirements,
  saveRequirement,
  fetchCeCredits,
  fetchLicenseSubmissions,
  submitCeCredit,
  deleteCeCredit,
  reviewCeCredit,
  submitLicense,
  reviewLicense,
  licensedStates,
  ceProgress,
  fmtHours,
} from "../lib/ce";

const isReviewer = (agent) => (agent?.email || "").toLowerCase() === REVIEWER_EMAIL;
const LICENSE_LABEL = { vt: "Vermont license", nh: "New Hampshire license", broker: "Broker license" };
const longDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

/** Re-runs `load` now and whenever CE data changes anywhere in the app. */
function useCeReload(load, deps) {
  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener("hcflow:ce-changed", h);
    return () => window.removeEventListener("hcflow:ce-changed", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

async function openFile(path, onError) {
  const tab = window.open("", "_blank");
  try {
    const url = await agentLicenseUrl(path);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    if (tab) tab.close();
    onError?.(e.message);
  }
}

/** A filled line: approved hours solid, pending review lighter. */
function ProgressLine({ p, compact = false }) {
  const pct = p.need ? Math.min(100, (p.done / p.need) * 100) : 100;
  const pendPct = p.need ? Math.min(100 - pct, (p.pendingHours / p.need) * 100) : 0;
  return (
    <div className={`ce-line ${compact ? "ce-line--compact" : ""} ${p.complete ? "ce-line--done" : ""}`}>
      <div className="ce-line-label">
        <strong>{p.state} CE</strong>
        <span>
          {fmtHours(p.done)} of {fmtHours(p.need)} hrs{p.complete ? " ✓" : ""}
          {p.pendingHours > 0 && <em> · {fmtHours(p.pendingHours)} in review</em>}
        </span>
      </div>
      <div className="ce-line-track" role="progressbar" aria-valuemin={0} aria-valuemax={p.need} aria-valuenow={p.done}>
        <div className="ce-line-fill" style={{ width: `${pct}%` }} />
        {pendPct > 0 && <div className="ce-line-pending" style={{ left: `${pct}%`, width: `${pendPct}%` }} />}
      </div>
      {!compact && (
        <div className="ce-line-sub">
          Mandatory {fmtHours(p.mandatoryDone)}/{fmtHours(p.needM)} · Elective {fmtHours(p.electiveDone)}/{fmtHours(p.needE)}
          {p.cycle.fromLicense ? ` · cycle ends ${longDate(p.cycle.end)}` : " · last 2 years (add your license expiration for the exact cycle)"}
        </div>
      )}
    </div>
  );
}

/** Slim CE lines for the signed-in agent, on the main screen. Click → CE page. */
export function CeProgressStrip({ agent, onOpen }) {
  const [data, setData] = useState(null);
  useCeReload(() => {
    if (!agent?.id) return;
    Promise.all([fetchRequirements(), fetchCeCredits(agent.id)])
      .then(([reqs, credits]) => setData({ reqs, credits }))
      .catch(() => setData(null));
  }, [agent?.id]);
  const states = licensedStates(agent);
  if (!data || !states.length || data.reqs._missing) return null;
  return (
    <button type="button" className="ce-strip" onClick={onOpen} title="Your continuing education — open CE & Licenses">
      {states.map(({ state, key }) => (
        <ProgressLine key={state} p={ceProgress(agent, state, key, data.credits, data.reqs)} compact />
      ))}
    </button>
  );
}

/** Fran's "to-do": every upload waiting on her review, on the main screen. */
export function CeReviewCard({ agent, onOpen }) {
  const [items, setItems] = useState([]);
  useCeReload(() => {
    if (!isReviewer(agent)) return;
    Promise.all([fetchCeCredits(), fetchLicenseSubmissions(), fetchAgents()])
      .then(([credits, subs, agents]) => {
        const name = (id) => agents.find((a) => a.id === id)?.name?.split(" ")[0] || "An agent";
        setItems([
          ...credits.filter((c) => c.status === "pending").map((c) => `${name(c.agent_id)}'s ${c.state} CE certificate (${fmtHours(c.hours)} hrs ${c.credit_type})`),
          ...subs.filter((s) => s.status === "pending").map((s) => `${name(s.agent_id)}'s new ${LICENSE_LABEL[s.state] || "license"}`),
        ]);
      })
      .catch(() => setItems([]));
  }, [agent?.id]);
  if (!items.length) return null;
  return (
    <div className="ce-review-card">
      <div>
        <strong>@Fran — review {items.length === 1 ? "this upload" : `${items.length} uploads`}</strong>
        <ul>
          {items.slice(0, 4).map((t) => (
            <li key={t}>{t}</li>
          ))}
          {items.length > 4 && <li>…and {items.length - 4} more</li>}
        </ul>
      </div>
      <button type="button" className="google-btn" onClick={onOpen} title="Check they're real, then approve or reject">
        Review
      </button>
    </div>
  );
}

function CeUploadForm({ agent, states, autoApprove, onDone }) {
  const [state, setState] = useState(states[0]?.state || "VT");
  const [creditType, setCreditType] = useState("elective");
  const [courseName, setCourseName] = useState("");
  const [hours, setHours] = useState("");
  const [completedOn, setCompletedOn] = useState("");
  const [file, setFile] = useState(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const showToast = useToast();

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Add the certificate file.");
    if (!(Number(hours) > 0)) return setError("How many hours is it?");
    setBusy(true);
    try {
      await submitCeCredit(agent, { state, creditType, courseName, hours, completedOn, file }, { autoApprove });
      showToast(autoApprove ? "CE credit added" : "CE certificate sent to Fran for review");
      setCourseName("");
      setHours("");
      setCompletedOn("");
      setFile(null);
      onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="uc-form ce-upload" onSubmit={submit}>
      {error && <div className="error-banner">{error}</div>}
      {states.length > 1 && (
        <div>
          <div className="detail-label">Which license is it for?</div>
          <RadioGroup name="ceState" value={state} onChange={setState} options={states.map((s) => ({ value: s.state, label: STATE_NAMES[s.state] }))} />
        </div>
      )}
      <div>
        <div className="detail-label">Credit type</div>
        <RadioGroup
          name="ceType"
          value={creditType}
          onChange={setCreditType}
          options={[
            { value: "mandatory", label: "Mandatory (core)" },
            { value: "elective", label: "Elective" },
          ]}
        />
      </div>
      <label>
        Course name
        <input value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="e.g. VREC Mandatory Course 2026" />
      </label>
      <div className="ce-row">
        <label>
          Hours
          <input type="number" min="0.5" step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} required />
        </label>
        <label>
          Completed on
          <input type="date" value={completedOn} onChange={(e) => setCompletedOn(e.target.value)} />
        </label>
      </div>
      <label
        className={`check-dropzone comp-dropzone ${over ? "check-dropzone--over" : ""} ${file ? "comp-dropzone--set" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          setFile(e.dataTransfer.files?.[0] || null);
        }}
      >
        <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
        {file ? (
          <span>
            <FileText size={16} style={{ verticalAlign: -3 }} /> <strong>{file.name}</strong>
          </span>
        ) : (
          <span>
            <Upload size={16} style={{ verticalAlign: -3 }} /> <strong>Drop the certificate here</strong> or click to choose
          </span>
        )}
      </label>
      <button type="submit" className="google-btn" disabled={busy}>
        {busy ? "Uploading…" : autoApprove ? "Add CE Credit" : "Send for Review"}
      </button>
    </form>
  );
}

function LicenseCard({ agent, state, submissions, onError }) {
  const key = state.toLowerCase();
  const path = agent[`${key}_license_path`];
  const expires = agent[`${key}_license_expires`];
  const pending = submissions.find((s) => s.state === key && s.status === "pending");
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState("");
  const [num, setNum] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  async function send() {
    if (!file) return onError("Choose the license file.");
    setBusy(true);
    try {
      await submitLicense(agent, { state: key, expires: exp, licenseNumber: num, file });
      showToast("New license sent to Fran for review");
      setOpen(false);
      setFile(null);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="license-editor">
      <div className="license-editor-head">
        <strong>{STATE_NAMES[state]} license</strong>
        {expires && <span className="license-badge">Expires {longDate(expires)}</span>}
      </div>
      <div className={`license-status-row ${path ? "license-status-row--ok" : "license-status-row--missing"}`}>
        {path ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
        <span className="license-status-text">
          <strong>{path ? "Latest copy on file" : "No copy on file yet"}</strong>
          {pending && <span className="license-status-sub"> · new one waiting on Fran's review</span>}
        </span>
        <span className="license-status-actions">
          {path && (
            <button type="button" className="license-mini-btn" onClick={() => openFile(path, onError)} title="Download your license">
              <Download size={14} /> Download
            </button>
          )}
          {!pending && (
            <button type="button" className="license-mini-btn" onClick={() => setOpen((o) => !o)} title="Upload a renewed license for Fran to review">
              <Upload size={14} /> Upload new
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="ce-license-upload">
          <label>
            New expiration date
            <input type="date" value={exp} onChange={(e) => setExp(e.target.value)} />
          </label>
          <label>
            License # (if it changed)
            <input value={num} onChange={(e) => setNum(e.target.value)} />
          </label>
          <label className="license-mini-btn" title="PDF or photo">
            <Upload size={14} /> {file ? file.name : "Choose file"}
            <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button type="button" className="google-btn" disabled={busy} onClick={send}>
            {busy ? "Uploading…" : "Send for Review"}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewList({ credits, submissions, agents, onError }) {
  const [busyId, setBusyId] = useState(null);
  const showToast = useToast();
  const name = (id) => agents.find((a) => a.id === id)?.name || "Agent";
  const pendingCredits = credits.filter((c) => c.status === "pending");
  const pendingSubs = submissions.filter((s) => s.status === "pending");
  if (!pendingCredits.length && !pendingSubs.length) return <p className="field-help">Nothing waiting on review. 🎉</p>;

  async function act(id, fn, msg) {
    setBusyId(id);
    try {
      await fn();
      showToast(msg);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusyId(null);
    }
  }
  const reject = (item, fn) => {
    const note = window.prompt("Why is it being rejected? (the agent sees this)", "");
    if (note === null) return;
    act(item.id, () => fn(note || null), "Rejected");
  };

  return (
    <ul className="ce-review-list">
      {pendingCredits.map((c) => (
        <li key={c.id}>
          <div>
            <strong>{name(c.agent_id)}</strong> — {c.state} {c.credit_type} CE, {fmtHours(c.hours)} hrs
            <div className="field-help">
              {c.course_name || "Untitled course"}
              {c.completed_on ? ` · completed ${longDate(c.completed_on)}` : ""}
            </div>
          </div>
          <span className="license-status-actions">
            <button type="button" className="license-mini-btn" onClick={() => openFile(c.file_path, onError)} title="Look at the certificate">
              <FileText size={14} /> View
            </button>
            <button type="button" className="license-mini-btn" disabled={busyId === c.id} onClick={() => act(c.id, () => reviewCeCredit(c.id, "approved"), "Approved — it counts now")}>
              <CheckCircle2 size={14} /> Approve
            </button>
            <button type="button" className="license-mini-btn" disabled={busyId === c.id} onClick={() => reject(c, (note) => reviewCeCredit(c.id, "rejected", note))}>
              <XCircle size={14} /> Reject
            </button>
          </span>
        </li>
      ))}
      {pendingSubs.map((s) => (
        <li key={s.id}>
          <div>
            <strong>{name(s.agent_id)}</strong> — new {LICENSE_LABEL[s.state] || "license"}
            <div className="field-help">
              {s.expires ? `Expires ${longDate(s.expires)}` : "No expiration entered"}
              {s.license_number ? ` · #${s.license_number}` : ""}
            </div>
          </div>
          <span className="license-status-actions">
            <button type="button" className="license-mini-btn" onClick={() => openFile(s.file_path, onError)} title="Look at the license">
              <FileText size={14} /> View
            </button>
            <button
              type="button"
              className="license-mini-btn"
              disabled={busyId === s.id}
              onClick={() => act(s.id, () => reviewLicense(s, "approved"), "Approved — it's their license on file now (and copied to Dropbox)")}
            >
              <CheckCircle2 size={14} /> Approve
            </button>
            <button type="button" className="license-mini-btn" disabled={busyId === s.id} onClick={() => reject(s, (note) => reviewLicense(s, "rejected", note))}>
              <XCircle size={14} /> Reject
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function RequirementsEditor({ reqs, onError }) {
  const showToast = useToast();
  return (
    <div className="ce-req-grid">
      {["VT-salesperson", "VT-broker", "NH"].map((k) => (
        <ReqRow key={k} k={k} req={reqs[k]} onError={onError} onSaved={() => showToast("Requirement saved")} />
      ))}
    </div>
  );
}
function ReqRow({ k, req, onError, onSaved }) {
  const [m, setM] = useState(String(req.mandatory_hours));
  const [e, setE] = useState(String(req.elective_hours));
  const dirty = m !== String(req.mandatory_hours) || e !== String(req.elective_hours);
  return (
    <div className="ce-req-row">
      <strong>{req.label}</strong>
      <label>
        Mandatory
        <input type="number" min="0" step="0.5" value={m} onChange={(ev) => setM(ev.target.value)} />
      </label>
      <label>
        Elective
        <input type="number" min="0" step="0.5" value={e} onChange={(ev) => setE(ev.target.value)} />
      </label>
      <span className="field-help">= {fmtHours((Number(m) || 0) + (Number(e) || 0))} hrs / 2 yrs</span>
      {dirty && (
        <button
          type="button"
          className="license-mini-btn"
          onClick={() =>
            saveRequirement(k, { mandatory_hours: Number(m) || 0, elective_hours: Number(e) || 0 })
              .then(onSaved)
              .catch((err) => onError(err.message))
          }
        >
          Save
        </button>
      )}
    </div>
  );
}

/** The page. Agents see their own; brokers can pick any agent and review uploads. */
export default function CeTracker({ currentAgent, onBack }) {
  const isBroker = currentAgent?.role === "broker";
  const [agents, setAgents] = useState([]);
  const [viewId, setViewId] = useState(currentAgent?.id);
  const [reqs, setReqs] = useState(null);
  const [credits, setCredits] = useState([]);
  const [subs, setSubs] = useState([]);
  const [error, setError] = useState(null);
  const showToast = useToast();

  useCeReload(() => {
    Promise.all([fetchRequirements(), fetchCeCredits(isBroker ? null : currentAgent.id), fetchLicenseSubmissions(isBroker ? null : currentAgent.id), fetchAgents()])
      .then(([r, c, s, a]) => {
        setReqs(r);
        setCredits(c);
        setSubs(s);
        setAgents(a);
      })
      .catch((e) => setError(e.message));
  }, [currentAgent?.id, isBroker]);

  const viewed = useMemo(() => (viewId === currentAgent?.id ? { ...currentAgent, ...(agents.find((a) => a.id === viewId) || {}) } : agents.find((a) => a.id === viewId)), [agents, viewId, currentAgent]);
  const states = licensedStates(viewed);
  const mine = credits.filter((c) => c.agent_id === viewed?.id);
  const mySubs = subs.filter((s) => s.agent_id === viewed?.id);
  const autoApprove = isReviewer(currentAgent);

  return (
    <div className="ce-page">
      <header className="app-header">
        <button type="button" className="header-icon-btn" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft size={20} />
        </button>
        <div>
          <div className="brand-eyebrow">Continuing Education</div>
          <h1>
            <GraduationCap size={22} style={{ verticalAlign: -4 }} /> CE & Licenses
          </h1>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {reqs?._missing && <div className="error-banner">The CE tracker needs its database setup — Fran, run the CE tracker SQL.</div>}

      {isBroker && (
        <div className="detail-section">
          <h2 className="comps-section-title">Waiting on Review</h2>
          <p className="field-help">Agent uploads only count once they're approved. Open each one and make sure it's real.</p>
          <ReviewList credits={credits} submissions={subs} agents={agents} onError={setError} />
        </div>
      )}

      {isBroker && agents.length > 0 && (
        <div className="detail-section">
          <h2 className="comps-section-title">Everyone's Standing</h2>
          <div className="ce-team">
            {agents.map((a) => (
              <button key={a.id} type="button" className={`ce-team-row ${a.id === viewId ? "ce-team-row--on" : ""}`} onClick={() => setViewId(a.id)} title={`Open ${a.name}'s CE`}>
                <span className="ce-team-name">{a.name}</span>
                {reqs && licensedStates(a).map(({ state, key }) => <ProgressLine key={state} p={ceProgress(a, state, key, credits, reqs)} compact />)}
              </button>
            ))}
          </div>
        </div>
      )}

      {viewed && reqs && (
        <>
          <div className="detail-section">
            <h2 className="comps-section-title">{viewed.id === currentAgent.id ? "Where You Stand" : `${viewed.name.split(" ")[0]}'s CE`}</h2>
            {states.map(({ state, key }) => (
              <ProgressLine key={state} p={ceProgress(viewed, state, key, credits, reqs)} />
            ))}
          </div>

          {viewed.id === currentAgent.id && (
            <div className="detail-section">
              <h2 className="comps-section-title">Add a CE Certificate</h2>
              {!autoApprove && <p className="field-help">Fran reviews each certificate; it counts toward your hours once approved.</p>}
              <CeUploadForm agent={viewed} states={states} autoApprove={autoApprove} />
            </div>
          )}

          <div className="detail-section">
            <h2 className="comps-section-title">CE Credits</h2>
            {mine.length === 0 ? (
              <p className="field-help">No CE uploaded yet.</p>
            ) : (
              <ul className="ce-credit-list">
                {mine.map((c) => (
                  <li key={c.id}>
                    <span className={`ce-status ce-status--${c.status}`}>{c.status === "pending" ? "In review" : c.status === "approved" ? "Approved" : "Rejected"}</span>
                    <div className="ce-credit-main">
                      <strong>{c.course_name || "CE course"}</strong>
                      <span className="field-help">
                        {c.state} · {c.credit_type} · {fmtHours(c.hours)} hrs{c.completed_on ? ` · ${longDate(c.completed_on)}` : ""}
                        {c.status === "rejected" && c.review_note ? ` · “${c.review_note}”` : ""}
                      </span>
                    </div>
                    <span className="license-status-actions">
                      <button type="button" className="license-mini-btn" onClick={() => openFile(c.file_path, setError)} title="View the certificate">
                        <FileText size={14} />
                      </button>
                      {(c.status !== "approved" || isBroker) && (
                        <button
                          type="button"
                          className="license-mini-btn"
                          title="Delete this credit"
                          onClick={() => {
                            if (!window.confirm("Delete this CE credit?")) return;
                            deleteCeCredit(c.id)
                              .then(() => showToast("Deleted"))
                              .catch((e) => setError(e.message));
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="detail-section">
            <h2 className="comps-section-title">Licenses</h2>
            {states.map(({ state }) => (
              <LicenseCard key={state} agent={viewed} state={state} submissions={mySubs} onError={setError} />
            ))}
            {mySubs.filter((s) => s.status === "rejected").map((s) => (
              <p key={s.id} className="field-note">
                Your {LICENSE_LABEL[s.state]} upload from {longDate(s.created_at)} wasn't accepted{s.review_note ? `: “${s.review_note}”` : ""}. Please upload it again.
              </p>
            ))}
          </div>

          {isBroker && (
            <div className="detail-section">
              <h2 className="comps-section-title">Requirements</h2>
              <p className="field-help">Hours per 2-year license cycle. Defaults come from the course providers — double-check them against the VT OPR and NH Real Estate Commission and change them here if needed.</p>
              <RequirementsEditor reqs={reqs} onError={setError} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
