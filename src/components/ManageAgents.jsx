import { useEffect, useRef, useState } from "react";
import { FileText, Copy, Check, ArrowLeft, Mail, Plus, X, CheckCircle2, AlertCircle, Upload, CalendarDays } from "lucide-react";
import { isTrackingOnboarding, onboardingItemsFor, buildWelcomeEmail } from "../lib/onboarding";
import { openEmailCompose } from "../lib/clientEmail";
import RadioGroup from "./RadioGroup";
import ConfirmDialog from "./ConfirmDialog";
import { SkeletonList } from "./Skeleton";
import { useToast } from "../lib/ToastContext";
import { loadDraft, useDraftPersistence } from "../lib/useDraftPersistence";
import {
  fetchAllAgents,
  addAgent,
  updateAgentFields,
  removeAgent,
  uploadAgentCoverSheet,
  uploadAgentLicense,
  agentLicenseUrl,
  uploadAgentDocument,
  fetchBrokerageLicenses,
  saveBrokerageLicense,
  uploadBrokerageLicense,
} from "../lib/transactions";
import { focusNextOnEnter } from "../lib/formKeyNav";
import { agentMissingItems } from "../lib/agentMissingInfo";

/** Uses the app's actual current URL — never a guessed/hardcoded domain, so the
 * sign-in link is always correct even if the deployment domain ever changes. */
function buildOnboardingPackage({ name, email, dropboxListingPath }) {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const signInUrl = window.location.origin;
  const folderLine = dropboxListingPath
    ? `Your listing documents live in Dropbox at ${dropboxListingPath} — already set up and shared with you.`
    : "Ask Fran or Holly for your Dropbox listing folder if you don't have access yet.";

  return `Welcome to HC Flow, ${firstName}!

Sign in here: ${signInUrl}
Use your Hall Collins Google account (${email || "the email Fran/Holly set up for you"}) to sign in — that's how the app knows it's you.

Quick orientation:

- COMPS — After a listing appointment, tap "+ New Comp" to log it right away (address, seller info, property details). It shows up under the Comps tab.
- WON LISTING — Once you win the listing, move its stage to "Listing Won." HC Flow automatically sets up your Dropbox folder and a starter to-do checklist (photos, listing agreement, disclosures).
- ACTIVE LISTINGS — Once it's actually live to the public, move it to "On Market."
- UNDER CONTRACT — For either your listing going under contract or a buyer client, use "+ Under Contract" (or the stage dropdown on an existing card).
- CLOSED — When a deal closes, Fran or Holly runs the close-out calculator.
- Search — use the search bar at the top of any page to find a deal by address or last name.
- ${folderLine}

Questions? Just ask Fran or Holly.`;
}

