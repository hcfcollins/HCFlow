// Trust account reconciliation: read Xero's "Earnest Money Held (Trust Acct
// Liability) Transactions" report (PDF — the "VT/NH Trust Account Audit"
// export), total each client, match them to deals in the app, and list
// everyone who isn't squared up — flagging the ones whose deal is already
// closed or terminated.
//
// How the report reads: one block per Xero contact (bold 10pt name), its
// transactions (date · description · gross/debit/credit · related account),
// then "Total <name>" with the block's net Gross. Net Gross ≠ 0 means money
// is still sitting in (or was over-paid out of) the trust account for them.
// Rows whose related account is Accounts Receivable are deposit invoices the
// app created in Xero — the payment itself posts against AR, so this report
// can't show whether it arrived: those are "confirm it was paid & matched".
import { supabase } from "./supabaseClient";

const DATE_RE = /^[A-Z][a-z]{2} \d{1,2}, \d{4}$/;
const AMOUNT_RE = /^\(?-?[\d,]+\.\d{2}\)?$/;
const NON_CLIENT_RE = /^(VHFA|Hall Collins( Real Estate Group| LLC)?|Error)$/i;

export function parseAmount(s) {
  const t = String(s || "").trim();
  if (!t || t === "-") return 0;
  const neg = t.startsWith("(") || t.startsWith("-");
  const n = Number(t.replace(/[(),\-\s]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** PDF file → [{ items: [{ str, x, y, w, size, bold }] }] per page. */
export async function readPdfPages(file) {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const boldFonts = new Set(
      Object.entries(tc.styles || {})
        .filter(([, s]) => /bold|semibold|black|heavy/i.test(s.fontFamily || ""))
        .map(([k]) => k)
    );
    pages.push({
      items: tc.items
        .filter((it) => it.str && it.str.trim())
        .map((it) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5], w: it.width, size: Math.abs(it.transform[0]) || it.height, font: it.fontName, bold: boldFonts.has(it.fontName) })),
    });
  }
  return pages;
}

