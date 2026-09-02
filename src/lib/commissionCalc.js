/**
 * Hall Collins commission close-out calculation.
 * See Build Spec §6 — this logic was verified against real historical closed-deal
 * numbers before being confirmed. Do not modify without re-verifying against
 * real numbers; a subtle base-amount bug here means real money paid incorrectly.
 */
export function calculateCloseout({ commissionAfterReferral, agentName, side, leadType, agentSplitPct }) {
  const isHolly = agentName === "Holly Hall";
  const isFran = agentName === "Fran Collins";

  if (isHolly || isFran) {
    let hollyPct = 0;
    let franPct = 0;
    if (side === "Seller") {
      hollyPct = isHolly ? 0.6 : 0.4;
      franPct = isHolly ? 0.4 : 0.6;
    } else if (side === "Buyer") {
      hollyPct = isHolly ? 0.8 : 0.2;
      franPct = isHolly ? 0.2 : 0.8;
    } else if (side === "Split") {
      hollyPct = isHolly ? 1 : 0;
      franPct = isFran ? 1 : 0;
    }
    return {
      isOwnerDeal: true,
      agentCommission: null,
      hollyCommission: round2(commissionAfterReferral * hollyPct),
      franCommission: round2(commissionAfterReferral * franPct),
      bankAmount: 0,
      bucketAmount: 0,
      agentPct: null,
    };
  }

  const agentPct = leadType === "Provided" ? (agentSplitPct != null ? agentSplitPct / 100 : 0.6) : 0.8;
  const bucketAmount = commissionAfterReferral * (1 - agentPct);
  const agentCommission = commissionAfterReferral * agentPct;
  const hollyCommission = leadType === "Provided" ? bucketAmount * 0.1 : 0;
  const franCommission = leadType === "Provided" ? bucketAmount * 0.1 : 0;
  const bankAmount = leadType === "Provided" ? bucketAmount * 0.8 : bucketAmount;

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

function round2(n) {
  return Math.round(n * 100) / 100;
}