export default function ManageAgents({ onBack, focusAgentId = null }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddAgent, setShowAddAgent] = useState(false);

  function load() {
    setLoading(true);
    fetchAllAgents()
      .then(setAgents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  return (
    <div className="deal-detail">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">Broker Tools</div>
          <h1>Manage Agents</h1>
        </div>
        <button type="button" className="header-icon-btn" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft size={20} />
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {!loading && <OnboardingTodos agents={agents} onChanged={load} />}

      <BrokerageLicenses focused={focusAgentId === "brokerage"} />

      {showAddAgent && (
        <AddAgentForm
          onAdded={() => {
            load();
            setShowAddAgent(false);
          }}
        />
      )}

      <div className="detail-section">
        <div className="roster-header">
          <h2 className="comps-section-title">Roster</h2>
          <button
            type="button"
            className={`roster-add-btn ${showAddAgent ? "roster-add-btn--open" : ""}`}
            onClick={() => setShowAddAgent((v) => !v)}
            title={showAddAgent ? "Close the new agent form" : "Add a new agent"}
            aria-label={showAddAgent ? "Close the new agent form" : "Add a new agent"}
          >
            {showAddAgent ? <X size={18} /> : <Plus size={18} />}
          </button>
        </div>
        {loading ? (
          <SkeletonList count={3} />
        ) : (
          <div className="agent-list">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onChanged={load} focused={agent.id === focusAgentId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Guesses email + Dropbox paths from a "First Last" name, matching the
 * firstname.lastname@hallcollins.com and /HC - First Last/First - Listings
 * conventions already used by the rest of the roster. Returns null until
 * there's at least a first and last name to work with. */
function predictAgentFields(fullName) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = parts[0];
  const last = parts[parts.length - 1];
  const properName = `${first} ${last}`;
  return {
    email: `${first.toLowerCase()}.${last.toLowerCase()}@hallcollins.com`,
    dropboxListingPath: `/HC - ${properName}/${first} - Listings`,
    dropboxBuyerPath: `/HC - ${properName}/${first} - Buyers`,
  };
}

function AddAgentForm({ onAdded }) {
  const draft = useRef(loadDraft("add-agent")).current;
  const [name, setName] = useState(draft?.name || "");
  const [email, setEmail] = useState(draft?.email || "");
  const [role, setRole] = useState(draft?.role || "agent");
  const [dropboxListingPath, setDropboxListingPath] = useState(draft?.dropboxListingPath || "");
  const [dropboxBuyerPath, setDropboxBuyerPath] = useState(draft?.dropboxBuyerPath || "");
  const [emailTouched, setEmailTouched] = useState(draft?.emailTouched || false);
  const [pathsTouched, setPathsTouched] = useState(draft?.pathsTouched || false);
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [onboardingPackage, setOnboardingPackage] = useState(null);

  // coverFile (a File object) can't be persisted to localStorage, so it's excluded —
  // re-picking a PDF after a restore is a minor ask compared to the rest of the form.
  const { clearDraft } = useDraftPersistence("add-agent", {
    name, email, role, dropboxListingPath, dropboxBuyerPath, emailTouched, pathsTouched,
  });

  function handleNameChange(v) {
    setName(v);
    const prediction = predictAgentFields(v);
    if (!prediction) return;
    if (!emailTouched) setEmail(prediction.email);
    if (!pathsTouched) {
      setDropboxListingPath(prediction.dropboxListingPath);
      setDropboxBuyerPath(prediction.dropboxBuyerPath);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let coverSheetUrl = null;
      if (coverFile) coverSheetUrl = await uploadAgentCoverSheet(coverFile, name);
      await addAgent({
        name,
        email: email || null,
        role,
        dropboxListingPath: dropboxListingPath || null,
        dropboxBuyerPath: dropboxBuyerPath || null,
        coverSheetUrl,
      });
      setOnboardingPackage(buildOnboardingPackage({ name, email, dropboxListingPath }));
      setName("");
      setEmail("");
      setRole("agent");
      setDropboxListingPath("");
      setDropboxBuyerPath("");
      setEmailTouched(false);
      setPathsTouched(false);
      setCoverFile(null);
      clearDraft();
      onAdded();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (onboardingPackage) {
    return <OnboardingPackage text={onboardingPackage} onDone={() => setOnboardingPackage(null)} />;
  }

  return (
    <form className="uc-form" onSubmit={handleSubmit} onKeyDown={focusNextOnEnter}>
      <div className="onboarding-checklist">
        <strong>Before adding a new agent, in Dropbox:</strong>
        <ol>
          <li>
            Create their folders — <code>/HC - Name/Name - Listings</code> and <code>/HC - Name/Name - Buyers</code>,
            matching everyone else's pattern.
          </li>
          <li>Share just those folders with them — not other agents' folders.</li>
          <li>Confirm the email below matches their actual Google Sign-In account.</li>
        </ol>
      </div>

      <fieldset>
        <legend>Add Agent</legend>
        {error && <div className="error-banner">{error}</div>}
        {draft && (
          <div className="view-as-banner">
            Restored your unsaved draft from last time — nothing was lost.
          </div>
        )}
        <label>
          Name
          <input value={name} onChange={(e) => handleNameChange(e.target.value)} required />
        </label>
        <label>
          Email <span className="field-help">(guessed from their name — must match their actual Google Sign-In email)</span>
          <input
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailTouched(true);
            }}
          />
        </label>
        <div>
          <div className="detail-label">Role</div>
          <RadioGroup name="role" value={role} onChange={setRole} options={["agent", "broker"]} />
        </div>
        <label>
          Dropbox Listing Folder <span className="field-help">(guessed from their name — e.g. /HC - Jane Doe/Jane - Listings)</span>
          <input
            value={dropboxListingPath}
            onChange={(e) => {
              setDropboxListingPath(e.target.value);
              setPathsTouched(true);
            }}
          />
        </label>
        <label>
          Dropbox Buyer Folder <span className="field-help">(guessed from their name — optional, not yet used by any automation)</span>
          <input
            value={dropboxBuyerPath}
            onChange={(e) => {
              setDropboxBuyerPath(e.target.value);
              setPathsTouched(true);
            }}
          />
        </label>
        <label>
          Personalized Cover Sheet PDF <span className="field-help">(optional — falls back to the generic cover)</span>
          <input type="file" accept="application/pdf" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
        </label>
        <button title="Add this agent to the roster" type="submit" className="google-btn uc-submit" disabled={saving}>
          {saving ? "Adding…" : "Add Agent"}
        </button>
      </fieldset>
    </form>
  );
}

function OnboardingPackage({ text, onDone }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (permissions, non-secure context) — the textarea
      // below still lets Fran select-all and copy manually either way.
    }
  }

  return (
    <div className="detail-section onboarding-package">
      <h2 className="comps-section-title">Onboarding Package Ready</h2>
      <p className="field-help">Copy this and send it to them however you'd like (email, text, etc.).</p>
      <textarea className="onboarding-package-text" readOnly rows={14} value={text} onClick={(e) => e.target.select()} />
      <div className="comp-edit-all-actions">
        <button title="Close" type="button" onClick={onDone}>
          Done
        </button>
        <button title="Copy to clipboard" type="button" className="google-btn" onClick={handleCopy}>
          {copied ? (
            <>
              <Check size={14} /> Copied!
            </>
          ) : (
            <>
              <Copy size={14} /> Copy to Clipboard
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** Fran's to-do section for new-agent onboarding — one card per agent still
 * being onboarded, with their open items. Profile items tick themselves off
 * once the info is in their roster profile; the rest she checks off here.
 * An agent drops out of this section once everything's done. */
function OnboardingTodos({ agents, onChanged }) {
  const showToast = useToast();
  const [busyKey, setBusyKey] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const tracked = agents.filter((a) => a.is_active && isTrackingOnboarding(a));
  const withItems = tracked.map((a) => ({ agent: a, items: onboardingItemsFor(a) }));
  const inProgress = withItems.filter((x) => x.items.some((i) => !i.done));
  const complete = withItems.filter((x) => x.items.every((i) => i.done));

  if (!tracked.length) return null;

  async function toggle(agent, key, done) {
    setBusyKey(`${agent.id}:${key}`);
    try {
      const next = { ...(agent.onboarding || {}) };
      if (done) next[key] = new Date().toISOString();
      else delete next[key];
      await updateAgentFields(agent.id, { onboarding: next });
      onChanged();
    } catch (e) {
      showToast(`Couldn't save: ${e.message}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="detail-section">
      <h2 className="comps-section-title">
        Onboarding To-Dos <span className="comps-section-count">{inProgress.length}</span>
      </h2>
      {inProgress.length === 0 && <p className="field-help">Everyone's fully onboarded. 🎉</p>}
      <div className="agent-list">
        {inProgress.map(({ agent, items }) => {
          const doneCount = items.filter((i) => i.done).length;
          return (
            <div key={agent.id} className="tx-card onboarding-card">
              <div className="tx-card-top">
                <div>
                  <div className="tx-address">{agent.name}</div>
                  <div className="tx-sub">
                    {doneCount} of {items.length} done
                  </div>
                </div>
              </div>
              <div className="onboarding-progress">
                <div className="onboarding-progress-bar" style={{ width: `${(doneCount / items.length) * 100}%` }} />
              </div>
              <ul className="onboarding-items">
                {items
                  .slice()
                  .sort((a, b) => Number(a.done) - Number(b.done))
                  .map((item) => (
                    <li key={item.key} className={item.done ? "onboarding-item--done" : ""}>
                      <label className="onboarding-item">
                        <input
                          type="checkbox"
                          checked={item.done}
                          disabled={item.kind === "profile" || busyKey === `${agent.id}:${item.key}`}
                          onChange={(e) => toggle(agent, item.key, e.target.checked)}
                        />
                        <span>
                          {item.label}
                          {item.kind === "profile" && !item.done && (
                            <span className="field-help"> — fill in on their roster card below; checks itself off</span>
                          )}
                        </span>
                      </label>
                      {item.key === "welcome_email" && !item.done && (
                        <button
                          type="button"
                          className="todo-action-btn onboarding-draft-btn"
                          title={agent.email ? `Open a pre-filled Gmail draft to ${agent.email}` : "Add their email first"}
                          onClick={() => openEmailCompose(buildWelcomeEmail(agent))}
                        >
                          <Mail size={11} /> Draft Email
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>
      {complete.length > 0 && (
        <button title="Show or hide agents who finished onboarding" type="button" className="comps-minimize-btn" onClick={() => setShowDone((v) => !v)}>
          {showDone ? "Hide" : "Show"} fully onboarded ({complete.length})
        </button>
      )}
      {showDone && (
        <p className="field-help">
          {complete.map(({ agent }) => agent.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function AgentRow({ agent, onChanged, focused = false }) {
  // Opened from "Agent Info Missing" on the To-Dos tab → start open and scroll here.
  const [expanded, setExpanded] = useState(focused);
  const rowRef = useRef(null);
  useEffect(() => {
    if (!focused || !rowRef.current) return;
    setExpanded(true);
    const t = setTimeout(() => rowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    return () => clearTimeout(t);
  }, [focused]);
  const missing = agentMissingItems(agent);
  const [email, setEmail] = useState(agent.email || "");
  const [dropboxListingPath, setDropboxListingPath] = useState(agent.dropbox_listing_path || "");
  const [dropboxBuyerPath, setDropboxBuyerPath] = useState(agent.dropbox_buyer_path || "");
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const showToast = useToast();

  const isDirty =
    email !== (agent.email || "") ||
    dropboxListingPath !== (agent.dropbox_listing_path || "") ||
    dropboxBuyerPath !== (agent.dropbox_buyer_path || "") ||
    coverFile !== null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let coverSheetUrl = agent.cover_sheet_url;
      if (coverFile) coverSheetUrl = await uploadAgentCoverSheet(coverFile, agent.name);
      await updateAgentFields(agent.id, {
        email: email || null,
        dropbox_listing_path: dropboxListingPath || null,
        dropbox_buyer_path: dropboxBuyerPath || null,
        cover_sheet_url: coverSheetUrl,
      });
      setCoverFile(null);
      onChanged();
      showToast("Agent updated");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function performToggleActive() {
    setSaving(true);
    setError(null);
    try {
      if (agent.is_active) await removeAgent(agent.id);
      else await updateAgentFields(agent.id, { is_active: true });
      onChanged();
      showToast(agent.is_active ? "Agent deactivated" : "Agent reactivated");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleToggleActive(e) {
    e.stopPropagation();
    if (agent.is_active) {
      setShowDeactivateConfirm(true);
    } else {
      performToggleActive();
    }
  }

  return (
    <div ref={rowRef} className={`tx-card uc-form agent-row ${agent.is_active ? "" : "agent-row--inactive"}`}>
      <div className="tx-card-top agent-row-header" onClick={() => setExpanded((x) => !x)}>
        <div>
          <div className="tx-address">{agent.name}</div>
          <div className="tx-sub">
            {agent.role} {agent.is_active ? "" : "· inactive"}
          </div>
          {"vt_license_expires" in agent && agent.role !== "coordinator" && <LicenseBadges agent={agent} />}
          {missing.length > 0 && <div className="agent-missing-line">Missing: {missing.join(" · ")}</div>}
        </div>
        <button title={agent.is_active ? "Turn off this agent's access (keeps their deals)" : "Turn this agent's access back on"} type="button" className="agent-deactivate-btn" onClick={handleToggleActive} disabled={saving}>
          {agent.is_active ? "Deactivate" : "Reactivate"}
        </button>
      </div>

      {expanded && (
        <>
          {error && <div className="error-banner">{error}</div>}

          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Dropbox Listing Folder
            <input value={dropboxListingPath} onChange={(e) => setDropboxListingPath(e.target.value)} />
          </label>
          <label>
            Dropbox Buyer Folder
            <input value={dropboxBuyerPath} onChange={(e) => setDropboxBuyerPath(e.target.value)} />
          </label>
          <label>
            Cover Sheet PDF
            <input type="file" accept="application/pdf" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
          </label>
          {agent.cover_sheet_url && !coverFile && (
            <a href={agent.cover_sheet_url} target="_blank" rel="noreferrer" className="cma-export-btn">
              <FileText size={14} /> Current Cover Sheet
            </a>
          )}

          {"vt_license_expires" in agent && agent.role !== "coordinator" && (
            <div className="license-section">
              <div className="license-section-title">Real Estate Licenses</div>
              <p className="field-help">
                Reminders go to {agent.name.split(" ")[0]} and Fran 3 months before expiration (for continuing education), then 1 month,
                2 weeks, and 1 day before.
              </p>
              <LicenseEditor agent={agent} state="vt" label="Vermont (required)" onChanged={onChanged} />
              {"nh_not_licensed" in agent && (
                <label className="inspection-waived-check" title="New Hampshire is optional — stops asking for an NH license">
                  <input
                    type="checkbox"
                    checked={agent.nh_not_licensed === true}
                    onChange={async (e) => {
                      try {
                        await updateAgentFields(agent.id, { nh_not_licensed: e.target.checked });
                        onChanged();
                        showToast(e.target.checked ? `${agent.name.split(" ")[0]} marked not licensed in NH` : "NH license back on");
                      } catch (err) {
                        setError(err.message);
                      }
                    }}
                  />
                  Not licensed in NH
                </label>
              )}
              {!agent.nh_not_licensed && <LicenseEditor agent={agent} state="nh" label="New Hampshire" onChanged={onChanged} />}
              {agent.role === "broker" && "broker_license_expires" in agent && (
                <LicenseEditor agent={agent} state="broker" label="Broker License" onChanged={onChanged} />
              )}
            </div>
          )}

          {agent.role === "agent" && "policy_manual_path" in agent && (
            <div className="license-section">
              <div className="license-section-title">Signed Documents</div>
              <div className="license-editor">
                <AgentDocumentField agent={agent} docKey="policy_manual" label="Signed Policy Manual" onChanged={onChanged} />
                <AgentDocumentField agent={agent} docKey="ica" label="Signed Independent Contractor Agreement" onChanged={onChanged} />
              </div>
            </div>
          )}

          {isDirty && (
            <button title="Save changes" type="button" className="google-btn uc-submit" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          )}

          {agent.role !== "coordinator" && !isTrackingOnboarding(agent) && (
            <button title="Track this agent's new-agent onboarding to-dos"
              type="button"
              className="comps-status-btn"
              disabled={saving}
              onClick={async () => {
                try {
                  await updateAgentFields(agent.id, { onboarding: {} });
                  onChanged();
                  showToast(`Added ${agent.name} to Onboarding To-Dos`);
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              Start onboarding checklist
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={showDeactivateConfirm}
        title={`Deactivate ${agent.name}?`}
        message="They'll disappear from the active agent picker until reactivated."
        confirmLabel="Deactivate"
        danger
        onConfirm={() => {
          setShowDeactivateConfirm(false);
          performToggleActive();
        }}
        onCancel={() => setShowDeactivateConfirm(false)}
      />
    </div>
  );
}

/** Days from today (local) until a YYYY-MM-DD date; negative once past. */
function daysUntil(ymd) {
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const today = new Date();
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - t0) / 86400000);
}
const shortExp = (ymd) => {
  const [y, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}/${y.slice(2)}`;
};

/** "VT exp 3/31/27" chips on the agent row — amber within 3 months, red when expired. */
function LicenseBadges({ agent }) {
  const chips = [
    ["VT", agent.vt_license_expires],
    ["NH", agent.nh_license_expires],
  ].filter(([, d]) => d);
  if (!chips.length) return null;
  return (
    <div className="license-badges">
      {chips.map(([st, d]) => {
        const left = daysUntil(d);
        const cls = left < 0 ? "license-badge--expired" : left <= 90 ? "license-badge--soon" : "";
        return (
          <span key={st} className={`license-badge ${cls}`} title={left < 0 ? `${st} license expired` : `${st} license expires in ${left} day${left === 1 ? "" : "s"}`}>
            {st} {left < 0 ? "expired" : "exp"} {shortExp(d)}
          </span>
        );
      })}
    </div>
  );
}

/** One state's license: expiration date (saves on change) + upload/view a copy. */
/** An agent's own license: state "vt" | "nh" | "broker" (columns
 * {state}_license_expires / {state}_license_path on agents). */
function LicenseEditor({ agent, state, label, onChanged }) {
  return (
    <LicenseFields
      record={agent}
      expKey={`${state}_license_expires`}
      pathKey={`${state}_license_path`}
      label={label}
      saveFields={(patch) => updateAgentFields(agent.id, patch)}
      uploadFile={(file) => uploadAgentLicense(agent.id, state, file)}
      onChanged={onChanged}
    />
  );
}

/** Expiration date (saved with a button) + upload/view a copy, for any license record. */
function LicenseFields({ record, expKey, pathKey, label, saveFields, uploadFile, onChanged }) {
  const agent = record;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [draftDate, setDraftDate] = useState(agent[expKey] || "");
  useEffect(() => setDraftDate(agent[expKey] || ""), [agent[expKey]]); // eslint-disable-line react-hooks/exhaustive-deps
  const showToast = useToast();
  const left = daysUntil(agent[expKey]);

  async function saveDate(value) {
    setBusy(true);
    setError(null);
    try {
      await saveFields({ [expKey]: value || null });
      onChanged();
      showToast(value ? `${label} expiration saved` : `${label} expiration cleared`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadFile(file);
      onChanged();
      showToast(`${label} license uploaded`);
    } catch (e) {
      setError(e.message.includes("Bucket not found") ? "The license storage isn't set up yet — run the license SQL first." : e.message);
    } finally {
      setBusy(false);
    }
  }

  async function view() {
    // Open the tab inside the click so it isn't popup-blocked.
    const tab = window.open("", "_blank");
    try {
      const url = await agentLicenseUrl(agent[pathKey]);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      if (tab) tab.close();
      setError(e.message);
    }
  }

  const hasCopy = Boolean(agent[pathKey]);
  const expires = agent[expKey] || "";
  const [editingDate, setEditingDate] = useState(false);

  return (
    <div className="license-editor">
      <div className="license-editor-head">
        <strong>{label}</strong>
        {left != null && (
          <span className={`license-badge ${left < 0 ? "license-badge--expired" : left <= 90 ? "license-badge--soon" : ""}`}>
            {left < 0 ? "Expired" : left === 0 ? "Expires today" : `${left} day${left === 1 ? "" : "s"} left`}
          </span>
        )}
      </div>
      {error && <div className="error-banner">{error}</div>}

      {/* Copy on file? */}
      <div className={`license-status-row ${hasCopy ? "license-status-row--ok" : "license-status-row--missing"}`}>
        {hasCopy ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
        <span className="license-status-text">
          {hasCopy ? (
            <>
              <strong>Copy uploaded</strong>
              {uploadedOn(agent[pathKey]) && <span className="license-status-sub"> · {uploadedOn(agent[pathKey])}</span>}
            </>
          ) : (
            <strong>No copy uploaded</strong>
          )}
        </span>
        <span className="license-status-actions">
          {hasCopy && (
            <button type="button" className="license-mini-btn" onClick={view} title={`View the ${label} copy`}>
              <FileText size={14} /> View
            </button>
          )}
          <label className="license-mini-btn" title={`Upload a copy of the ${label} (PDF or photo)`}>
            <Upload size={14} /> {busy ? "Saving…" : hasCopy ? "Replace" : "Upload"}
            <input type="file" accept="application/pdf,image/*" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </span>
      </div>

      {/* Expiration date */}
      <div className={`license-status-row ${expires ? (left < 0 ? "license-status-row--bad" : "license-status-row--ok") : "license-status-row--missing"}`}>
        {expires && left >= 0 ? <CalendarDays size={18} /> : <AlertCircle size={18} />}
        <span className="license-status-text">
          {expires ? (
            <>
              <strong>{left < 0 ? "Expired" : "Expires"} {longExp(expires)}</strong>
            </>
          ) : (
            <strong>No expiration date</strong>
          )}
        </span>
        {!editingDate && (
          <span className="license-status-actions">
            <button type="button" className="license-mini-btn" onClick={() => setEditingDate(true)} title="Set the expiration date">
              {expires ? "Change" : "Add date"}
            </button>
          </span>
        )}
      </div>
      {editingDate && (
        <div className="license-date-edit">
          {/* Not saved on every change — phone date wheels fire a change for
              each spin. Pick the date, then tap Save. */}
          <input type="date" value={draftDate} disabled={busy} onChange={(e) => setDraftDate(e.target.value)} />
          <div className="license-date-actions">
            <button
              type="button"
              className="google-btn"
              disabled={busy || !draftDate || draftDate === expires}
              onClick={async () => {
                await saveDate(draftDate);
                setEditingDate(false);
              }}
              title="Save this expiration date"
            >
              {busy ? "Saving…" : "Save date"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraftDate(expires);
                setEditingDate(false);
              }}
              title="Close without changing"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** A signed document on file for the agent (policy manual, contractor
 * agreement): uploaded or not, with View / Upload. */
function AgentDocumentField({ agent, docKey, label, onChanged }) {
  const pathKey = `${docKey}_path`;
  const path = agent[pathKey];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const showToast = useToast();

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadAgentDocument(agent.id, docKey, file);
      onChanged();
      showToast(`${label} uploaded`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function view() {
    const tab = window.open("", "_blank");
    try {
      const url = await agentLicenseUrl(path);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      if (tab) tab.close();
      setError(e.message);
    }
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <div className={`license-status-row ${path ? "license-status-row--ok" : "license-status-row--missing"}`}>
        {path ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
        <span className="license-status-text">
          <strong>{label}</strong>
          <span className="license-status-sub"> · {path ? `uploaded${uploadedOn(path) ? ` ${uploadedOn(path)}` : ""}` : "not uploaded"}</span>
        </span>
        <span className="license-status-actions">
          {path && (
            <button type="button" className="license-mini-btn" onClick={view} title={`View the ${label}`}>
              <FileText size={14} /> View
            </button>
          )}
          <label className="license-mini-btn" title={`Upload the ${label} (PDF or photo)`}>
            <Upload size={14} /> {busy ? "Saving…" : path ? "Replace" : "Upload"}
            <input type="file" accept="application/pdf,image/*" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        </span>
      </div>
    </>
  );
}

/** Upload date from the file name ("…-1763049600000.pdf") → "Nov 13, 2026". */
function uploadedOn(path) {
  const m = /-(\d{13})\.[a-z0-9]+$/i.exec(path || "");
  return m ? new Date(Number(m[1])).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}
/** "2027-03-31" → "March 31, 2027" */
function longExp(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** The firm's own licenses (Hall Collins Real Estate Group, VT + NH) —
 * renewal reminders go to Fran only. Stored in brokerage_licenses. */
function BrokerageLicenses({ focused = false }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const load = () =>
    fetchBrokerageLicenses()
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (focused && rows) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [focused, rows]);

  return (
    <div className="detail-section" ref={ref}>
      <h2 className="comps-section-title">Brokerage Licenses</h2>
      <p className="field-help">
        Hall Collins Real Estate Group's own firm licenses. Renewal reminders go to Fran at 3 months, 1 month, 2 weeks, and 1 day before
        expiration.
      </p>
      {error ? (
        <p className="field-help dbx-picker-error">
          {/brokerage_licenses/.test(error) ? "Run the brokerage license SQL first." : error}
        </p>
      ) : !rows ? (
        <p className="field-help">Loading…</p>
      ) : (
        ["VT", "NH"].map((st) => {
          const row = rows.find((r) => r.state === st) || { state: st };
          return (
            <LicenseFields
              key={st}
              record={row}
              expKey="expires"
              pathKey="license_path"
              label={st === "VT" ? "Vermont Brokerage License" : "New Hampshire Brokerage License"}
              saveFields={(patch) => saveBrokerageLicense(st, patch)}
              uploadFile={(file) => uploadBrokerageLicense(st, file)}
              onChanged={load}
            />
          );
        })
      )}
    </div>
  );
}
