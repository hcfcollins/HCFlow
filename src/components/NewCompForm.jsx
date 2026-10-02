import { useRef, useState } from "react";
import { createComp } from "../lib/transactions";
import RadioGroup from "./RadioGroup";
import CheckboxGroup from "./CheckboxGroup";
import EmailListInput from "./EmailListInput";
import { CLIENT_SOURCES, correctPercentInput } from "./UnderContractForm";
import { loadDraft, useDraftPersistence } from "../lib/useDraftPersistence";
import {
  TIMEFRAMES,
  PROPERTY_STYLES as PROPERTY_TYPES,
  ELECTRICAL_OPTIONS,
  HEATING_OPTIONS,
  BASEMENT_OPTIONS,
  RECOMMENDATION_OPTIONS,
} from "../lib/compFieldOptions";

export default function NewCompForm({ currentAgent, onCancel, onSubmitted }) {
  const draft = useRef(loadDraft("new-comp")).current;
  const [address, setAddress] = useState(draft?.address || "");
  const [town, setTown] = useState(draft?.town || "");
  const [sellerName, setSellerName] = useState(draft?.sellerName || "");
  const [sellerEmails, setSellerEmails] = useState(draft?.sellerEmails || [""]);
  const [timeframe, setTimeframe] = useState(draft?.timeframe || TIMEFRAMES[0]);
  const [propertyStyle, setPropertyStyle] = useState(draft?.propertyStyle || PROPERTY_TYPES[0]);
  const [electrical, setElectrical] = useState(draft?.electrical || "");
  const [heatingSystem, setHeatingSystem] = useState(draft?.heatingSystem || []);
  const [heatingOther, setHeatingOther] = useState(draft?.heatingOther || "");
  const [basement, setBasement] = useState(draft?.basement || []);
  const [waterSource, setWaterSource] = useState(draft?.waterSource || "");
  const [septic, setSeptic] = useState(draft?.septic || "");
  const [recommendations, setRecommendations] = useState(draft?.recommendations || []);
  const [referralNote, setReferralNote] = useState(draft?.referralNote || "");
  const [notes, setNotes] = useState(draft?.notes || "");
  const [leadType, setLeadType] = useState(draft?.leadType || "Organic");
  const [clientSource, setClientSource] = useState(draft?.clientSource || CLIENT_SOURCES[0]);
  const [referralOwedTo, setReferralOwedTo] = useState(draft?.referralOwedTo || "");
  const [referralPctChoice, setReferralPctChoice] = useState(draft?.referralPctChoice || "25");
  const [referralPct, setReferralPct] = useState(draft?.referralPct || "25");
  const [referralPctAutoAdjusted, setReferralPctAutoAdjusted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const { clearDraft } = useDraftPersistence("new-comp", {
    address, town, sellerName, sellerEmails, timeframe, propertyStyle, electrical,
    heatingSystem, heatingOther, basement, waterSource, septic, recommendations,
    referralNote, notes, leadType, clientSource, referralOwedTo, referralPctChoice, referralPct,
  });

  function handleReferralPctBlur() {
    const corrected = correctPercentInput(referralPct);
    if (corrected) {
      setReferralPct(corrected);
      setReferralPctAutoAdjusted(true);
    } else {
      setReferralPctAutoAdjusted(false);
    }
  }

  function handleReferralPctChoice(value) {
    setReferralPctChoice(value);
    setReferralPctAutoAdjusted(false);
    setReferralPct(value === "Other" ? "" : value);
  }

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
        sellerEmails: sellerEmails.map((e) => e.trim()).filter(Boolean),
        timeframe,
        propertyStyle,
        electrical: electrical || null,
        heatingSystem: heatingOther ? [...heatingSystem, heatingOther] : heatingSystem,
        basement,
        waterSource,
        septic,
        recommendations,
        referralNote: referralNote || null,
        leadType,
        clientSource,
        referralOwedTo,
        referralPct,
      });
      clearDraft();
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
        <button
          type="button"
          onClick={() => {
            clearDraft();
            onCancel();
          }}
        >
          Cancel
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}
      {draft && (
        <div className="view-as-banner">
          Restored your unsaved draft from last time — nothing was lost.
        </div>
      )}

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
        Seller Email(s)
        <EmailListInput values={sellerEmails} onChange={setSellerEmails} />
      </label>
      <fieldset>
        <legend>Lead Type</legend>
        <p className="field-help">
          Did the brokerage provide this lead, or did you bring it organically? Not related to
          referrals or client source.
        </p>
        <RadioGroup name="leadType" value={leadType} onChange={setLeadType} options={["Organic", "Provided"]} />
      </fieldset>

      <label>
        Client Source
        <select value={clientSource} onChange={(e) => setClientSource(e.target.value)}>
          {CLIENT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      {clientSource === "Referral" && (
        <>
          <label>
            Who is the referral owed to?
            <input value={referralOwedTo} onChange={(e) => setReferralOwedTo(e.target.value)} />
          </label>
          <fieldset>
            <legend>Referral % owed</legend>
            <RadioGroup
              name="referralPctChoice"
              value={referralPctChoice}
              onChange={handleReferralPctChoice}
              options={[
                { value: "25", label: "25%" },
                { value: "30", label: "30%" },
                { value: "Other", label: "Other" },
              ]}
            />
            {referralPctChoice === "Other" && (
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="Referral %, e.g. 20"
                value={referralPct}
                onChange={(e) => {
                  setReferralPct(e.target.value);
                  setReferralPctAutoAdjusted(false);
                }}
                onBlur={handleReferralPctBlur}
              />
            )}
            {referralPctAutoAdjusted && (
              <span className="field-note">
                Adjusted to {referralPct}% — enter referral % as a plain number like 25, not 0.25.
              </span>
            )}
          </fieldset>
        </>
      )}

      <label>
        Referral / Lead Notes <span className="field-help">(internal — never appears on the generated comp)</span>
        <input
          value={referralNote}
          onChange={(e) => setReferralNote(e.target.value)}
          placeholder="Any extra context, e.g. how the referral came about"
        />
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
