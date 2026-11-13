// What a deal still needs filled in, by stage — drives the highlighted
// "standing to-do" on deal cards and the deal detail screen. Computed live
// from the deal itself (never stored), so it disappears on its own the moment
// the info is added.

const has = (v) => (Array.isArray(v) ? v.some((x) => String(x || "").trim()) : v != null && String(v).trim() !== "");

// Our client is the buyer on a Buy deal, or on a Split where we represent the
// buyers — used for labels ("Buyer Email") and hiding listing-only sections.
export const clientIsBuyer = (tx) => tx.side === "Buy" || (tx.side === "Split" && tx.split_client_side === "Buy");

/** "Buyer side" / "Seller side" / "Split - Buyer Side" / "Split - Seller Side"
 * (just "Split" until we know which side our clients are on). */
export function sideLabel(tx) {
  if (tx.side === "Split") {
    if (tx.split_client_side === "Buy") return "Split - Buyer Side";
    if (tx.split_client_side === "Sell") return "Split - Seller Side";
    return "Split";
  }
  return `${tx.side === "Buy" ? "Buyer" : tx.side === "Sell" ? "Seller" : tx.side} side`;
}

// `field` matches a data-field="…" on the deal screen (DealDetail) — that's
// where tapping the item jumps to and flashes.
const CONTRACT_CHECKS = [
  // Split: which side are OUR clients on — drives every buyer/seller label.
  { field: "split_client_side", label: "Our Side (Buyers or Sellers)", get: (tx) => tx.split_client_side, onlyIf: (tx) => tx.side === "Split" },
  { field: "region", label: "State (VT/NH)", get: (tx) => tx.region },
  { field: "next_date", label: "Closing Date", get: (tx) => tx.next_date },
  { field: "price", label: "Price", get: (tx) => tx.price },
  { field: "seller_name", label: "Seller Name", get: (tx) => tx.seller_name },
  { field: "buyer_name", label: "Buyer Name", get: (tx) => tx.buyer_name },
  { field: "seller_emails", label: "Client Email", get: (tx) => tx.seller_emails },
  { field: "seller_attorney", label: "Seller Attorney", get: (tx) => tx.seller_attorney?.name },
  { field: "buyer_attorney", label: "Buyer Attorney", get: (tx) => tx.buyer_attorney?.name },
  // "Waived / no inspection" checked → nothing to ask for.
  { field: "inspection_date", label: "Inspection Date", get: (tx) => (tx.commission_data?.inspection_waived ? "waived" : tx.commission_data?.inspection_date) },
  // No financing contingency date = treated as a cash/no-financing deal, so
  // neither the financing date itself nor an appraiser is asked for. Once a
  // financing date is entered, the appraiser becomes required.
  // Listing side only — on the buyer side we almost never find out who the
  // appraiser was, so it's never asked for there.
  { field: "appraiser", label: "Appraiser", get: (tx) => tx.commission_data?.appraiser, onlyIf: (tx) => has(tx.commission_data?.financing_date) && !clientIsBuyer(tx) },
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
// Closed deals: client emails and attorneys are nice to have, not required —
// listed separately as optional (closedOptionalItems) for when there's time.
const CLOSED_OPTIONAL_FIELDS = ["seller_emails", "seller_attorney", "buyer_attorney"];
const CLOSED_REVIEW_CHECKS = [
  ...CONTRACT_CHECKS.filter((c) => !["inspection_date", "appraiser", ...CLOSED_OPTIONAL_FIELDS].includes(c.field)),
  ...REVIEW_EXTRA,
];

/** Closed deals only: optional blanks (client email, attorneys). */
export function closedOptionalItems(tx) {
  if (!tx || tx.terminated_at || tx.stage !== "closed") return [];
  return CONTRACT_CHECKS.filter((c) => CLOSED_OPTIONAL_FIELDS.includes(c.field) && !has(c.get(tx))).map((c) => ({
    field: c.field,
    label: c.field === "seller_emails" ? (clientIsBuyer(tx) ? "Buyer Email" : "Seller Email") : c.label,
  }));
}

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
    .map((c) => ({
      field: c.field,
      label:
        c.field === "seller_emails"
          ? clientIsBuyer(tx)
            ? "Buyer Email"
            : tx.side === "Split" && !tx.split_client_side
              ? "Client Email"
              : c.label === "Client Email" ? "Seller Email" : c.label
          : c.label,
    }));
}

/** Labels only. */
export function missingInfoFor(tx) {
  return missingInfoItems(tx).map((m) => m.label);
}
