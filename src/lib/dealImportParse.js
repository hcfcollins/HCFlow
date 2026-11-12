// One-time (temporary) import of this year's deals from the old Google Sheet
// "Deal Tracker" (its "Deal Tracker Form" tab, downloaded as .xlsx). Columns
// are found by header name, not position, so a reordered sheet still works.
//
// Status column → app stage:
//   Cashed Out  → Closed (with the sheet's commission figures saved as a
//                 historical close-out, so My Spreadsheet totals are right)
//   Not Yet     → Under Contract (closes through the Close-Out Calculator as usual)
//   TERMINATED  → a terminated Under Contract deal (off by default)
//
// A Split deal is two rows in the sheet (one per side) and stays two linked
// deals here, so each side closes out with its own agent, % and referral.

import { PROPERTY_STYLES } from "./compFieldOptions.js";

export const IMPORT_SHEET_NAME = "Deal Tracker Form";

const CLIENT_SOURCE_OPTIONS = [
  "Prior Client/Sphere",
  "Zillow",
  "Postcard/Mailer",
  "Random Direct Contact",
  "Website/Floorday",
  "Referral",
];

// header text → our key. Exact match first, then "starts with".
const HEADERS = {
  closingDate: "closing date",
  status: "check received",
  deposit: "will we hold the deposit",
  address: "address",
  sellerAttorney: "seller attorney",
  buyerAttorney: "buyer attorney",
  agent: "agent",
  side: "which side",
  leadType: "lead type",
  price: "price",
  commissionPct: "commission %",
  totalCheck: "total commission check",
  referralPct: "referral %",
  afterReferral: "commission after referral",
  brokerageKeeps: "brokerage keeps",
  holly: "holly commission",
  fran: "fran commission",
  agentCommission: "agent commission",
  sellerName: "seller name",
  buyerName: "buyer name",
  clientSource: "client source",
  notes: "notes",
  inspection: "inspection deadline",
  financing: "financing date",
  appraiser: "appraiser",
  propertyStyle: "property style",
  region: "vt or nh",
};

function headerIndexes(headerRow) {
  const norm = headerRow.map((h) => String(h ?? "").trim().toLowerCase());
  const idx = {};
  for (const [key, label] of Object.entries(HEADERS)) {
    let i = norm.indexOf(label);
    if (i === -1) i = norm.findIndex((h) => h.startsWith(label));
    idx[key] = i;
  }
  return idx;
}

const BLANKISH = /^(n\/?a|tbd|none|-+|\?|no|x)$/i;
function text(v) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s && !BLANKISH.test(s) && !/^#(REF|N\/A|VALUE|DIV)/i.test(s) ? s : null;
}
function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
/** Excel dates come back as UTC-midnight Dates — read the UTC parts so the
 * calendar day never shifts. */
function isoDate(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
  }
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

/** Year of a stored closing date (next_date is free text: ISO or M/D/YYYY). */
export function yearOf(dateStr) {
  const iso = isoDate(dateStr);
  return iso ? Number(iso.slice(0, 4)) : null;
}

const TERMINATED_PREFIX = /^\s*(terminated|term)\b[\s\-–—:]*/i;
function cleanAddress(raw) {
  return String(raw ?? "").replace(TERMINATED_PREFIX, "").replace(/\s+/g, " ").trim();
}

/** "1100 Stock Farm Road, Randolph VT" and "1100 Stock Farm Rd Randolph" →
 * "1100 stock" — street number + first word, enough to spot the same
 * property typed two ways. */
export function addressKey(address) {
  const tokens = cleanAddress(address)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return tokens.slice(0, 2).join(" ");
}

function mapSide(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("sell") || s.startsWith("list")) return "Sell";
  if (s.startsWith("buy")) return "Buy";
  if (s.startsWith("split") || s.startsWith("dual") || s.startsWith("both")) return "Split";
  return null;
}

function mapStatus(statusCell, rawAddress) {
  const s = String(statusCell ?? "").trim().toLowerCase();
  if (s.startsWith("term") || TERMINATED_PREFIX.test(String(rawAddress ?? ""))) return "terminated";
  if (s.startsWith("cashed")) return "closed";
  return "contract";
}

function mapDeposit(v) {
  if (v == null || String(v).trim() === "") return { hold: null, amount: null, note: null };
  if (typeof v === "number") return v > 0 ? { hold: "Yes", amount: v, note: null } : { hold: "No", amount: null, note: null };
  const s = String(v).trim();
  if (/^no\b/i.test(s)) return { hold: "No", amount: null, note: null };
  const first = num(s.split(/\s(?:and|then|&)\s|,\s/)[0]);
  return { hold: "Yes", amount: first, note: /\d.*\D+\d/.test(s) ? `Deposit (from sheet): ${s}` : null };
}

/** Sheet rows (arrays, header first) → deal objects for `year`, matched
 * against the deals already in the app and the agent roster. */
