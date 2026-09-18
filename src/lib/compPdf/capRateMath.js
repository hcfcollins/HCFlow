// Multi-family income / cap rate / financing model ported verbatim from the Streamlit
// CMA generator's app.py (hcfcollins/hall-collins-cma-generator, ~lines 616-816).

export const CAP_LOW = 7.0;
export const CAP_HIGH = 11.0;
export const COC_LOW = 8.0;
export const COC_HIGH = 12.0;

export const UTILITY_OPTIONS = ["Electric", "Heat", "Plowing", "Mowing", "Trash", "Internet"];

/** Standard mortgage amortization: annual debt service for a given price and loan terms. */
export function annualDebtServiceForPrice(price, downPct, rateAnnual, termYrs) {
  const loan = price * (1 - downPct / 100);
  const rMonthly = rateAnnual / 100 / 12;
  const nPayments = termYrs * 12;
  let monthlyPmt;
  if (rMonthly > 0 && loan > 0) {
    monthlyPmt = (loan * (rMonthly * (1 + rMonthly) ** nPayments)) / ((1 + rMonthly) ** nPayments - 1);
  } else {
    monthlyPmt = nPayments > 0 ? loan / nPayments : 0;
  }
  return monthlyPmt * 12;
}

/** Price implied by a target cap rate: Price = NOI / (capPct / 100). */
export function priceAtCap(noi, capPct) {
  return capPct > 0 && noi > 0 ? noi / (capPct / 100) : 0;
}

/** Price implied by a target cash-on-cash return, solved algebraically (see app.py `_price_at_coc`). */
export function priceAtCoc(noi, cocTargetPct, downPct, rateAnnual, termYrs) {
  if (noi <= 0 || downPct <= 0 || rateAnnual <= 0) return 0;
  const d = downPct / 100;
  const r = rateAnnual / 100 / 12;
  const n = termYrs * 12;
  const k = ((r * (1 + r) ** n) / ((1 + r) ** n - 1)) * 12; // annual payment per $1 of loan
  const denom = (cocTargetPct / 100) * d + (1 - d) * k;
  return denom > 0 ? noi / denom : 0;
}

/**
 * @param {object} mf - { unitRents: [{label, current, market}], vacancyPct, taxes, insurance,
 *   maintenance, reservePct, includedUtilities: [], downPct, interestRate, loanTermYrs }
 * @param {number} priceForCap - the recommended price the analysis is run against
 */
export function computeCapRateAnalysis(mf, priceForCap) {
  const unitRents = mf.unitRents || [];
  const vacancyPct = Number(mf.vacancyPct ?? 5);
  const taxes = Number(mf.taxes || 0);
  const insurance = Number(mf.insurance || 0);
  const maintenance = Number(mf.maintenance || 0);
  const reservePct = Number(mf.reservePct ?? 5);

  const grossCur = unitRents.reduce((sum, u) => sum + (Number(u.current) || 0), 0) * 12;
  const grossMkt = unitRents.reduce((sum, u) => sum + (Number(u.market) || 0), 0) * 12;

  const reserveCur = grossCur * (reservePct / 100);
  const reserveMkt = grossMkt * (reservePct / 100);
  const baseExpenses = taxes + insurance + maintenance;
  const expensesCur = baseExpenses + reserveCur;
  const expensesMkt = baseExpenses + reserveMkt;

  const effCur = grossCur * (1 - vacancyPct / 100);
  const noiCur = effCur - expensesCur;
  const capCur = priceForCap > 0 ? (noiCur / priceForCap) * 100 : 0;

  const effMkt = grossMkt * (1 - vacancyPct / 100);
  const noiMkt = effMkt - expensesMkt;
  const capMkt = priceForCap > 0 ? (noiMkt / priceForCap) * 100 : 0;

  const hasMarket = grossMkt !== grossCur && grossMkt > 0;

  const downPct = Number(mf.downPct ?? 25);
  const rateAnnual = Number(mf.interestRate ?? 7);
  const termYrs = Number(mf.loanTermYrs ?? 30);
  const showFinancing = downPct > 0 && rateAnnual > 0;

  const downAmt = priceForCap * (downPct / 100);
  const loanAmt = priceForCap - downAmt;
  const annualDebt = showFinancing ? annualDebtServiceForPrice(priceForCap, downPct, rateAnnual, termYrs) : 0;
  const cfCur = noiCur - annualDebt;
  const cfMkt = noiMkt - annualDebt;
  const cocCur = downAmt > 0 ? (cfCur / downAmt) * 100 : 0;
  const cocMkt = downAmt > 0 ? (cfMkt / downAmt) * 100 : 0;

  const prAt7Cur = priceAtCap(noiCur, CAP_LOW);
  const prAt11Cur = priceAtCap(noiCur, CAP_HIGH);
  const prAt7Mkt = hasMarket ? priceAtCap(noiMkt, CAP_LOW) : 0;
  const prAt11Mkt = hasMarket ? priceAtCap(noiMkt, CAP_HIGH) : 0;

  const prCoc8Cur = showFinancing ? priceAtCoc(noiCur, COC_LOW, downPct, rateAnnual, termYrs) : 0;
  const prCoc12Cur = showFinancing ? priceAtCoc(noiCur, COC_HIGH, downPct, rateAnnual, termYrs) : 0;
  const prCoc8Mkt = showFinancing && hasMarket ? priceAtCoc(noiMkt, COC_LOW, downPct, rateAnnual, termYrs) : 0;
  const prCoc12Mkt = showFinancing && hasMarket ? priceAtCoc(noiMkt, COC_HIGH, downPct, rateAnnual, termYrs) : 0;

  return {
    unitRents,
    vacancyPct,
    taxes,
    insurance,
    maintenance,
    reservePct,
    includedUtilities: mf.includedUtilities || [],
    grossCur,
    grossMkt,
    reserveCur,
    reserveMkt,
    baseExpenses,
    expensesCur,
    expensesMkt,
    effCur,
    noiCur,
    capCur,
    effMkt,
    noiMkt,
    capMkt,
    hasMarket,
    downPct,
    rateAnnual,
    termYrs,
    showFinancing,
    downAmt,
    loanAmt,
    monthlyPayment: showFinancing ? annualDebt / 12 : 0,
    annualDebt,
    cfCur,
    cfMkt,
    cocCur,
    cocMkt,
    prAt7Cur,
    prAt11Cur,
    prAt7Mkt,
    prAt11Mkt,
    prCoc8Cur,
    prCoc12Cur,
    prCoc8Mkt,
    prCoc12Mkt,
  };
}
