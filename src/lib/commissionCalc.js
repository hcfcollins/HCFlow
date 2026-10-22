// Flat transaction-coordinator fee, picked by the agent (not auto-derived from
// side/property_style — overlapping scenarios like a land deal with a buyer
// client are a judgment call). Comes out of the brokerage's own bank_amount,
// not the agent/Holly/Fran split — see applyTcFee below.
export const TC_FEE_AMOUNTS = {
  Land: 250,
  Buyer: 300,
  "Unrepresented Buyer Listing": 500,
  Compliance: 200,
};

/** Comes out of the brokerage's own bank_amount — every deal (owner or agent)
 * now always has a non-zero bank_amount (see calculateCloseout below), so this
 * no longer needs a owner-deal zero-floor special case, just the general one. */
export function applyTcFee(bankAmount, tcFeeType) {
  const fee = TC_FEE_AMOUNTS[tcFeeType] || 0;
  return Math.max(0, round2(bankAmount - fee));
}

/**
 * Hall Collins commission close-out calculation.
 * Do not modify without re-verifying against real numbers; a subtle base-amount
 * bug here means real money paid incorrectly.
 *
 * Rule, for every deal: referral fees are already removed before this is called
 * (commissionAfterReferral is net of referral). The brokerage then always takes
 * 20% of commissionAfterReferral first (the "bank" minimum) — the remaining 80%
 * is what gets split:
 *   - Owner deal (Holly or Fran is the agent), Sell side: the acting owner gets
 *     60% of the remainder, the other owner gets 40%.
 *   - Owner deal, Buy side: the acting owner gets 80% of the remainder, the
 *     other owner gets 20%.
 *   - Owner deal, Split side (dual agency, owner representing both sides): the
 *     acting owner keeps the full remainder — this case isn't in the brokerage's
 *     written split rules, so it's a direct carryover of this app's prior
 *     Split-side behavior with the new 20% floor applied on top; flag to Fran/
 *     Holly to confirm if that's ever actually wrong.
 *   - Agent deal, Organic lead: the agent keeps the full remainder (their 80%),
 *     brokerage's 20% stays as pure bank — no Holly/Fran cut on organic leads.
 *   - Agent deal, Provided lead: the brokerage's cut is instead 40% (the agent
 *     keeps 60%, i.e. agentPct defaults to 0.6 — still overridable via
 *     agentSplitPct for a negotiated split), and THAT 40%-ish bucket splits
 *     1/4 to Fran, 1/4 to Holly, with the remaining half staying as bank — e.g.
 *     at the default 40% bucket: Fran 10% of total, Holly 10% of total, bank
 *     20% of total. Proportional to whatever the bucket actually is if
 *     agentSplitPct is overridden, not a flat dollar amount.
 */
export function calculateCloseout({ commissionAfterReferral, agentName, side, leadType, agentSplitPct }) {
  const isHolly = agentName === "Holly Hall";
  const isFran = agentName === "Fran Collins";

  if (isHolly || isFran) {
    const bankAmount = commissionAfterReferral * 0.2;
    const remainder = commissionAfterReferral - bankAmount;

    let hollyPct = 0;
    let franPct = 0;
    if (side === "Sell") {
      hollyPct = isHolly ? 0.6 : 0.4;
      franPct = isHolly ? 0.4 : 0.6;
    } else if (side === "Buy") {
      hollyPct = isHolly ? 0.8 : 0.2;
      franPct = isHolly ? 0.2 : 0.8;
    } else if (side === "Split") {
      hollyPct = isHolly ? 1 : 0;
      franPct = isFran ? 1 : 0;
    }
    return {
      isOwnerDeal: true,
      agentCommission: null,
      hollyCommission: round2(remainder * hollyPct),
      franCommission: round2(remainder * franPct),
      bankAmount: round2(bankAmount),
      bucketAmount: round2(bankAmount),
      agentPct: null,
    };
  }

  const agentPct = leadType === "Provided" ? (agentSplitPct != null ? agentSplitPct / 100 : 0.6) : 0.8;
  const bucketAmount = commissionAfterReferral * (1 - agentPct);
  const agentCommission = commissionAfterReferral * agentPct;
  const hollyCommission = leadType === "Provided" ? bucketAmount * 0.25 : 0;
  const franCommission = leadType === "Provided" ? bucketAmount * 0.25 : 0;
  const bankAmount = leadType === "Provided" ? bucketAmount * 0.5 : bucketAmount;

  return {
    isOwnerDeal: false,
    agentCommission: round2(agentCommission),
    hollyCommission: round2(hollyCommission),
    franCommission: round2(franCommission),
    bankAmount: round2(bankAmount),
    bucketAmount: round2(bucketAmount),
    agentPct,
  };
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}
