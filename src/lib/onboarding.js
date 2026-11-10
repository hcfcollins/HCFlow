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
  { key: "welcome_email", label: "Send welcome email (important links, standard contract language, email signature)" },
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

/** Plain-text welcome email body — the HC Flow orientation plus the sections
 * Fran asked for. The bracketed sections are placeholders until Fran provides
 * the real links/contract language; she reviews the Gmail draft before
 * sending either way. */
export function buildWelcomeEmail(agent) {
  const first = agent.name.split(/\s+/)[0];
  const signInUrl = window.location.origin;
  const listingFolder = agent.dropbox_listing_path
    ? `Your listing documents live in Dropbox at ${agent.dropbox_listing_path}.`
    : "Your Dropbox listing folder is on its way — we'll share it with you shortly.";

  const body = `Hi ${first},

Welcome to Hall Collins Real Estate Group — we're so glad you're here! Here's everything you need to get going.

IMPORTANT LINKS
• HC Flow (our deal tracker — sign in with your Hall Collins Google account): ${signInUrl}
• ${listingFolder}
• [Add any other links here]

STANDARD CONTRACT LANGUAGE
[Add the standard contract language here]

YOUR EMAIL SIGNATURE
Please set this as your Gmail signature (Settings → See all settings → Signature):

${agent.name}
REALTOR® | Hall Collins Real Estate Group
${agent.email || "[your Hall Collins email]"} | [your cell]

Questions about any of this? Just ask Fran or Holly.

Welcome aboard!
Fran`;

  return {
    to: agent.email ? [agent.email] : [],
    subject: "Welcome to Hall Collins — links, contract language & your email signature",
    body,
  };
}
