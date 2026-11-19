// Live previews on the Generate Comp form, matching the Streamlit CMA generator:
// the land "Land Valuation Estimate" breakdown, and the multi-family "Live Analysis
// Preview" + "Income-Based Price Recommendation" tables. Same math as the PDF.
import { computeLandValuation } from "../lib/compPdf/landPricing";
import { computeCapRateAnalysis, CAP_LOW, CAP_HIGH, COC_LOW, COC_HIGH } from "../lib/compPdf/capRateMath";

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString()}`;
const paren = (n) => `(${money(n)})`;
const round = (n, to) => Math.round((Number(n) || 0) / to) * to;

/** Suggested {low, high, rec} from the land model or the income analysis, or null. */
export function suggestedPrices({ isLand, isMultiFamily, land, mf, priceForCap }) {
  if (isLand) {
    const v = computeLandValuation(land);
    if (!(v.acres > 0)) return null;
    return { low: v.low, high: v.high, rec: v.suggested, source: "land" };
  }
  if (isMultiFamily) {
    const a = computeCapRateAnalysis(mf, priceForCap);
    if (!(a.noiCur > 0)) return null;
    return {
      low: round(a.prAt11Cur, 5000),
      high: round(a.prAt7Cur, 5000),
      rec: round(a.prAt7Mkt || a.prAt7Cur, 1000),
      marketCeiling: a.prAt7Mkt ? round(a.prAt7Mkt, 5000) : 0,
      source: "income",
    };
  }
  return null;
}

export function LandEstimate({ land }) {
  const v = computeLandValuation(land);
  const rows = [
    ["Base land value (all parcels start here)", v.baseValue],
    [`Acreage value (${v.acres.toFixed(1)} acres × ${money(v.perAcre)}/acre)`, v.acreValue],
  ];
  if (v.roadPremium) rows.push([`Road frontage — ${land.roadFrontage}`, v.roadPremium]);
  if (v.contiguousPremium) rows.push([`Parcel character — ${land.parcelCharacter}`, v.contiguousPremium]);
  if (v.percPremium) rows.push([`Perc/soil status — ${land.percStatus}`, v.percPremium]);
  if (v.devValue) rows.push(["Development improvements completed", v.devValue]);
  return (
    <div className="cma-estimate">
      <div className="cma-estimate-title">📐 Land Valuation Estimate</div>
      <table className="cma-estimate-table">
        <tbody>
          {rows.map(([label, val]) => (
            <tr key={label}>
              <td>{label}</td>
              <td>{val < 0 ? `−${money(-val)}` : `+${money(val)}`}</td>
            </tr>
          ))}
          <tr className="cma-estimate-total">
            <td>Suggested List Price</td>
            <td>{money(v.suggested)}</td>
          </tr>
        </tbody>
      </table>
      <p className="cma-estimate-note">
        Suggested range: <strong>{money(v.low)} – {money(v.high)}</strong> · $35,000 base + {money(v.perAcre)}/acre + premiums for development, road access and parcel character.
      </p>
    </div>
  );
}

export function IncomeAnalysis({ mf, priceForCap }) {
  const a = computeCapRateAnalysis(mf, priceForCap);
  const mkt = a.hasMarket;
  const pct = (n) => (priceForCap > 0 ? `${n.toFixed(2)}%` : "—");
  const row = (label, cur, market, cls) => (
    <tr className={cls} key={label}>
      <td>{label}</td>
      <td>{cur}</td>
      {mkt && <td className="cma-mkt">{market}</td>}
    </tr>
  );
  const cfCls = (n) => (n >= 0 ? "cma-pos" : "cma-neg");
  return (
    <>
      <div className="cma-estimate">
        <div className="cma-estimate-title">📊 Live Analysis Preview</div>
        <table className="cma-estimate-table">
          <thead>
            <tr>
              <th />
              <th>Current Rents</th>
              {mkt && <th className="cma-mkt">Market Rents</th>}
            </tr>
          </thead>
          <tbody>
            {row("Gross Annual Rent", money(a.grossCur), money(a.grossMkt))}
            {row(`Effective Gross Income (${a.vacancyPct}% vac.)`, money(a.effCur), money(a.effMkt))}
            {row("Operating Expenses", paren(a.baseExpenses), paren(a.baseExpenses))}
            {row(`Capital Reserve (${a.reservePct}% of gross)`, paren(a.reserveCur), paren(a.reserveMkt))}
            {row("NOI", money(a.noiCur), money(a.noiMkt), "cma-estimate-total")}
            {row("Cap Rate", pct(a.capCur), pct(a.capMkt), "cma-estimate-total cma-cap")}
            {a.showFinancing && priceForCap > 0 && (
              <>
                <tr className="cma-subhead">
                  <td colSpan={mkt ? 3 : 2}>
                    🏦 Financing: {a.downPct}% down @ {a.rateAnnual}% for {a.termYrs} yrs
                  </td>
                </tr>
                {row("Loan Amount", money(a.loanAmt), money(a.loanAmt))}
                {row("Annual Debt Service", paren(a.annualDebt), paren(a.annualDebt))}
                <tr className="cma-estimate-total">
                  <td>Cash Flow After Financing</td>
                  <td className={cfCls(a.cfCur)}>{money(a.cfCur)}</td>
                  {mkt && <td className={cfCls(a.cfMkt)}>{money(a.cfMkt)}</td>}
                </tr>
                <tr>
                  <td>Cash-on-Cash Return (on {money(a.downAmt)} down)</td>
                  <td className={cfCls(a.cocCur)}>{a.cocCur.toFixed(2)}%</td>
                  {mkt && <td className={cfCls(a.cocMkt)}>{a.cocMkt.toFixed(2)}%</td>}
                </tr>
              </>
            )}
          </tbody>
        </table>
        <p className="cma-estimate-note">
          {priceForCap > 0 ? `Cap rate and financing are figured at ${money(priceForCap)} — they update when you change the recommended price.` : "Enter a recommended price below to see the cap rate and financing."}
          {mkt && ` Market rents total ${money(a.grossMkt / 12)}/mo (${a.grossMkt >= a.grossCur ? "+" : "−"}${money(Math.abs(a.grossMkt - a.grossCur) / 12)}/mo vs. current).`}
        </p>
      </div>

      {a.noiCur > 0 && (
        <div className="cma-estimate cma-estimate--navy">
          <div className="cma-estimate-title">💡 Income-Based Price Recommendation</div>
          <table className="cma-estimate-table">
            <thead>
              <tr>
                <th>Price Scenario</th>
                <th>Implied Price</th>
                <th>Return</th>
              </tr>
            </thead>
            <tbody>
              <tr className="cma-subhead">
                <td colSpan={3}>💵 Cash Purchase — Cap Rate · Current NOI {money(a.noiCur)}/yr</td>
              </tr>
              <tr>
                <td>{CAP_LOW}% cap rate — investor ceiling</td>
                <td>{money(a.prAt7Cur)}</td>
                <td>{CAP_LOW.toFixed(1)}%</td>
              </tr>
              <tr>
                <td>{CAP_HIGH}% cap rate — strong investor value</td>
                <td>{money(a.prAt11Cur)}</td>
                <td>{CAP_HIGH.toFixed(1)}%</td>
              </tr>
              {mkt && a.prAt7Mkt > 0 && (
                <>
                  <tr className="cma-subhead cma-mkt">
                    <td colSpan={3}>📈 At Market Rents — NOI {money(a.noiMkt)}/yr</td>
                  </tr>
                  <tr className="cma-mkt">
                    <td>{CAP_LOW}% cap rate at market rents</td>
                    <td>{money(a.prAt7Mkt)}</td>
                    <td>{CAP_LOW.toFixed(1)}%</td>
                  </tr>
                  <tr className="cma-mkt">
                    <td>{CAP_HIGH}% cap rate at market rents</td>
                    <td>{money(a.prAt11Mkt)}</td>
                    <td>{CAP_HIGH.toFixed(1)}%</td>
                  </tr>
                </>
              )}
              {a.showFinancing && a.prCoc8Cur > 0 && (
                <>
                  <tr className="cma-subhead">
                    <td colSpan={3}>
                      🏦 Financed Buyer — Cash-on-Cash ({a.downPct}% down @ {a.rateAnnual}%, {a.termYrs} yr)
                    </td>
                  </tr>
                  <tr>
                    <td>{COC_LOW}% CoC — solid leveraged return</td>
                    <td>{money(a.prCoc8Cur)}</td>
                    <td>{COC_LOW.toFixed(1)}%</td>
                  </tr>
                  <tr>
                    <td>{COC_HIGH}% CoC — strong leveraged return</td>
                    <td>{money(a.prCoc12Cur)}</td>
                    <td>{COC_HIGH.toFixed(1)}%</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
          <p className="cma-estimate-note">
            Cap rate = return on an all-cash purchase (NOI ÷ price). 7–11% is typical for Northern New England multi-family. A lower price means a higher return; the final list price also reflects comps and condition.
          </p>
        </div>
      )}
    </>
  );
}
