import { useState } from "react";
import { FileText } from "lucide-react";
import CheckboxGroup from "./CheckboxGroup";
import RadioGroup from "./RadioGroup";
import { updateTransactionFields, uploadCompPdf, addActivityLog } from "../lib/transactions";
import { ROAD_FRONTAGE_OPTIONS, PARCEL_CHARACTER_OPTIONS, PERC_STATUS_OPTIONS, LAND_DEV_ITEMS } from "../lib/compPdf/landPricing";
import { UTILITY_OPTIONS } from "../lib/compPdf/capRateMath";

const DEFAULT_LAND = { acres: "", roadFrontage: "None", parcelCharacter: "Standard lot", percStatus: "None done", devItems: {}, comps: [{}, {}, {}] };
const DEFAULT_MF = {
  units: 2,
  unitRents: [{ label: "Unit 1", current: "", market: "" }, { label: "Unit 2", current: "", market: "" }],
  vacancyPct: 5,
  taxes: "",
  insurance: "",
  maintenance: "",
  reservePct: 5,
  includedUtilities: [],
  downPct: 25,
  interestRate: 7,
  loanTermYrs: 30,
};

function resizeUnitRents(unitRents, count) {
  const next = unitRents.slice(0, count);
  while (next.length < count) next.push({ label: `Unit ${next.length + 1}`, current: "", market: "" });
  return next;
}

