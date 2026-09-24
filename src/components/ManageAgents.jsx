import { useEffect, useState } from "react";
import { FileText, Copy, Check } from "lucide-react";
import RadioGroup from "./RadioGroup";
import { fetchAllAgents, addAgent, updateAgentFields, removeAgent, uploadAgentCoverSheet } from "../lib/transactions";

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

export default function ManageAgents({ onBack }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
        <button type="button" onClick={onBack}>
          Back
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <AddAgentForm onAdded={load} />

      <div className="detail-section">
        <h2 className="comps-section-title">Roster</h2>
        {loading ? (
          <p className="empty-state">Loading…</p>
        ) : (
          <div className="agent-list">
            {agents.map((agent) => (
              <AgentRow key={agent.id} agent={agent} onChanged={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddAgentForm({ onAdded }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [dropboxListingPath, setDropboxListingPath] = useState("");
  const [dropboxBuyerPath, setDropboxBuyerPath] = useState("");
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [onboardingPackage, setOnboardingPackage] = useState(null);

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
      setCoverFile(null);
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
    <form className="uc-form" onSubmit={handleSubmit}>
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
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email <span className="field-help">(must match their Google Sign-In email)</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div>
          <div className="detail-label">Role</div>
          <RadioGroup name="role" value={role} onChange={setRole} options={["agent", "broker"]} />
        </div>
        <label>
          Dropbox Listing Folder <span className="field-help">(e.g. /HC - Jane Doe/Jane - Listings)</span>
          <input value={dropboxListingPath} onChange={(e) => setDropboxListingPath(e.target.value)} />
        </label>
        <label>
          Dropbox Buyer Folder <span className="field-help">(optional, not yet used by any automation)</span>
          <input value={dropboxBuyerPath} onChange={(e) => setDropboxBuyerPath(e.target.value)} />
        </label>
        <label>
          Personalized Cover Sheet PDF <span className="field-help">(optional — falls back to the generic cover)</span>
          <input type="file" accept="application/pdf" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
        </label>
        <button type="submit" className="google-btn uc-submit" disabled={saving}>
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
        <button type="button" onClick={onDone}>
          Done
        </button>
        <button type="button" className="google-btn" onClick={handleCopy}>
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

function AgentRow({ agent, onChanged }) {
  const [email, setEmail] = useState(agent.email || "");
  const [dropboxListingPath, setDropboxListingPath] = useState(agent.dropbox_listing_path || "");
  const [dropboxBuyerPath, setDropboxBuyerPath] = useState(agent.dropbox_buyer_path || "");
  const [coverFile, setCoverFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

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
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    setSaving(true);
    setError(null);
    try {
      if (agent.is_active) await removeAgent(agent.id);
      else await updateAgentFields(agent.id, { is_active: true });
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`tx-card uc-form agent-row ${agent.is_active ? "" : "agent-row--inactive"}`}>
      <div className="tx-card-top">
        <div>
          <div className="tx-address">{agent.name}</div>
          <div className="tx-sub">
            {agent.role} {agent.is_active ? "" : "· inactive"}
          </div>
        </div>
        <button type="button" className="comps-status-btn" onClick={handleToggleActive} disabled={saving}>
          {agent.is_active ? "Deactivate" : "Reactivate"}
        </button>
      </div>

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

      <button type="button" className="google-btn uc-submit" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
