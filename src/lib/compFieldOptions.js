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