export default function GenerateCompForm({ transaction, onCancel, onGenerated }) {
  const isLand = transaction.property_style === "Land";
  const isMultiFamily = transaction.property_style === "Multi Family";
  const saved = transaction.comp_analysis || {};

  const [priceLow, setPriceLow] = useState(saved.priceLow ?? "");
  const [priceHigh, setPriceHigh] = useState(saved.priceHigh ?? "");
  const [priceRec, setPriceRec] = useState(saved.priceRec ?? "");
  const [priceNotes, setPriceNotes] = useState(saved.priceNotes ?? "");
  const [agentNotes, setAgentNotes] = useState(saved.agentNotes ?? "");
  const [land, setLand] = useState({ ...DEFAULT_LAND, ...saved.land });
  const [mf, setMf] = useState({ ...DEFAULT_MF, ...saved.multiFamily });
  const [supplementalFile, setSupplementalFile] = useState(null);
  const [anrFile, setAnrFile] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [resultUrl, setResultUrl] = useState(transaction.last_comp_url || null);

  function updateLand(patch) {
    setLand((l) => ({ ...l, ...patch }));
  }
  function toggleDevItem(key) {
    setLand((l) => ({ ...l, devItems: { ...l.devItems, [key]: !l.devItems[key] } }));
  }
  function updateLandComp(i, patch) {
    setLand((l) => {
      const comps = [...l.comps];
      comps[i] = { ...comps[i], ...patch };
      return { ...l, comps };
    });
  }

  function updateMf(patch) {
    setMf((m) => ({ ...m, ...patch }));
  }
  function setUnitCount(count) {
    setMf((m) => ({ ...m, units: count, unitRents: resizeUnitRents(m.unitRents, count) }));
  }
  function updateUnitRent(i, patch) {
    setMf((m) => {
      const unitRents = [...m.unitRents];
      unitRents[i] = { ...unitRents[i], ...patch };
      return { ...m, unitRents };
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const low = Number(priceLow);
    const high = Number(priceHigh);
    const rec = Number(priceRec);
    if (!low || !high || !rec) {
      setError("Price low, high, and recommended are all required.");
      return;
    }

    const form = {
      priceLow: low,
      priceHigh: high,
      priceRec: rec,
      priceNotes,
      agentNotes,
      land: isLand ? { ...land, acres: Number(land.acres) || 0 } : undefined,
      multiFamily: isMultiFamily
        ? {
            ...mf,
            vacancyPct: Number(mf.vacancyPct) || 0,
            taxes: Number(mf.taxes) || 0,
            insurance: Number(mf.insurance) || 0,
            maintenance: Number(mf.maintenance) || 0,
            reservePct: Number(mf.reservePct) || 0,
            downPct: Number(mf.downPct) || 0,
            interestRate: Number(mf.interestRate) || 0,
            loanTermYrs: Number(mf.loanTermYrs) || 0,
            unitRents: mf.unitRents.map((u) => ({ ...u, current: Number(u.current) || 0, market: Number(u.market) || 0 })),
          }
        : undefined,
    };

    setGenerating(true);
    try {
      // Dynamically imported so @react-pdf/renderer and pdf-lib (a couple MB combined)
      // only load when someone actually generates a comp, not on every app load.
      const { buildCompPdf, compPdfFileName } = await import("../lib/compPdf/buildCompPdf");
      const pdfBytes = await buildCompPdf(transaction, form, supplementalFile, anrFile);
      const fileName = compPdfFileName(transaction);
      const result = await uploadCompPdf(transaction.id, pdfBytes, fileName);
      await updateTransactionFields(transaction.id, { comp_analysis: form });
      await addActivityLog(transaction.id, "Generated comp PDF", fileName);
      setResultUrl(result.fileUrl);
      onGenerated?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <form className="uc-form generate-comp-form" onSubmit={handleSubmit}>
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">{transaction.address}</div>
          <h1>Generate Comp</h1>
        </div>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {resultUrl && (
        <a href={resultUrl} target="_blank" rel="noreferrer" className="cma-export-btn">
          <FileText size={14} /> View Generated Comp
        </a>
      )}

      <fieldset>
        <legend>Price Band</legend>
        <label>
          Lowest Price — As-Is ($)
          <input type="number" value={priceLow} onChange={(e) => setPriceLow(e.target.value)} placeholder="e.g. 400000" required />
        </label>
        <label>
          Highest Price — Instagram-Worthy ($)
          <input type="number" value={priceHigh} onChange={(e) => setPriceHigh(e.target.value)} placeholder="e.g. 450000" required />
        </label>
        <label>
          Recommended List Price ($)
          <input type="number" value={priceRec} onChange={(e) => setPriceRec(e.target.value)} placeholder="e.g. 425000" required />
        </label>
        <label>
          Agent Pricing Notes
          <textarea value={priceNotes} onChange={(e) => setPriceNotes(e.target.value)} rows={2} placeholder="Rationale behind the price…" />
        </label>
      </fieldset>

      {isLand && (
        <fieldset>
          <legend>Land Valuation</legend>
          <label>
            Lot Size (acres)
            <input type="number" step="0.1" value={land.acres} onChange={(e) => updateLand({ acres: e.target.value })} />
          </label>
          <div>
            <div className="detail-label">Road Frontage</div>
            <RadioGroup name="roadFrontage" value={land.roadFrontage} onChange={(v) => updateLand({ roadFrontage: v })} options={ROAD_FRONTAGE_OPTIONS} />
          </div>
          <div>
            <div className="detail-label">Parcel Character</div>
            <RadioGroup name="parcelCharacter" value={land.parcelCharacter} onChange={(v) => updateLand({ parcelCharacter: v })} options={PARCEL_CHARACTER_OPTIONS} />
          </div>
          <div>
            <div className="detail-label">Perc Test / Soil Work</div>
            <RadioGroup name="percStatus" value={land.percStatus} onChange={(v) => updateLand({ percStatus: v })} options={PERC_STATUS_OPTIONS} />
          </div>
          <div>
            <div className="detail-label">Development / Improvements Already Completed</div>
            <CheckboxGroup
              name="devItems"
              values={LAND_DEV_ITEMS.filter((i) => land.devItems[i.key]).map((i) => i.key)}
              onChange={(keys) => updateLand({ devItems: Object.fromEntries(keys.map((k) => [k, true])) })}
              options={LAND_DEV_ITEMS.map((i) => ({ value: i.key, label: `${i.label} (+$${i.value.toLocaleString()})` }))}
            />
          </div>
          <div className="detail-label">Land Comparable Sales (optional, up to 3)</div>
          {land.comps.map((c, i) => (
            <div key={i} className="land-comp-row">
              <input placeholder="Address" value={c.address || ""} onChange={(e) => updateLandComp(i, { address: e.target.value })} />
              <input type="number" placeholder="Sale Price" value={c.salePrice || ""} onChange={(e) => updateLandComp(i, { salePrice: e.target.value })} />
              <input type="number" step="0.1" placeholder="Acres" value={c.acres || ""} onChange={(e) => updateLandComp(i, { acres: e.target.value })} />
              <input placeholder="Notes" value={c.notes || ""} onChange={(e) => updateLandComp(i, { notes: e.target.value })} />
            </div>
          ))}
        </fieldset>
      )}

      {isMultiFamily && (
        <fieldset>
          <legend>Multi-Family Income Analysis</legend>
          <label>
            Number of Units
            <input type="number" min={1} max={20} value={mf.units} onChange={(e) => setUnitCount(Number(e.target.value) || 1)} />
          </label>
          {mf.unitRents.map((u, i) => (
            <div key={i} className="unit-rent-row">
              <input placeholder={`Unit ${i + 1} description`} value={u.label} onChange={(e) => updateUnitRent(i, { label: e.target.value })} />
              <input type="number" placeholder="Current rent/mo" value={u.current} onChange={(e) => updateUnitRent(i, { current: e.target.value })} />
              <input type="number" placeholder="Market rent/mo" value={u.market} onChange={(e) => updateUnitRent(i, { market: e.target.value })} />
            </div>
          ))}
          <div>
            <div className="detail-label">Included in Rent</div>
            <CheckboxGroup name="utilities" values={mf.includedUtilities} onChange={(v) => updateMf({ includedUtilities: v })} options={UTILITY_OPTIONS} />
          </div>
          <label>
            Vacancy Rate (%)
            <input type="number" step="0.5" value={mf.vacancyPct} onChange={(e) => updateMf({ vacancyPct: e.target.value })} />
          </label>
          <label>
            Annual Property Taxes ($)
            <input type="number" value={mf.taxes} onChange={(e) => updateMf({ taxes: e.target.value })} />
          </label>
          <label>
            Annual Insurance ($)
            <input type="number" value={mf.insurance} onChange={(e) => updateMf({ insurance: e.target.value })} />
          </label>
          <label>
            Annual Maintenance & Other ($)
            <input type="number" value={mf.maintenance} onChange={(e) => updateMf({ maintenance: e.target.value })} />
          </label>
          <label>
            Capital Reserve (% of gross rent)
            <input type="number" step="0.5" value={mf.reservePct} onChange={(e) => updateMf({ reservePct: e.target.value })} />
          </label>
          <p className="field-help">Financing (optional — leave down payment or rate at 0 to skip cash-on-cash/financing sections)</p>
          <label>
            Down Payment (%)
            <input type="number" value={mf.downPct} onChange={(e) => updateMf({ downPct: e.target.value })} />
          </label>
          <label>
            Interest Rate (%)
            <input type="number" step="0.125" value={mf.interestRate} onChange={(e) => updateMf({ interestRate: e.target.value })} />
          </label>
          <label>
            Loan Term (years)
            <input type="number" value={mf.loanTermYrs} onChange={(e) => updateMf({ loanTermYrs: e.target.value })} />
          </label>
        </fieldset>
      )}

      <fieldset>
        <legend>Agent Notes</legend>
        <textarea value={agentNotes} onChange={(e) => setAgentNotes(e.target.value)} rows={4} placeholder="General notes for this write-up…" />
      </fieldset>

      <fieldset>
        <legend>Attachments (optional)</legend>
        <label>
          Supplemental PDF <span className="field-help">(an existing comp PDF — its first 2 pages get replaced by our cover sheet)</span>
          <input type="file" accept="application/pdf" onChange={(e) => setSupplementalFile(e.target.files?.[0] || null)} />
        </label>
        <label>
          Vermont ANR Map PDF <span className="field-help">(appended to the end as-is)</span>
          <input type="file" accept="application/pdf" onChange={(e) => setAnrFile(e.target.files?.[0] || null)} />
        </label>
      </fieldset>

      <button type="submit" className="google-btn uc-submit" disabled={generating}>
        {generating ? "Generating…" : "Generate Comp"}
      </button>
    </form>
  );
}
