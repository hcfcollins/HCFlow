// Builds a session file matching the Hall Collins CMA Generator's
// "Upload .json session file" format (see hall-collins-cma-generator/app.py
// `_load_session_from_dict`), so a Comp's data can be loaded there in one
// step instead of retyped. Field names/options here are duplicated from
// that app and will drift if it changes — see BUILD_SPEC for context.

const PROPERTY_TYPE_MAP = { Residential: "Single Family", Land: "Land" };

// CMA app's fuel_types are fuel sources only; ours mixes fuel + delivery
// method. Only the fuels with a clean match populate fuel_types — anything
// else (Baseboard, Hot Water, Direct Vent/Rinnai) gets folded into the notes
// instead of silently dropped.
const HEATING_TO_FUEL = {
  Oil: "Oil",
  Propane: "Propane",
  Electric: "Electric",
  "Mini Splits": "Mini Split",
  "Wood Stove": "Wood",
  "Pellet Stove": "Pellet",
};

const RECOMMENDATION_MAP = {
  "🌸 Wait for Spring": "rec_spring",
  "🔍 Septic Inspection Recommended in Advance": "rec_septic",
  "🏠 Home Inspection Recommended in Advance": "rec_home_insp",
  "🛋️ Staging Instructions": "rec_staging",
  "🧹 Deep Clean / Clear Out Recommended": "rec_clean",
  "📐 Land Subdivision Opportunity": "rec_subdivision",
  "🎨 Painting / Complete A Few Projects": "rec_painting",
};

export function buildCmaSessionExport(tx) {
  const heating = tx.heating_system || [];
  const fuelTypes = heating.map((h) => HEATING_TO_FUEL[h]).filter(Boolean);
  const unmappedHeating = heating.filter((h) => !HEATING_TO_FUEL[h]);

  const featureNotes = [
    unmappedHeating.length ? `Heating: ${unmappedHeating.join(", ")}` : null,
    tx.basement?.length ? `Basement: ${tx.basement.join(", ")}` : null,
    tx.electrical ? `Electrical: ${tx.electrical}` : null,
    tx.water_source ? `Water source: ${tx.water_source}` : null,
    tx.septic ? `Septic: ${tx.septic}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const recommendations = {};
  for (const item of tx.recommendations || []) {
    const key = RECOMMENDATION_MAP[item];
    if (key) recommendations[key] = true;
  }

  return {
    _version: "hc-flow-export",
    _saved: new Date().toISOString().slice(0, 10),
    subject: {
      street_address: tx.address || "",
      city_state: tx.town || "",
      address: tx.town ? `${tx.address}, ${tx.town}` : tx.address || "",
      property_type: PROPERTY_TYPE_MAP[tx.property_style] || "Single Family",
      fuel_types: fuelTypes,
      private_septic: tx.septic ? "Yes" : "— not specified —",
      private_well: tx.water_source ? "Yes" : "— not specified —",
      features_notes: featureNotes,
      agent_notes: tx.notes || "",
    },
    agent_notes: tx.notes || "",
    recommendations,
  };
}

export function downloadCmaSessionFile(tx) {
  const data = buildCmaSessionExport(tx);
  const json = JSON.stringify(data, null, 2);
  const slug = (tx.address || "comp").replace(/[^a-zA-Z0-9]/g, "_");
  const filename = `CMA_starter_${slug}_${data._saved}.json`;

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
