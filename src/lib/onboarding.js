// New-agent onboarding checklist (Manage Agents → Onboarding To-Dos).
//
// Stored on agents.onboarding (jsonb): null = not being tracked (everyone who
// was already on the roster before this existed); {} or { itemKey: ISO date }
// = tracked, with the date each manual item was checked off. New agents added
// through Manage Agents start tracked automatically.
//
// Two kinds of items:
// - manual: Fran checks them off.
// - profile: "standing" to-dos computed from the roster profile itself — they
//   tick themselves off as soon as the info is filled in, and come back if
//   it's ever cleared.

export const MANUAL_ONBOARDING_ITEMS = [
  { key: "hc_email", label: "Set up Hall Collins email" },
  { key: "dropbox_license", label: "Add license to Dropbox" },
  { key: "email_geri", label: "Email Geri" },
  { key: "nh_membership", label: "Add secondary membership for NH" },
  { key: "dotloop", label: "Dotloop license" },
  { key: "welcome_email", label: "Send welcome email (boards of Realtors, links, HubSpot, email signature, contract language)" },
];

export const PROFILE_ONBOARDING_ITEMS = [
  { key: "profile_email", label: "Add their email to the roster", isDone: (a) => Boolean(a.email) },
  { key: "profile_listing_folder", label: "Add their Dropbox listing folder", isDone: (a) => Boolean(a.dropbox_listing_path) },
  { key: "profile_buyer_folder", label: "Add their Dropbox buyer folder", isDone: (a) => Boolean(a.dropbox_buyer_path) },
  { key: "profile_cover_sheet", label: "Upload their cover sheet", isDone: (a) => Boolean(a.cover_sheet_url) },
];

export function isTrackingOnboarding(agent) {
  return agent.onboarding != null && typeof agent.onboarding === "object";
}

/** [{ key, label, done, kind }] for one tracked agent. */
export function onboardingItemsFor(agent) {
  const state = agent.onboarding || {};
  return [
    ...PROFILE_ONBOARDING_ITEMS.map((i) => ({ key: i.key, label: i.label, done: i.isDone(agent), kind: "profile" })),
    ...MANUAL_ONBOARDING_ITEMS.map((i) => ({ key: i.key, label: i.label, done: Boolean(state[i.key]), kind: "manual" })),
  ];
}

/** True now that Fran's welcome email content is in buildWelcomeEmail below
 * (Nov 2026) — keeps her old "send Claude the content" reminder cleared. */
export const WELCOME_EMAIL_CONTENT_READY = true;

export const STANDING_REMINDERS = [
  {
    key: "welcome_email_content",
    forEmail: "fran.collins@hallcollins.com",
    text: "Send Claude the welcome email content: important links, standard contract language, and how the email signature should read",
    active: () => !WELCOME_EMAIL_CONTENT_READY,
  },
];

/** Plain-text welcome email body — Fran's wording (Nov 2026). Opens as a
 * draft for her to review before sending. */
export function buildWelcomeEmail(agent) {
  const first = agent.name.split(/\s+/)[0];

  const body = `Hi ${first},

We're so excited to have you on the team! Thank you for getting your independent contractor agreement and policy manual signed. Below is everything you need to get set up. Please work through this list over the next week, and reach out with any questions.

1. JOIN THE BOARDS OF REALTORS
We need both memberships so you can access the most up-to-date forms in dotloop.

• Windsor County Board of Realtors (primary): Email Geri at info@windsorcountyrealtors.com to become a member.
• New Hampshire Association of Realtors (secondary): Email Amber Bonenfant at amber@nhar.com to set up your secondary membership.

2. BOOKMARK THESE LINKS
• MLS (PrimeMLS): https://mdweb.mmsi2.com/neren/
• dotloop: https://www.dotloop.com/
• DepositLink (earnest money): https://www.depositlink.com/
• HC Flow (our internal app): https://hc-flow.vercel.app/
• Vermont ANR Natural Resources Atlas (wetlands, flood zones, parcel info): https://anrmaps.vermont.gov/websites/anra5/

3. HUBSPOT (OUR CRM)
• Log in here: https://app.hubspot.com/contacts/23356899/objects/0-1/views/13152087/list
• Update the objects/view settings as needed so you're seeing your contacts.
• Install the HubSpot Sales Chrome extension and connect it to your Gmail so emails log to contacts automatically.

4. YOUR EMAIL SIGNATURE
Please set this up as your Gmail signature (Gmail → Settings → See all settings → Signature). Bold your name and the VT office number. For the logo, click the image icon in the signature editor → Web Address (URL) and paste: https://hc-flow.vercel.app/hall-collins-logo-full.png

${agent.name}
REALTOR®
${agent.phone || "[your cell]"} (cell)
[Hall Collins logo]

VT 802-242-5500
${agent.email || "[your Hall Collins email]"}
www.hallcollins.com
www.facebook.com/hallcollins
2626 E Woodstock Rd.
Woodstock, VT 05091

5. COMMON CONTRACT LANGUAGE
Save these somewhere handy. Copy and paste as needed, filling in the details.

• Buyer agency fee (if seller agrees):
It will be a term of the buyer's offer that the seller, and/or a third party to the settlement and transfer of the property, agrees to distribute from the transaction 3% of the purchase price at closing to Hall Collins Real Estate Group in order to settle the buyer's contractual obligation in their buyer agency agreement. Hall Collins Real Estate Group shall receive no other fee if seller agrees.

• Buyer agency fee:
It is a term of the buyer's offer that the seller, and/or a third party to the settlement and transfer of the property, agrees to distribute from the transaction 3% of the purchase price at closing to Hall Collins Real Estate Group in order to settle the buyer's contractual obligation in their buyer agency agreement. Hall Collins Real Estate Group shall receive no other fee.

• Buried oil tank removal:
Seller, at the seller's sole expense, will have the buried oil tank professionally removed, soil tested, and properly decommissioned by a licensed contractor prior to closing. Seller shall provide buyer with all official removal certificates, permits, and passing soil test reports as proof of completion at least one week prior to closing.

• Oil tank inspection:
Seller, at the seller's sole expense, to have oil company perform oil tank inspection prior to closing. Proof of the passed inspection shall be provided at least one week prior to closing.

• Chimney repair:
Seller to have qualified chimney contractor assess damage, repair flue and deteriorating mortar and brick above the roof line. Receipts to be provided no later than 1 week prior to closing.

• Seller credit:
Seller to provide credit back at closing in the amount of $X,XXX to go towards buyer prepaids, lender fees or other lender approved items.

• Heat and lawn (warm months):
Seller will keep the property properly heated and lawn mowed through closing.

• Heat and snow (winter):
Seller will keep the property properly heated and snow cleared from driveway and walkways through closing.

Once your board memberships are active, let me know and we'll get you fully connected in dotloop.

Welcome aboard. We're thrilled you're here and think you will make an invaluable addition to the team!

Fran Collins
fran.collins@hallcollins.com
(802) 272-3533`;

  return {
    to: agent.email ? [agent.email] : [],
    subject: "Welcome to Hall Collins! Getting you set up",
    body,
  };
}
