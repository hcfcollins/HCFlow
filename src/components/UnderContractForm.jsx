import { useEffect, useRef, useState } from "react";
import { fetchAttorneys, submitUnderContract, resolveAttorneyId as resolveAttorneyIdRaw, BUYER_START_DOCS, uploadBuyerStartDocs } from "../lib/transactions";
import RadioGroup from "./RadioGroup";
import NextStepsEmail from "./NextStepsEmail";
import AgentField from "./AgentField";
import { loadDraft, useDraftPersistence } from "../lib/useDraftPersistence";
import { TC_FEE_AMOUNTS, suggestTcFee } from "../lib/commissionCalc";
import { focusNextOnEnter } from "../lib/formKeyNav";
import { useToast } from "../lib/ToastContext";

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
  const showToast = useToast();
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
  // The transaction coordinator never owns a deal herself, so she starts with
  // no agent picked rather than defaulting to her own id.
  const defaultsToSelf = currentAgent.role !== "coordinator";
  const [selectedAgentId, setSelectedAgentId] = useState(initialData?.agent_id || draft?.selectedAgentId || (defaultsToSelf ? currentAgent.id : null));
  const [selectedAgentName, setSelectedAgentName] = useState(initialData?.agent?.name || draft?.selectedAgentName || (defaultsToSelf ? currentAgent.name : null));
  const [side, setSide] = useState(initialData?.side || draft?.side || "Sell");
  // Buyer deals: start their Dropbox folder? + the paperwork to put in it.
  const hasFolder = Boolean(initialData?.dropbox_folder_url || initialData?.dropbox_folder_path);
  const [startFolder, setStartFolder] = useState("yes");
  const [buyerFiles, setBuyerFiles] = useState({});
  const [clientEmailsText, setClientEmailsText] = useState((initialData?.seller_emails || []).join(", ") || draft?.clientEmailsText || "");
  const [nextSteps, setNextSteps] = useState(null); // after submit (buyer): offer the Next Steps email
  // On a Split deal, which side are *your* clients on — decides whether it's
  // grouped under Sellers or Buyers on the Under Contract page.
  const [splitClientSide, setSplitClientSide] = useState(initialData?.split_client_side || draft?.splitClientSide || "");
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
  const [depositDueDate, setDepositDueDate] = useState(initialData?.commission_data?.deposit_due_date || draft?.depositDueDate || "");
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
  // Picked automatically from the answers above until someone changes it.
  const [tcFeeTouched, setTcFeeTouched] = useState(Boolean(draft?.tcFeeTouched));
  const [buyerUnrepresented, setBuyerUnrepresented] = useState(draft?.buyerUnrepresented || "");
  const suggestedTcFee = suggestTcFee({
    agentName: selectedAgentName,
    side,
    splitClientSide,
    propertyStyle,
    buyerUnrepresented: buyerUnrepresented === "yes",
  });
  useEffect(() => {
    if (!tcFeeTouched) setTcFeeType(suggestedTcFee);
  }, [suggestedTcFee, tcFeeTouched]);
  const [townWaterSewer, setTownWaterSewer] = useState(initialData?.town_water_sewer ?? draft?.townWaterSewer ?? false);

  const { clearDraft } = useDraftPersistence(draftKey, {
    region, selectedAgentId, selectedAgentName, side, splitClientSide, leadType, sellerName, buyerName, address,
    propertyStyle, price, buyerAttorney, buyerAttorneyTbd, sellerAttorney, sellerAttorneyTbd,
    commissionPct, closingDate, inspectionDate, financingDate, appraiser, appraiserOther,
    holdDeposit, depositAmount, depositDueDate, secondDeposit, secondDepositAmount, secondDepositDueDate, tcFeeType,
    clientSource, referralOwedTo, referralPctChoice, referralPct, townWaterSewer, tcFeeTouched, buyerUnrepresented, clientEmailsText,
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
    if (!selectedAgentId) {
      setError("Pick which agent this deal belongs to.");
      return;
    }
    if (side === "Split" && !splitClientSide) {
      setError("On a Split deal, pick whether your clients are the buyers or the sellers.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const [buyerAttorneyId, sellerAttorneyId] = await Promise.all([
        resolveAttorneyId(buyerAttorney, buyerAttorneyTbd, attorneys),
        resolveAttorneyId(sellerAttorney, sellerAttorneyTbd, attorneys),
      ]);

      const submitted = await submitUnderContract({
        region,
        agentId: selectedAgentId,
        side,
        splitClientSide: side === "Split" ? splitClientSide : null,
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
        // Asked on every deal (for the buyer's Next Steps email); only a deposit
        // we hold goes to Xero / trust reminders (submitUnderContract checks holdDeposit).
        depositAmount: depositAmount ? Number(depositAmount) : null,
        depositDueDate: depositDueDate || null,
        secondDeposit,
        secondDepositAmount: secondDeposit === "Yes" && secondDepositAmount ? Number(secondDepositAmount) : null,
        secondDepositDueDate: secondDeposit === "Yes" && secondDepositDueDate ? secondDepositDueDate : null,
        clientSource,
        referralOwedTo: clientSource === "Referral" ? referralOwedTo : null,
        referralPct: clientSource === "Referral" && referralPct ? Number(referralPct) : null,
        tcFeeType: tcFeeType || null,
        townWaterSewer: side !== "Buy" ? townWaterSewer : null,
        existingId: initialData?.id || null,
        clientEmails: clientEmailsText.split(/[,;\s]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
        createBuyerFolder: side === "Buy" ? hasFolder || startFolder === "yes" : undefined,
      });

      // The buyer's paperwork → their Dropbox folder.
      if (side === "Buy" && Object.keys(buyerFiles).length) {
        if (submitted.dropbox_folder_url || submitted.dropbox_folder_path) {
          const { saved, failed } = await uploadBuyerStartDocs(submitted, buyerFiles);
          if (saved.length) showToast(`Saved to Dropbox: ${saved.join(", ")}`);
          for (const f of failed) showToast(`Couldn't save ${f.label}: ${f.message}`);
        } else {
          showToast("The documents weren't saved — this deal has no Dropbox folder yet. Add them from the deal page once it has one.");
        }
      }

      if (submitted._otherSide) {
        showToast(`Linked as an in-house deal with ${submitted._otherSide.agentName || "the other agent"}'s side — each side closes out separately`);
      }
      if (submitted._xeroWarning) showToast(submitted._xeroWarning);
      if (submitted._dropboxWarning) showToast(submitted._dropboxWarning);
      if (submitted._emailWarning) showToast(submitted._emailWarning);
      clearDraft();
      const clientBuys = side === "Buy" || (side === "Split" && splitClientSide === "Buy");
      if (clientBuys) {
        setNextSteps({
          transaction: submitted,
          agentName: selectedAgentName,
          defaults: {
            depositAmount: depositAmount || "",
            depositDate: depositDueDate || "",
            secondDepositAmount: secondDeposit === "Yes" ? secondDepositAmount || "" : "",
            secondDepositDate: secondDeposit === "Yes" ? secondDepositDueDate || "" : "",
            inspectionDate: inspectionDate || "",
            financingDate: financingDate || "",
            closingDate: closingDate || "",
          },
        });
        return;
      }
      onSubmitted();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (nextSteps) {
    return <NextStepsEmail transaction={nextSteps.transaction} defaults={nextSteps.defaults} agentName={nextSteps.agentName} onClose={() => onSubmitted()} />;
  }

  return (
    <form className="uc-form" onSubmit={handleSubmit} onKeyDown={focusNextOnEnter}>
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">{initialData ? "Moving to Under Contract" : "New Deal"}</div>
          <h1>Under Contract</h1>
        </div>
        <button title="Close without saving"
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

      {side === "Buy" && (
        <fieldset className="buyer-start">
          {!hasFolder && (
            <>
              <legend>Start a Dropbox folder for this buyer?</legend>
              <RadioGroup
                name="startFolder"
                value={startFolder}
                onChange={setStartFolder}
                options={[
                  { value: "yes", label: "Yes, start one" },
                  { value: "no", label: "No, I'll pair an existing folder" },
                ]}
              />
            </>
          )}
          {hasFolder || startFolder === "yes" ? (
            <>
              <p className="field-help">
                {hasFolder ? "Add the buyer's paperwork to their Dropbox folder" : "Add the buyer's paperwork to the new folder"} (optional; you can add these later too). Each is saved as “{(address || "Street").split(",")[0].trim()} - …”.
              </p>
              <div className="buyer-start-docs">
                {BUYER_START_DOCS.map((d) => (
                  <BuyerDocSlot
                    key={d.key}
                    label={d.label}
                    file={buyerFiles[d.key]}
                    onFile={(f) => setBuyerFiles((cur) => {
                      const next = { ...cur };
                      if (f) next[d.key] = f;
                      else delete next[d.key];
                      return next;
                    })}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="field-help">After submitting, open the deal and use “Pair Existing Folder” to connect their folder, then add the paperwork there.</p>
          )}
        </fieldset>
      )}

      {side === "Split" && (
        <fieldset>
          <legend>Are your clients the buyers or the sellers?</legend>
          <p className="field-help">Decides whether this deal is grouped under Sellers or Buyers on the Under Contract page.</p>
          <RadioGroup
            name="splitClientSide"
            value={splitClientSide}
            onChange={setSplitClientSide}
            options={[
              { value: "Sell", label: "Sellers" },
              { value: "Buy", label: "Buyers" },
            ]}
          />
        </fieldset>
      )}

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
        {side === "Buy" || (side === "Split" && splitClientSide === "Buy") ? "Buyer Email(s)" : side === "Split" && !splitClientSide ? "Client Email(s)" : "Seller Email(s)"}
        <input
          type="text"
          inputMode="email"
          value={clientEmailsText}
          onChange={(e) => setClientEmailsText(e.target.value)}
          placeholder="client@email.com, second client…"
        />
        <span className="field-help">Our client's email — used for the Next Steps email and closing documents. Separate two with a comma.</span>
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
      {side !== "Buy" && (
        <label className="tbd-toggle">
          <input type="checkbox" checked={townWaterSewer} onChange={(e) => setTownWaterSewer(e.target.checked)} />
          Town Water / Town Sewer <span className="field-help">(final reading needs to be ordered 2 weeks out instead of 1)</span>
        </label>
      )}

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
        <legend>Earnest Money Deposit</legend>
        <input
          type="number"
          placeholder="Deposit amount"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
        />
        <label className="uc-inline-label">
          Deposit Due Date
          <input type="date" value={depositDueDate} onChange={(e) => setDepositDueDate(e.target.value)} />
        </label>
        <div className="uc-subq">Will we hold the deposit?</div>
        <RadioGroup name="holdDeposit" value={holdDeposit} onChange={setHoldDeposit} options={["Yes", "No"]} />
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

      {selectedAgentName === "Holly Hall" && side === "Sell" && propertyStyle !== "Land" && (
        <fieldset>
          <legend>Does the buyer have their own agent?</legend>
          <RadioGroup
            name="buyerUnrepresented"
            value={buyerUnrepresented}
            onChange={setBuyerUnrepresented}
            options={[
              { value: "no", label: "Yes, the buyer has an agent" },
              { value: "yes", label: "No, the buyer is unrepresented" },
            ]}
          />
        </fieldset>
      )}

      <label>
        Transaction Coordinator Fee{" "}
        <span className="field-help">
          (filled in automatically: Compliance for every agent; Holly's files get the full fee for the deal type. Change it if needed.)
        </span>
        <select
          value={tcFeeType}
          onChange={(e) => {
            setTcFeeTouched(true);
            setTcFeeType(e.target.value);
          }}
        >
          <option value="">None</option>
          {Object.entries(TC_FEE_AMOUNTS).map(([type, amount]) => (
            <option key={type} value={type}>
              {type} (${amount})
            </option>
          ))}
        </select>
      </label>

      <button title="Save this deal as Under Contract" type="submit" className="google-btn uc-submit" disabled={saving}>
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

/** One drop/choose slot for a buyer document (kept until Submit). */
function BuyerDocSlot({ label, file, onFile }) {
  const [over, setOver] = useState(false);
  const pick = (list) => {
    const f = [...(list || [])][0];
    if (f) onFile(f);
  };
  return (
    <label
      className={`buyer-doc-slot ${file ? "buyer-doc-slot--set" : ""} ${over ? "check-dropzone--over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
    >
      <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => pick(e.target.files)} />
      <span className="buyer-doc-label">{file ? "✓ " : ""}{label}</span>
      <span className="field-help buyer-doc-file">{file ? file.name : "Drop or tap to choose"}</span>
      {file && (
        <button
          type="button"
          className="license-mini-btn"
          onClick={(e) => {
            e.preventDefault();
            onFile(null);
          }}
          aria-label={`Remove ${label}`}
        >
          Remove
        </button>
      )}
    </label>
  );
}
