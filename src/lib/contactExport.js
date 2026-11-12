// "Export Client Contacts" (Spreadsheet View) — one .xlsx of client names,
// emails, and mailing addresses for uploading into a mailing/CRM program.
//
// Who's in it:
// - Every BUYER on any deal that's under contract or closed, on either side
//   — when we're the listing agent too, since the property they bought is
//   their new mailing address. Their email is only included when they were
//   our client (we only collect our own clients' emails).
// - Our SELLER clients, emails only — Mailing Address is left blank on
//   purpose: after closing the old address isn't theirs anymore and we
//   rarely get a forwarding address. Listed after the buyers.
// Terminated deals are left out (that buyer never bought the house).

import { clientIsBuyer } from "./missingInfo";

const STAGE_LABEL = { contract: "Under Contract", closed: "Closed" };

/** Best-effort split of a freeform name ("John & Jane Smith") into
 * first ("John & Jane") / last ("Smith") for mail-merge programs. */
function splitName(full) {
  const words = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { first: words[0] || "", last: "" };
  return { first: words.slice(0, -1).join(" "), last: words[words.length - 1] };
}

function ourRole(tx) {
  if (tx.side === "Buy") return "Buyer's Agent";
  if (tx.side === "Sell") return "Listing Agent";
  if (tx.side === "Split") return tx.split_client_side === "Buy" ? "Buyer's Agent" : tx.split_client_side === "Sell" ? "Listing Agent" : "Both Sides";
  return tx.side || "";
}

const weRepSeller = (tx) => tx.side === "Sell" || tx.side === "Split";

export function buildContactRows(transactions) {
  const rows = [];
  const seen = new Set();
  const live = transactions.filter((tx) => !tx.terminated_at && (tx.stage === "contract" || tx.stage === "closed"));

  for (const tx of live) {
    if (!tx.buyer_name?.trim()) continue;
    const key = `buyer|${tx.buyer_name.trim().toLowerCase()}|${(tx.address || "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // seller_emails holds OUR client's emails — the buyers' only when we
    // represented them.
    const emails = clientIsBuyer(tx) ? tx.seller_emails || [] : [];
    rows.push({ type: "Buyer", name: tx.buyer_name.trim(), emails, tx, mailing: true });
  }

  for (const tx of live) {
    if (!weRepSeller(tx) || clientIsBuyer(tx) || !tx.seller_name?.trim()) continue;
    const key = `seller|${tx.seller_name.trim().toLowerCase()}|${(tx.address || "").trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ type: "Seller", name: tx.seller_name.trim(), emails: tx.seller_emails || [], tx, mailing: false });
  }

  return rows.map(({ type, name, emails, tx, mailing }) => {
    const { first, last } = splitName(name);
    return {
      type,
      name,
      first,
      last,
      email: emails[0] || "",
      otherEmails: emails.slice(1).join(", "),
      street: mailing ? tx.address || "" : "",
      town: mailing ? tx.town || "" : "",
      state: mailing ? tx.region || "" : "",
      zip: mailing ? tx.zip || "" : "",
      property: [tx.address, tx.town, [tx.region, tx.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      status: STAGE_LABEL[tx.stage] || tx.stage,
      closing: tx.next_date ? String(tx.next_date).slice(0, 10) : "",
      agent: tx.agent?.name || "",
      role: ourRole(tx),
    };
  });
}

const COLUMNS = [
  ["Contact Type", "type", 12],
  ["Full Name", "name", 26],
  ["First Name", "first", 18],
  ["Last Name", "last", 16],
  ["Email", "email", 30],
  ["Other Emails", "otherEmails", 30],
  ["Mailing Street", "street", 30],
  ["Mailing Town", "town", 16],
  ["Mailing State", "state", 8],
  ["Mailing Zip", "zip", 10],
  ["Property", "property", 36],
  ["Deal Status", "status", 14],
  ["Closing Date", "closing", 12],
  ["Agent", "agent", 18],
  ["We Were", "role", 14],
];

/** Builds and downloads the .xlsx. Returns how many contacts went in. */
export async function exportClientContacts(transactions) {
  const rows = buildContactRows(transactions);
  // Loaded only when someone actually exports — keeps it out of the app's
  // startup download.
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const header = COLUMNS.map(([label]) => ({ value: label, fontWeight: "bold" }));
  const data = [header, ...rows.map((r) => COLUMNS.map(([, key]) => ({ value: r[key] || "", type: String })))];
  const today = new Date().toISOString().slice(0, 10);
  await writeExcelFile(data, {
    columns: COLUMNS.map(([, , width]) => ({ width })),
    stickyRowsCount: 1,
    sheet: "Client Contacts",
  }).toFile(`HC Client Contacts ${today}.xlsx`);
  return { total: rows.length, buyers: rows.filter((r) => r.type === "Buyer").length };
}
