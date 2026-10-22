import { useEffect, useState } from "react";
import RadioGroup from "./RadioGroup";
import { saveCloseout, fetchAllAgents, pushCloseoutToSheet, pushCloseoutToXero } from "../lib/transactions";
import { calculateCloseout, applyTcFee, TC_FEE_AMOUNTS, round2 } from "../lib/commissionCalc";
import { useToast } from "../lib/ToastContext";
import { focusNextOnEnter } from "../lib/formKeyNav";

const LEAD_TYPES = ["Organic", "Provided"];

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Gusto doesn't have a direct API for a single company yet (their embedded
 * payroll program is partner-only right now) — this just gets the exact text
 * for each payment onto the clipboard, ready to paste into Gusto's own manual
 * contractor payment form, instead of Fran retyping/recalculating it there. */
function GustoCopyRow({ payeeName, gustoContractorId, amount, memo, invoiceNumber }) {
  const showToast = useToast();
  if (!amount) return null;

  async function handleCopy() {
    const text = [`Amount: ${money(amount)}`, `Memo: ${memo}`, invoiceNumber ? `Invoice #: ${invoiceNumber}` : null]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied — paste into ${payeeName}'s Gusto payment`);
    } catch {
      showToast("Couldn't copy — your browser blocked clipboard access");
    }
  }

  return (
    <div className="closeout-preview-row">
      <span>
        {payeeName}
        {!gustoContractorId && <span className="field-note"> (no Gusto Contractor ID on file)</span>}
      </span>
      <button type="button" className="comps-minimize-btn" onClick={handleCopy}>
        Copy for Gusto
      </button>
    </div>
  );
}

