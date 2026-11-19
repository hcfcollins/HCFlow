import { useState } from "react";
import { FileText, X, UploadCloud } from "lucide-react";
import EmailListInput from "./EmailListInput";
import CheckboxGroup from "./CheckboxGroup";
import RadioGroup from "./RadioGroup";
import { updateTransactionFields, uploadCompPdf, addActivityLog, polishAgentNotes } from "../lib/transactions";
import { focusNextOnEnter } from "../lib/formKeyNav";
import { streetOf } from "../lib/folderOrganizer";
import { ROAD_FRONTAGE_OPTIONS, PARCEL_CHARACTER_OPTIONS, PERC_STATUS_OPTIONS, LAND_DEV_ITEMS, LAND_PER_ACRE } from "../lib/compPdf/landPricing";
import { UTILITY_OPTIONS } from "../lib/compPdf/capRateMath";
import { LandEstimate, IncomeAnalysis, suggestedPrices } from "./CompValuationPreview";
import {
  TIMEFRAMES,
  PROPERTY_STYLES,
  ELECTRICAL_OPTIONS,
  HEATING_OPTIONS,
  BASEMENT_OPTIONS,
  FUEL_TYPE_OPTIONS,
  YES_NO_OPTIONS,
  SOLAR_OPTIONS,
  NOT_SPECIFIED,
  recommendationOptionsFor,
} from "../lib/compFieldOptions";

const DEFAULT_LAND = { acres: "", perAcre: "", roadFrontage: "None", parcelCharacter: "Standard lot", percStatus: "None done", devItems: {}, comps: [{}, {}, {}] };
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