export function parseDealTracker(rows, { year, agents, existing }) {
  if (!rows?.length) throw new Error("That sheet is empty.");
  const idx = headerIndexes(rows[0]);
  for (const k of ["closingDate", "address", "agent", "side"]) {
    if (idx[k] === -1) throw new Error(`Couldn't find the "${HEADERS[k]}" column — is this the Deal Tracker Form tab?`);
  }
  const cell = (r, k) => (idx[k] === -1 ? null : r[idx[k]]);
  const agentByName = (name) => {
    const n = String(name ?? "").trim().toLowerCase();
    if (!n) return null;
    return (
      agents.find((a) => a.name.toLowerCase() === n) ||
      agents.find((a) => a.name.toLowerCase().split(" ")[0] === n.split(" ")[0]) ||
      null
    );
  };

  const parsed = [];
  rows.slice(1).forEach((r, i) => {
    const closingDate = isoDate(cell(r, "closingDate"));
    const address = cleanAddress(cell(r, "address"));
    if (!address || !closingDate || Number(closingDate.slice(0, 4)) !== year) return;
    const rawPct = num(cell(r, "commissionPct"));
    const refPct = num(cell(r, "referralPct"));
    const regionCell = text(cell(r, "region"))?.toUpperCase();
    const region = regionCell === "VT" || regionCell === "NH" ? regionCell : /\bNH\b/i.test(address) ? "NH" : /\bVT\b/i.test(address) ? "VT" : null;
    const agentName = text(cell(r, "agent"));
    const agent = agentByName(agentName);
    const style = text(cell(r, "propertyStyle"));
    const source = text(cell(r, "clientSource"));
    const lead = text(cell(r, "leadType"));
    parsed.push({
      rowNums: [i + 2],
      closingDate,
      status: mapStatus(cell(r, "status"), cell(r, "address")),
      address,
      region,
      agentName,
      agentId: agent?.id || null,
      side: mapSide(cell(r, "side")),
      leadType: lead === "Organic" || lead === "Provided" ? lead : null,
      price: num(cell(r, "price")),
      // "3" means 3%; a stray 0.03 is converted.
      commissionPct: rawPct == null ? null : rawPct < 0.2 ? Math.round(rawPct * 10000) / 100 : rawPct,
      // The sheet stores 0.25 for 25%; the app stores 25.
      referralPct: refPct == null || refPct === 0 ? null : refPct <= 1 ? Math.round(refPct * 10000) / 100 : refPct,
      money: {
        commission_after_referral: num(cell(r, "afterReferral")),
        bank_amount: num(cell(r, "brokerageKeeps")),
        holly_commission: num(cell(r, "holly")),
        fran_commission: num(cell(r, "fran")),
        agent_commission: num(cell(r, "agentCommission")),
      },
      sellerName: text(cell(r, "sellerName")),
      buyerName: text(cell(r, "buyerName")),
      sellerAttorney: text(cell(r, "sellerAttorney")),
      buyerAttorney: text(cell(r, "buyerAttorney")),
      clientSource: CLIENT_SOURCE_OPTIONS.includes(source) ? source : null,
      notes: text(cell(r, "notes")),
      inspectionDate: isoDate(cell(r, "inspection")),
      financingDate: isoDate(cell(r, "financing")),
      appraiser: text(cell(r, "appraiser")),
      propertyStyle: PROPERTY_STYLES.find((p) => p.toLowerCase() === style?.toLowerCase()) || null,
      deposit: mapDeposit(cell(r, "deposit")),
    });
  });

  // A Split deal is two rows in the sheet — one per side, each with its own
  // agent, commission %, referral and close-out. They stay two separate deals
  // here too (so each side closes out on its own), linked to each other.
  const deals = parsed.map((d) => ({ ...d, warnings: [], pairId: null }));
  for (const d of deals) {
    if (d.pairId) continue;
    const twin = deals.find(
      (o) =>
        o !== d &&
        !o.pairId &&
        addressKey(o.address) === addressKey(d.address) &&
        (o.status === "terminated") === (d.status === "terminated") &&
        (o.side === "Split" || d.side === "Split" || (o.side && d.side && o.side !== d.side))
    );
    if (twin) d.pairId = twin.pairId = `pair-${d.rowNums[0]}`;
  }

  for (const d of deals) {
    if (!d.agentId) d.warnings.push(d.agentName ? `No agent named "${d.agentName}" in the app` : "No agent");
    if (!d.side) d.warnings.push("Side (Buyer/Seller) not recognized");
    if (d.pairId) {
      const twin = deals.find((o) => o !== d && o.pairId === d.pairId);
      d.warnings.push(`One side of a Split deal — its own close-out, linked to ${twin.agentName || "the other side"}'s side (row ${twin.rowNums[0]})`);
    } else {
      const sameKey = deals.filter(
        (o) => addressKey(o.address) === addressKey(d.address) && (o.status === "terminated") === (d.status === "terminated")
      );
      if (sameKey.length > 1) d.warnings.push("This address appears more than once in the sheet");
    }
    const match = existing.find((t) => addressKey(t.address) === addressKey(d.address) && !(t.terminated_at && d.status !== "terminated"));
    d.existingId = match?.id || null;
    d.existingStage = match?.stage || null;
    // Default selection: new, not-terminated, and has an agent + side.
    d.selected = !d.existingId && d.status !== "terminated" && Boolean(d.agentId && d.side);
  }
  return deals.sort((a, b) => a.closingDate.localeCompare(b.closingDate));
}


