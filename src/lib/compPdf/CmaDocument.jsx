import { Document, Page, View, Text, Image, Svg, Rect, Polygon, StyleSheet } from "@react-pdf/renderer";
import { NAVY, PINK, LGRAY, MGRAY, DGRAY, BLUSH, STEEL, WHITE, GREEN, RED, money, pct } from "./theme";
import { RECOMMENDATION_BODY, cleanRecommendationTitle } from "./recommendations";
import { computeLandValuation, LAND_DEV_ITEMS } from "./landPricing";
import { computeCapRateAnalysis, CAP_LOW, CAP_HIGH, COC_LOW, COC_HIGH } from "./capRateMath";

// Section/table styling here is a clean, consistent approximation of the original
// reportlab CMA layout (hcfcollins/hall-collins-cma-generator's pdf_builder.py) — every
// dollar figure, formula, and paragraph of copy is ported verbatim; exact per-cell
// table styling was not chased pixel-for-pixel.
const s = StyleSheet.create({
  page: { paddingTop: 54, paddingBottom: 60, paddingHorizontal: 54, fontFamily: "Times-Roman", fontSize: 10, color: DGRAY },
  h1: { fontFamily: "Times-Bold", fontSize: 15, color: NAVY, marginBottom: 4, marginTop: 4 },
  divider: { borderBottomWidth: 2, borderBottomColor: PINK, marginBottom: 8 },
  thinDivider: { borderBottomWidth: 1, borderBottomColor: PINK, marginTop: 8, marginBottom: 8 },
  h2: { fontFamily: "Times-Bold", fontSize: 11, color: NAVY, marginBottom: 4, marginTop: 6 },
  body: { fontFamily: "Times-Roman", fontSize: 10, color: DGRAY, lineHeight: 1.4, marginBottom: 6, textAlign: "justify" },
  bodyIndent: { fontFamily: "Times-Roman", fontSize: 10, color: DGRAY, lineHeight: 1.4, marginBottom: 6, marginLeft: 12, textAlign: "justify" },
  label: { fontFamily: "Times-Bold", fontSize: 9, color: NAVY },
  caption: { fontFamily: "Times-Italic", fontSize: 9, color: MGRAY, marginBottom: 4 },
  blurb: { backgroundColor: "#EEF3F8", padding: 10, marginBottom: 8, borderRadius: 3, fontSize: 9.5, lineHeight: 1.4, color: "#222222" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 54,
    right: 54,
    borderTopWidth: 0.5,
    borderTopColor: PINK,
    paddingTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: { fontFamily: "Times-Italic", fontSize: 9, color: MGRAY },
  footerPage: { fontFamily: "Times-Roman", fontSize: 8, color: MGRAY },
  row: { flexDirection: "row" },
  tableWrap: { borderWidth: 0.5, borderColor: "#DDDDDD", marginBottom: 10 },
  tHeadCell: { backgroundColor: NAVY, color: WHITE, fontFamily: "Times-Bold", fontSize: 9, padding: 5 },
  tCell: { fontSize: 9.5, padding: 5, borderTopWidth: 0.5, borderTopColor: "#DDDDDD" },
  tCellLabel: { fontFamily: "Times-Roman", color: DGRAY },
  tCellRight: { textAlign: "right" },
  tTotalRow: { backgroundColor: BLUSH, borderTopWidth: 1.5, borderTopColor: PINK },
});

function Divider() {
  return <View style={s.divider} />;
}

function SectionHeader({ children }) {
  return (
    <View>
      <Text style={s.h1}>{String(children).toUpperCase()}</Text>
      <Divider />
    </View>
  );
}

/** Generic table: columns = [{flex, align}], header = [text...], rows = [[text...]], totalRowIndex marks a summary row. */
function DataTable({ columns, header, rows, totalRowIndex }) {
  return (
    <View style={s.tableWrap}>
      <View style={s.row}>
        {header.map((h, i) => (
          <Text key={i} style={[s.tHeadCell, { flex: columns[i]?.flex ?? 1, textAlign: columns[i]?.align ?? "left" }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={[s.row, totalRowIndex === ri ? s.tTotalRow : { backgroundColor: ri % 2 === 0 ? WHITE : LGRAY }]} wrap={false}>
          {row.map((cell, ci) => (
            <Text
              key={ci}
              style={[
                s.tCell,
                { flex: columns[ci]?.flex ?? 1, textAlign: columns[ci]?.align ?? "left" },
                ci === 0 && s.tCellLabel,
                totalRowIndex === ri && { fontFamily: "Times-Bold", color: ci === 0 ? NAVY : PINK },
              ]}
            >
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Footer({ logoUrl }) {
  return (
    <View style={s.footer} fixed>
      {logoUrl && <Image src={logoUrl} style={{ width: 90, height: 22 }} />}
      <Text style={s.footerText}>
        Comparative Market Analysis  |  Confidential  |{" "}
        {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
      </Text>
      <Text style={s.footerPage} render={({ pageNumber }) => `Page ${pageNumber}`} />
    </View>
  );
}

// ── Subject Property Overview ────────────────────────────────────────────────

function SubjectOverview({ transaction }) {
  const rows = [];
  const push = (label, val) => val && rows.push([label, String(val)]);
  push("Street Address", transaction.address);
  push("Town", transaction.town);
  push("Property Type", transaction.property_style);
  push("Seller(s)", transaction.seller_name);
  push("Rough Timeframe", transaction.timeframe);
  push("Electrical", transaction.electrical);
  if (transaction.heating_system?.length) push("Heating System", transaction.heating_system.join(", "));
  if (transaction.basement?.length) push("Basement", transaction.basement.join(", "));
  push("Water Source", transaction.water_source);
  push("Septic", transaction.septic);

  return (
    <View>
      <SectionHeader>Subject Property Overview</SectionHeader>
      {rows.length === 0 ? (
        <Text style={s.caption}>No subject property details entered.</Text>
      ) : (
        <View style={s.tableWrap}>
          {rows.map(([label, val], i) => (
            <View key={label} style={[s.row, { backgroundColor: i % 2 === 0 ? STEEL : LGRAY }]} wrap={false}>
              <Text style={[s.tCell, { flex: 1.3, fontFamily: "Times-Bold", color: NAVY }]}>{label}</Text>
              <Text style={[s.tCell, { flex: 2.7 }]}>{val}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ── Agent Recommendations checklist ──────────────────────────────────────────

function RecommendationsSection({ recommendations }) {
  const items = (recommendations || []).filter((title) => RECOMMENDATION_BODY[title]);
  if (!items.length) return null;
  return (
    <View break>
      <SectionHeader>Agent Recommendations</SectionHeader>
      {items.map((title) => (
        <View key={title} wrap={false} style={{ marginBottom: 8 }}>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 11, color: PINK, marginBottom: 1 }}>
            •  {cleanRecommendationTitle(title)}
          </Text>
          <Text style={s.bodyIndent}>{RECOMMENDATION_BODY[title]}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Price Recommendation (incl. gradient bar) ────────────────────────────────

function barSegmentColor(t) {
  let r, g, b;
  if (t < 0.5) {
    const t2 = t * 2;
    r = 0xee + (0xe9 - 0xee) * t2;
    g = 0xf1 + (0x1e - 0xf1) * t2;
    b = 0xf4 + (0x63 - 0xf4) * t2;
  } else {
    const t2 = (t - 0.5) * 2;
    r = 0xe9 + (0x17 - 0xe9) * t2;
    g = 0x1e + (0x33 - 0x1e) * t2;
    b = 0x63 + (0x48 - 0x63) * t2;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function PriceScaleBar({ priceLow, priceHigh, priceRec }) {
  const barW = 480;
  const barH = 26;
  const segments = 80;
  const segW = barW / segments;
  const ratio = priceHigh > priceLow ? Math.min(0.98, Math.max(0.02, (priceRec - priceLow) / (priceHigh - priceLow))) : 0.5;
  const arrowX = ratio * barW;

  return (
    <Svg width={barW} height={44} style={{ marginBottom: 4 }}>
      {Array.from({ length: segments }, (_, i) => (
        <Rect key={i} x={i * segW} y={16} width={segW + 0.5} height={barH} fill={barSegmentColor(i / segments)} />
      ))}
      <Polygon points={`${arrowX - 6},14 ${arrowX + 6},14 ${arrowX},2`} fill={NAVY} />
    </Svg>
  );
}

function PriceRecommendation({ priceLow, priceHigh, priceRec, priceNotes }) {
  return (
    <View break>
      <SectionHeader>Price Recommendation</SectionHeader>

      <PriceScaleBar priceLow={priceLow} priceHigh={priceHigh} priceRec={priceRec} />
      <View style={[s.row, { justifyContent: "space-between", marginBottom: 8 }]}>
        <Text style={{ fontFamily: "Times-Bold", fontSize: 11, color: "#555555" }}>${priceLow.toLocaleString()}</Text>
        <Text style={{ fontFamily: "Times-Bold", fontSize: 11, color: "#555555" }}>${priceHigh.toLocaleString()}</Text>
      </View>

      <Text style={{ fontFamily: "Times-Bold", fontSize: 11, color: NAVY, marginBottom: 4 }}>Why is there a range?</Text>
      <Text style={s.body}>
        Pricing is an art, not a science. We believe any sale is a team effort between us as your agents and you as
        the seller. The more prepared you are, the higher the price you can generate and vice versa. If you would
        prefer to sell it without the hassle, we need to price it accordingly to keep those projects in mind.
      </Text>

      <Text style={{ fontSize: 9, color: "#444444", lineHeight: 1.4, marginLeft: 8, marginBottom: 4 }}>
        <Text style={{ fontFamily: "Times-Bold" }}>${priceLow.toLocaleString()} — As-Is:</Text> Property sold in
        current condition, not cleaned out, not in photo-ready condition.
      </Text>
      <Text style={{ fontSize: 9, color: "#444444", lineHeight: 1.4, marginLeft: 8, marginBottom: 8 }}>
        <Text style={{ fontFamily: "Times-Bold" }}>${priceHigh.toLocaleString()} — Instagram-Worthy:</Text> Top-notch
        condition, full inspection reports on hand, smoke detectors up to date, exceptionally clean, no smell of
        animals.
      </Text>

      <Text style={{ fontFamily: "Times-Bold", fontSize: 17, color: NAVY, textAlign: "center", marginBottom: 4 }}>
        Our Recommended List Price: ${priceRec.toLocaleString()}
      </Text>
      <View style={{ borderBottomWidth: 0.5, borderBottomColor: PINK, width: "60%", alignSelf: "center", marginBottom: 6 }} />
      <Text style={{ fontFamily: "Times-Italic", fontSize: 9, color: MGRAY, textAlign: "center", marginBottom: 14 }}>
        Based on current market conditions
      </Text>

      {!!priceNotes?.trim() && (
        <Text style={s.body}>
          <Text style={{ fontFamily: "Times-Bold" }}>Agent Pricing Notes: </Text>
          <Text style={{ fontFamily: "Times-Italic" }}>{priceNotes.trim()}</Text>
        </Text>
      )}

      <Text style={{ fontFamily: "Times-Italic", fontSize: 9, color: NAVY, lineHeight: 1.4, textAlign: "justify" }}>
        We pride ourselves in our firm that we don't attempt to inflate the value to win the listing. This is where
        we earnestly feel as though the property will settle on the market. We are not perfect and this is not an
        exact science, but we want to work together with you as a team. We love what we do and we want you to have
        as seamless of an experience as possible!
      </Text>
    </View>
  );
}

// ── Agent Notes ───────────────────────────────────────────────────────────────

function AgentNotes({ notes }) {
  if (!notes?.trim()) return null;
  const paragraphs = notes.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <View>
      <Divider />
      <SectionHeader>Agent Notes</SectionHeader>
      {(paragraphs.length ? paragraphs : [notes]).map((p, i) => (
        <Text key={i} style={s.bodyIndent}>
          {p.replace(/\n/g, " ")}
        </Text>
      ))}
    </View>
  );
}

// ── Land Valuation Analysis ───────────────────────────────────────────────────

function LandSection({ land, priceRec }) {
  const v = computeLandValuation(land);
  const rows = [["Base land value (all parcels)", money(v.baseValue)], [`Acreage value (${v.acres.toFixed(1)} acres × $1,000/acre)`, money(v.acreValue)]];
  if (v.roadPremium) rows.push([`Road frontage premium — ${land.roadFrontage}`, money(v.roadPremium)]);
  if (v.contiguousPremium) rows.push([`Parcel character — ${land.parcelCharacter}`, money(v.contiguousPremium)]);
  if (v.percPremium) rows.push([`Perc/soil work — ${land.percStatus}`, money(v.percPremium)]);
  v.completedDev.forEach((item) => rows.push([`    ${item.label}`, money(item.value)]));
  const totalRowIndex = rows.length;
  rows.push(["Suggested List Price", money(v.suggested)]);

  return (
    <View>
      <SectionHeader>Land Valuation Analysis</SectionHeader>
      <Text style={s.blurb}>
        <Text style={{ fontFamily: "Times-Bold" }}>How land is priced</Text> — Land value in this market is a
        sliding scale based entirely on the level of development already completed. Every parcel starts at a{" "}
        <Text style={{ fontFamily: "Times-Bold" }}>$35,000 baseline</Text> regardless of size, then adds
        approximately <Text style={{ fontFamily: "Times-Bold" }}>$1,000 per acre</Text> of undeveloped land. From
        there, value increases based on what work has already been done — a driveway, well, septic, electrical
        service, and cleared site prep all reduce the buyer's cost and risk, and are reflected directly in the
        price.
      </Text>

      <DataTable
        columns={[{ flex: 3, align: "left" }, { flex: 1.3, align: "right" }]}
        header={["Value Component", "Amount"]}
        rows={rows}
        totalRowIndex={totalRowIndex}
      />

      <Text style={{ fontFamily: "Times-Bold", fontSize: 10, color: NAVY, marginBottom: 4 }}>Property Improvements Checklist</Text>
      <DataTable
        columns={[{ flex: 2.2, align: "left" }, { flex: 1, align: "right" }, { flex: 1, align: "right" }]}
        header={["Improvement", "Status", "Est. Value"]}
        rows={LAND_DEV_ITEMS.map((item) => {
          const done = v.completedDev.some((d) => d.key === item.key);
          return [item.label, done ? "Yes" : "No", done ? money(item.value) : "—"];
        })}
      />

      {v.comps.length > 0 && (
        <>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 10, color: NAVY, marginBottom: 4 }}>Land Comparable Sales</Text>
          <DataTable
            columns={[{ flex: 2, align: "left" }, { flex: 1.3, align: "right" }, { flex: 1.2, align: "right" }, { flex: 1.8, align: "left" }]}
            header={["Address", "Sale Price", "Acres", "Notes"]}
            rows={v.comps.map((c) => {
              const ppa = c.salePrice && c.acres ? ` (${money(c.salePrice / c.acres)}/ac)` : "";
              return [c.address || "—", c.salePrice ? money(c.salePrice) : "—", c.acres ? `${Number(c.acres).toFixed(1)} ac${ppa}` : "—", c.notes || ""];
            })}
          />
        </>
      )}

      <Text style={s.blurb}>
        <Text style={{ fontFamily: "Times-Bold" }}>Pricing Note:</Text> At{" "}
        <Text style={{ fontFamily: "Times-Bold" }}>{money(v.suggested)}</Text>, this parcel is priced to reflect its
        current state of development and the local market for raw or partially improved land.{" "}
        {v.completedDev.length === 0
          ? "Since this parcel is undeveloped, a buyer will need to budget for all site work — driveway, well, septic, and electrical — before construction can begin. That full cost burden is reflected in the conservative pricing above."
          : v.completedDev.length >= 3
          ? `With ${v.completedDev.length} development items already completed (${v.completedDev.slice(0, 3).map((d) => d.label).join(", ")}${v.completedDev.length > 3 ? "…" : ""}), this parcel offers meaningful value to a buyer who wants to move quickly.`
          : ""}{" "}
        Land can be a patient asset — pricing above the model's output is possible, but expect longer days on market
        unless demand is unusually strong or a specific buyer need aligns with this parcel.
      </Text>
    </View>
  );
}

// ── Multi-Family Cap Rate Analysis ────────────────────────────────────────────

function CapRateSection({ mf, priceRec }) {
  const a = computeCapRateAnalysis(mf, priceRec);

  return (
    <View>
      <SectionHeader>Multi-Family Income &amp; Cap Rate Analysis</SectionHeader>

      {a.unitRents.length > 0 && (
        <>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 10, color: NAVY, marginBottom: 4 }}>Rent by Unit</Text>
          <DataTable
            columns={
              a.hasMarket
                ? [{ flex: 0.4, align: "center" }, { flex: 2, align: "left" }, { flex: 1.2, align: "center" }, { flex: 1.2, align: "center" }, { flex: 0.8, align: "center" }]
                : [{ flex: 0.4, align: "center" }, { flex: 2.2, align: "left" }, { flex: 1.4, align: "center" }]
            }
            header={a.hasMarket ? ["#", "Unit Description", "Current Rent/mo", "Market Rent/mo", "Δ/mo"] : ["#", "Unit Description", "Current Rent/mo"]}
            rows={a.unitRents.map((u, i) => {
              const cur = Number(u.current) || 0;
              const mkt = Number(u.market) || 0;
              const diff = mkt - cur;
              return a.hasMarket
                ? [String(i + 1), u.label || `Unit ${i + 1}`, money(cur, "$0"), money(mkt, "$0"), `${diff >= 0 ? "+" : ""}${diff.toLocaleString()}`]
                : [String(i + 1), u.label || `Unit ${i + 1}`, money(cur, "$0")];
            })}
          />
          {a.includedUtilities.length > 0 ? (
            <Text style={{ fontSize: 9, color: GREEN, backgroundColor: "#F1F8E9", padding: 6, marginBottom: 8 }}>
              Included in rent: {a.includedUtilities.join("  ·  ")}
            </Text>
          ) : (
            <Text style={[s.caption]}>No utilities included in rent.</Text>
          )}
        </>
      )}

      <DataTable
        columns={a.hasMarket ? [{ flex: 2.5 }, { flex: 1.2, align: "right" }, { flex: 1.2, align: "right" }] : [{ flex: 2.5 }, { flex: 1.2, align: "right" }]}
        header={a.hasMarket ? ["Income & Expense Summary", "Current Rents", "Market Rents"] : ["Income & Expense Summary", "Annual Amount"]}
        rows={[
          a.hasMarket ? ["Gross Annual Rent", money(a.grossCur), money(a.grossMkt)] : ["Gross Annual Rent", money(a.grossCur)],
          a.hasMarket
            ? [`Less Vacancy (${a.vacancyPct.toFixed(1)}%)`, `(${money(a.grossCur - a.effCur)})`, `(${money(a.grossMkt - a.effMkt)})`]
            : [`Less Vacancy (${a.vacancyPct.toFixed(1)}%)`, `(${money(a.grossCur - a.effCur)})`],
          a.hasMarket ? ["Effective Gross Income", money(a.effCur), money(a.effMkt)] : ["Effective Gross Income", money(a.effCur)],
          a.hasMarket ? ["Property Taxes", money(a.taxes), money(a.taxes)] : ["Property Taxes", money(a.taxes)],
          a.hasMarket ? ["Insurance", money(a.insurance), money(a.insurance)] : ["Insurance", money(a.insurance)],
          a.hasMarket ? ["Maintenance & Other", money(a.maintenance), money(a.maintenance)] : ["Maintenance & Other", money(a.maintenance)],
          a.hasMarket
            ? [`Capital Reserve (${a.reservePct.toFixed(0)}% of gross)`, `(${money(a.reserveCur)})`, `(${money(a.reserveMkt)})`]
            : [`Capital Reserve (${a.reservePct.toFixed(0)}% of gross)`, `(${money(a.reserveCur)})`],
          a.hasMarket
            ? ["Net Operating Income (NOI)", money(a.noiCur), money(a.noiMkt)]
            : ["Net Operating Income (NOI)", money(a.noiCur)],
        ]}
        totalRowIndex={a.hasMarket ? 7 : 7}
      />

      <View style={[s.row, { marginBottom: 10 }]}>
        <View style={{ flex: 1, backgroundColor: BLUSH, padding: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 9, color: NAVY, marginBottom: 3 }}>Recommended Price</Text>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 14, color: NAVY }}>{money(priceRec)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: NAVY, padding: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 9, color: WHITE, marginBottom: 3 }}>Cap Rate — Current</Text>
          <Text style={{ fontFamily: "Times-Bold", fontSize: 16, color: WHITE }}>{pct(a.capCur)}</Text>
        </View>
        {a.hasMarket && (
          <View style={{ flex: 1, backgroundColor: PINK, padding: 8, alignItems: "center" }}>
            <Text style={{ fontSize: 9, color: WHITE, marginBottom: 3 }}>Cap Rate — Market</Text>
            <Text style={{ fontFamily: "Times-Bold", fontSize: 16, color: WHITE }}>{pct(a.capMkt)}</Text>
          </View>
        )}
      </View>
      <Text style={s.caption}>
        Cap rate = NOI ÷ Recommended Price. This is an estimate based on provided figures and should not substitute
        a full investment analysis or professional appraisal.
      </Text>

      {a.prAt7Cur > 0 && (
        <View break>
          <SectionHeader>Income-Based Price Recommendation</SectionHeader>
          <Text style={s.blurb}>
            <Text style={{ fontFamily: "Times-Bold" }}>Cap Rate</Text> — return on an all-cash purchase (NOI ÷
            Price, no debt). A {CAP_LOW.toFixed(0)}% cap rate means the property generates{" "}
            <Text style={{ fontFamily: "Times-Bold" }}>${CAP_LOW} of annual income for every $100 of purchase price</Text>.
            Investors targeting {CAP_LOW.toFixed(0)}–{CAP_HIGH.toFixed(0)}% are typical in Northern New England
            multi-family.
          </Text>
          <DataTable
            columns={[{ flex: 3 }, { flex: 1.2, align: "right" }, { flex: 1, align: "right" }]}
            header={["Price Scenario", "Implied Price", "Return %"]}
            rows={[
              [`${CAP_LOW.toFixed(0)}% cap rate — investor ceiling`, money(a.prAt7Cur), pct(CAP_LOW, 1)],
              [`${CAP_HIGH.toFixed(0)}% cap rate — strong investor value`, money(a.prAt11Cur), pct(CAP_HIGH, 1)],
              ...(a.prAt7Mkt > 0
                ? [
                    [`${CAP_LOW.toFixed(0)}% cap rate at market rents`, money(a.prAt7Mkt), pct(CAP_LOW, 1)],
                    [`${CAP_HIGH.toFixed(0)}% cap rate at market rents`, money(a.prAt11Mkt), pct(CAP_HIGH, 1)],
                  ]
                : []),
            ]}
          />

          {a.showFinancing && a.prCoc8Cur > 0 && (
            <>
              <Text style={s.blurb}>
                <Text style={{ fontFamily: "Times-Bold" }}>A Note on Financing and List Price Strategy</Text>
                {"\n\n"}
                Most serious multi-family investors in this market purchase in cash or with significant reserves,
                and they underwrite to a cash cap rate first. We recommend starting at the cash-based price above —
                it is well-supported by the income. However, if buyer activity is soft or feedback points to a
                financed buyer pool, it is worth understanding what price delivers an attractive cash-on-cash return
                under a financed scenario.
                {"\n\n"}
                A good CoC return is generally {COC_LOW.toFixed(0)}–{COC_HIGH.toFixed(0)}%. The table below shows
                what today's recommended price ({money(priceRec)}) actually delivers on a financed basis (
                {a.downPct.toFixed(0)}% down @ {a.rateAnnual.toFixed(2)}% / {a.termYrs} yr). If that number is below{" "}
                {COC_LOW.toFixed(0)}%, a price reduction may be necessary to attract financed buyers.
                {"\n\n"}
                <Text style={{ fontFamily: "Times-Bold" }}>
                  To deliver a minimum {COC_LOW.toFixed(0)}% CoC on current rents, the price would need to be at or
                  below {money(a.prCoc8Cur)}.
                </Text>
                {a.hasMarket && a.prCoc8Mkt > 0 ? ` At market rents, that floor rises to ${money(a.prCoc8Mkt)}.` : ""}
              </Text>

              <DataTable
                columns={a.hasMarket ? [{ flex: 2.5 }, { flex: 1.2, align: "right" }, { flex: 1.2, align: "right" }] : [{ flex: 2.5 }, { flex: 1.2, align: "right" }]}
                header={a.hasMarket ? [`At Recommended Price: ${money(priceRec)}`, "Current Rents", "Market Rents"] : [`At Recommended Price: ${money(priceRec)}`, "Amount"]}
                rows={[
                  a.hasMarket ? [`Down Payment (${a.downPct.toFixed(0)}%)`, money(a.downAmt), money(a.downAmt)] : [`Down Payment (${a.downPct.toFixed(0)}%)`, money(a.downAmt)],
                  a.hasMarket ? ["Annual Debt Service", `(${money(a.annualDebt)})`, `(${money(a.annualDebt)})`] : ["Annual Debt Service", `(${money(a.annualDebt)})`],
                  a.hasMarket ? ["NOI", money(a.noiCur), money(a.noiMkt)] : ["NOI", money(a.noiCur)],
                  a.hasMarket
                    ? ["Cash Flow After Financing", money(a.cfCur), money(a.cfMkt)]
                    : ["Cash Flow After Financing", money(a.cfCur)],
                  a.hasMarket ? ["Cash-on-Cash Return", pct(a.cocCur), pct(a.cocMkt)] : ["Cash-on-Cash Return", pct(a.cocCur)],
                ]}
                totalRowIndex={4}
              />
            </>
          )}
          <Text style={s.caption}>
            ★ Cap rate = NOI ÷ Price (cash basis, no debt). These are income-based price targets for investor
            buyers. Final list price may differ based on comparable sales, condition, and market demand.{" "}
            {CAP_LOW.toFixed(0)}–{CAP_HIGH.toFixed(0)}% is a typical Northern New England multi-family cap rate
            range.
          </Text>
        </View>
      )}

      {a.showFinancing && (
        <View break>
          <SectionHeader>Financing Scenario Analysis</SectionHeader>
          <Text style={s.blurb}>
            <Text style={{ fontFamily: "Times-Bold" }}>Cash-on-Cash Return (CoC)</Text> answers the question an
            investor with a mortgage actually cares about: after making the down payment and covering the mortgage
            every month, how much cash is left over — and what return does that represent on the money I put in?
            This scenario assumes {a.downPct.toFixed(0)}% down at {a.rateAnnual.toFixed(3)}% interest over{" "}
            {a.termYrs} years. An {COC_LOW.toFixed(0)}–{COC_HIGH.toFixed(0)}% CoC is generally considered a strong
            leveraged return in this market.
          </Text>
          <DataTable
            columns={a.hasMarket ? [{ flex: 2.5 }, { flex: 1.2, align: "right" }, { flex: 1.2, align: "right" }] : [{ flex: 2.5 }, { flex: 1.2, align: "right" }]}
            header={a.hasMarket ? ["Item", "Current Rents", "Market Rents"] : ["Item", "Amount"]}
            rows={[
              a.hasMarket ? ["Purchase Price", money(priceRec), money(priceRec)] : ["Purchase Price", money(priceRec)],
              a.hasMarket
                ? [`Down Payment (${a.downPct.toFixed(0)}%)`, money(a.downAmt), money(a.downAmt)]
                : [`Down Payment (${a.downPct.toFixed(0)}%)`, money(a.downAmt)],
              a.hasMarket ? ["Loan Amount", money(a.loanAmt), money(a.loanAmt)] : ["Loan Amount", money(a.loanAmt)],
              a.hasMarket
                ? [`Monthly Payment`, money(a.monthlyPayment), money(a.monthlyPayment)]
                : [`Monthly Payment`, money(a.monthlyPayment)],
              a.hasMarket ? ["Annual Debt Service", `(${money(a.annualDebt)})`, `(${money(a.annualDebt)})`] : ["Annual Debt Service", `(${money(a.annualDebt)})`],
              a.hasMarket ? ["NOI", money(a.noiCur), money(a.noiMkt)] : ["NOI", money(a.noiCur)],
              a.hasMarket ? ["Cash Flow After Financing", money(a.cfCur), money(a.cfMkt)] : ["Cash Flow After Financing", money(a.cfCur)],
              a.hasMarket ? ["Cash-on-Cash Return", pct(a.cocCur), pct(a.cocMkt)] : ["Cash-on-Cash Return", pct(a.cocCur)],
            ]}
          />
          <View style={{ backgroundColor: "#FFF8E1", borderWidth: 1.5, borderColor: "#F9A825", padding: 10 }}>
            <Text style={{ fontFamily: "Times-Bold", fontSize: 10, color: DGRAY, marginBottom: 4 }}>
              Important Note on Bank Financing
            </Text>
            <Text style={{ fontSize: 9.5, lineHeight: 1.4, color: DGRAY }}>
              Commercial lenders typically require a minimum of two years of documented operating history (rent
              rolls, tax returns, profit &amp; loss statements) before approving a loan on a multi-family investment
              property. A buyer without that track record will likely need to purchase in cash or through a
              private/bridge lender at a higher rate until that history is established. This financing scenario is
              illustrative and assumes the buyer qualifies for conventional commercial financing at{" "}
              {a.rateAnnual.toFixed(3)}%.
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

// ── Top-level document ────────────────────────────────────────────────────────

export default function CmaDocument({ transaction, form, logoDataUrl }) {
  const isLand = transaction.property_style === "Land";
  const isMultiFamily = transaction.property_style === "Multi Family";

  return (
    <Document>
      <Page size="LETTER" style={s.page} wrap>
        <SubjectOverview transaction={transaction} />
        <Divider />

        {isMultiFamily && form.multiFamily && (
          <>
            <CapRateSection mf={form.multiFamily} priceRec={form.priceRec} />
            <Divider />
          </>
        )}

        {isLand && form.land && (
          <>
            <LandSection land={form.land} priceRec={form.priceRec} />
            <Divider />
          </>
        )}

        <RecommendationsSection recommendations={transaction.recommendations} />

        <PriceRecommendation priceLow={form.priceLow} priceHigh={form.priceHigh} priceRec={form.priceRec} priceNotes={form.priceNotes} />

        <AgentNotes notes={form.agentNotes} />

        <Footer logoUrl={logoDataUrl} />
      </Page>
    </Document>
  );
}
