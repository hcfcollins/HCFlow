import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import RadioGroup from "./RadioGroup";
import { fetchAllAgents, addAgent, updateAgentFields, removeAgent, uploadAgentCoverSheet } from "../lib/transactions";

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

  return (
    <form className="uc-form" onSubmit={handleSubmit}>
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
