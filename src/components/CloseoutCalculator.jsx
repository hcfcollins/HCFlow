import { useState } from "react";
import RadioGroup from "./RadioGroup";
import { saveCloseout } from "../lib/transactions";
import { calculateCloseout } from "../lib/commissionCalc";

const LEAD_TYPES = ["Organic", "Provided"];

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CloseoutCalculator({ transaction, onCancel, onSaved }) {
  const saved = transaction.closeouts || {};
  const [price, setPrice] = useState(saved.price ?? transaction.price ?? "");
  const [commissionPct, setCommissionPct] = useState(saved.commission_pct ?? "");
  const [referralPct, setReferralPct] = useState(saved.referral_pct ?? transaction.commission_data?.referral_pct ?? 0);
  const [leadType, setLeadType] = useState(saved.lead_type ?? transaction.commission_data?.lead_type ?? "Organic");
  const [agentSplitPct, setAgentSplitPct] = useState(saved.agent_split_pct ?? "");
  const [netOverride, setNetOverride] = useState(saved.net_override ?? false);
  const [netAmount, setNetAmount] = useState(saved.net_amount ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const priceNum = Number(price) || 0;
  const commissionPctNum = Number(commissionPct) || 0;
  const referralPctNum = Number(referralPct) || 0;
  const grossCommission = priceNum * (commissionPctNum / 100);
  const referralAmount = grossCommission * (referralPctNum / 100);
  const commissionAfterReferral = netOverride ? Number(netAmount) || 0 : grossCommission - referralAmount;

  const result = calculateCloseout({
    commissionAfterReferral,
    agentName: transaction.agent?.name,
    side: transaction.side,
    leadType,
    agentSplitPct: agentSplitPct !== "" ? Number(agentSplitPct) : null,
  });

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await saveCloseout(transaction.id, {
        price: priceNum,
        commission_pct: commissionPctNum,
        agent_split_pct: !result.isOwnerDeal && leadType === "Provided" ? Number(agentSplitPct) || 60 : null,
        lead_type: leadType,
        referral_pct: referralPctNum,
        net_override: netOverride,
        net_amount: netOverride ? Number(netAmount) || null : null,
        commission_after_referral: Math.round(commissionAfterReferral * 100) / 100,
        agent_commission: result.agentCommission,
        holly_commission: result.hollyCommission,
        fran_commission: result.franCommission,
        bank_amount: result.bankAmount,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="uc-form closeout-calculator">
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">{transaction.address}</div>
          <h1>Close-Out Calculator</h1>
        </div>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <fieldset>
        <legend>Deal Basics</legend>
        <label>
          Price ($)
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 400000" />
        </label>
        <label>
          Commission (%)
          <input type="number" step="0.1" value={commissionPct} onChange={(e) => setCommissionPct(e.target.value)} placeholder="e.g. 6" />
        </label>
        <label>
          Referral (%) <span className="field-help">(% of the gross commission owed to a referring agent, if any)</span>
          <input type="number" step="0.1" value={referralPct} onChange={(e) => setReferralPct(e.target.value)} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Based on Net Proceeds</legend>
        <label className="tbd-toggle">
          <input type="checkbox" checked={netOverride} onChange={(e) => setNetOverride(e.target.checked)} />
          This deal's commission was based on net proceeds, not the price/commission % above
        </label>
        {netOverride && (
          <label>
            Net Commission Amount ($)
            <input type="number" value={netAmount} onChange={(e) => setNetAmount(e.target.value)} placeholder="e.g. 9780" />
          </label>
        )}
      </fieldset>

      {!result.isOwnerDeal && (
        <fieldset>
          <legend>Lead Type</legend>
          <RadioGroup name="leadType" value={leadType} onChange={setLeadType} options={LEAD_TYPES} />
          {leadType === "Provided" && (
            <label>
              Agent Split (%) <span className="field-help">(defaults to 60% if left blank)</span>
              <input type="number" value={agentSplitPct} onChange={(e) => setAgentSplitPct(e.target.value)} placeholder="60" />
            </label>
          )}
        </fieldset>
      )}

      <fieldset className="closeout-preview">
        <legend>Preview</legend>
        <div className="closeout-preview-row">
          <span>Commission After Referral</span>
          <strong>{money(commissionAfterReferral)}</strong>
        </div>
        {result.isOwnerDeal ? (
          <>
            <div className="closeout-preview-row">
              <span>Holly's Cut</span>
              <strong>{money(result.hollyCommission)}</strong>
            </div>
            <div className="closeout-preview-row">
              <span>Fran's Cut</span>
              <strong>{money(result.franCommission)}</strong>
            </div>
          </>
        ) : (
          <>
            <div className="closeout-preview-row">
              <span>Agent Commission</span>
              <strong>{money(result.agentCommission)}</strong>
            </div>
            <div className="closeout-preview-row">
              <span>Holly's Cut</span>
              <strong>{money(result.hollyCommission)}</strong>
            </div>
            <div className="closeout-preview-row">
              <span>Fran's Cut</span>
              <strong>{money(result.franCommission)}</strong>
            </div>
            <div className="closeout-preview-row">
              <span>Bank Amount</span>
              <strong>{money(result.bankAmount)}</strong>
            </div>
          </>
        )}
      </fieldset>

      <div className="comp-edit-all-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="google-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save & Mark Closed"}
        </button>
      </div>
    </div>
  );
}
