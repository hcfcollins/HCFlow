import { useState } from "react";
import { Mail } from "lucide-react";
import { createComp } from "../lib/transactions";
import RadioGroup from "./RadioGroup";
import CheckboxGroup from "./CheckboxGroup";

const TIMEFRAMES = ["Now", "6 months", "Next year"];
const PROPERTY_TYPES = ["Residential", "Land"];
const ELECTRICAL_OPTIONS = ["200 amp", "150 amp", "100 amp", "Fuses", "Knob and Tube"];
const HEATING_OPTIONS = [
  "Baseboard",
  "Hot Water",
  "Oil",
  "Propane",
  "Electric",
  "Direct Vent/Rinnai",
  "Mini Splits",
  "Wood Stove",
  "Pellet Stove",
  "Radiant",
];
const BASEMENT_OPTIONS = ["Dirt Floor", "Concrete Block", "Poured Concrete", "Fieldstone", "Crawlspace"];
const RECOMMENDATION_OPTIONS = [
  "🌸 Wait for Spring",
  "🔍 Septic Inspection Recommended in Advance",
  "🏠 Home Inspection Recommended in Advance",
  "🛋️ Staging Instructions",
  "🧹 Deep Clean / Clear Out Recommended",
  "📐 Land Subdivision Opportunity",
  "🎨 Painting / Complete A Few Projects",
];

export default function NewCompForm({ currentAgent, onCancel, onSubmitted }) {
  const [address, setAddress] = useState("");
  const [town, setTown] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [timeframe, setTimeframe] = useState(TIMEFRAMES[0]);
  const [propertyStyle, setPropertyStyle] = useState(PROPERTY_TYPES[0]);
  const [electrical, setElectrical] = useState("");
  const [heatingSystem, setHeatingSystem] = useState([]);
  const [heatingOther, setHeatingOther] = useState("");
  const [basement, setBasement] = useState([]);
  const [waterSource, setWaterSource] = useState("");
  const [septic, setSeptic] = useState("");
  const [recommendations, setRecommendations] = useState([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createComp({
        agentId: currentAgent.id,
        address,
        town,
        side: "Sell",
        notes,
        sellerName,
        sellerEmail,
        timeframe,
        propertyStyle,
        electrical: electrical || null,
        heatingSystem: heatingOther ? [...heatingSystem, heatingOther] : heatingSystem,
        basement,
        waterSource,
        septic,
        recommendations,
      });
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

      <label>
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} required />
      </label>
      <label>
        Town
        <input value={town} onChange={(e) => setTown(e.target.value)} />
      </label>

      <label>
        Seller Name(s)
        <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      </label>
      <label>
        Seller Email
        <div className="input-with-icon">
          <input type="email" value={sellerEmail} onChange={(e) => setSellerEmail(e.target.value)} />
          {sellerEmail && (
            <a href={`mailto:${sellerEmail}`} className="input-icon-btn" title="Email seller">
              <Mail size={16} />
            </a>
          )}
        </div>
      </label>

      <fieldset>
        <legend>Rough Timeframe</legend>
        <RadioGroup name="timeframe" value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
      </fieldset>

      <fieldset>
        <legend>Property Type</legend>
        <RadioGroup name="propertyType" value={propertyStyle} onChange={setPropertyStyle} options={PROPERTY_TYPES} />
      </fieldset>

      <fieldset>
        <legend>Electrical</legend>
        <RadioGroup name="electrical" value={electrical} onChange={setElectrical} options={ELECTRICAL_OPTIONS} />
      </fieldset>

      <fieldset>
        <legend>Heating System</legend>
        <CheckboxGroup name="heatingSystem" values={heatingSystem} onChange={setHeatingSystem} options={HEATING_OPTIONS} />
        <input placeholder="Other" value={heatingOther} onChange={(e) => setHeatingOther(e.target.value)} />
      </fieldset>

      <fieldset>
        <legend>Basement</legend>
        <CheckboxGroup name="basement" values={basement} onChange={setBasement} options={BASEMENT_OPTIONS} />
      </fieldset>

      <label>
        Water Source (and where it is)
        <input value={waterSource} onChange={(e) => setWaterSource(e.target.value)} placeholder="e.g. Drilled well, back of the lot" />
      </label>
      <label>
        Septic (type and where it is)
        <input value={septic} onChange={(e) => setSeptic(e.target.value)} placeholder="e.g. Conventional, front yard" />
      </label>

      <fieldset>
        <legend>Recommendations</legend>
        <CheckboxGroup
          name="recommendations"
          values={recommendations}
          onChange={setRecommendations}
          options={RECOMMENDATION_OPTIONS}
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