export default function CloseoutCalculator({ transaction, onCancel, onSaved }) {
  const showToast = useToast();
  const saved = transaction.closeouts || {};
  const [price, setPrice] = useState(saved.price ?? transaction.price ?? "");
  const [commissionPct, setCommissionPct] = useState(saved.commission_pct ?? "");
  const [referralPct, setReferralPct] = useState(saved.referral_pct ?? transaction.commission_data?.referral_pct ?? 0);
  const [leadType, setLeadType] = useState(saved.lead_type ?? transaction.commission_data?.lead_type ?? "Organic");
  const [agentSplitPct, setAgentSplitPct] = useState(saved.agent_split_pct ?? "");
  const [netOverride, setNetOverride] = useState(saved.net_override ?? false);
  const [netAmount, setNetAmount] = useState(saved.net_amount ?? "");
  const [tcFeeType, setTcFeeType] = useState(saved.tc_fee_type ?? transaction.commission_data?.tc_fee_type ?? "");
  const originalAnticipated = saved.anticipated_commission ?? "";
  const [anticipatedCommission, setAnticipatedCommission] = useState(originalAnticipated);
  const [anticipatedNote, setAnticipatedNote] = useState(saved.anticipated_commission_note ?? "");
  const [depositRetained, setDepositRetained] = useState(saved.deposit_retained ?? false);
  const [trustToCheckingTransferred, setTrustToCheckingTransferred] = useState(saved.trust_to_checking_transferred ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [allAgents, setAllAgents] = useState([]);

  useEffect(() => {
    fetchAllAgents().then(setAllAgents).catch(() => {});
  }, []);

  const hollyAgent = allAgents.find((a) => a.name === "Holly Hall");
  const franAgent = allAgents.find((a) => a.name === "Fran Collins");
  const coordinatorAgent = allAgents.find((a) => a.role === "coordinator");

  const anticipatedChanged = String(anticipatedCommission) !== String(originalAnticipated);

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
  // Comes out of the brokerage's own cut, not the agent/Holly/Fran split.
  const tcFeeAmount = TC_FEE_AMOUNTS[tcFeeType] || 0;
  const finalBankAmount = applyTcFee(result.bankAmount, tcFeeType);
  // Summed from the actual displayed line items (not re-derived from the input
  // formula) so it's a genuine check against the math below, not just a copy of
  // commissionAfterReferral minus the TC fee.
  const totalToDistribute = round2((result.agentCommission || 0) + result.hollyCommission + result.franCommission + finalBankAmount);

  // Maps this calculator's numbers onto the "Deal Tracker Form" sheet's actual
  // columns (confirmed against the live Zap — see commit history), skipping
  // "Check Received" (Fran sets that herself once the check clears — that's
  // what fires the existing Xero automation) and the reminder-email trigger
  // columns (33-36) and Email Address (37), which some other, untouched
  // automation already owns. A few columns' exact meaning was a best guess
  // confirmed with Fran only loosely — flagged below — fix these the moment
  // real data shows them landing wrong:
  //   - real_percentage: assumed to be the effective rate after referral
  //     (commissionAfterReferral / price), not the raw entered commission %.
  //   - brokerage_split_pct: assumed to be the agent's split % (blank for
  //     owner deals, which don't use this concept the same way).
  //   - brokerage_keeps: sent BEFORE the TC fee deduction, since TC Fee has
  //     its own column — if the sheet expects it net of TC fee, swap to
  //     finalBankAmount instead.
  function buildSheetPayload() {
    const realPercentage = priceNum > 0 ? round2((commissionAfterReferral / priceNum) * 100) : commissionPctNum;
    const brokerageSplitPct = !result.isOwnerDeal && result.agentPct != null ? round2(result.agentPct * 100) : null;
    const leftoverForTeam = round2(commissionAfterReferral - result.bankAmount);
    const depositHeldAmount = transaction.commission_data?.hold_deposit === "Yes" ? transaction.commission_data.deposit_amount : null;

    return {
      closing_date: transaction.next_date || null,
      address: transaction.address,
      seller_attorney: transaction.seller_attorney?.name || null,
      buyer_attorney: transaction.buyer_attorney?.name || null,
      agent_name: transaction.agent?.name || null,
      which_side: transaction.side,
      lead_type: leadType,
      price: priceNum,
      commission_pct: commissionPctNum,
      real_percentage: realPercentage,
      total_commission_check: round2(grossCommission),
      brokerage_split_pct: brokerageSplitPct,
      referral_pct: referralPctNum,
      referral_amount: round2(referralAmount),
      commission_after_referral: round2(commissionAfterReferral),
      brokerage_keeps: result.bankAmount,
      leftover_for_team: leftoverForTeam,
      holly_commission: result.hollyCommission,
      fran_commission: result.franCommission,
      agent_commission: result.agentCommission,
      seller_name: transaction.seller_name || null,
      buyer_name: transaction.buyer_name || null,
      client_source: transaction.commission_data?.client_source || null,
      timestamp: new Date().toISOString(),
      notes: transaction.notes || null,
      inspection_deadline: transaction.commission_data?.inspection_date || null,
      financing_date: transaction.commission_data?.financing_date || null,
      appraiser: transaction.commission_data?.appraiser || null,
      deposit_held_amount: depositHeldAmount,
      property_style: transaction.property_style || null,
      vt_or_nh: transaction.region || null,
      tc_fee: tcFeeType ? tcFeeAmount : null,
      // For the per-payee Xero Bills: who each one is actually owed to (so the
      // Bill's Contact is the real payee, not the brokerage) and a ready-made
      // Reference string matching the exact text used by the Gusto copy
      // helper above, so the Bill and the Gusto payment read identically.
      referral_owed_to: transaction.commission_data?.referral_owed_to || null,
      tc_fee_payee_name: tcFeeType ? coordinatorAgent?.name || "Kerry Dawson" : null,
      commission_reference: `Commission - ${transaction.address}`,
      referral_reference: `Referral Fee - ${transaction.address}`,
      tc_fee_reference: `Transaction Coordinator Fee - ${transaction.address}`,
    };
  }

  async function handleSave() {
    if (anticipatedChanged && !anticipatedNote.trim()) {
      setError("You changed the Anticipated Commission amount — add a note explaining why before saving.");
      return;
    }
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
        bank_amount: finalBankAmount,
        tc_fee_type: tcFeeType || null,
        tc_fee_amount: tcFeeType ? tcFeeAmount : null,
        anticipated_commission: anticipatedCommission === "" ? null : Number(anticipatedCommission),
        anticipated_commission_note: anticipatedNote.trim() || null,
        deposit_retained: depositRetained,
        trust_to_checking_transferred: trustToCheckingTransferred,
      });
      showToast("Close-out saved — deal marked Closed");
      // Best-effort — the closeout itself is already saved and the deal is
      // already marked Closed above, so a failure here (Zap not wired up yet,
      // Zapier down, whatever) is surfaced but must never look like the save
      // failed or block moving on.
      const sheetPayload = buildSheetPayload();
      try {
        await pushCloseoutToSheet(sheetPayload);
        showToast("Sent to the Deal Tracker sheet");
      } catch (e) {
        showToast(`Saved, but couldn't send to the Deal Tracker sheet: ${e.message}`);
      }
      try {
        await pushCloseoutToXero(sheetPayload);
        showToast("Invoice and bills created in Xero");
      } catch (e) {
        showToast(`Saved, but couldn't push to Xero: ${e.message}`);
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="uc-form closeout-calculator" onKeyDown={focusNextOnEnter}>
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

      <label>
        Transaction Coordinator Fee <span className="field-help">(comes out of the brokerage's cut, below)</span>
        <select value={tcFeeType} onChange={(e) => setTcFeeType(e.target.value)}>
          <option value="">None</option>
          {Object.entries(TC_FEE_AMOUNTS).map(([type, amount]) => (
            <option key={type} value={type}>
              {type} (${amount})
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Anticipated Commission</legend>
        <label>
          Anticipated Commission ($) <span className="field-help">(what you expect this to actually pay out — separate from the calculated figures below)</span>
          <input type="number" value={anticipatedCommission} onChange={(e) => setAnticipatedCommission(e.target.value)} placeholder="e.g. 9500" />
        </label>
        {anticipatedChanged && (
          <label>
            Note <span className="field-help">(required — why did this change?)</span>
            <input value={anticipatedNote} onChange={(e) => setAnticipatedNote(e.target.value)} placeholder="e.g. price dropped at inspection" />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Deposit Reconciliation</legend>
        {transaction.commission_data?.hold_deposit === "Yes" ? (
          <p className="field-help">
            Recorded at Under Contract: {money(transaction.commission_data.deposit_amount)} held
            {transaction.commission_data?.second_deposit === "Yes" &&
              `, plus a second deposit of ${money(transaction.commission_data.second_deposit_amount)}`}
            .
          </p>
        ) : (
          <p className="field-help">No deposit was recorded as held at Under Contract.</p>
        )}
        <label className="tbd-toggle">
          <input type="checkbox" checked={depositRetained} onChange={(e) => setDepositRetained(e.target.checked)} />
          Deposit retained (not refunded to buyer)
        </label>
        <label className="tbd-toggle">
          <input
            type="checkbox"
            checked={trustToCheckingTransferred}
            onChange={(e) => setTrustToCheckingTransferred(e.target.checked)}
          />
          Transferred from trust account into checking
        </label>
      </fieldset>

      <fieldset className="closeout-preview">
        <legend>Preview</legend>
        <div className="closeout-preview-row">
          <span>Commission After Referral</span>
          <strong>{money(commissionAfterReferral)}</strong>
        </div>
        {!result.isOwnerDeal && (
          <div className="closeout-preview-row">
            <span>Agent Commission</span>
            <strong>{money(result.agentCommission)}</strong>
          </div>
        )}
        <div className="closeout-preview-row">
          <span>Holly's Commission</span>
          <strong>{money(result.hollyCommission)}</strong>
        </div>
        <div className="closeout-preview-row">
          <span>Fran's Commission</span>
          <strong>{money(result.franCommission)}</strong>
        </div>
        {tcFeeType && (
          <div className="closeout-preview-row">
            <span>Transaction Coordinator Fee ({tcFeeType})</span>
            <strong>−{money(tcFeeAmount)}</strong>
          </div>
        )}
        <div className="closeout-preview-row">
          <span>Brokerage Keeps</span>
          <strong>{money(finalBankAmount)}</strong>
        </div>
        <div className="closeout-preview-row closeout-preview-row--total">
          <span>Total to Distribute</span>
          <strong>{money(totalToDistribute)}</strong>
        </div>
      </fieldset>

      <fieldset>
        <legend>Gusto Payroll</legend>
        <p className="field-help">
          Direct push isn't possible yet (Gusto's API program is partner-only right now) — copy each payment's
          amount, memo, and invoice number here, then paste into Gusto's contractor payment form manually.
        </p>
        {!result.isOwnerDeal && (
          <GustoCopyRow
            payeeName={transaction.agent?.name || "Agent"}
            gustoContractorId={transaction.agent?.gusto_contractor_id}
            amount={result.agentCommission}
            memo={`Commission - ${transaction.address}`}
          />
        )}
        <GustoCopyRow
          payeeName="Holly Hall"
          gustoContractorId={hollyAgent?.gusto_contractor_id}
          amount={result.hollyCommission}
          memo={`Commission - ${transaction.address}`}
        />
        <GustoCopyRow
          payeeName="Fran Collins"
          gustoContractorId={franAgent?.gusto_contractor_id}
          amount={result.franCommission}
          memo={`Commission - ${transaction.address}`}
        />
        {tcFeeType && (
          <GustoCopyRow
            payeeName={coordinatorAgent?.name || "Transaction Coordinator"}
            gustoContractorId={coordinatorAgent?.gusto_contractor_id}
            amount={tcFeeAmount}
            memo={`Transaction Coordinator Fee - ${transaction.address}`}
            invoiceNumber={`TC - ${transaction.address}`.slice(0, 25)}
          />
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
