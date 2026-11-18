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
export function gmailComposeUrl({ to = [], cc = [], subject = "", body = "" }) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: to.join(",") });
  if (cc.length) params.set("cc", cc.join(","));
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/** mailto: with %20-style encoding (URLSearchParams' "+" for spaces shows up
 * literally in iOS Mail). */
export function mailtoUrl({ to = [], cc = [], subject = "", body = "" }) {
  const q = [];
  if (cc.length) q.push(`cc=${cc.map(encodeURIComponent).join(",")}`);
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

/** Jeff Lewis (buyer's attorney) requires the deposit check delivered to him —
 * we never retain it against our commission on his closings. */
export const isJeffLewis = (name) => /\bjeff(rey)?\s+lewis\b/i.test(String(name || ""));

/** The commission numbers for the attorneys' commission statement.
 * Net commission (Fran, Nov 2026) = (purchase price − seller credit) ×
 * commission %. Due at closing = net commission, less the deposit we're
 * holding when we retain it (deposit smaller than the commission, and the
 * buyer's attorney isn't Jeff Lewis). Otherwise the deposit check goes to the
 * buyer's attorney and the full net commission is due at closing.
 * Commission % comes from commission_data (Kerry can read it) or the
 * broker-only close-out row. */
export function commissionForAttorneys(tx) {
  const co = tx.closeouts || {};
  const cd = tx.commission_data || {};
  const price = Number(tx.price ?? co.price) || 0;
  const sellerCredit = Number(cd.seller_credit) || 0;
  const pct = Number(cd.commission_pct ?? co.commission_pct) || 0;
  const commission = price && pct ? ((price - sellerCredit) * pct) / 100 : null;
  const deposit =
    (cd.hold_deposit === "Yes" ? Number(cd.deposit_amount) || 0 : 0) + (cd.second_deposit === "Yes" ? Number(cd.second_deposit_amount) || 0 : 0);
  const jeff = isJeffLewis(tx.buyer_attorney?.name);
  const retain = commission != null && deposit > 0 && deposit < commission && !jeff;
  return { price, sellerCredit, pct, commission, deposit, jeff, retain, due: commission == null ? null : retain ? commission - deposit : commission };
}

/** Commission statement email to the attorneys (agent cc'd) — never to
 * clients. `licenses` = { agent, brokerage } license numbers for the
 * property's state. */
export function buildAttorneyCommissionEmail(tx, licenses = {}) {
  const money = (n) => `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const c = commissionForAttorneys(tx);
  const state = tx.region === "NH" ? "NH" : "VT";
  const closing = tx.next_date ? formatClosing(tx.next_date) : null;
  const attorney = tx.buyer_attorney?.name;
  const lines =
    c.commission == null
      ? ["Net commission: (purchase price or commission % not set yet)"]
      : [
          `Purchase price: ${money(c.price)}`,
          c.sellerCredit ? `Less seller credit: −${money(c.sellerCredit)}` : null,
          c.sellerCredit ? `Net price: ${money(c.price - c.sellerCredit)}` : null,
          `Commission: ${c.pct}%`,
          `Net commission: ${money(c.commission)}`,
          c.retain ? `Less deposit held by Hall Collins (retained against our commission): −${money(c.deposit)}` : null,
          `Due to Hall Collins Real Estate Group at closing: ${money(c.due)}`,
        ].filter(Boolean);
  const depositLine = c.deposit && !c.retain ? `We are holding the ${money(c.deposit)} deposit and will deliver the check to ${attorney || "the buyer's attorney"} before closing.` : null;
  const licenseLines = [
    `Agent: ${tx.agent?.name || "—"}${licenses.agent ? `, ${state} License #${licenses.agent}` : ""}`,
    `Brokerage: Hall Collins Real Estate Group${licenses.brokerage ? `, ${state} Brokerage License #${licenses.brokerage}` : ""}`,
  ].join("\n");
  const body = [
    "Hi,",
    `Here is the commission statement for ${tx.address}${closing ? `, closing ${closing}` : ""}:`,
    lines.join("\n"),
    depositLine,
    licenseLines,
    "Please let us know if you need anything else from us.",
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n\n");
  const to = [tx.buyer_attorney?.email, tx.seller_attorney?.email].filter(Boolean);
  const cc = tx.agent?.email ? [tx.agent.email] : [];
  return { to: [...new Set(to)], cc, subject: `Commission Statement - ${tx.address}`, body };
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
