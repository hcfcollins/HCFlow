// Brand palette ported verbatim from the Streamlit CMA generator's pdf_builder.py
// (hcfcollins/hall-collins-cma-generator) so the native PDF matches the same look.
export const NAVY = "#173348";
export const PINK = "#E91E63";
export const LGRAY = "#F5F5F5";
export const MGRAY = "#999999";
export const DGRAY = "#333333";
export const WHITE = "#FFFFFF";
export const BLUSH = "#FFF8FB";
export const STEEL = "#EEF1F4";
export const GREEN = "#2E7D32";
export const RED = "#C62828";

export const money = (v, fallback = "—") => {
  if (v === null || v === undefined || v === "" || v === 0) return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `$${Math.round(n).toLocaleString()}`;
};

export const pct = (v, digits = 2) => `${Number(v || 0).toFixed(digits)}%`;