/** Drag-and-drop (or click to choose) for one PDF. */
function PdfDropField({ label, help, file, onFile }) {
  const [over, setOver] = useState(false);
  const take = (list) => {
    const f = [...(list || [])].find((x) => x.type === "application/pdf" || /\.pdf$/i.test(x.name));
    if (f) onFile(f);
  };
  return (
    <div className="comp-drop-field">
      <div className="detail-label">
        {label} {help && <span className="field-help">{help}</span>}
      </div>
      <label
        className={`check-dropzone comp-dropzone ${over ? "check-dropzone--over" : ""} ${file ? "comp-dropzone--set" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        title="Drop a PDF here, or click to choose one"
      >
        <input type="file" accept="application/pdf" hidden onChange={(e) => take(e.target.files)} />
        {file ? (
          <span>
            <FileText size={16} style={{ verticalAlign: -3 }} /> <strong>{file.name}</strong>
            <br />
            <span className="field-help">Drop another to replace it</span>
          </span>
        ) : (
          <span>
            <UploadCloud size={18} style={{ verticalAlign: -4 }} /> <strong>Drop a PDF here</strong> or click to choose
          </span>
        )}
      </label>
      {file && (
        <button type="button" className="import-link-btn" onClick={() => onFile(null)} title="Don't include this file">
          Remove
        </button>
      )}
    </div>
  );
}

export default function GenerateCompForm({ transaction, onCancel, onGenerated }) {
  const saved = transaction.comp_analysis || {};

  // Property/comp details, editable here in case something was entered wrong or has
  // changed since the comp was first created — pre-filled from the transaction.
  const [sellerName, setSellerName] = useState(transaction.seller_name || "");
  const [sellerEmails, setSellerEmails] = useState(transaction.seller_emails?.length ? transaction.seller_emails : [""]);
  const [timeframe, setTimeframe] = useState(transaction.timeframe || TIMEFRAMES[0]);
  const [propertyStyle, setPropertyStyle] = useState(transaction.property_style || PROPERTY_STYLES[0]);
  const [electrical, setElectrical] = useState(transaction.electrical || "");
  const [heatingSystem, setHeatingSystem] = useState(transaction.heating_system || []);
  const [heatingOther, setHeatingOther] = useState("");
  const [basement, setBasement] = useState(transaction.basement || []);
  const [waterSource, setWaterSource] = useState(transaction.water_source || "");
  const [septic, setSeptic] = useState(transaction.septic || "");
  const [beds, setBeds] = useState(transaction.beds ?? "");
  const [baths, setBaths] = useState(transaction.baths ?? "");
  const [garageSpaces, setGarageSpaces] = useState(transaction.garage_spaces ?? "");
  const [lotAcres, setLotAcres] = useState(transaction.lot_acres ?? saved.land?.acres ?? "");
  const [yearBuilt, setYearBuilt] = useState(transaction.year_built ?? "");
  const [featuresNotes, setFeaturesNotes] = useState(transaction.features_notes || "");
  const [finishesNote, setFinishesNote] = useState(transaction.finishes_note || "");
  const [fuelTypes, setFuelTypes] = useState(transaction.fuel_types || []);
  const [privateSeptic, setPrivateSeptic] = useState(transaction.private_septic || NOT_SPECIFIED);
  const [privateWell, setPrivateWell] = useState(transaction.private_well || NOT_SPECIFIED);
  const [hasView, setHasView] = useState(transaction.has_view || NOT_SPECIFIED);
  const [solar, setSolar] = useState(transaction.solar || NOT_SPECIFIED);
  const [boundaryNotes, setBoundaryNotes] = useState(transaction.boundary_notes || "");
  const [recommendations, setRecommendations] = useState(transaction.recommendations || []);

  const isLand = propertyStyle === "Land";
  const isMultiFamily = propertyStyle === "Multi Family";

  const [priceLow, setPriceLow] = useState(saved.priceLow ?? "");
  const [priceHigh, setPriceHigh] = useState(saved.priceHigh ?? "");
  const [priceRec, setPriceRec] = useState(saved.priceRec ?? "");
  const [priceNotes, setPriceNotes] = useState(saved.priceNotes ?? "");
  const [agentNotes, setAgentNotes] = useState(saved.agentNotes ?? "");
  const [land, setLand] = useState({ ...DEFAULT_LAND, ...saved.land });
  const [mf, setMf] = useState({ ...DEFAULT_MF, ...saved.multiFamily });
  const [supplementalFile, setSupplementalFile] = useState(null);
  const [anrFile, setAnrFile] = useState(null);
  const [anrNote, setAnrNote] = useState(null);
  // ✨ Polish: { status: "working" | "ready" | "error", text?, error? } | null
  const [polish, setPolish] = useState(null);

  async function runPolish() {
    setPolish({ status: "working" });
    try {
      const text = await polishAgentNotes(agentNotes, {
        address: transaction.address,
        town: transaction.town,
        seller: sellerName,
        propertyStyle,
        ...(isLand
          ? { roadFrontage: land.roadFrontage, parcelCharacter: land.parcelCharacter, percSoilWork: land.percStatus, improvementsDone: LAND_DEV_ITEMS.filter((i) => land.devItems[i.key]).map((i) => i.label) }
          : { beds, baths, yearBuilt, garageSpaces, heating: heatingSystem, basement, water: waterSource, septic, solar: solar === NOT_SPECIFIED ? "" : solar }),
        ...(isMultiFamily ? { units: mf.units, includedInRent: mf.includedUtilities } : {}),
        lotAcres,
        view: hasView === NOT_SPECIFIED ? "" : hasView,
        features: featuresNotes,
        finishes: isLand ? "" : finishesNote,
        boundaries: boundaryNotes,
        recommendations,
        priceRangeLow: priceLow,
        priceRangeHigh: priceHigh,
        recommendedListPrice: priceRec,
        pricingNotes: priceNotes,
      });
      setPolish({ status: "ready", text });
    } catch (e) {
      setPolish({ status: "error", error: e.message });
    }
  }
  // Land uses the one Lot Size field; the income analysis runs at the recommended price.
  const landForCalc = { ...land, acres: lotAcres };
  const priceForCap = Number(priceRec) || Number(priceHigh) || 0;
  const suggestion = suggestedPrices({ isLand, isMultiFamily, land: landForCalc, mf, priceForCap });
  const suggestionApplied =
    suggestion && Number(priceLow) === suggestion.low && Number(priceHigh) === suggestion.high && Number(priceRec) === suggestion.rec;

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
      land: isLand ? { ...land, acres: Number(lotAcres) || 0 } : undefined,
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

    // Property/comp detail edits made here save back onto the transaction itself
    // (real columns, same as NewCompForm), separate from `form` (the comp_analysis blob).
    const detailsPatch = {
      seller_name: sellerName || null,
      seller_emails: sellerEmails.map((e) => e.trim()).filter(Boolean),
      timeframe,
      property_style: propertyStyle,
      electrical: electrical || null,
      heating_system: heatingOther ? [...heatingSystem, heatingOther] : heatingSystem,
      basement,
      water_source: waterSource,
      septic,
      beds: beds === "" ? null : Number(beds),
      baths: baths === "" ? null : Number(baths),
      garage_spaces: garageSpaces === "" ? null : Number(garageSpaces),
      lot_acres: lotAcres === "" ? null : Number(lotAcres),
      year_built: yearBuilt === "" ? null : Number(yearBuilt),
      features_notes: featuresNotes || null,
      finishes_note: finishesNote || null,
      fuel_types: fuelTypes,
      private_septic: privateSeptic === NOT_SPECIFIED ? null : privateSeptic,
      private_well: privateWell === NOT_SPECIFIED ? null : privateWell,
      has_view: hasView === NOT_SPECIFIED ? null : hasView,
      solar: solar === NOT_SPECIFIED ? null : solar,
      boundary_notes: boundaryNotes || null,
      // Drop recommendations that don't apply to this type (e.g. staging on land).
      recommendations: recommendations.filter((r) => recommendationOptionsFor(propertyStyle).includes(r)),
    };
    // Used for PDF generation immediately, since the `transaction` prop won't reflect
    // these edits until the parent reloads.
    const mergedTransaction = {
      ...transaction,
      ...detailsPatch,
      heating_system: detailsPatch.heating_system,
    };

    setGenerating(true);
    try {
      await updateTransactionFields(transaction.id, detailsPatch);
      // Dynamically imported so @react-pdf/renderer and pdf-lib (a couple MB combined)
      // only load when someone actually generates a comp, not on every app load.
      const { buildCompPdf, compPdfFileName } = await import("../lib/compPdf/buildCompPdf");
      const pdfBytes = await buildCompPdf(mergedTransaction, form, supplementalFile, anrFile);
      const fileName = compPdfFileName(mergedTransaction);
      const result = await uploadCompPdf(transaction.id, pdfBytes, fileName);
      // The ANR map also goes to Showing Docs — now if the listing has its
      // folder, or (saved with the CMAs) automatically once it's won.
      let anrMap = saved.anrMap || null;
      setAnrNote(null);
      if (anrFile) {
        try {
          const street = streetOf(mergedTransaction).replace(/[\\/:*?"<>|]/g, "") || "Property";
          const r = await uploadCompPdf(transaction.id, await anrFile.arrayBuffer(), `${street} - ANR Map.pdf`, "anr");
          if (r.inShowingDocs) {
            setAnrNote("ANR map added to the listing's Showing Docs folder.");
          } else {
            anrMap = { path: r.filePath };
            setAnrNote("ANR map saved — it'll go into Showing Docs automatically when the listing is won.");
          }
        } catch (e) {
          setAnrNote(`Comp saved, but the ANR map couldn't be filed for Showing Docs: ${e.message}`);
        }
      }
      await updateTransactionFields(transaction.id, { comp_analysis: { ...form, ...(anrMap ? { anrMap } : {}) } });
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
    <form className="uc-form generate-comp-form" onSubmit={handleSubmit} onKeyDown={focusNextOnEnter}>
      <header className="app-header">
        <div>
          <div className="brand-eyebrow">{transaction.address}</div>
          <h1>Generate Comp</h1>
        </div>
        <button type="button" className="header-icon-btn" onClick={onCancel} aria-label="Close" title="Close">
          <X size={20} />
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {anrNote && <p className="field-note">{anrNote}</p>}
      {resultUrl && (
        <a href={resultUrl} target="_blank" rel="noreferrer" className="cma-export-btn">
          <FileText size={14} /> View Generated Comp
        </a>
      )}

      <fieldset className="type-picker">
        <legend>Property Type</legend>
        <RadioGroup name="propertyType" value={propertyStyle} onChange={setPropertyStyle} options={PROPERTY_STYLES} />
        <p className="field-help">Land and Multi Family change the form: land drops the house questions and adds the land valuation; multi-family adds the rent and cap rate analysis.</p>
      </fieldset>

      <fieldset>
        <legend>Property Details</legend>
        <p className="field-help">Pre-filled from the comp — fix anything that's changed or was entered wrong.</p>
        <label>
          Seller Name(s)
          <input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
        </label>
        <label>
          Seller Email(s)
          <EmailListInput values={sellerEmails} onChange={setSellerEmails} />
        </label>
        <div>
          <div className="detail-label">Rough Timeframe</div>
          <RadioGroup name="timeframe" value={timeframe} onChange={setTimeframe} options={TIMEFRAMES} />
        </div>
        {!isLand && (
          <>
        <div>
          <div className="detail-label">Electrical</div>
          <RadioGroup name="electrical" value={electrical} onChange={setElectrical} options={ELECTRICAL_OPTIONS} />
        </div>
        <div>
          <div className="detail-label">Heating System</div>
          <CheckboxGroup name="heatingSystem" values={heatingSystem} onChange={setHeatingSystem} options={HEATING_OPTIONS} />
          <input placeholder="Other" value={heatingOther} onChange={(e) => setHeatingOther(e.target.value)} />
        </div>
        <div>
          <div className="detail-label">Basement</div>
          <CheckboxGroup name="basement" values={basement} onChange={setBasement} options={BASEMENT_OPTIONS} />
        </div>
        <label>
          Water Source (and where it is)
          <input value={waterSource} onChange={(e) => setWaterSource(e.target.value)} placeholder="e.g. Drilled well, back of the lot" />
        </label>
        <label>
          Septic (type and where it is)
          <input value={septic} onChange={(e) => setSeptic(e.target.value)} placeholder="e.g. Conventional, front yard" />
        </label>
          </>
        )}
        <div>
          <div className="detail-label">Recommendations</div>
          <CheckboxGroup name="recommendations" values={recommendations} onChange={setRecommendations} options={recommendationOptionsFor(propertyStyle)} />
        </div>
      </fieldset>

      <fieldset>
        <legend>{isLand ? "Parcel Details" : "Subject Property Stats"}</legend>
        <p className="field-help">Appears in the Subject Property Overview section of the generated CMA.</p>
        {!isLand && (
          <>
        <label>
          Bedrooms
          <input type="number" min="0" value={beds} onChange={(e) => setBeds(e.target.value)} />
        </label>
        <label>
          Bathrooms
          <input type="number" min="0" step="0.5" value={baths} onChange={(e) => setBaths(e.target.value)} />
        </label>
        <label>
          Garage Spaces
          <input type="number" min="0" value={garageSpaces} onChange={(e) => setGarageSpaces(e.target.value)} />
        </label>
        <label>
          Lot Size (acres)
          <input type="number" min="0" step="any" value={lotAcres} onChange={(e) => setLotAcres(e.target.value)} />
        </label>
        <label>
          Year Built
          <input type="number" min="1700" max="2100" value={yearBuilt} onChange={(e) => setYearBuilt(e.target.value)} />
        </label>
          </>
        )}
        <label>
          Notable Features / Highlights
          <textarea
            value={featuresNotes}
            onChange={(e) => setFeaturesNotes(e.target.value)}
            rows={2}
            placeholder={isLand ? "e.g. Southern exposure, open meadow, stone walls, brook, mountain views, build sites…" : ""}
          />
        </label>
        {!isLand && (
          <>
        <label>
          Quality of Finishes
          <textarea value={finishesNote} onChange={(e) => setFinishesNote(e.target.value)} rows={2} />
        </label>
        <div>
          <div className="detail-label">Fuel Type(s)</div>
          <CheckboxGroup name="fuelTypes" values={fuelTypes} onChange={setFuelTypes} options={FUEL_TYPE_OPTIONS} />
        </div>
        <label>
          Private Septic
          <select value={privateSeptic} onChange={(e) => setPrivateSeptic(e.target.value)}>
            {YES_NO_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label>
          Private Well
          <select value={privateWell} onChange={(e) => setPrivateWell(e.target.value)}>
            {YES_NO_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
          </>
        )}
        <label>
          View
          <select value={hasView} onChange={(e) => setHasView(e.target.value)}>
            {YES_NO_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        {!isLand && (
          <label>
            Solar
            <select value={solar} onChange={(e) => setSolar(e.target.value)}>
              {SOLAR_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Notes on Boundary Lines
          <textarea value={boundaryNotes} onChange={(e) => setBoundaryNotes(e.target.value)} rows={2} />
        </label>
      </fieldset>

      {isLand && (
        <fieldset>
          <legend>Land Valuation</legend>
          <p className="field-help">Land is priced on a sliding scale by how much development is already done. Fill this in and the model suggests a price range for the CMA.</p>
          <label>
            Lot Size (acres)
            <input type="number" min="0" step="any" value={lotAcres} onChange={(e) => setLotAcres(e.target.value)} />
          </label>
          {(() => {
            const rate = Number(land.perAcre) > 0 ? Number(land.perAcre) : LAND_PER_ACRE;
            const acres = Number(lotAcres) || 0;
            return (
              <label>
                Price per Acre ($)
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={land.perAcre ?? ""}
                  onChange={(e) => updateLand({ perAcre: e.target.value })}
                  placeholder={`${LAND_PER_ACRE.toLocaleString()} (recommended)`}
                />
                <span className="field-help">
                  Recommended: ${LAND_PER_ACRE.toLocaleString()}/acre for undeveloped land — change it if this area or parcel sells for more or less.
                  {acres > 0 && ` ${acres} acres × $${rate.toLocaleString()} = $${Math.round(acres * rate).toLocaleString()}`}
                </span>
              </label>
            );
          })()}
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
          <LandEstimate land={landForCalc} />
          <div className="detail-label">Land Comparable Sales (optional, up to 3)</div>
          {land.comps.map((c, i) => (
            <div key={i} className="land-comp-row">
              <input placeholder="Address" value={c.address || ""} onChange={(e) => updateLandComp(i, { address: e.target.value })} />
              <input type="number" placeholder="Sale Price" value={c.salePrice || ""} onChange={(e) => updateLandComp(i, { salePrice: e.target.value })} />
              <input type="number" step="any" placeholder="Acres" value={c.acres || ""} onChange={(e) => updateLandComp(i, { acres: e.target.value })} />
              <input placeholder="Notes" value={c.notes || ""} onChange={(e) => updateLandComp(i, { notes: e.target.value })} />
            </div>
          ))}
        </fieldset>
      )}

      {isMultiFamily && (
        <fieldset>
          <legend>Multi-Family Income Analysis</legend>
          <p className="field-help">Fill in income and expenses — the cap rate and an income-based price range are figured live and included in the CMA.</p>
          <label>
            Number of Units
            <input type="number" min={2} max={20} value={mf.units} onChange={(e) => setUnitCount(Math.min(20, Math.max(2, Number(e.target.value) || 2)))} />
          </label>
          <div className="unit-rent-row unit-rent-head">
            <span>Unit description</span>
            <span>Current rent/mo</span>
            <span>Market rent/mo</span>
          </div>
          {mf.unitRents.map((u, i) => (
            <div key={i} className="unit-rent-row">
              <input placeholder={`Unit ${i + 1} — e.g. 2BR/1BA upstairs`} value={u.label} onChange={(e) => updateUnitRent(i, { label: e.target.value })} />
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
            <span className="field-help">For big replacements (roof, heating, appliances, paint). Rule of thumb: 5% for newer or well-kept buildings, 8–10% for older ones or aging systems.</span>
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
          <IncomeAnalysis mf={mf} priceForCap={priceForCap} />
        </fieldset>
      )}

      <fieldset>
        <legend>Price Band</legend>
        {suggestion && (
          <div className="cma-suggest">
            <span>
              💡 <strong>{suggestion.source === "land" ? "Land valuation suggestion" : "Income-based suggestion"}</strong> —{" "}
              {suggestion.source === "land"
                ? `the model suggests $${suggestion.rec.toLocaleString()} (range $${suggestion.low.toLocaleString()} – $${suggestion.high.toLocaleString()}).`
                : `a 7–11% cap rate on current NOI implies $${suggestion.low.toLocaleString()} – $${suggestion.high.toLocaleString()}.${suggestion.marketCeiling ? ` Market rents support up to $${suggestion.marketCeiling.toLocaleString()}.` : ""}`}{" "}
              Adjust for comps and condition.
            </span>
            {suggestionApplied ? (
              <span className="field-help">Using these ✓</span>
            ) : (
              <button
                type="button"
                className="comps-status-btn"
                onClick={() => {
                  setPriceLow(String(suggestion.low));
                  setPriceHigh(String(suggestion.high));
                  setPriceRec(String(suggestion.rec));
                }}
                title="Fill the low, high and recommended prices with this suggestion"
              >
                Use these prices
              </button>
            )}
          </div>
        )}
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

      <fieldset>
        <legend>Agent Notes</legend>
        <textarea value={agentNotes} onChange={(e) => setAgentNotes(e.target.value)} rows={4} placeholder="General notes for this write-up…" />
        <div className="polish-row">
          <button
            type="button"
            className="comps-status-btn polish-btn"
            disabled={!agentNotes.trim() || polish?.status === "working"}
            onClick={runPolish}
            title="AI cleans up your notes: a compliment, then any hurdles, then excitement and how we'll tailor the marketing. You review it before anything changes."
          >
            {polish?.status === "working" ? "Polishing…" : "✨ Polish with AI"}
          </button>
          <span className="field-help">Opens with a compliment, covers any hurdles, ends with the listing and marketing plan — you review it first.</span>
        </div>
        {polish?.status === "error" && <p className="field-note">{polish.error}</p>}
        {polish?.status === "ready" && (
          <div className="polish-preview">
            <div className="detail-label">Polished version — edit it here if you like</div>
            <textarea value={polish.text} onChange={(e) => setPolish({ ...polish, text: e.target.value })} rows={8} />
            <div className="polish-actions">
              <button
                type="button"
                className="google-btn"
                onClick={() => {
                  setAgentNotes(polish.text);
                  setPolish(null);
                }}
                title="Replace your notes with this version"
              >
                Use this
              </button>
              <button type="button" className="comps-status-btn" onClick={runPolish} title="Ask for a different version">
                Try again
              </button>
              <button type="button" className="comps-status-btn" onClick={() => setPolish(null)} title="Keep your original notes">
                Keep mine
              </button>
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="comp-attachments">
        <legend>Attachments (optional)</legend>
        <PdfDropField
          label="Supplemental PDF"
          help="(an existing comp PDF — its first 2 pages get replaced by our cover sheet)"
          file={supplementalFile}
          onFile={setSupplementalFile}
        />
        <PdfDropField
          label="ANR or Parcel Map PDF"
          help="(appended to the end as-is, and filed in Showing Docs when the listing is won)"
          file={anrFile}
          onFile={setAnrFile}
        />
      </fieldset>

      <button title="Build the CMA PDF and save it to Dropbox" type="submit" className="google-btn uc-submit" disabled={generating}>
        {generating ? "Generating…" : "Generate Comp"}
      </button>
    </form>
  );
}
