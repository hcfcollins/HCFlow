// Shared option lists for comp/property detail fields — single source of truth for
// NewCompForm, DealDetail's Comp Details grid, and GenerateCompForm so they can't
// drift apart (RECOMMENDATION_OPTIONS in particular must exactly match the keys in
// src/lib/compPdf/recommendations.js's RECOMMENDATION_BODY map).
export const TIMEFRAMES = ["Now", "6 months", "Next year"];
export const PROPERTY_STYLES = ["Residential", "Land", "Commercial", "Multi Family"];
export const ELECTRICAL_OPTIONS = ["200 amp", "150 amp", "100 amp", "Fuses", "Knob and Tube"];
export const HEATING_OPTIONS = [
  "Baseboard",
  "Hot Water",
  "Forced Hot Air",
  "Oil",
  "Propane",
  "Electric",
  "Direct Vent/Rinnai",
  "Mini Splits",
  "Wood Stove",
  "Pellet Stove",
  "Radiant",
];
export const BASEMENT_OPTIONS = ["Dirt Floor", "Concrete Block", "Poured Concrete", "Fieldstone", "Crawlspace"];
export const RECOMMENDATION_OPTIONS = [
  "🌸 Wait for Spring",
  "🔍 Septic Inspection Recommended in Advance",
  "🏠 Home Inspection Recommended in Advance",
  "🛋️ Staging Instructions",
  "🧹 Deep Clean / Clear Out Recommended",
  "📐 Land Subdivision Opportunity",
  "🎨 Painting / Complete A Few Projects",
  "Organize Leases & Tenant Documents",
  "Consider Evicting Tenants Before Listing",
  "Make Repairs to Major Systems",
];
// The last 3 RECOMMENDATION_OPTIONS only make sense for income properties — ported
// from the Streamlit CMA generator's "Multi-Family specific:" sub-section, which only
// shows these when Property Type == "Multi Family".
const MF_ONLY_RECOMMENDATIONS = ["Organize Leases & Tenant Documents", "Consider Evicting Tenants Before Listing", "Make Repairs to Major Systems"];
export function recommendationOptionsFor(propertyStyle) {
  return propertyStyle === "Multi Family" ? RECOMMENDATION_OPTIONS : RECOMMENDATION_OPTIONS.filter((o) => !MF_ONLY_RECOMMENDATIONS.includes(o));
}

// Subject Property stats fields, ported from the Streamlit CMA generator's Step 1
// "Subject Property Details" expander.
export const FUEL_TYPE_OPTIONS = ["Oil", "Propane", "Pellet", "Electric", "Mini Split", "Wood", "Other"];
export const NOT_SPECIFIED = "— not specified —";
export const YES_NO_OPTIONS = [NOT_SPECIFIED, "Yes", "No"];
export const SOLAR_OPTIONS = [NOT_SPECIFIED, "No", "Yes — Owned", "Yes — Leased"];

// Utility Providers section on DealDetail — stored as one jsonb object on
// transactions.utilities, keyed by these exact labels (e.g.
// { "Electricity": "Green Mountain Power", "Water": "Town Water" }), so
// adding a type later is just another entry here, no migration needed.
// `options` = a two-choice radio instead of a free-text provider name;
// `showIf` hides a field that doesn't apply (no septic maintenance on town
// sewer).
export const UTILITY_FIELDS = [
  // `suggestions` = pick-from-a-list OR type your own, same as the attorney
  // fields (a native datalist).
  { key: "Electricity", suggestions: ["Green Mountain Power", "Washington Electric", "Off-Grid", "Liberty", "NH Coop"] },
  { key: "Oil" },
  { key: "Propane" },
  { key: "Internet" },
  { key: "Trash" },
  { key: "Plowing" },
  { key: "Property Management" },
  { key: "Solar Maintenance" },
  { key: "Water", options: ["Town Water", "Private"] },
  { key: "Septic", options: ["Town Sewer", "Private"] },
  { key: "Septic Maintenance", showIf: (u) => !isTownSewer(u?.Septic) },
];

/** "Town Septic" was the label for a short while before "Town Sewer" — treat
 * any saved value either way as town sewer. */
export function isTownSewer(v) {
  return v === "Town Sewer" || v === "Town Septic";
}

export function normalizeUtilities(u) {
  if (!u) return {};
  return u.Septic === "Town Septic" ? { ...u, Septic: "Town Sewer" } : u;
}

export const UTILITY_TYPES = UTILITY_FIELDS.map((f) => f.key);

export function visibleUtilityFields(utilities) {
  return UTILITY_FIELDS.filter((f) => !f.showIf || f.showIf(utilities || {}));
}
