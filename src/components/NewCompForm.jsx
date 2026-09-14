import { useState } from "react";
import { createComp } from "../lib/transactions";
import RadioGroup from "./RadioGroup";
import AgentField from "./AgentField";

export default function NewCompForm({ currentAgent, onCancel, onSubmitted }) {
  const [selectedAgentId, setSelectedAgentId] = useState(currentAgent.id);
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [side, setSide] = useState("Sell");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createComp({ agentId: selectedAgentId, address, town, side, notes });
      onSubmitted();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="uc-form" onSubmit={handleSubmit}>
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">New Deal</div>
          <h1>New Comp</h1>
        </div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <AgentField currentAgent={currentAgent} value={selectedAgentId} onChange={setSelectedAgentId} />

      <label>
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} required />
      </label>
      <label>
        Town
        <input value={town} onChange={(e) => setTown(e.target.value)} />
      </label>

      <fieldset>
        <legend>Which Side?</legend>
        <RadioGroup
          name="side"
          value={side}
          onChange={setSide}
          options={[
            { value: "Sell", label: "Seller" },
            { value: "Buy", label: "Buyer" },
          ]}
        />
      </fieldset>

      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Notes from the appointment…" />
      </label>

      <button type="submit" className="google-btn uc-submit" disabled={saving}>
        {saving ? "Saving…" : "Add to Comps"}
      </button>
    </form>
  );
}
