// Land valuation model ported verbatim from the Streamlit CMA generator's app.py
// (hcfcollins/hall-collins-cma-generator, ~lines 1014-1056): $35,000 base + $1,000/acre,
// plus fixed premiums for road frontage, parcel character, perc/soil work, and completed
// development items. Do not change these dollar figures without checking with Fran —
// this is the firm's actual land pricing model, not a placeholder.

export const LAND_BASE_VALUE = 35000;
export const LAND_PER_ACRE = 1000;

export const ROAD_FRONTAGE_OPTIONS = ["None", "Private Road / ROW", "Public Road — Town Maintained", "Public Road — State Route"];
const ROAD_PREMIUM = {
  "None": 0,
  "Private Road / ROW": 5000,
  "Public Road — Town Maintained": 20000,
  "Public Road — State Route": 15000,
};

export const PARCEL_CHARACTER_OPTIONS = ["Standard lot", "Large contiguous parcel (bonus)", "Multiple non-contiguous parcels"];
const CONTIGUOUS_PREMIUM = {
  "Standard lot": 0,
  "Large contiguous parcel (bonus)": 50000,
  "Multiple non-contiguous parcels": -10000,
};

export const PERC_STATUS_OPTIONS = ["None done", "Perc test passed", "Septic design on file", "Permit approved"];
const PERC_PREMIUM = {
  "None done": 0,
  "Perc test passed": 5000,
  "Septic design on file": 12000,
  "Permit approved": 18000,
};

export const LAND_DEV_ITEMS = [
  { key: "well", label: "Well", value: 20000 },
  { key: "percTest", label: "Perc Test", value: 5000 },
  { key: "septicDesign", label: "Septic Design", value: 8000 },
  { key: "septic", label: "Septic Installed", value: 25000 },
  { key: "clearing", label: "Clearing", value: 10000 },
  { key: "driveway", label: "Driveway", value: 15000 },
  { key: "electrical", label: "Electrical", value: 12000 },
  { key: "internet", label: "Internet", value: 3000 },
];

/**
 * @param {object} land - { acres, roadFrontage, parcelCharacter, percStatus, devItems: {well, percTest, ...}, comps: [{address, salePrice, acres, notes}] }
 */
export function computeLandValuation(land) {
  const acres = Number(land.acres) || 0;
  const acreValue = Math.round(acres * LAND_PER_ACRE);
  const roadPremium = ROAD_PREMIUM[land.roadFrontage] ?? 0;
  const contiguousPremium = CONTIGUOUS_PREMIUM[land.parcelCharacter] ?? 0;
  const percPremium = PERC_PREMIUM[land.percStatus] ?? 0;

  const completedDev = LAND_DEV_ITEMS.filter((item) => land.devItems?.[item.key]);
  const notCompletedDev = LAND_DEV_ITEMS.filter((item) => !land.devItems?.[item.key]);
  const devValue = completedDev.reduce((sum, item) => sum + item.value, 0);

  const suggested = LAND_BASE_VALUE + acreValue + roadPremium + contiguousPremium + percPremium + devValue;
  const low = Math.round((suggested * 0.85) / 5000) * 5000;
  const high = Math.round((suggested * 1.1) / 5000) * 5000;

  const comps = (land.comps || []).filter((c) => c.address || c.salePrice);

  return {
    acres,
    baseValue: LAND_BASE_VALUE,
    acreValue,
    roadPremium,
    contiguousPremium,
    percPremium,
    devValue,
    completedDev,
    notCompletedDev,
    suggested,
    low,
    high,
    comps,
  };
}
