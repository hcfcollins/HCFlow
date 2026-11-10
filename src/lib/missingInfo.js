// What a deal still needs filled in, by stage — drives the highlighted
// "standing to-do" on deal cards and the deal detail screen. Computed live
// from the deal itself (never stored), so it disappears on its own the moment
// the info is added.

const has = (v) => (Array.isArray(v) ? v.some((x) => String(x || "").trim()) : v != null && String(v).trim() !== "");

const CONTRACT_CHECKS = [
  { label: "Closing Date", get: (tx) => tx.next_date },
  { label: "Price", get: (tx) => tx.price },
  { label: "Seller Name", get: (tx) => tx.seller_name },
  { label: "Buyer Name", get: (tx) => tx.buyer_name },
  { label: "Client Email", get: (tx) => tx.seller_emails },
  { label: "Seller Attorney", get: (tx) => tx.seller_attorney?.name },
  { label: "Buyer Attorney", get: (tx) => tx.buyer_attorney?.name },
  { label: "Inspection Date", get: (tx) => tx.commission_data?.inspection_date },
  { label: "Financing Date", get: (tx) => tx.commission_data?.financing_date },
  { label: "Appraiser", get: (tx) => tx.commission_data?.appraiser },
];

const LISTING_CHECKS = [
  { label: "Price", get: (tx) => tx.price },
  { label: "Town", get: (tx) => tx.town },
  { label: "Seller Name", get: (tx) => tx.seller_name },
  { label: "Seller Email", get: (tx) => tx.seller_emails },
  { label: "Property Style", get: (tx) => tx.property_style },
];

/** Labels of what's missing on this deal (empty array if nothing). */
export function missingInfoFor(tx) {
  if (!tx || tx.terminated_at) return [];
  const checks = tx.stage === "contract" ? CONTRACT_CHECKS : tx.stage === "won" || tx.stage === "market" ? LISTING_CHECKS : [];
  return checks.filter((c) => !has(c.get(tx))).map((c) => c.label);
}
