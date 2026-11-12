import { UTILITY_TYPES } from "./compFieldOptions";

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

/** "3" or "3.0" -> "3%"; anything already containing % (or freeform text like
 * "$5,000 flat") is left alone. */
export function formatBac(value) {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (/^\d+(\.\d+)?$/.test(v)) return `${v}%`;
  return v;
}

/** Plain-text utility handoff email for the client, built from the deal's
 * Utility Providers section. Wording depends on side: a seller is cancelling
 * service/scheduling final readings, a buyer is setting service up. */
export function buildUtilityEmail(tx) {
  const providers = UTILITY_TYPES.filter((u) => tx.utilities?.[u]).map((u) => `• ${u}: ${tx.utilities[u]}`);
  const isBuyer = tx.side === "Buy";
  const name = ((isBuyer ? tx.buyer_name : tx.seller_name) || "").trim();
  const closing = tx.next_date ? formatClosing(tx.next_date) : "closing";

  const intro = isBuyer
    ? `As we get closer to ${closing === "closing" ? "closing" : `closing on ${closing}`}, here are the utility providers for ${tx.address} so you can get service set up in your name starting the day of closing:`
    : `As we get closer to ${closing === "closing" ? "closing" : `closing on ${closing}`}, here are the utility providers we have on file for ${tx.address}. Please reach out to each one to schedule final readings and stop service in your name as of the closing date:`;

  const list = providers.length ? providers.join("\n") : "• (No utility providers on file yet — please let us know who services the property.)";

  const body = `Hi${name ? ` ${name}` : ""},

${intro}

${list}

Let us know if you have any questions!`;

  return {
    to: tx.seller_emails || [],
    subject: `Utilities - ${tx.address}`,
    body,
  };
}

function formatClosing(dateStr) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr);
  if (!m) return dateStr;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "long", day: "numeric" });
}
