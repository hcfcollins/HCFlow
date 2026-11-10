import { UTILITY_TYPES } from "./compFieldOptions";

/** Gmail's web compose screen, pre-filled — used instead of a mailto: link,
 * which silently does nothing on a computer with no desktop mail app set up
 * (the team works in Gmail on the web). Opens in a new tab. */
export function gmailComposeUrl({ to = [], subject = "", body = "" }) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: to.join(",") });
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function openGmailCompose(opts) {
  window.open(gmailComposeUrl(opts), "_blank", "noopener,noreferrer");
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
