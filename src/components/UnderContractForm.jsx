import { useEffect, useState } from "react";
import { fetchAgents, fetchAttorneys, addAttorney, submitUnderContract } from "../lib/transactions";

const CLIENT_SOURCES = [
  "Prior Client/Sphere",
  "Zillow",
  "Postcard/Mailer",
  "Random Direct Contact",
  "Website/Floorday",
  "Referral",
];

const OWNER_NAMES = ["Fran Collins", "Holly Hall"];

async function resolveAttorneyId(name, tbd, attorneys) {
  if (tbd || !name.trim()) return null;
  const match = attorneys.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  if (match) return match.id;
  const created = await addAttorney(name.trim());
  return created.id;
}

const isBroker = (agent) => agent.role === "broker";

export default function UnderContractForm({ currentAgent, onCancel, onSubmitted }) {
  const [agents, setAgents] = useState([]);
  const [attorneys, setAttorneys] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [region, setRegion] = useState("VT");
  const [selectedAgentId, setSelectedAgentId] = useState(currentAgent.id);
  const [side, setSide] = useState("Sell");
  const [leadType, setLeadType] = useState("Organic");
  const [sellerName, setSellerName] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [address, setAddress] = useState("");
  const [propertyStyle, setPropertyStyle] = useState("Residential");
  const [price, setPrice] = useState("");
  const [buyerAttorney, setBuyerAttorney] = useState("");
  const [buyerAttorneyTbd, setBuyerAttorneyTbd] = useState(false);
  const [sellerAttorney, setSellerAttorney] = useState("");
  const [sellerAttorneyTbd, setSellerAttorneyTbd] = useState(false);
  const [commissionPct, setCommissionPct] = useState("");
  const [commissionAutoAdjusted, setCommissionAutoAdjusted] = useState(false);
  const [closingDate, setClosingDate] = useState("");
  const [inspectionDate, setInspectionDate] = useState("");
  const [financingDate, setFinancingDate] = useState("");
  const [appraiser, setAppraiser] = useState("TBD");
  const [appraiserOther, setAppraiserOther] = useState("");
  const [holdDeposit, setHoldDeposit] = useState("No");
  const [depositAmount, setDepositAmount] = useState("");
  const [secondDeposit, setSecondDeposit] = useState("No");
  const [secondDepositAmount, setSecondDepositAmount] = useState("");
  const [secondDepositDueDate, setSecondDepositDueDate] = useState("");
  const [clientSource, setClientSource] = useState(CLIENT_SOURCES[0]);
  const [referralOwedTo, setReferralOwedTo] = useState("");
  const [referralPct, setReferralPct] = useState("");

  useEffect(() => {
    fetchAttorneys().then(setAttorneys).catch((e) => setError(e.message));
    if (isBroker(currentAgent)) {
      fetchAgents().then(setAgents).catch((e) => setError(e.message));
    }
  }, []);

  const selectedAgentName = isBroker(currentAgent)
    ? agents.find((a) => a.id === selectedAgentId)?.name
    : currentAgent.name;
  const isOwnerAgent = OWNER_NAMES.includes(selectedAgentName);

  useEffect(() => {
    if (!isOwnerAgent && side === "Split") setSide("Sell");
  }, [isOwnerAgent, side]);

  function handleCommissionBlur() {
    const parsed = parseFloat(commissionPct);
    // Commission is always entered as a plain percentage number (e.g. 3, not .03 or 3%).
    // A value under 1 almost certainly means someone typed the decimal form by mistake.
    if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
      setCommissionPct(String(Math.round(parsed * 100 * 100) / 100));
      setCommissionAutoAdjusted(true);
    } else {
      setCommissionAutoAdjusted(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const [buyerAttorneyId, sellerAttorneyId] = await Promise.all([
        resolveAttorneyId(buyerAttorney, buyerAttorneyTbd, attorneys),
        resolveAttorneyId(sellerAttorney, sellerAttorneyTbd, attorneys),
      ]);

      await submitUnderContract({
        region,
        agentId: selectedAgentId,
        side,
        leadType,
        sellerName,
        buyerName,
        address,
        propertyStyle,
        price: price ? Number(price) : null,
        buyerAttorneyId,
        sellerAttorneyId,
        commissionPct: commissionPct ? Number(commissionPct) : null,
        closingDate: closingDate || null,
        inspectionDate: inspectionDate || null,
        financingDate: financingDate || null,
        appraiser: appraiser === "Other" ? appraiserOther : "TBD",
        holdDeposit,
        depositAmount: holdDeposit === "Yes" && depositAmount ? Number(depositAmount) : null,
        secondDeposit,
        secondDepositAmount: secondDeposit === "Yes" && secondDepositAmount ? Number(secondDepositAmount) : null,
        secondDepositDueDate: secondDeposit === "Yes" && secondDepositDueDate ? secondDepositDueDate : null,
        clientSource,
        referralOwedTo: clientSource === "Referral" ? referralOwedTo : null,
        referralPct: clientSource === "Referral" && referralPct ? Number(referralPct) : null,
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
          <h1>Under Contract</h1>
        </div>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <fieldset>
        <legend>VT or NH</legend>
        <RadioGroup name="region" value={region} onChange={setRegion} options={["VT", "NH"]} />
      </fieldset>

      {isBroker(currentAgent) ? (
        <fieldset>
          <legend>Agent</legend>
          <RadioGroup
            name="agent"
            value={selectedAgentId}
            onChange={setSelectedAgentId}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        </fieldset>
      ) : (
        <div className="uc-agent-display">
          Agent <strong>{currentAgent.name}</strong>
        </div>
      )}

      <fieldset>
        <legend>Which Side?</legend>
        <RadioGroup
          name="side"
          value={side}
          onChange={setSide}
          options={[
            { value: "Sell", label: "Seller" },
            { value: "Buy", label: "Buyer" },
            ...(isOwnerAgent ? [{ value: "Split", label: "Split" }] : []),
          ]}
        />
      </fieldset>

      <fieldset>
        <legend>Lead Type</legend>
        <p className="field-help">
          Did the brokerage provide this lead, or did you bring it organically? Not related to
          referrals or client source.
        </p>
        <RadioGroup name="leadType" value={leadType} onChange={setLeadType} options={["Organic", "Provided"]} />
      </fieldset>

      <label>
        Seller Name
        <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      </label>
      <label>
        Buyer Name
        <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
      </label>
      <label>
        Address
        <input value={address} onChange={(e) => setAddress(e.target.value)} required />
      </label>

      <fieldset>
        <legend>Property Style</legend>
        <RadioGroup
          name="propertyStyle"
          value={propertyStyle}
          onChange={setPropertyStyle}
          options={["Residential", "Land", "Commercial"]}
        />
      </fieldset>

      <label>
        Price
        <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>

      <AttorneyField
        label="Buyer Attorney"
        name={buyerAttorney}
        onNameChange={setBuyerAttorney}
        tbd={buyerAttorneyTbd}
        onTbdChange={setBuyerAttorneyTbd}
        attorneys={attorneys}
      />
      <AttorneyField
        label="Seller Attorney"
        name={sellerAttorney}
        onNameChange={setSellerAttorney}
        tbd={sellerAttorneyTbd}
        onTbdChange={setSellerAttorneyTbd}
        attorneys={attorneys}
      />

      <label>
        Commission % (plain number, e.g. 2.5 — not .025 or "2.5%")
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={commissionPct}
          onChange={(e) => {
            setCommissionPct(e.target.value);
            setCommissionAutoAdjusted(false);
          }}
          onBlur={handleCommissionBlur}
        />
        {commissionAutoAdjusted && (
          <span className="field-note">
            Adjusted to {commissionPct}% — enter commission as a plain number like 3, not 0.03.
          </span>
        )}
      </label>

      <label>
        Closing Date
        <input type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value)} />
      </label>
      <label>
        Inspection Deadline
        <input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
      </label>
      <label>
        Financing Date
        <input type="date" value={financingDate} onChange={(e) => setFinancingDate(e.target.value)} />
      </label>

      <fieldset>
        <legend>Appraiser</legend>
        <RadioGroup name="appraiser" value={appraiser} onChange={setAppraiser} options={["TBD", "Other"]} />
        {appraiser === "Other" && (
          <input
            placeholder="Appraiser name"
            value={appraiserOther}
            onChange={(e) => setAppraiserOther(e.target.value)}
          />
        )}
      </fieldset>

      <fieldset>
        <legend>Will we hold the deposit?</legend>
        <RadioGroup name="holdDeposit" value={holdDeposit} onChange={setHoldDeposit} options={["Yes", "No"]} />
        {holdDeposit === "Yes" && (
          <input
            type="number"
            placeholder="Deposit amount"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
          />
        )}
      </fieldset>

      <fieldset>
        <legend>Will there be a second deposit?</legend>
        <RadioGroup name="secondDeposit" value={secondDeposit} onChange={setSecondDeposit} options={["Yes", "No"]} />
        {secondDeposit === "Yes" && (
          <>
            <input
              type="number"
              placeholder="Second deposit amount"
              value={secondDepositAmount}
              onChange={(e) => setSecondDepositAmount(e.target.value)}
            />
            <label className="uc-inline-label">
              Second Deposit Due Date
              <input
                type="date"
                value={secondDepositDueDate}
                onChange={(e) => setSecondDepositDueDate(e.target.value)}
              />
            </label>
          </>
        )}
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
          <label>
            Referral % owed
            <input type="number" step="0.01" value={referralPct} onChange={(e) => setReferralPct(e.target.value)} />
          </label>
        </>
      )}

      <button type="submit" className="google-btn uc-submit" disabled={saving}>
        {saving ? "Saving…" : "Submit"}
      </button>
    </form>
  );
}

function RadioGroup({ name, value, onChange, options }) {
  const normalized = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="radio-group">
      {normalized.map((o) => (
        <label key={o.value} className="radio-option">
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function AttorneyField({ label, name, onNameChange, tbd, onTbdChange, attorneys }) {
  const listId = `attorneys-${label.replace(/\s+/g, "-")}`;
  return (
    <label>
      {label}
      <input
        list={listId}
        value={name}
        disabled={tbd}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Start typing to search or add new…"
      />
      <datalist id={listId}>
        {attorneys.map((a) => (
          <option key={a.id} value={a.name} />
        ))}
      </datalist>
      <span className="tbd-toggle">
        <input
          type="checkbox"
          checked={tbd}
          onChange={(e) => {
            onTbdChange(e.target.checked);
            if (e.target.checked) onNameChange("");
          }}
        />
        TBD
      </span>
    </label>
  );
}
