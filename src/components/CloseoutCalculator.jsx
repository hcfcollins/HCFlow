import { useEffect, useState } from "react";
import { Copy, X } from "lucide-react";
import RadioGroup from "./RadioGroup";
import FolderOrganizer from "./FolderOrganizer";
import {
  saveCloseout,
  fetchAllAgents,
  pushCloseoutToXero,
  fullAddress,
  sendCloseoutEmail,
  fetchSignInventory,
  incrementSignInventory,
  uploadDealDoc,
  addTodo,
  fetchListingFile,
  COMMISSION_CHECK_DOC,
  CLOSING_DOCS_DOC,
} from "../lib/transactions";
import { calculateCloseout, applyTcFee, TC_FEE_AMOUNTS, round2, suggestTcFee, referralSendTo } from "../lib/commissionCalc";
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
function CopyableRow({ label, amount, highlight, math }) {
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
      <span>
        {label}
        {math && <em className="closeout-math">{math}</em>}
      </span>
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
  // Not closed out yet → start from the deal's current purchase price (it may
  // have been changed on the deal screen since the Under Contract form).
  const [price, setPrice] = useState(
    (saved.commission_after_referral == null ? transaction.price ?? saved.price : saved.price ?? transaction.price) ?? ""
  );
  const [commissionPct, setCommissionPct] = useState(saved.commission_pct ?? "");
  const [referralPct, setReferralPct] = useState(saved.referral_pct ?? transaction.commission_data?.referral_pct ?? 0);
  const [leadType, setLeadType] = useState(saved.lead_type ?? transaction.commission_data?.lead_type ?? "Organic");
  const [agentSplitPct, setAgentSplitPct] = useState(saved.agent_split_pct ?? "");
  const [netOverride, setNetOverride] = useState(saved.net_override ?? false);
  const [netAmount, setNetAmount] = useState(saved.net_amount ?? "");
  // Transaction coordinator fee, automatic (Fran, Nov 2026): Compliance on
  // every deal, except Holly's files get the full fee for the deal type.
  const isHollyDeal = transaction.agent?.name === "Holly Hall";
  const clientBuys = transaction.side === "Buy" || (transaction.side === "Split" && transaction.split_client_side === "Buy");
  // Holly: what the Under Contract form picked for her, else work it out.
  const autoTcFee = isHollyDeal
    ? transaction.commission_data?.tc_fee_type ||
      suggestTcFee({ agentName: "Holly Hall", side: transaction.side, splitClientSide: transaction.split_client_side, propertyStyle: transaction.property_style })
    : "Compliance";
  const [tcFeeType, setTcFeeType] = useState(saved.tc_fee_type ?? autoTcFee);
  // Listing side: the actual check vs. the actual commission (the difference
  // is earnest money we held in trust and applied toward the commission).
  const [checkAmount, setCheckAmount] = useState(saved.check_amount ?? "");
  const [referralPaid, setReferralPaid] = useState(saved.referral_paid ?? false);
  const originalAnticipated = saved.anticipated_commission ?? "";
  const [anticipatedCommission, setAnticipatedCommission] = useState(originalAnticipated);
  // Until someone types their own number, Anticipated Commission just follows
  // price × commission % (prefilled).
  const [anticipatedEdited, setAnticipatedEdited] = useState(saved.anticipated_commission != null);
  const [anticipatedNote, setAnticipatedNote] = useState(saved.anticipated_commission_note ?? "");
  const [depositRetained, setDepositRetained] = useState(saved.deposit_retained ?? false);
  const [trustToCheckingTransferred, setTrustToCheckingTransferred] = useState(saved.trust_to_checking_transferred ?? false);
  const [alreadyClosedExternally, setAlreadyClosedExternally] = useState(saved.is_historical_import ?? false);
  // Pre-checked once the agent confirmed the pickup (card / Ready for Closeout).
  const [signReturned, setSignReturned] = useState(saved.sign_returned ?? Boolean(transaction.sign_picked_up_at));
  const [signInventoryCount, setSignInventoryCount] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [allAgents, setAllAgents] = useState([]);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [showOrganizer, setShowOrganizer] = useState(false);

  const hasSign = transaction.side !== "Buy" && transaction.sign_status === "Yes";

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

  const priceNum = Number(price) || 0;
  const commissionPctNum = Number(commissionPct) || 0;
  const referralPctNum = Number(referralPct) || 0;
  const calculatedCommission = priceNum * (commissionPctNum / 100);
  const anticipatedValue = anticipatedEdited ? anticipatedCommission : calculatedCommission ? String(round2(calculatedCommission)) : "";
  // A note is only required when a previously saved anticipated number changes.
  const anticipatedChanged = originalAnticipated !== "" && String(anticipatedValue) !== String(originalAnticipated);
  // "Received doesn't match" (net_override): the actual check amount replaces
  // price × % — the referral still comes out of it, and everything below
  // (splits, sheet, Xero) uses what was actually received.
  const grossCommission = netOverride ? Number(netAmount) || 0 : calculatedCommission;
  const referralAmount = grossCommission * (referralPctNum / 100);
  const commissionAfterReferral = grossCommission - referralAmount;

  const isListingSide = !clientBuys;
  const cd = transaction.commission_data || {};
  const depositHeld =
    cd.hold_deposit === "Yes" ? (Number(cd.deposit_amount) || 0) + (cd.second_deposit === "Yes" ? Number(cd.second_deposit_amount) || 0 : 0) : 0;
  const checkNum = checkAmount === "" ? null : Number(checkAmount);
  const checkShort = checkNum == null ? null : round2(grossCommission - checkNum); // how much less the check is than the commission
  const checkMatchesDeposit = checkShort != null && depositHeld > 0 && Math.abs(checkShort - depositHeld) < 1;
  const trustTransferAmount = isListingSide && depositHeld > 0 && (depositRetained || checkMatchesDeposit) ? depositHeld : 0;
  const hasReferral = referralPctNum > 0;
  // "Send" is misleading when the external-close box is checked — that path
  // deliberately skips the Xero push.
  // Says exactly what saving does: marks it Closed and creates the Xero
  // invoice + bills (not when it already closed outside the app).
  const saveButtonLabel = alreadyClosedExternally ? "Save and Mark Closed (no Xero, no email)" : "Save, Mark Closed, Email & Push to Xero";

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

  // Italic "how we got here" lines under each Preview number — mirrors
  // calculateCloseout (lib/commissionCalc.js) exactly.
  const pctText = (n) => `${round2(n * 100)}%`;
  const m = (n) => money(n);
  const math = (() => {
    const car = commissionAfterReferral;
    const out = {};
    out.car = hasReferral
      ? `${m(grossCommission)} commission − ${referralPctNum}% referral (${m(referralAmount)}) we pay out`
      : netOverride
        ? "Actual commission entered above"
        : `${m(priceNum)} × ${commissionPctNum}%`;
    const fee = tcFeeType ? ` − ${m(tcFeeAmount)} TC fee` : "";
    if (result.isOwnerDeal) {
      const remainder = car - result.bankAmount;
      const actingIsHolly = transaction.agent?.name === "Holly Hall";
      const [mine, theirs] = transaction.side === "Sell" ? [0.6, 0.4] : transaction.side === "Buy" ? [0.8, 0.2] : [1, 0];
      const sideWord = transaction.side === "Sell" ? "listing" : transaction.side === "Buy" ? "buyer" : "Split";
      out.bank = `20% × ${m(car)} = ${m(result.bankAmount)}${fee}`;
      const actingLine = `${pctText(mine)} × the remaining 80% (${m(remainder)}) — ${actingIsHolly ? "Holly" : "Fran"}'s ${sideWord} deal`;
      const otherLine = theirs ? `${pctText(theirs)} × the remaining 80% (${m(remainder)})` : `Nothing — ${actingIsHolly ? "Holly" : "Fran"} keeps the full 80% on a Split`;
      out.holly = actingIsHolly ? actingLine : otherLine;
      out.fran = actingIsHolly ? otherLine : actingLine;
    } else {
      const agentPct = result.agentPct;
      const bucketPct = 1 - agentPct;
      out.agent = `${pctText(agentPct)} × ${m(car)}${leadType === "Provided" ? " (provided lead)" : " (organic lead)"}`;
      if (leadType === "Provided") {
        out.bank = `50% of the ${pctText(bucketPct)} brokerage share (${m(result.bucketAmount)}) = ${m(result.bankAmount)}${fee}`;
        out.holly = `25% of the ${pctText(bucketPct)} brokerage share (${m(result.bucketAmount)})`;
        out.fran = out.holly;
      } else {
        out.bank = `${pctText(bucketPct)} × ${m(car)} = ${m(result.bankAmount)}${fee}`;
        out.holly = "Organic lead — no owner share";
        out.fran = out.holly;
      }
    }
    out.tc = `${tcFeeType} flat fee — taken out of the brokerage's cut`;
    out.total = `${[result.isOwnerDeal ? null : "agent", "Holly", "Fran", tcFeeType ? "TC fee" : null].filter(Boolean).join(" + ")} (the referral and brokerage share aren't paid through Gusto)`;
    return out;
  })();

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
    const xeroAddress = fullAddress(transaction);
    const realPercentage = priceNum > 0 ? round2((commissionAfterReferral / priceNum) * 100) : commissionPctNum;
    const brokerageSplitPct = !result.isOwnerDeal && result.agentPct != null ? round2(result.agentPct * 100) : null;
    const leftoverForTeam = round2(commissionAfterReferral - result.bankAmount);
    const depositHeldAmount = transaction.commission_data?.hold_deposit === "Yes" ? transaction.commission_data.deposit_amount : null;

    return {
      closing_date: transaction.next_date || null,
      address: xeroAddress,
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
      commission_reference: `Commission - ${xeroAddress}`,
      referral_reference: `Referral Fee - ${xeroAddress}`,
      tc_fee_reference: `Transaction Coordinator Fee - ${xeroAddress}`,
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
      referralSendTo: hasReferral ? referralSendTo(transaction) : null,
      agentCommission: result.isOwnerDeal ? null : result.agentCommission,
      hollyCommission: result.hollyCommission,
      franCommission: result.franCommission,
      bankAmount: finalBankAmount,
      tcFeeAmount: tcFeeType ? tcFeeAmount : 0,
      totalToDistribute,
      side: transaction.side,
      agentPct: result.isOwnerDeal ? null : result.agentPct,
      coordinatorEmail: coordinatorAgent?.email || null,
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
        anticipated_commission: anticipatedValue === "" ? null : Number(anticipatedValue),
        anticipated_commission_note: anticipatedNote.trim() || null,
        deposit_retained: depositRetained || checkMatchesDeposit,
        trust_to_checking_transferred: trustToCheckingTransferred,
        check_amount: checkNum,
        referral_paid: referralPaid,
        is_historical_import: alreadyClosedExternally,
        sign_returned: signReturned,
      });
      showToast("Close-out saved — deal marked Closed");

      // Post-check follow-ups still open → Fran's to-dos (once each).
      try {
        const have = new Set((transaction.todos || []).map((t) => t.text));
        const followUps = [
          hasReferral && !referralPaid
            ? `@Fran Pay referral ${money(referralAmount)} to ${transaction.commission_data?.referral_owed_to || "the referring agent"} — send to: ${(referralSendTo(transaction) || "nothing in the deal's notes yet").replace(/\s*\n\s*/g, ", ")}`
            : null,
          trustTransferAmount > 0 && !trustToCheckingTransferred ? `@Fran Transfer ${money(trustTransferAmount)} earnest money from trust to checking` : null,
        ].filter((t) => t && !have.has(t));
        for (const text of followUps) await addTodo(transaction.id, text, null);
      } catch (e) {
        showToast(`Saved, but couldn't add the follow-up to-dos: ${e.message}`);
      }

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
      // this feature existed) must not re-trigger the Xero push — that would
      // create a duplicate invoice/bills for money already recorded elsewhere.
      // (The old Deal Tracker Google Sheet row via Zapier was retired Nov 2026 —
      // Xero gets everything directly.)
      if (alreadyClosedExternally) {
        showToast("Marked Closed — Xero was not notified");
      } else {
        // Best-effort — the closeout itself is already saved and the deal is
        // already marked Closed above, so a failure here is surfaced but must
        // never look like the save failed or block moving on.
        const sheetPayload = buildSheetPayload();
        try {
          await pushCloseoutToXero(sheetPayload);
          showToast("Invoice and bills created in Xero");
        } catch (e) {
          showToast(`Saved, but couldn't push to Xero: ${e.message}`);
        }
        // The real closeout email(s) — Fran authorized sending on save (Nov 2026).
        // Owner deal → Fran + Holly (cc Kerry); agent deal → agent (cc partners@
        // + Kerry); provided lead → also "Provided Lead Closeout" to Fran + Holly.
        try {
          const sent = await sendCloseoutEmail(buildEmailPayload(), false);
          const n = sent?.sent?.length || 0;
          showToast(`Closeout email${n === 1 ? "" : "s"} sent to ${(sent?.sent || []).map((x) => x.to.join(", ")).join(" / ")}`);
        } catch (e) {
          showToast(`Saved, but couldn't send the closeout email: ${e.message}`);
        }
      }
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Real email only — for when the close-out is already saved (and pushed to
  // Xero) but the email didn't go out. Re-saving would push to Xero twice.
  async function handleResendEmail() {
    if (!window.confirm("Send the real closeout email now? (Nothing is saved and Xero isn't touched.)")) return;
    setSendingTestEmail(true);
    try {
      const sent = await sendCloseoutEmail(buildEmailPayload(), false);
      showToast(`Closeout email sent to ${(sent?.sent || []).map((x) => [...x.to, ...x.cc].join(", ")).join(" / ")}`);
    } catch (e) {
      showToast(`Couldn't send the closeout email: ${e.message}`);
    } finally {
      setSendingTestEmail(false);
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
        <button type="button" className="header-icon-btn" onClick={onCancel} aria-label="Close" title="Close">
          <X size={20} />
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="closeout-external-toggle">
        <label className="tbd-toggle">
          <input
            type="checkbox"
            checked={alreadyClosedExternally}
            onChange={(e) => setAlreadyClosedExternally(e.target.checked)}
          />
          This deal already closed outside the app — just mark it Closed, don't send anything to Xero
        </label>
        {alreadyClosedExternally && (
          <button title="Mark Closed without sending anything to Xero" type="button" className="google-btn closeout-external-save-btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : saveButtonLabel}
          </button>
        )}
      </div>

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
          Anticipated Commission ($){" "}
          <span className="field-help">{anticipatedEdited ? "(your number)" : "(price × commission % — change it if you expect something different)"}</span>
          <input
            type="number"
            value={anticipatedValue}
            onChange={(e) => {
              setAnticipatedEdited(true);
              setAnticipatedCommission(e.target.value);
            }}
            placeholder="e.g. 9500"
          />
        </label>
        {anticipatedChanged && (
          <label>
            Note <span className="field-help">(required — why did the anticipated amount change?)</span>
            <input value={anticipatedNote} onChange={(e) => setAnticipatedNote(e.target.value)} placeholder="e.g. price dropped at inspection" />
          </label>
        )}
        <label className="tbd-toggle">
          <input type="checkbox" checked={netOverride} onChange={(e) => setNetOverride(e.target.checked)} />
          The actual commission doesn't match the anticipated amount
        </label>
        {netOverride && (
          <>
            <label>
              Actual Commission ($) <span className="field-help">(the full commission earned — any referral is paid out by us afterward, and the splits recalculate from this)</span>
              <input type="number" value={netAmount} onChange={(e) => setNetAmount(e.target.value)} placeholder="e.g. 9780" />
            </label>
            {anticipatedValue !== "" && netAmount !== "" && (
              <p className="field-help">
                Difference: {Number(netAmount) - Number(anticipatedValue) >= 0 ? "+" : "−"}$
                {Math.abs(Number(netAmount) - Number(anticipatedValue)).toLocaleString(undefined, { maximumFractionDigits: 2 })} vs. anticipated
              </p>
            )}
            {!anticipatedChanged && (
              <label>
                Why is it different? <span className="field-help">(optional — e.g. seller credit at closing)</span>
                <input value={anticipatedNote} onChange={(e) => setAnticipatedNote(e.target.value)} placeholder="e.g. seller credit at closing" />
              </label>
            )}
          </>
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
        Transaction Coordinator Fee{" "}
        <span className="field-help">(automatic: Compliance on every deal; Holly's files get the full fee. Comes out of the brokerage's cut.)</span>
        <select value={tcFeeType} onChange={(e) => setTcFeeType(e.target.value)}>
          <option value="">None</option>
          {Object.entries(TC_FEE_AMOUNTS).map(([type, amount]) => (
            <option key={type} value={type}>
              {type} (${amount})
            </option>
          ))}
        </select>
      </label>
      {isHollyDeal && !tcFeeType && <p className="field-note">Holly's listing — pick the full transaction coordinator fee for this one.</p>}

      {/* After the check arrives: listings compare the check to the commission
          (the gap is our trust deposit applied to it), then the referral we
          owe and any trust → checking transfer. */}
      <fieldset>
        <legend>After the Check Arrives</legend>
        {isListingSide && (
          <>
            <div className="closeout-compare">
              <div>
                <span className="field-help">Actual commission</span>
                <strong>{money(grossCommission)}</strong>
              </div>
              <label>
                <span className="field-help">Actual check amount ($)</span>
                <input type="number" value={checkAmount} onChange={(e) => setCheckAmount(e.target.value)} placeholder={grossCommission ? String(round2(grossCommission)) : "e.g. 9500"} />
              </label>
            </div>
            {checkNum != null && (
              <p className={Math.abs(checkShort) < 1 || checkMatchesDeposit ? "field-help" : "field-note"}>
                {Math.abs(checkShort) < 1
                  ? depositHeld > 0
                    ? `The check covers the full commission, so the ${money(depositHeld)} deposit wasn't applied — make sure it went to the closing attorney (no trust transfer).`
                    : "The check matches the commission."
                  : checkMatchesDeposit
                    ? `The check is ${money(checkShort)} short — exactly the earnest money deposit we hold, so it was applied toward the commission. Transfer ${money(depositHeld)} from the trust account to checking.`
                    : checkShort > 0
                      ? `The check is ${money(checkShort)} less than the commission${depositHeld ? `, which doesn't match the ${money(depositHeld)} deposit` : ""} — double-check before closing out.`
                      : `The check is ${money(-checkShort)} more than the commission — double-check before closing out.`}
              </p>
            )}
            {depositHeld > 0 && (
              <label className="tbd-toggle">
                <input type="checkbox" checked={depositRetained || checkMatchesDeposit} disabled={checkMatchesDeposit} onChange={(e) => setDepositRetained(e.target.checked)} />
                Deposit ({money(depositHeld)}) applied toward the commission instead of going to the attorney
              </label>
            )}
          </>
        )}
        {hasReferral && (
          <label className="tbd-toggle">
            <input type="checkbox" checked={referralPaid} onChange={(e) => setReferralPaid(e.target.checked)} />
            Referral paid: {money(referralAmount)} ({referralPctNum}% of the check) to {transaction.commission_data?.referral_owed_to || "the referring agent"}
          </label>
        )}
        {hasReferral && (
          <div className="referral-send-to">
            <div className="detail-label">Send the referral to</div>
            {referralSendTo(transaction) ? (
              <div className="referral-send-to-text">{referralSendTo(transaction)}</div>
            ) : (
              <div className="field-help">Nothing in the deal's Notes yet — add where to send it there.</div>
            )}
          </div>
        )}
        {trustTransferAmount > 0 && (
          <label className="tbd-toggle">
            <input type="checkbox" checked={trustToCheckingTransferred} onChange={(e) => setTrustToCheckingTransferred(e.target.checked)} />
            Transferred {money(trustTransferAmount)} earnest money from the trust account to checking
          </label>
        )}
        {!hasReferral && trustTransferAmount === 0 && !isListingSide && <p className="field-help">Nothing to pay out or transfer on this one.</p>}
        <p className="field-help">Anything left unchecked here is added to your To-Dos when you save.</p>
      </fieldset>


      {/* Consolidated into one compact fieldset — these were two separate
          fieldsets taking up a lot of vertical room. Only Hall Collins' own
          listings hold the trust deposit — on a pure Buy-side deal the other
          brokerage holds it, so that part is irrelevant there, same as no
          deposit ever being recorded. */}
      {hasSign && (
        <fieldset>
          <legend>Sign</legend>
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
              {"sign_picked_up_at" in transaction && (
                <p className="field-help">
                  {transaction.sign_picked_up_at
                    ? `Confirmed picked up ${new Date(transaction.sign_picked_up_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`
                    : "⚠️ Nobody has confirmed the sign was picked up yet."}
                </p>
              )}
            </>
          )}
        </fieldset>
      )}

      <fieldset className="closeout-preview">
        <legend>Preview</legend>
        <CopyableRow label={hasReferral ? "Commission After Referral" : "Total Commission"} amount={commissionAfterReferral} math={math.car} />
        <CopyableRow label="Brokerage Keeps" amount={finalBankAmount} math={math.bank} />

        <div className="closeout-preview-gap" />

        <CopyableRow label="Holly's Commission" amount={result.hollyCommission} math={math.holly} />
        <CopyableRow label="Fran's Commission" amount={result.franCommission} math={math.fran} />
        {!result.isOwnerDeal && <CopyableRow label="Agent Commission" amount={result.agentCommission} math={math.agent} />}
        {tcFeeType && <CopyableRow label={`Transaction Coordinator Fee (${tcFeeType})`} amount={tcFeeAmount} math={math.tc} />}
        <CopyableRow label="Total to Distribute" amount={totalToDistribute} highlight math={math.total} />
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

      <DealDocUpload transaction={transaction} docName={CLOSING_DOCS_DOC} label="Closing Docs" hint="Drag the closing docs here" optionalNote="We don't always get these — skip it if you don't have them." />
      <DealDocUpload transaction={transaction} docName={COMMISSION_CHECK_DOC} label="Commission Check" hint="Drag the commission check here" />

      {(transaction.dropbox_folder_url || transaction.dropbox_folder_path) && (
        <fieldset>
          <legend>Deal Folder</legend>
          <p className="field-help">
            Rename everything in this deal's Dropbox folder (except Photos) to “1) {String(transaction.address || "").split(",")[0].trim()} - …”, in the order it
            happened, ending with Closing Docs and the Commission Check. You'll see the list before anything changes.
          </p>
          <button type="button" className="comps-minimize-btn" onClick={() => setShowOrganizer(true)} title="Review and rename this deal's files">
            Organize Deal Folder
          </button>
        </fieldset>
      )}
      {showOrganizer && <FolderOrganizer transaction={transaction} onClose={() => setShowOrganizer(false)} />}

      <fieldset>
        <legend>Closeout Email</legend>
        <p className="field-help">
          The real closeout email goes out when you tap Save at the bottom. This test button sends a preview only to you
          (fran.collins@hallcollins.com), with a banner showing exactly who would get it, using the numbers shown above.
        </p>
        <button title="Send the closeout email to yourself only, to check it" type="button" className="comps-minimize-btn" onClick={handleSendTestEmail} disabled={sendingTestEmail}>
          {sendingTestEmail ? "Sending…" : "Send Test Closeout Email"}
        </button>
        {saved?.commission_after_referral != null && !alreadyClosedExternally && (
          <button
            title="Send the real closeout email again — doesn't save, doesn't touch Xero"
            type="button"
            className="comps-minimize-btn"
            onClick={handleResendEmail}
            disabled={sendingTestEmail}
          >
            Resend Real Closeout Email Only (no Xero)
          </button>
        )}
      </fieldset>

      <div className="comp-edit-all-actions">
        <button title="Close without saving" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button title="Save the close-out and mark this deal Closed" type="button" className="google-btn" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : saveButtonLabel}
        </button>
      </div>
    </div>
  );
}

/** Closing docs / commission check → the deal's Dropbox folder as
 * "<address> - <docName>". Doesn't need the close-out saved first; shows
 * what's on file. Drag and drop, or click to choose. */
function DealDocUpload({ transaction, docName, label, hint, optionalNote }) {
  const showToast = useToast();
  const onFile = (transaction.documents || []).find((d) => d.name === docName);
  const [savedPath, setSavedPath] = useState(onFile?.file_name || null);
  // Filed from elsewhere (e.g. the Closeout Inbox) after this opened — show it.
  useEffect(() => {
    if (onFile?.file_name) setSavedPath(onFile.file_name);
  }, [onFile?.file_name]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file) {
    if (!file) return;
    if (!/\.(pdf|jpe?g|png|heic)$/i.test(file.name)) {
      setError("That file type won't work — drop a PDF or a photo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = await uploadDealDoc(transaction, file, docName);
      setSavedPath(path);
      showToast(`${label} saved to Dropbox`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function view() {
    const tab = window.open("", "_blank");
    try {
      const blob = await fetchListingFile(transaction.id, savedPath);
      const typed = new Blob([blob], { type: /\.pdf$/i.test(savedPath) ? "application/pdf" : blob.type });
      const url = URL.createObjectURL(typed);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch (e) {
      if (tab) tab.close();
      setError(e.message);
    }
  }

  return (
    <fieldset>
      <legend>{label}</legend>
      {optionalNote && !savedPath && <p className="field-help">{optionalNote}</p>}
      {error && <div className="error-banner">{error}</div>}
      <div className={`license-status-row ${savedPath ? "license-status-row--ok" : "license-status-row--missing"}`}>
        <span className="license-status-text">
          {savedPath ? (
            <>
              <strong>✓ Copy on file</strong>
              <span className="license-status-sub"> · {savedPath.split("/").slice(-2).join(" / ")}</span>
            </>
          ) : (
            <strong>No {label.toLowerCase()} uploaded yet</strong>
          )}
        </span>
        <span className="license-status-actions">
          {savedPath && (
            <button type="button" className="license-mini-btn" onClick={view} title={`View the ${label.toLowerCase()}`}>
              View
            </button>
          )}
        </span>
      </div>
      {/* Drag a scan/PDF straight from the computer, or click to choose one. */}
      <label
        className={`check-dropzone ${dragging ? "check-dropzone--over" : ""} ${busy ? "check-dropzone--busy" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) upload(e.dataTransfer.files?.[0]);
        }}
        title={`Drop the ${label.toLowerCase()} here, or click to choose the file`}
      >
        <input type="file" accept="application/pdf,image/*" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        {busy ? (
          <span>Uploading to Dropbox…</span>
        ) : (
          <span>
            <strong>{hint}</strong> or click to choose a file
            <br />
            <span className="field-help">PDF or photo{savedPath ? " — replaces the copy on file" : ""}</span>
          </span>
        )}
      </label>
      <p className="field-help">Saved in this deal's Dropbox folder (contract / closing docs) as “{String(transaction.address || "").split(",")[0].trim()} - {docName}”.</p>
    </fieldset>
  );
}
