import { UTILITY_TYPES } from "./compFieldOptions.js";

/** Phones and tablets (including iPads, which report themselves as a Mac but
 * have a touch screen) — these get the device's own mail app via mailto:. */
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** Gmail's web compose screen, pre-filled — used on a computer instead of a
 * mailto: link, which silently does nothing there with no desktop mail app set
 * up (the team works in Gmail on the web). */
export function gmailComposeUrl({ to = [], subject = "", body = "" }) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: to.join(",") });
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** mailto: with %20-style encoding (URLSearchParams' "+" for spaces shows up
 * literally in iOS Mail). */
export function mailtoUrl({ to = [], subject = "", body = "" }) {
  const q = [];
  if (subject) q.push(`subject=${encodeURIComponent(subject)}`);
  if (body) q.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to.map(encodeURIComponent).join(",")}${q.length ? `?${q.join("&")}` : ""}`;
}

/** The right compose link for this device: native mail app on mobile, a
 * Gmail tab on desktop. For <a href>, pair with emailLinkTarget(). */
export function emailComposeUrl(opts) {
  return isMobileDevice() ? mailtoUrl(opts) : gmailComposeUrl(opts);
}

export function emailLinkTarget() {
  return isMobileDevice() ? undefined : "_blank";
}

export function openEmailCompose(opts) {
  if (isMobileDevice()) window.location.href = mailtoUrl(opts);
  else window.open(gmailComposeUrl(opts), "_blank", "noopener,noreferrer");
}

/** A buyer agency commission over 4% is almost always a typo (e.g. the
 * price typed into the commission box). Returns a warning string, or null. */
export const BAC_WARN_ABOVE = 4;
export function bacWarning(value) {
  // Flat-fee BACs ("$5,000 flat") aren't percentages — never warn on those.
  if (/\$|flat/i.test(String(value ?? ""))) return null;
  const n = parseFloat(String(value ?? "").replace(/[%,$\s]/g, ""));
  if (!Number.isFinite(n) || n <= BAC_WARN_ABOVE) return null;
  return `${String(value).trim()} is over ${BAC_WARN_ABOVE}% — is that the commission, or did the price end up here?`;
}

/** "3" or "3.0" -> "3%"; anything already containing % (or freeform text like
 * "$5,000 flat") is left alone. */
export function formatBac(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}%`;
  return v;
}

/** "Christopher E Miller and Kari H Miller" → "Christopher and Kari";
 * three or more → "A, B, and C". */
export function firstNamesOf(fullNames) {
  const firsts = String(fullNames || "")
    .split(/\s*(?:&|\band\b|,|\/)\s*/i)
    .map((n) => n.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (firsts.length <= 1) return firsts[0] || "";
  if (firsts.length === 2) return `${firsts[0]} and ${firsts[1]}`;
  return `${firsts.slice(0, -1).join(", ")}, and ${firsts[firsts.length - 1]}`;
}

/** Plain-text utility handoff email for the client, built from the deal's
 * Utility Providers section. Buyer side uses Fran's wording (Nov 2026):
 * set service up, the oil/propane VT rule, energy buyers group, book the
 * walkthrough. Seller side: cancel service / schedule final readings. */
export function buildUtilityEmail(tx) {
  const u = tx.utilities || {};
  const lines = UTILITY_TYPES.filter((k) => u[k]).map((k) => utilityLine(u, k));
  const isBuyer = tx.side === "Buy" || (tx.side === "Split" && tx.split_client_side === "Buy");
  const closing = tx.next_date ? formatClosing(tx.next_date) : null;

  if (isBuyer) {
    const names = firstNamesOf(tx.buyer_name);
    const list = lines.length ? lines.join("\n") : "(Utility providers coming soon — we're still confirming who services the property.)";
    const hasOil = Boolean(u.Oil);
    const hasPropane = Boolean(u.Propane);
    const fuel =
      hasOil && hasPropane
        ? "Oil is prorated at closing, but the propane is something you will have to purchase directly from the fuel company after closing. It's a funky VT rule."
        : hasOil
          ? "Oil is prorated at closing."
          : hasPropane
            ? "Propane is something you will have to purchase directly from the fuel company after closing. It's a funky VT rule."
            : null;
    const buyersGroup =
      hasOil || hasPropane
        ? "I would also recommend joining an energy buyers group for fuel. I personally use Hilltop Energy Buyers group and I am certainly not sponsored, but they have saved me a bunch so I tell all my clients about them!"
        : null;
    const body = [
      `Hi${names ? ` ${names}` : ""},`,
      `As we get closer to closing${closing ? ` on ${closing}` : ""}, here are the utility providers for ${tx.address} so you can get service set up in your name starting the day of closing. Call early this week to ensure there are no snags.`,
      list,
      "Let us know if you have any questions!",
      fuel,
      buyersGroup,
      "Let me know if you have any other questions. We also need to book our final walkthrough, so let me know when you are free!",
      "Fondly,",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { to: tx.seller_emails || [], subject: `Utilities - ${tx.address}`, body };
  }

  const name = (tx.seller_name || "").trim();
  const intro = `As we get closer to ${closing ? `closing on ${closing}` : "closing"}, here are the utility providers we have on file for ${tx.address}. Please reach out to each one to schedule final readings and stop service in your name as of the closing date:`;
  const list = lines.length ? lines.map((l) => `• ${l}`).join("\n") : "• (No utility providers on file yet — please let us know who services the property.)";
  const body = `Hi${name ? ` ${name}` : ""},

${intro}

${list}

Let us know if you have any questions!`;
  return { to: tx.seller_emails || [], subject: `Utilities - ${tx.address}`, body };
}

/** Pre-filled email asking the brokers to release the earnest money deposit
 * to the closing attorney before closing. Addressed to our agent; Kerry adds
 * the other brokerage (their email isn't in the app). */
export function buildDepositReleaseEmail(tx) {
  const cd = tx.commission_data || {};
  const money = (n) => `$${Number(n).toLocaleString()}`;
  const amounts = [
    cd.hold_deposit === "Yes" && cd.deposit_amount ? money(cd.deposit_amount) : null,
    cd.second_deposit === "Yes" && cd.second_deposit_amount ? `${money(cd.second_deposit_amount)} (second deposit)` : null,
  ].filter(Boolean);
  const attorney = tx.buyer_attorney?.name || null;
  const closing = tx.next_date ? formatClosing(tx.next_date) : null;
  const body = [
    "Hi,",
    `${tx.address} is scheduled to close${closing ? ` on ${closing}` : " soon"}. Could you please release the earnest money deposit${amounts.length ? ` (${amounts.join(" + ")})` : ""} to the closing attorney${attorney ? `, ${attorney},` : ""} ahead of closing?`,
    "Please send us a copy of the check once it goes out so we have it for our file.",
    "Thank you!",
  ].join("\n\n");
  return { to: tx.agent?.email ? [tx.agent.email] : [], subject: `Deposit Release - ${tx.address}`, body };
}

/** "Electricity: Green Mountain Power — (802) 655-6600 — greenmountainpower.com" */
function utilityLine(u, key) {
  const c = u._contacts?.[key] || {};
  return [`${key}: ${u[key]}`, c.phone, c.website].filter(Boolean).join(" — ");
}

function formatClosing(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr);
  if (!m) return dateStr;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