/** Pages of positioned text → { title, account, period, asOf, clients }. Pure. */
export function parseTrustPages(pages) {
  const all = pages.flatMap((p) => p.items);
  const title = all.find((it) => /Earnest Money|Trust/i.test(it.str) && it.size >= 14)?.str || "";
  const titleText = all.filter((it) => it.size >= 14).map((it) => it.str).join(" ") + " " + all.find((it) => /Trust Account Audit/i.test(it.str))?.str;
  const account = /\bNH\b|New Hampshire/i.test(titleText) ? "NH" : /\bVT\b|Vermont/i.test(titleText) ? "VT" : null;
  const period = all.find((it) => /^For the period/i.test(it.str))?.str.replace(/^For the period\s*/i, "") || "";
  const footerDate = all.find((it) => DATE_RE.test(it.str) && it.y < 45)?.str || null;

  const clients = [];
  let cur = null;
  let cols = null;

  for (const page of pages) {
    const hdr = (label) => page.items.find((it) => it.str === label);
    const g = hdr("GROSS"), d = hdr("DEBIT"), c = hdr("CREDIT"), ra = hdr("RELATED ACCOUNT"), desc = hdr("DESCRIPTION"), dt = hdr("DATE");
    if (g && d && c) {
      cols = {
        dateX: dt?.x ?? 57,
        descX: desc?.x ?? 116,
        refX: hdr("REFERENCE")?.x ?? 204,
        gross: g.x + g.w,
        debit: d.x + d.w,
        credit: c.x + c.w,
        relX: ra?.x ?? c.x + c.w + 5,
        headerY: g.y,
      };
    }
    if (!cols) continue;
    // Body only: below the column header, above the footer.
    const body = page.items.filter((it) => it.y < cols.headerY - 2 && it.y > 45);
    // Typical body text size — client names are noticeably bigger.
    const sizes = body.map((it) => it.size).sort((a, b) => a - b);
    const bodySize = sizes[Math.floor(sizes.length / 2)] || 8;
    const isLeft = (it) => Math.abs(it.x - cols.dateX) < 4;
    const amountCol = (it) => {
      if (!(AMOUNT_RE.test(it.str) || it.str === "-")) return null;
      const right = it.x + it.w;
      const opts = [["gross", cols.gross], ["debit", cols.debit], ["credit", cols.credit]].map(([k, r]) => [k, Math.abs(right - r)]);
      opts.sort((a, b) => a[1] - b[1]);
      return opts[0][1] < 12 ? opts[0][0] : null;
    };
    // Amounts on the row; a total whose name wraps has them a line lower.
    const rowAmounts = (y, below = 0) => {
      const out = {};
      const dist = {};
      for (const it of body) {
        const dy = y - it.y;
        if (dy < -2.5 || dy > 2.5 + below) continue;
        const k = amountCol(it);
        if (k && (dist[k] === undefined || Math.abs(dy) < dist[k])) {
          out[k] = parseAmount(it.str);
          dist[k] = Math.abs(dy);
        }
      }
      return out;
    };

    // Anchors in reading order: client headers, transaction dates, totals.
    const sorted = [...body].sort((a, b) => b.y - a.y || a.x - b.x);
    const anchors = [];
    for (const it of sorted) {
      if (!isLeft(it)) continue;
      if (it.str === "Total") anchors.push({ kind: "grand", it });
      else if (/^Total\b/.test(it.str)) anchors.push({ kind: "total", it });
      else if (DATE_RE.test(it.str)) anchors.push({ kind: "txn", it });
      else if (it.size > bodySize + 1) anchors.push({ kind: "client", it });
    }
    // Total names that wrap onto a second line ("…Constantine" / "Stavropoulos")
    // sit at the left edge in body size — they're neither anchors nor clients.

    const pageTxns = [];
    for (const a of anchors) {
      if (a.kind === "client") {
        // A name split across items on the same line.
        const name = body.filter((it) => Math.abs(it.y - a.it.y) < 1 && it.size > bodySize + 1).sort((p, q) => p.x - q.x).map((it) => it.str).join(" ");
        if (cur && cur.name === name) continue;
        cur = { name, txns: [], total: null };
        clients.push(cur);
      } else if (a.kind === "txn") {
        if (!cur) continue;
        const amt = rowAmounts(a.it.y);
        const t = { date: a.it.str, y: a.it.y, gross: amt.gross ?? round2((amt.credit || 0) - (amt.debit || 0)), debit: amt.debit || 0, credit: amt.credit || 0, desc: [], ref: [], related: [] };
        cur.txns.push(t);
        pageTxns.push(t);
      } else if (a.kind === "total") {
        if (!cur) continue;
        const amt = rowAmounts(a.it.y, 12);
        if (amt.gross !== undefined && !cur.total) cur.total = { gross: amt.gross, debit: amt.debit ?? 0, credit: amt.credit ?? 0 };
      }
    }
    // Description / related-account lines → the nearest transaction row on the page.
    for (const it of body) {
      const inDesc = it.x >= cols.descX - 2 && it.x < cols.gross - 60 && !isLeft(it);
      const inRel = it.x >= cols.relX - 2;
      if (!inDesc && !inRel) continue;
      const inRef = inDesc && it.x >= cols.refX - 2;
      let best = null;
      for (const t of pageTxns) if (!best || Math.abs(t.y - it.y) < Math.abs(best.y - it.y)) best = t;
      if (!best || Math.abs(best.y - it.y) > 40) continue;
      (inRel ? best.related : inRef ? best.ref : best.desc).push({ y: it.y, x: it.x, str: it.str });
    }
  }

  const finish = (parts) => [...parts].sort((a, b) => b.y - a.y || a.x - b.x).map((p) => p.str).join(" ").replace(/\s+/g, " ").trim();
  const out = clients.map((cl) => {
    const txns = cl.txns.map((t) => ({ date: t.date, description: finish(t.desc), reference: finish(t.ref), related: finish(t.related).replace(/(\S)MMA$/, "$1 MMA"), gross: t.gross, debit: t.debit, credit: t.credit }));
    const summed = round2(txns.reduce((s, t) => s + t.gross, 0));
    return { name: cl.name, balance: cl.total ? round2(cl.total.gross) : summed, txns };
  });
  return { title, account, period, asOf: footerDate, clients: out };
}

// ---------- matching to deals ----------

const STOP = new Set(["and", "the", "of", "trust", "family", "llc", "inc", "jr", "sr", "ii", "iii", "trustee", "manager", "member", "revocable", "living", "estate"]);
const nameTokens = (s) => String(s || "").toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));

