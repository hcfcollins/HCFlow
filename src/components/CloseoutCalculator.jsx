import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import RadioGroup from "./RadioGroup";
import {
  saveCloseout,
  fetchAllAgents,
  pushCloseoutToSheet,
  pushCloseoutToXero,
  sendCloseoutEmail,
  fetchSignInventory,
  incrementSignInventory,
} from "../lib/transactions";
import { calculateCloseout, applyTcFee, TC_FEE_AMOUNTS, round2 } from "../lib/commissionCalc";
import { useToast } from "../lib/ToastContext";
import { focusNextOnEnter } from "../lib/formKeyNav";

const LEAD_TYPES = ["Organic", "Provided"];

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Gusto's API isn't connectable yet (partner-only program, no self-serve
// access) — rather than a separate "Copy for Gusto" section with its own
// formatted text block, each Preview row below gets its own small copy
// button on the plain number itself, ready to paste wherever it's needed.
function CopyableRow({ label, amount, highlight }) {
  const showToast = useToast();

  async function handleCopy() {
    const raw = Number(amount || 0).toFixed(2);
    try {
      await navigator.clipboard.writeText(raw);
      showToast(`Copied ${money(amount)}`);
    } catch {
      showToast("Couldn't copy — your browser blocked clipboard access");
    }
  }

  return (
    <div className={highlight ? "closeout-preview-row closeout-preview-row--total" : "closeout-preview-row"}>
      <span>{label}</span>
      <span className="closeout-preview-value">
        <strong>{money(amount)}</strong>
        <button type="button" className="closeout-copy-btn" onClick={handleCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
          <Copy size={13} />
        </button>
      </span>
    </div>
  );
}

// Same idea as CopyableRow, but for the plain reference/memo text Gusto's
// payment form wants (not a dollar amount) — e.g. the Invoice # and Memo
// fields for a commission or TC fee payment.
function CopyableTextRow({ label, text }) {
  const showToast = useToast();

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied "${text}"`);
    } catch {
      showToast("Couldn't copy — your browser blocked clipboard access");
    }
  }

  return (
    <div className="closeout-preview-row">
      <span>{label}</span>
      <span className="closeout-preview-value">
        <span className="closeout-preview-text">{text}</span>
        <button type="button" className="closeout-copy-btn" onClick={handleCopy} aria-label={`Copy ${label}`} title={`Copy ${label}`}>
          <Copy size={13} />
        </button>
      </span>
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
  const [alreadyClosedExternally, setAlreadyClosedExternally] = useState(saved.is_historical_import ?? false);
  const [signReturned, setSignReturned] = useState(saved.sign_returned ?? false);
  const [signInventoryCount, setSignInventoryCount] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [allAgents, setAllAgents] = useState([]);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  const hasSign = transaction.side !== "Buy" && transaction.sign_status === "Yes";
  const showDepositSection = transaction.side !== "Buy" && transaction.commission_data?.hold_deposit === "Yes";

  useEffect(() => {
    fetchAllAgents().then(setAllAgents).catch(() => {});
    if (hasSign) fetchSignInventory().then(setSignInventoryCount).catch(() => {});
    // This screen replaces whatever was on screen before it (usually a deal
    // scrolled partway down), so without this it opens mid-scroll instead of
    // at the top.
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coordinatorAgent = allAgents.find((a) => a.role === "coordinator");

  const anticipatedChanged = String(anticipatedCommission) !== String(originalAnticipated);

  const priceNum = Number(price) || 0;
  const commissionPctNum = Number(commissionPct) || 0;
  const referralPctNum = Number(referralPct) || 0;
  const grossCommission = priceNum * (commissionPctNum / 100);
  const referralAmount = grossCommission * (referralPctNum / 100);
  const commissionAfterReferral = netOverride ? Number(netAmount) || 0 : grossCommission - referralAmount;
  const hasReferral = referralPctNum > 0;

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
  // What actually gets paid out through Gusto: agent/Holly/Fran commission
  // plus the TC fee (also a Gusto payment, to the coordinator). The referral
  // fee isn't in here — it's paid outside Gusto entirely — and Brokerage
  // Keeps isn't either, since that money stays in the business rather than
  // going out to anyone.
  const totalToDistribute = round2((result.agentCommission || 0) + result.hollyCommission + result.franCommission + (tcFeeType ? tcFeeAmount : 0));

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
      // Reference string for that Bill's memo line.
      referral_owed_to: transaction.commission_data?.referral_owed_to || null,
      tc_fee_payee_name: tcFeeType ? coordinatorAgent?.name || "Kerry Dawson" : null,
      commission_reference: `Commission - ${transaction.address}`,
      referral_reference: `Referral Fee - ${transaction.address}`,
      tc_fee_reference: `Transaction Coordinator Fee - ${transaction.address}`,
    };
  }

  // Same already-computed numbers shown in the Preview section below — the
  // closeout email uses these live, so "Send Test Email" works from this
  // screen before anything's actually been saved, not just on an already-
  // closed deal.
  function buildEmailPayload() {
    return {
      address: transaction.address,
      agentName: transaction.agent?.name || null,
      agentEmail: transaction.agent?.email || null,
      leadType,
      grossCommission: round2(grossCommission),
      commissionAfterReferral: round2(commissionAfterReferral),
      referralOwedTo: transaction.commission_data?.referral_owed_to || null,
      referralPct: referralPctNum || null,
      referralAmount: round2(referralAmount),
      agentCommission: result.isOwnerDeal ? null : result.agentCommission,
      hollyCommission: result.hollyCommission,
      franCommission: result.franCommission,
      bankAmount: finalBankAmount,
      tcFeeAmount: tcFeeType ? tcFeeAmount : 0,
      totalToDistribute,
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
        is_historical_import: alreadyClosedExternally,
        sign_returned: signReturned,
      });
      showToast("Close-out saved — deal marked Closed");

      // Only increment once — if it was already marked returned on a prior
      // save, saving again (e.g. editing some other field) must not keep
      // adding to the count.
      if (hasSign && signReturned && !saved.sign_returned) {
        try {
          await incrementSignInventory();
        } catch (e) {
          showToast(`Saved, but couldn't update sign inventory: ${e.message}`);
        }
      }

      // A deal that already closed outside the app (e.g. handled manually before
      // this feature existed) must not re-trigger the Sheet/Xero pushes — those
      // would create a duplicate Google Sheet row and duplicate Xero invoice/bills
      // for money that was already recorded and paid out elsewhere.
      if (alreadyClosedExternally) {
        showToast("Marked Closed — Google Sheet and Xero were not notified");
      } else {
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
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendTestEmail() {
    setSendingTestEmail(true);
    try {
      const result = await sendCloseoutEmail(buildEmailPayload(), true);
      const recipients = result.sent.map((s) => [...s.to, ...s.cc].join(", ")).join(" / ");
      showToast(`Test email${result.sent.length > 1 ? "s" : ""} sent to you — real recipients would be: ${recipients}`);
    } catch (e) {
      showToast(`Couldn't send test email: ${e.message}`);
    } finally {
      setSendingTestEmail(false);
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

      <label className="tbd-toggle closeout-external-toggle">
        <input
          type="checkbox"
          checked={alreadyClosedExternally}
          onChange={(e) => setAlreadyClosedExternally(e.target.checked)}
        />
        This deal already closed outside the app — just mark it Closed, don't notify the Deal Tracker sheet or Xero
      </label>

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
        <legend>Anticipated & Actual Commission</legend>
        <label>
          Anticipated Commission ($) <span className="field-help">(what you expect this to actually pay out)</span>
          <input type="number" value={anticipatedCommission} onChange={(e) => setAnticipatedCommission(e.target.value)} placeholder="e.g. 9500" />
        </label>
        {anticipatedChanged && (
          <label>
            Note <span className="field-help">(required — why did this change?)</span>
            <input value={anticipatedNote} onChange={(e) => setAnticipatedNote(e.target.value)} placeholder="e.g. price dropped at inspection" />
          </label>
        )}
        <label className="tbd-toggle">
          <input type="checkbox" checked={netOverride} onChange={(e) => setNetOverride(e.target.checked)} />
          Based on net proceeds, not the price/commission % above
        </label>
        {netOverride && (
          <label>
            Actual Commission Amount ($) <span className="field-help">(everything below recalculates from this)</span>
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


      {/* Consolidated into one compact fieldset — these were two separate
          fieldsets taking up a lot of vertical room. Only Hall Collins' own
          listings hold the trust deposit — on a pure Buy-side deal the other
          brokerage holds it, so that part is irrelevant there, same as no
          deposit ever being recorded. */}
      {(hasSign || showDepositSection) && (
        <fieldset>
          <legend>Sign & Deposit</legend>
          {hasSign && (
            <>
              <p className="field-help">
                Yard sign was put up for this listing.
                {signInventoryCount != null && ` ${signInventoryCount} currently in inventory.`}
              </p>
              <label className="tbd-toggle">
                <input type="checkbox" checked={signReturned} onChange={(e) => setSignReturned(e.target.checked)} />
                Sign has been picked up — add it back to inventory
              </label>
            </>
          )}
          {showDepositSection && (
            <>
              <p className="field-help">
                Recorded at Under Contract: {money(transaction.commission_data.deposit_amount)} held
                {transaction.commission_data?.second_deposit === "Yes" &&
                  `, plus a second deposit of ${money(transaction.commission_data.second_deposit_amount)}`}
                . Returning an unused deposit to the buyer is handled separately, as a to-do, only if this deal
                ends up terminated instead of closed.
              </p>
              <label className="tbd-toggle">
                <input type="checkbox" checked={depositRetained} onChange={(e) => setDepositRetained(e.target.checked)} />
                Deposit applied toward commission — didn't forward it to the attorney, smaller check as a result
              </label>
              <label className="tbd-toggle">
                <input
                  type="checkbox"
                  checked={trustToCheckingTransferred}
                  onChange={(e) => setTrustToCheckingTransferred(e.target.checked)}
                />
                Transferred from trust account into checking
              </label>
            </>
          )}
        </fieldset>
      )}

      <fieldset className="closeout-preview">
        <legend>Preview</legend>
        <CopyableRow label={hasReferral ? "Commission After Referral" : "Total Commission"} amount={commissionAfterReferral} />
        <CopyableRow label="Brokerage Keeps" amount={finalBankAmount} />

        <div className="closeout-preview-gap" />

        <CopyableRow label="Holly's Commission" amount={result.hollyCommission} />
        <CopyableRow label="Fran's Commission" amount={result.franCommission} />
        {!result.isOwnerDeal && <CopyableRow label="Agent Commission" amount={result.agentCommission} />}
        {tcFeeType && <CopyableRow label={`Transaction Coordinator Fee (${tcFeeType})`} amount={tcFeeAmount} />}
        <CopyableRow label="Total to Distribute" amount={totalToDistribute} highlight />
      </fieldset>

      <fieldset>
        <legend>Gusto Reference Notes</legend>
        <p className="field-help">Ready to paste into Gusto's Invoice # / Memo fields for each payment.</p>
        <CopyableTextRow label="Commission Memo" text={`Commission - ${transaction.address}`} />
        {tcFeeType && (
          <>
            <CopyableTextRow label="TC Fee Invoice #" text={`TC Fee - ${transaction.address.split(",")[0].trim()}`} />
            <CopyableTextRow label="TC Fee Memo" text={`Transaction Coordinator Fee - ${transaction.address}`} />
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Closeout Email</legend>
        <p className="field-help">
          Sends only to you (fran.collins@hallcollins.com), with a banner showing exactly who the real recipients
          would be, using the numbers currently shown above — nothing goes to the agent, Holly, or
          partners@hallcollins.com from this button, and nothing needs to be saved first.
        </p>
        <button type="button" className="comps-minimize-btn" onClick={handleSendTestEmail} disabled={sendingTestEmail}>
          {sendingTestEmail ? "Sending…" : "Send Test Closeout Email"}
        </button>
      </fieldset>

      <div className="comp-edit-all-actions">
        <button type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="button" className="google-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save and Send Closeout"}
        </button>
      </div>
    </div>
  );
}
