import { useEffect, useRef, useState } from "react";
import { fetchAttorneys, submitUnderContract, resolveAttorneyId as resolveAttorneyIdRaw } from "../lib/transactions";
import RadioGroup from "./RadioGroup";
import AgentField from "./AgentField";
import { loadDraft, useDraftPersistence } from "../lib/useDraftPersistence";
import { TC_FEE_AMOUNTS } from "../lib/commissionCalc";

export const CLIENT_SOURCES = [
  "Prior Client/Sphere",
  "Zillow",
  "Postcard/Mailer",
  "Random Direct Contact",
  "Website/Floorday",
  "Referral",
];

const OWNER_NAMES = ["Fran Collins", "Holly Hall"];

// Percentage fields are always entered as plain numbers (e.g. 3, not .03 or 3%).
// A value under 1 almost certainly means someone typed the decimal form by mistake.
export function correctPercentInput(value) {
  const parsed = parseFloat(value);
  if (!isNaN(parsed) && parsed > 0 && parsed < 1) {
    return String(Math.round(parsed * 100 * 100) / 100);
  }
  return null;
}

function resolveAttorneyId(name, tbd, attorneys) {
  if (tbd) return null;
  return resolveAttorneyIdRaw(name, attorneys);
}

export default function UnderContractForm({ currentAgent, initialData, onCancel, onSubmitted }) {
  // Scoped per existing deal (so an interruption mid-fill reloads correctly next
  // time for that specific deal) or to a shared "new" bucket for a blank entry
  // not tied to an existing record. initialData's real values always win over a
  // stray draft — the draft only fills in whatever isn't already known.
  const draftKey = `under-contract:${initialData?.id || "new"}`;
  const draft = useRef(loadDraft(draftKey)).current;

  const [attorneys, setAttorneys] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [region, setRegion] = useState(initialData?.region || draft?.region || "VT");
  const [selectedAgentId, setSelectedAgentId] = useState(initialData?.agent_id || draft?.selectedAgentId || currentAgent.id);
  const [selectedAgentName, setSelectedAgentName] = useState(initialData?.agent?.name || draft?.selectedAgentName || currentAgent.name);
  const [side, setSide] = useState(initialData?.side || draft?.side || "Sell");
  const [leadType, setLeadType] = useState(initialData?.commission_data?.lead_type || draft?.leadType || "Organic");
  const [sellerName, setSellerName] = useState(initialData?.seller_name || draft?.sellerName || "");
  const [buyerName, setBuyerName] = useState(initialData?.buyer_name || draft?.buyerName || "");
  const [address, setAddress] = useState(initialData?.address || draft?.address || "");
  const [propertyStyle, setPropertyStyle] = useState(initialData?.property_style || draft?.propertyStyle || "Residential");
  const [price, setPrice] = useState(initialData?.price != null ? String(initialData.price) : draft?.price || "");
  const [buyerAttorney, setBuyerAttorney] = useState(initialData?.buyer_attorney?.name || draft?.buyerAttorney || "");
  const [buyerAttorneyTbd, setBuyerAttorneyTbd] = useState(draft?.buyerAttorneyTbd || false);
  const [sellerAttorney, setSellerAttorney] = useState(initialData?.seller_attorney?.name || draft?.sellerAttorney || "");
  const [sellerAttorneyTbd, setSellerAttorneyTbd] = useState(draft?.sellerAttorneyTbd || false);
  const [commissionPct, setCommissionPct] = useState(draft?.commissionPct || "");
  const [commissionAutoAdjusted, setCommissionAutoAdjusted] = useState(false);
  const [closingDate, setClosingDate] = useState(draft?.closingDate || "");
  const [inspectionDate, setInspectionDate] = useState(draft?.inspectionDate || "");
  const [financingDate, setFinancingDate] = useState(draft?.financingDate || "");
  const [appraiser, setAppraiser] = useState(draft?.appraiser || "TBD");
  const [appraiserOther, setAppraiserOther] = useState(draft?.appraiserOther || "");
  const [holdDeposit, setHoldDeposit] = useState(draft?.holdDeposit || "No");
  const [depositAmount, setDepositAmount] = useState(draft?.depositAmount || "");
  const [secondDeposit, setSecondDeposit] = useState(draft?.secondDeposit || "No");
  const [secondDepositAmount, setSecondDepositAmount] = useState(draft?.secondDepositAmount || "");
  const [secondDepositDueDate, setSecondDepositDueDate] = useState(draft?.secondDepositDueDate || "");
  const [clientSource, setClientSource] = useState(initialData?.commission_data?.client_source || draft?.clientSource || CLIENT_SOURCES[0]);
  const [referralOwedTo, setReferralOwedTo] = useState(initialData?.commission_data?.referral_owed_to || draft?.referralOwedTo || "");
  const initialReferralPct = initialData?.commission_data?.referral_pct;
  const [referralPctChoice, setReferralPctChoice] = useState(
    initialReferralPct == null
      ? draft?.referralPctChoice || "25"
      : ["25", "30"].includes(String(initialReferralPct))
      ? String(initialReferralPct)
      : "Other"
  );
  const [referralPct, setReferralPct] = useState(initialReferralPct != null ? String(initialReferralPct) : draft?.referralPct || "25");
  const [referralPctAutoAdjusted, setReferralPctAutoAdjusted] = useState(false);
  const [tcFeeType, setTcFeeType] = useState(initialData?.commission_data?.tc_fee_type || draft?.tcFeeType || "");

  const { clearDraft } = useDraftPersistence(draftKey, {
    region, selectedAgentId, selectedAgentName, side, leadType, sellerName, buyerName, address,
    propertyStyle, price, buyerAttorney, buyerAttorneyTbd, sellerAttorney, sellerAttorneyTbd,
    commissionPct, closingDate, inspectionDate, financingDate, appraiser, appraiserOther,
    holdDeposit, depositAmount, secondDeposit, secondDepositAmount, secondDepositDueDate, tcFeeType,
    clientSource, referralOwedTo, referralPctChoice, referralPct,
  });

  useEffect(() => {
    fetchAttorneys().then(setAttorneys).catch((e) => setError(e.message));
  }, []);

  const isOwnerAgent = OWNER_NAMES.includes(selectedAgentName);

  useEffect(() => {
    if (!isOwnerAgent && side === "Split") setSide("Sell");
  }, [isOwnerAgent, side]);

  function handleCommissionBlur() {
    const corrected = correctPercentInput(commissionPct);
    if (corrected) {
      setCommissionPct(corrected);
      setCommissionAutoAdjusted(true);
    } else {
      setCommissionAutoAdjusted(false);
    }
  }

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
        tcFeeType: tcFeeType || null,
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
          <div className="brand-eyebrow">{initialData ? "Moving to Under Contract" : "New Deal"}</div>
          <h1>Under Contract</h1>
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
      {draft && (
        <div className="view-as-banner">
          Restored your unsaved draft from last time — nothing was lost.
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <fieldset>
        <legend>VT or NH</legend>
        <RadioGroup name="region" value={region} onChange={setRegion} options={["VT", "NH"]} />
      </fieldset>

      <AgentField
        currentAgent={currentAgent}
        value={selectedAgentId}
        onChange={(id, name) => {
          setSelectedAgentId(id);
          setSelectedAgentName(name);
        }}
      />

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
        Transaction Coordinator Fee{" "}
        <span className="field-help">(your judgment call — picks which flat fee applies, comes out of the brokerage's cut)</span>
        <select value={tcFeeType} onChange={(e) => setTcFeeType(e.target.value)}>
          <option value="">None</option>
          {Object.entries(TC_FEE_AMOUNTS).map(([type, amount]) => (
            <option key={type} value={type}>
              {type} (${amount})
            </option>
          ))}
        </select>
      </label>

      <button type="submit" className="google-btn uc-submit" disabled={saving}>
        {saving ? "Saving…" : "Submit"}
      </button>
    </form>
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
