// What a deal still needs filled in, by stage — drives the highlighted
// "standing to-do" on deal cards and the deal detail screen. Computed live
// from the deal itself (never stored), so it disappears on its own the moment
// the info is added.

const has = (v) => (Array.isArray(v) ? v.some((x) => String(x || "").trim()) : v != null && String(v).trim() !== "");

// Our client is the buyer on a Buy deal, or on a Split where we represent the
// buyers — used for labels ("Buyer Email") and hiding listing-only sections.
export const clientIsBuyer = (tx) => tx.side === "Buy" || (tx.side === "Split" && tx.split_client_side === "Buy");

// `field` matches a data-field="…" on the deal screen (DealDetail) — that's
// where tapping the item jumps to and flashes.
const CONTRACT_CHECKS = [
  { field: "region", label: "State (VT/NH)", get: (tx) => tx.region },
  { field: "next_date", label: "Closing Date", get: (tx) => tx.next_date },
  { field: "price", label: "Price", get: (tx) => tx.price },
  { field: "seller_name", label: "Seller Name", get: (tx) => tx.seller_name },
  { field: "buyer_name", label: "Buyer Name", get: (tx) => tx.buyer_name },
  { field: "seller_emails", label: "Client Email", get: (tx) => tx.seller_emails },
  { field: "seller_attorney", label: "Seller Attorney", get: (tx) => tx.seller_attorney?.name },
  { field: "buyer_attorney", label: "Buyer Attorney", get: (tx) => tx.buyer_attorney?.name },
  { field: "inspection_date", label: "Inspection Date", get: (tx) => tx.commission_data?.inspection_date },
  // No financing contingency date = treated as a cash/no-financing deal, so
  // neither the financing date itself nor an appraiser is asked for. Once a
  // financing date is entered, the appraiser becomes required.
  { field: "appraiser", label: "Appraiser", get: (tx) => tx.commission_data?.appraiser, onlyIf: (tx) => has(tx.commission_data?.financing_date) },
];

const LISTING_CHECKS = [
  { field: "region", label: "State (VT/NH)", get: (tx) => tx.region },
  { field: "price", label: "Price", get: (tx) => tx.price },
  { field: "town", label: "Town", get: (tx) => tx.town },
  { field: "seller_name", label: "Seller Name", get: (tx) => tx.seller_name },
  { field: "seller_emails", label: "Seller Email", get: (tx) => tx.seller_emails },
  { field: "property_style", label: "Property Style", get: (tx) => tx.property_style },
];

// The "go line by line" catch-up (Import Deals screen) also asks for these, and
// checks Closed deals too — minus the contingency items, long past by then.
const REVIEW_EXTRA = [
  { field: "town", label: "Town", get: (tx) => tx.town },
  { field: "property_style", label: "Property Style", get: (tx) => tx.property_style },
  { field: "dropbox", label: "Dropbox Folder", get: (tx) => tx.dropbox_folder_url },
];
const CLOSED_REVIEW_CHECKS = [
  ...CONTRACT_CHECKS.filter((c) => c.field !== "inspection_date" && c.field !== "appraiser"),
  ...REVIEW_EXTRA,
];

function checksFor(tx, review) {
  if (tx.stage === "contract") return review ? [...CONTRACT_CHECKS, ...REVIEW_EXTRA] : CONTRACT_CHECKS;
  if (tx.stage === "won" || tx.stage === "market") return LISTING_CHECKS;
  if (tx.stage === "closed" && review) return CLOSED_REVIEW_CHECKS;
  return [];
}

/** [{ field, label }] of what's missing on this deal (empty if nothing).
 * `review`: the fuller catch-up list (see REVIEW_EXTRA). */
export function missingInfoItems(tx, { review = false } = {}) {
  if (!tx || tx.terminated_at) return [];
  const checks = checksFor(tx, review);
  return checks
    .filter((c) => (!c.onlyIf || c.onlyIf(tx)) && !has(c.get(tx)))
    .map((c) => ({ field: c.field, label: c.field === "seller_emails" && clientIsBuyer(tx) ? "Buyer Email" : c.label }));
}

/** Labels only. */
export function missingInfoFor(tx) {
  return missingInfoItems(tx).map((m) => m.label);
}