/** "77 Kibling Hill Road" → ["77 kibling"]; every number+word pair in the text. */
export function addressKeys(text) {
  const keys = new Set();
  const re = /\b0*(\d+[a-z]?)\s+([a-z][a-z]*)/gi;
  let m;
  const clean = String(text || "").replace(/['’]/g, "");
  while ((m = re.exec(clean))) {
    const word = m[2].toLowerCase();
    if (["of", "and", "for", "part", "hours", "days"].includes(word)) continue;
    keys.add(`${m[1].toLowerCase() || "0"} ${word}`);
  }
  return [...keys];
}

function dealKey(tx) {
  return addressKeys(String(tx.address || "").split(",")[0])[0] || null;
}

export function dealStatus(tx) {
  if (!tx) return null;
  if (tx.terminated_at) return /^Listing expired/.test(tx.termination_reason || "") ? "Expired" : "Terminated";
  if (tx.stage === "closed") return "Closed";
  if (tx.stage === "contract") return tx.ready_for_closeout_at ? "Ready for Closeout" : "Under Contract";
  return "Active";
}

/** Find the deal a trust client belongs to: address in their descriptions first, names to break ties. */
export function matchDeal(client, transactions, account) {
  const text = client.txns.map((t) => `${t.description} ${t.reference || ""}`).join(" ");
  const keys = new Set(addressKeys(text));
  const tokens = nameTokens(client.name);
  const nameHit = (tx) => tokens.some((w) => nameTokens(`${tx.buyer_name || ""} ${tx.seller_name || ""}`).includes(w));
  const pool = transactions;
  let cands = pool.filter((tx) => keys.has(dealKey(tx)));
  if (cands.length > 1) {
    const named = cands.filter(nameHit);
    if (named.length) cands = named;
  }
  if (!cands.length) {
    const named = pool.filter(nameHit);
    if (named.length === 1) cands = named;
  }
  if (!cands.length) return null;
  // Most recent wins (same address sold twice).
  const sameAcct = (tx) => (!account || !tx.region || tx.region === account ? 1 : 0);
  return [...cands].sort((a, b) => sameAcct(b) - sameAcct(a) || String(b.next_date || b.updated_at || "").localeCompare(String(a.next_date || a.updated_at || "")))[0];
}

/** Report + deals → [{ key, name, balance, invoiced, issues, flagged, deal, status, last }], worst first. */
export function analyzeTrust(report, transactions) {
  const rows = [];
  for (const cl of report.clients || []) {
    const invoiced = round2(cl.txns.filter((t) => /receivable/i.test(t.related)).reduce((s, t) => s + t.gross, 0));
    const balance = round2(cl.balance);
    if (Math.abs(balance) < 0.005 && Math.abs(invoiced) < 0.005) continue;
    const nonClient = NON_CLIENT_RE.test(cl.name.trim());
    const deal = nonClient ? null : matchDeal(cl, transactions, report.account);
    const status = dealStatus(deal);
    const text = cl.txns.map((t) => t.description).join(" ");
    const saysDone = /terminat|closing|retain|refund|return/i.test(text);
    const issues = [];
    if (invoiced) issues.push({ kind: "invoiced", text: `$${fmt(invoiced)} deposit invoiced in Xero — confirm it was received and matched` });
    const held = round2(balance - invoiced);
    if (held > 0) issues.push({ kind: "held", text: `$${fmt(held)} still in trust` });
    if (balance < 0) issues.push({ kind: "negative", text: `$${fmt(-balance)} more paid out than came in — check where it was posted` });
    const wrongAccount = Boolean(deal?.region && report.account && deal.region !== report.account && balance !== 0);
    if (wrongAccount) issues.push({ kind: "account", text: `Deal is in ${deal.region} but this is the ${report.account} trust account` });
    const flagged = !nonClient && balance !== 0 && (wrongAccount || status === "Closed" || status === "Terminated" || status === "Expired");
    const last = cl.txns[cl.txns.length - 1] || null;
    rows.push({
      key: `${report.account || "?"}|${cl.name}`,
      name: cl.name,
      balance,
      invoiced,
      issues,
      nonClient,
      flagged,
      warn: !flagged && !nonClient && balance > 0 && !deal && saysDone,
      deal,
      status,
      last,
    });
  }
  const rank = (r) => (r.flagged ? 0 : r.nonClient ? 4 : r.balance < 0 ? 1 : r.warn ? 2 : 3);
  return rows.sort((a, b) => rank(a) - rank(b) || Math.abs(b.balance) - Math.abs(a.balance));
}

const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => `${n < 0 ? "−" : ""}$${fmt(Math.abs(n))}`;

// ---------- saved uploads (the running list) ----------

export async function saveTrustReport(agentId, fileName, report) {
  const { data, error } = await supabase
    .from("trust_reconciliations")
    .insert({ account: report.account, file_name: fileName, period: report.period, report_date: toYmd(report.asOf), clients: report.clients, uploaded_by: agentId })
    .select()
    .single();
  if (error) throw new Error(/trust_reconciliations|schema cache|does not exist/i.test(error.message) ? "Run the trust reconciliation SQL first (it's in supabase/schema.sql)." : error.message);
  return data;
}

/** Newest two uploads per account (current + previous, for "new / cleared since last time"). */
export async function fetchTrustReports() {
  const { data, error } = await supabase.from("trust_reconciliations").select("*").order("uploaded_at", { ascending: false }).limit(40);
  if (error) return { byAccount: {}, missing: /trust_reconciliations|schema cache|does not exist/i.test(error.message), error: error.message };
  const byAccount = {};
  for (const r of data || []) {
    const k = r.account || "?";
    (byAccount[k] ||= []).length < 2 && byAccount[k].push(r);
  }
  return { byAccount, missing: false };
}

function toYmd(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Accounts not uploaded yet this calendar month (for the monthly reminder). */
export function accountsDueThisMonth(byAccount, now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const known = new Set(["VT", ...Object.keys(byAccount || {}).filter((k) => k !== "?")]);
  return [...known].filter((acct) => {
    const latest = byAccount?.[acct]?.[0];
    return !latest || new Date(latest.uploaded_at) < monthStart;
  });
}
