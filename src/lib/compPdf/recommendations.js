// Seller recommendations checklist — full body copy ported verbatim from the
// Streamlit CMA generator's pdf_builder.py `rec_map` (hcfcollins/hall-collins-cma-generator).
// Keyed by the exact emoji-prefixed title strings NewCompForm.jsx already stores in
// transactions.recommendations, so no new selection UI is needed for this list — it's
// collected once at Comp creation and just rendered here.
export const RECOMMENDATION_BODY = {
  "🌸 Wait for Spring":
    "We will support you whenever you choose to list, but in this case we would recommend " +
    "waiting until April/May depending on the weather. Historically homes sell for a little " +
    "more and more buyers are shopping to get in for the summer and prior to the new school " +
    "year. Any time April–October is a strong time.",

  "🔍 Septic Inspection Recommended in Advance":
    "Because a septic system is hidden underground, it's naturally one of those big mystery " +
    "areas that makes buyers extra cautious. If they don't know what they are getting into, " +
    "they will inspect it the majority of the time and if there are any problems it can derail " +
    "the whole sale. Coming in to the transaction knowing what condition it is in can make you, " +
    "as the seller, look extremely thoughtful and prepared as well as relieve any anxiety the " +
    "buyer may have. It's actually one of the top reasons deals fall through or homes end up " +
    "back on the market. By inspecting it early, you take all the guesswork off the table so " +
    "you can price with confidence and avoid last-minute negotiation surprises. We can easily " +
    "connect you with a few local inspectors. This is one of the best ways to set yourself up " +
    "for a smooth, stress-free sale!",

  "🏠 Home Inspection Recommended in Advance":
    "A pre-listing home inspection allows you to identify and address issues on your " +
    "own timeline and budget — rather than during contract negotiations. This builds " +
    "buyer confidence and can help support your asking price.",

  "🛋️ Staging Instructions":
    "First impressions are everything. Declutter all living spaces, depersonalize the " +
    "home, ensure all rooms have adequate lighting, and add fresh flowers or plants to " +
    "key areas. At a minimum all surfaces should be cleared, plastic hidden away, any " +
    "excess clutter gone. We almost want to make a space look boring so people can start " +
    "to envision where they would place their own items.",

  "🧹 Deep Clean / Clear Out Recommended":
    "We recommend a professional deep clean prior to listing photography and showings. " +
    "Pay particular attention to kitchens, bathrooms, windows, and floors. Clearing " +
    "out attics, basements, and garages signals to buyers that the home has been well " +
    "cared for and makes spaces appear larger.",

  "📐 Land Subdivision Opportunity":
    "The lot size and configuration may present an opportunity for subdivision, which " +
    "could significantly increase the overall value. We recommend consulting with a " +
    "local surveyor and the town planning department before listing.",

  "🎨 Painting / Complete A Few Projects":
    "A fresh coat of neutral paint is one of the highest-return investments before " +
    "listing. Address any visible deferred maintenance — peeling paint, cracked trim, " +
    "or incomplete renovations — prior to going to market.",

  "Organize Leases & Tenant Documents":
    "Buyers and their attorneys will want to review all existing leases, rent rolls, " +
    "and any written agreements with tenants before closing. We recommend gathering " +
    "all signed lease agreements, security deposit records, and any written notices " +
    "into a single folder now. Being organized and transparent with this documentation " +
    "builds buyer confidence, speeds up due diligence, and can prevent deal-killing " +
    "surprises during the contract period.",

  "Consider Evicting Tenants Before Listing":
    "In some cases, the strongest move before listing is to start with a clean slate. " +
    "This is especially true when current rents are significantly below market — " +
    "a buyer inheriting a long-term tenant at $800/month on a unit worth $1,400/month " +
    "is effectively buying a discounted income stream with limited near-term upside. " +
    "Listing the unit vacant allows a new owner to set market rents immediately, " +
    "which can meaningfully increase the property's value and the buyer pool. " +
    "It may also apply when there are lease violations, non-payment history, or " +
    "month-to-month situations where a clean transition serves everyone's interests. " +
    "We recommend consulting with a local attorney about notice requirements and " +
    "timing before proceeding.",

  "Make Repairs to Major Systems":
    "Buyers of investment properties pay close attention to the condition and age of " +
    "major systems — heating, plumbing, electrical, and roofing. Known deferred " +
    "maintenance on these items will be flagged in inspections and used as negotiating " +
    "leverage. We recommend addressing any urgent repairs — particularly to heating " +
    "systems, water heaters, and roofing — before listing. Even partial repairs or " +
    "documented service records go a long way toward supporting your asking price and " +
    "reducing buyer hesitation.",
};

/** Strips a leading emoji (and the space after it) for the PDF's bullet headline. */
export function cleanRecommendationTitle(title) {
  return title.replace(/^\p{Extended_Pictographic}️?\s*/u, "").trim();
}
