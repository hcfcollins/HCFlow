// ── EMAILS_LIVE ── Fran's test-mode switch for every automatic email this
// function sends. While false, everything goes ONLY to Fran, with a yellow
// banner naming who it would really have gone to. Flip to true (and
// redeploy) only once Fran explicitly authorizes going live to everyone.
// notify-todo has its own matching constant.
// LIVE since Nov 15, 2026 — Fran authorized emails to everyone.
const EMAILS_LIVE = true;
// Partial go-live (Fran, Nov 13 2026): the daily TO-DO DIGEST goes for real to
// just these people; everyone else's still comes to Fran in test mode.
// Closing and license reminders are still fully in test mode.
const DIGEST_LIVE_FOR = new Set(["fran.collins@hallcollins.com", "kerry.dawson@hallcollins.com", "rachel.noyes@hallcollins.com"]);

// Runs three daily automations off the one pg_cron trigger:
//  3. License renewal reminders (sendLicenseReminders) — VT/NH real estate
//     licenses, to the agent + Fran: 3 months out (continuing education),
//     1 month, 2 weeks, 1 day.
//  1. The to-do digest (below).
//  2. Closing reminders (sendClosingReminders) — 10 days before a listing
//     closes: order the final town water/sewer reading, send the deposit
//     check to the attorneys.
//
// Daily 6:15 AM (Vermont time) to-do reminder email: one email per agent,
// listing the open to-dos on their own active deals, grouped by property,
// with Overdue / Due Today called out first. Agents with nothing open get no
// email. Terminated deals, and closed deals already closed for compliance,
// are skipped.
//
// Triggered by pg_cron (see the cron.schedule call in the setup SQL) at both
// 10:15 and 11:15 UTC — 6:15 AM Eastern is one or the other depending on
// daylight saving — and this function only actually sends on the run where
// it's 6 AM in America/New_York, so exactly one goes out per day.
//
// Deployed with --no-verify-jwt. Only way in: pg_cron, with the x-cron-secret
// header matching the CRON_SECRET secret.
//
// POST body (all optional): { force: true } skips the 6 AM check;
// { testMode: true } sends every agent's digest to Fran only, with a banner.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
const GMAIL_SENDER_EMAIL = Deno.env.get("GMAIL_SENDER_EMAIL") || "fran.collins@hallcollins.com";
const FRAN_EMAIL = "fran.collins@hallcollins.com";
const HOLLY_EMAIL = "holly.hall@hallcollins.com";
const CLOSING_REMINDER_DAYS = 10;
const TZ = "America/New_York";
const APP_URL = "https://hc-flow.vercel.app";

const serviceHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** YYYY-MM-DD and hour (0-23) right now in Vermont. */
function nowInVermont() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function shortDate(d: string): string {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(d);
  if (!m) return d;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

async function getGmailAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: GMAIL_REFRESH_TOKEN,
      client_id: GMAIL_CLIENT_ID,
      client_secret: GMAIL_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

function base64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeSubject(subject: string): string {
  return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`;
}

async function sendGmail(accessToken: string, to: string, subject: string, html: string, cc: string[] = []) {
  const headers = [
    `From: Hall Collins Flow <${GMAIL_SENDER_EMAIL}>`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ];
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64url(`${headers.join("\r\n")}\r\n\r\n${html}`) }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
}

interface Todo {
  text: string;
  done: boolean;
  due_date: string | null;
}
interface Tx {
  id: string;
  address: string;
  agent_id: string | null;
  stage: string;
  terminated_at: string | null;
  compliance_closed_at: string | null;
  todos: Todo[];
}

function todoLine(t: Todo, today: string, tomorrow: string): string {
  let badge = "";
  if (t.due_date && t.due_date < today) badge = `<span style="color:#B42318;font-weight:700;">Overdue (${shortDate(t.due_date)})</span> `;
  else if (t.due_date === today) badge = `<span style="color:#B54708;font-weight:700;">Due today</span> `;
  else if (t.due_date === tomorrow) badge = `<span style="color:#B54708;">Due tomorrow</span> `;
  else if (t.due_date) badge = `<span style="color:#667085;">Due ${shortDate(t.due_date)}</span> `;
  else badge = `<span style="color:#C7155B;font-weight:700;">Tagged you</span> `;
  return `<li style="margin:3px 0;">${badge}${escapeHtml(t.text)}</li>`;
}

function rank(t: Todo, today: string): number {
  if (!t.due_date) return 4;
  if (t.due_date < today) return 0;
  if (t.due_date === today) return 1;
  if (t.due_date === addDays(today, 1)) return 2;
  return 3;
}

/** Does this to-do @-tag this person? Same rules as notify-todo and the app:
 * "@First Last" exact, or "@First" by first name. */
function tagsAgent(text: string, agentName: string): boolean {
  const full = agentName.toLowerCase();
  const first = full.split(/\s+/)[0];
  const re = /(?:^|\s)@([A-Za-z][A-Za-z'-]*)(?:\s+([A-Za-z][A-Za-z'-]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const f = m[1].toLowerCase();
    if (m[2] && `${f} ${m[2].toLowerCase()}` === full) return true;
    if (f === first) return true;
  }
  return false;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Normalizes next_date (plain text, mixed formats) to YYYY-MM-DD, or null. */
function normalizeYmd(v: string | null): string | null {
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 10 days before a listing closes: order the final town water/sewer reading
 * (only if it's on public water/sewer) and send the deposit check to the
 * attorneys (only if we hold a deposit). To the listing agent, cc Fran +
 * Holly. `windowTest` (the Test button) instead covers every listing closing
 * in the next 14 days, so there's something to look at. */
// ── License renewal reminders ──
// Days before expiration → what the email says. Each one is sent once per
// license per expiration date (agents.license_reminders remembers), so a new
// expiration date after renewing starts the schedule over.
const LICENSE_STEPS: { days: number; when: string; note: string }[] = [
  { days: 90, when: "in 3 months", note: "Now's the time to get your continuing education done so you can renew on time." },
  { days: 30, when: "in 1 month", note: "If your continuing education isn't finished yet, please wrap it up and renew." },
  { days: 14, when: "in 2 weeks", note: "Please renew as soon as possible." },
  { days: 1, when: "tomorrow", note: "Please renew today — you can't practice on an expired license." },
];
const STATE_NAME: Record<string, string> = { VT: "Vermont", NH: "New Hampshire", BROKER: "broker" };

function daysBetween(fromYmd: string, toYmd: string) {
  const [a, b] = [fromYmd, toYmd].map((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    return Date.UTC(y, m - 1, dd);
  });
  return Math.round((b - a) / 86400000);
}
function longDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

async function sendLicenseReminders(accessToken: string, today: string, testMode: boolean, record: boolean, errors: string[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=*`, { headers: serviceHeaders });
  const agents = await res.json();
  if (!res.ok) {
    errors.push(`License reminders: couldn't load agents: ${JSON.stringify(agents)}`);
    return [];
  }
  if (!agents.length || !("vt_license_expires" in agents[0])) return []; // columns not added yet
  const fran = agents.find((a: { email: string | null }) => (a.email || "").toLowerCase() === FRAN_EMAIL);
  const results: { agent: string; state: string; step: number }[] = [];

  for (const agent of agents) {
    const sentLog: Record<string, number[]> = agent.license_reminders || {};
    let changed = false;
    for (const st of ["VT", "NH", "BROKER"]) {
      if (st === "NH" && agent.nh_not_licensed) continue; // NH is optional
      const expires = agent[`${st.toLowerCase()}_license_expires`];
      if (!expires) continue;
      const left = daysBetween(today, expires);
      if (left < 1) continue;
      const key = `${st}:${expires}`;
      const already = sentLog[key] || [];
      // The closest step we've reached that hasn't gone out yet. Earlier
      // (bigger) steps that were skipped — e.g. the date was only entered
      // last week — are marked done so they don't all fire at once.
      const due = LICENSE_STEPS.filter((s) => left <= s.days && !already.includes(s.days));
      if (!due.length) continue;
      const step = due[due.length - 1];

      const first = agent.name.split(/\s+/)[0];
      const stateName = STATE_NAME[st];
      const licenseName = st === "BROKER" ? "real estate broker license" : `${stateName} real estate license`;
      const subject = `License reminder: your ${st === "BROKER" ? "broker" : stateName} license expires ${step.when}`;
      const html = `<p>Hi ${escapeHtml(first)},</p>
<p>Your <strong>${licenseName}</strong> expires <strong>${step.when}</strong>, on <strong>${longDate(expires)}</strong>.</p>
<p>${step.note}</p>
<p>Once you've renewed, send Fran a copy of your new license so it can be updated in HC Flow.</p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;
      const realTo = agent.email || FRAN_EMAIL;
      const cc = realTo.toLowerCase() === FRAN_EMAIL ? [] : [FRAN_EMAIL];
      const to = testMode ? FRAN_EMAIL : realTo;
      const finalHtml = testMode
        ? `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">🧪 <strong>TEST MODE</strong> — this would have gone to <strong>${escapeHtml(agent.email || `${agent.name} (no email on file)`)}</strong>${cc.length ? `, cc Fran` : ""}.</div>${html}`
        : html;
      try {
        await sendGmail(accessToken, to, subject, finalHtml, testMode ? [] : cc);
        results.push({ agent: agent.name, state: st, step: step.days });
        if (record) {
          // In-app bell for the agent and Fran too.
          const message = `${st} license for ${agent.name} expires ${step.when} (${longDate(expires)}).`;
          const recipients = [...new Set([agent.id, fran?.id].filter(Boolean))];
          await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST",
            headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify(recipients.map((id) => ({ recipient_agent_id: id, transaction_id: null, kind: "todo_assigned", message }))),
          });
          sentLog[key] = [...new Set([...already, ...LICENSE_STEPS.filter((s) => s.days >= step.days).map((s) => s.days)])];
          changed = true;
        }
      } catch (e) {
        errors.push(`License reminder ${agent.name} ${st}: ${String(e)}`);
      }
    }
    if (changed) {
      await fetch(`${SUPABASE_URL}/rest/v1/agents?id=eq.${agent.id}`, {
        method: "PATCH",
        headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ license_reminders: sentLog }),
      });
    }
  }
  // The firm's own licenses (Hall Collins Real Estate Group) → Fran only.
  const firmRes = await fetch(`${SUPABASE_URL}/rest/v1/brokerage_licenses?select=*`, { headers: serviceHeaders });
  if (firmRes.ok) {
    const firmRows = await firmRes.json();
    for (const row of firmRows) {
      if (!row.expires) continue;
      const left = daysBetween(today, row.expires);
      if (left < 1) continue;
      const key = `${row.state}:${row.expires}`;
      const log: Record<string, number[]> = row.reminders || {};
      const already = log[key] || [];
      const due = LICENSE_STEPS.filter((s) => left <= s.days && !already.includes(s.days));
      if (!due.length) continue;
      const step = due[due.length - 1];
      const stateName = STATE_NAME[row.state] || row.state;
      // BOP / EO rows are the firm's insurance policies, not licenses.
      const POLICY: Record<string, string> = { BOP: "Business Owner's insurance policy", EO: "Errors & Omissions insurance policy" };
      const policy = POLICY[row.state];
      const subject = policy ? `Insurance reminder: the ${policy} ends ${step.when}` : `License reminder: the ${stateName} BROKERAGE license expires ${step.when}`;
      const html = policy
        ? `<p>Hi Fran,</p>
<p>Hall Collins Real Estate Group's <strong>${policy}</strong> ends <strong>${step.when}</strong>, on <strong>${longDate(row.expires)}</strong>.</p>
<p>${step.days >= 30 ? "Time to get the renewal started." : "Please renew as soon as possible."} Once it's renewed, upload the new policy and end date on Manage Agents → Insurance Policies.</p>`
        : `<p>Hi Fran,</p>
<p>Hall Collins Real Estate Group's <strong>${stateName} brokerage (firm) license</strong> expires <strong>${step.when}</strong>, on <strong>${longDate(row.expires)}</strong>.</p>
<p>${step.days >= 30 ? "Time to get the renewal started." : "Please renew as soon as possible."} Once it's renewed, upload the new license and expiration date on Manage Agents → Brokerage Licenses.</p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;
      try {
        await sendGmail(accessToken, FRAN_EMAIL, subject, html);
        results.push({ agent: "Hall Collins Real Estate Group", state: row.state, step: step.days });
        if (record) {
          if (fran?.id) {
            await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
              method: "POST",
              headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
              body: JSON.stringify([{ recipient_agent_id: fran.id, transaction_id: null, kind: "todo_assigned", message: policy ? `The ${policy} ends ${step.when} (${longDate(row.expires)}).` : `The ${stateName} brokerage license expires ${step.when} (${longDate(row.expires)}).` }]),
            });
          }
          log[key] = [...new Set([...already, ...LICENSE_STEPS.filter((s) => s.days >= step.days).map((s) => s.days)])];
          await fetch(`${SUPABASE_URL}/rest/v1/brokerage_licenses?state=eq.${row.state}`, {
            method: "PATCH",
            headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ reminders: log }),
          });
        }
      } catch (e) {
        errors.push(`Brokerage license reminder ${row.state}: ${String(e)}`);
      }
    }
  }
  return results;
}

async function sendClosingReminders(
  accessToken: string,
  agents: { id: string; name: string; email: string | null }[],
  today: string,
  testMode: boolean,
  windowTest: boolean,
  errors: string[]
) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?terminated_at=is.null&stage=eq.contract&select=` +
      encodeURIComponent(
        "id,address,side,agent_id,next_date,town_water_sewer,utilities," +
          "buyer_attorney:attorneys!transactions_buyer_attorney_id_fkey(name),seller_attorney:attorneys!transactions_seller_attorney_id_fkey(name)," +
          "commission_data(hold_deposit,deposit_amount,second_deposit,second_deposit_amount)"
      ),
    { headers: serviceHeaders }
  );
  const txs = await res.json();
  if (!res.ok) {
    errors.push(`Closing reminders: couldn't load deals: ${JSON.stringify(txs)}`);
    return [];
  }

  const target = addDays(today, CLOSING_REMINDER_DAYS);
  const windowEnd = addDays(today, 14);
  const results: { address: string; to: string; closing: string }[] = [];

  for (const tx of txs) {
    // Listing side only — a Buy-only deal has no deposit we hold or seller
    // utilities of ours to close out.
    if (tx.side === "Buy") continue;
    const closing = normalizeYmd(tx.next_date);
    if (!closing) continue;
    if (windowTest ? closing < today || closing > windowEnd : closing !== target) continue;

    const cd = tx.commission_data || {};
    const townWater = tx.town_water_sewer === true || tx.utilities?.Water === "Town Water";
    const townSewer = tx.town_water_sewer === true || (tx.utilities?.Septic === "Town Sewer" || tx.utilities?.Septic === "Town Septic");
    const publicWaterSewer = townWater || townSewer;
    const firstDeposit = Number(cd.deposit_amount) || 0;
    const secondDeposit = cd.second_deposit === "Yes" ? Number(cd.second_deposit_amount) || 0 : 0;
    const deposit = cd.hold_deposit === "Yes" ? firstDeposit + secondDeposit : 0;
    if (!publicWaterSewer && !deposit) continue;

    const agent = agents.find((a) => a.id === tx.agent_id);
    const realTo = agent?.email || FRAN_EMAIL;
    const realCc = [FRAN_EMAIL, HOLLY_EMAIL].filter((e) => e !== realTo);

    const waterSewerLabel = townWater && townSewer ? "water/sewer" : townWater ? "water" : "sewer";
    const attorneys = [
      tx.seller_attorney?.name ? `${escapeHtml(tx.seller_attorney.name)} (seller's attorney)` : null,
      tx.buyer_attorney?.name ? `${escapeHtml(tx.buyer_attorney.name)} (buyer's attorney)` : null,
    ].filter(Boolean);
    const daysOut = Math.round((Date.parse(closing) - Date.parse(today)) / 86400000);

    const items: string[] = [];
    if (publicWaterSewer) {
      items.push(`<li><strong>Order the final ${waterSewerLabel} reading</strong> from the town — the property is on public ${waterSewerLabel}.</li>`);
    }
    if (deposit) {
      const breakdown = secondDeposit ? ` (${money(firstDeposit)} + ${money(secondDeposit)} second deposit)` : "";
      const attorneyLine = attorneys.length
        ? `<br/>Attorney${attorneys.length > 1 ? "s" : ""} on file: ${attorneys.join(", ")}`
        : " <em>No attorney on file yet — add one in HC Flow.</em>";
      // Retain vs. deliver is decided in the 5-days-out deposit email.
      items.push(
        `<li><strong>Deposit:</strong> we hold <strong>${money(deposit)}</strong>${breakdown}. Don't send the check yet — you'll get an email 5 days before closing saying whether we <strong>retain</strong> it against our commission or <strong>deliver</strong> it to the attorney.${attorneyLine}</li>`
      );
    }

    let html = `<p>Hi ${escapeHtml((agent?.name || "there").split(/\s+/)[0])},</p>
<p><strong>${escapeHtml(tx.address)}</strong> closes on <strong>${escapeHtml(shortDate(closing))}</strong> — ${daysOut} day${daysOut === 1 ? "" : "s"} from now. Time to:</p>
<ul style="padding-left:20px;">${items.join("")}</ul>
<p><a href="${APP_URL}">Open HC Flow</a></p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;
    if (testMode) {
      const ccNote = realCc.length ? ` (cc ${escapeHtml(realCc.join(", "))})` : "";
      const windowNote = windowTest
        ? " Test runs include every listing closing in the next 14 days; for real it only goes out exactly 10 days before closing."
        : "";
      html = `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">🧪 <strong>TEST MODE</strong> — this would have gone to <strong>${escapeHtml(realTo)}</strong>${ccNote}.${windowNote}</div>${html}`;
    }
    try {
      await sendGmail(accessToken, testMode ? FRAN_EMAIL : realTo, `Closing in ${daysOut} days: ${tx.address}`, html, testMode ? [] : realCc);
      results.push({ address: tx.address, to: realTo, closing });
    } catch (e) {
      errors.push(`Closing reminder ${tx.address}: ${String(e)}`);
    }
  }
  return results;
}

// ── Deposit: retain or release, 5 days before closing ──
// Every Under Contract LISTING of ours (not buyer-side-only deals) gets one
// email exactly 5 days out saying what to do with the earnest money deposit
// — so nobody tells the attorneys the wrong thing. Shows the price,
// commission % and net commission it's based on, so a stale price gets caught:
//  - We hold it, and it's less than our net commission → retain it against
//    the commission (attorney owes us the rest).
//  - We hold it, and it covers the commission, or the buyer's attorney is
//    Jeff Lewis (he always wants the check) → deliver the check.
//  - We DON'T hold it → a reminder not to send anything.
// Net commission = (price − seller credit) × commission % (same as the
// commission statement in the app). To the agent (+ co-list), cc Fran,
// Holly and the coordinator.
const DEPOSIT_REMINDER_DAYS = 5;
const isJeffLewis = (name: string | null | undefined) => /\bjeff(rey)?\s+lewis\b/i.test(String(name || ""));

/** Listings that went live without a packet: each morning, check again and
 * send team@ the "Just Listed" email once the packet is in Showing Docs
 * (deal-emails does the work and records it). Last 30 days only. Skipped
 * quietly until the team_listing_email_at column exists. */
async function sendPendingTeamAnnouncements(testMode: boolean, errors: string[]) {
  if (testMode) return [];
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?terminated_at=is.null&stage=eq.market&side=neq.Buy&team_listing_email_at=is.null&social_went_live_at=gte.${encodeURIComponent(since)}&select=id,address`,
    { headers: serviceHeaders }
  );
  if (!res.ok) return [];
  const rows: { id: string; address: string }[] = await res.json();
  const sent: string[] = [];
  for (const row of rows) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/deal-emails`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "team_announce", transactionId: row.id }),
      });
      const data = await r.json();
      if (data?.sent) sent.push(row.address);
      else if (data?.error) errors.push(`Team email for ${row.address}: ${data.error}`);
    } catch (e) {
      errors.push(`Team email for ${row.address}: ${String(e)}`);
    }
  }
  return sent;
}

async function sendDepositReminders(accessToken: string, today: string, testMode: boolean, errors: string[]) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?terminated_at=is.null&stage=eq.contract&select=` +
      encodeURIComponent(
        "id,address,price,side,split_client_side,agent_id,colist_agent_id,next_date,other_side_id," +
          "buyer_attorney:attorneys!transactions_buyer_attorney_id_fkey(name),seller_attorney:attorneys!transactions_seller_attorney_id_fkey(name)," +
          "commission_data(*),closeouts(commission_pct,price)"
      ),
    { headers: serviceHeaders }
  );
  const txs = await res.json();
  if (!res.ok) {
    errors.push(`Deposit reminders: couldn't load deals: ${JSON.stringify(txs)}`);
    return [];
  }
  const rosterRes = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=id,name,email,role`, { headers: serviceHeaders });
  const roster: { id: string; name: string; email: string | null; role: string }[] = await rosterRes.json();
  const coordinators = roster.filter((a) => a.role === "coordinator" && a.email).map((a) => a.email!);

  const target = addDays(today, DEPOSIT_REMINDER_DAYS);
  const results: { address: string; to: string[]; decision: string }[] = [];
  // One side's numbers.
  // deno-lint-ignore no-explicit-any
  const sideNumbers = (t: any) => {
    const cd = t.commission_data || {};
    const co = t.closeouts || {};
    const held = cd.hold_deposit === "Yes";
    const first = Number(cd.deposit_amount) || 0;
    const second = cd.second_deposit === "Yes" ? Number(cd.second_deposit_amount) || 0 : 0;
    const price = Number(t.price ?? co.price) || 0;
    const credit = Number(cd.seller_credit) || 0;
    const pct = Number(cd.commission_pct ?? co.commission_pct) || 0;
    const isListing = !(t.side === "Buy" || (t.side === "Split" && t.split_client_side === "Buy"));
    return { held, isListing, price, pct, deposit: held ? first + second : 0, credit, commission: price && pct ? ((price - credit) * pct) / 100 : null };
  };

  // deno-lint-ignore no-explicit-any
  const due = txs.filter((t: any) => normalizeYmd(t.next_date) === target);
  // deno-lint-ignore no-explicit-any
  const byId = new Map(due.map((t: any) => [t.id, t]));
  for (const tx of due) {
    // In-house deal (both sides ours, linked by other_side_id): ONE deposit,
    // so one email to both agents, weighed against both sides' commission.
    const partner = tx.other_side_id ? byId.get(tx.other_side_id) : null;
    if (partner && partner.id < tx.id) continue; // the pair is handled once
    const closing = normalizeYmd(tx.next_date)!;
    const sides = [tx, partner].filter(Boolean).map(sideNumbers);
    // Only our listings — a buyer-side-only deal gets no deposit email.
    if (!sides.some((s) => s.isListing)) continue;
    const held = sides.some((s) => s.held);
    const deposit = Math.max(...sides.map((s) => s.deposit));
    const credit = Math.max(...sides.map((s) => s.credit));
    const commission = sides.every((s) => s.commission != null) ? sides.reduce((n, s) => n + (s.commission as number), 0) : null;
    const buyerAtty = tx.buyer_attorney?.name || partner?.buyer_attorney?.name || null;
    const jeff = isJeffLewis(buyerAtty);

    // The numbers behind the decision, price first — so anyone can spot a
    // price that changed and needs updating in HC Flow.
    const price = Math.max(...sides.map((s) => s.price));
    const pctText = sides
      .map((s) => (s.pct ? `${s.pct}%` : "not on file"))
      .join(" + ");
    const numbers = `<p style="margin:8px 0;">Purchase price: <strong>${price ? money(price) : "not on file"}</strong>${credit ? `<br/>Less seller credit: −${money(credit)}` : ""}<br/>Commission: ${pctText}${sides.length > 1 ? " (both sides)" : ""}${commission != null ? `<br/>Net commission: <strong>${money(commission)}</strong>` : ""}<br/>Deposit we hold: <strong>${money(deposit)}</strong></p>
<p style="font-size:13px;color:#666;">If the price or commission isn't right, update it in HC Flow before closing — this decision is based on these numbers.</p>`;

    let decision: string;
    let html: string;
    if (!held) {
      decision = "not held";
      html = `<p style="background:#FDE8E8;border:1px solid #F5B5B5;border-radius:8px;padding:10px 14px;">⚠️ <strong>Reminder: Hall Collins is NOT holding the deposit on this listing — don't send anything.</strong> The other side holds it, so there's no check from us and nothing to retain.</p>`;
    } else if (!deposit) {
      decision = "held, amount unknown";
      html = `<p>We're marked as holding the deposit, but <strong>no amount is on file</strong>. Please add it in HC Flow and check with Fran whether to retain or release it.</p>`;
    } else if (jeff) {
      decision = "release (Jeff Lewis)";
      html = `<p>📤 <strong>Deliver the ${money(deposit)} deposit check to Jeff Lewis</strong> before closing — he always requires the deposit check delivered to him (we don't retain it on his closings).</p>${numbers}`;
    } else if (commission == null) {
      decision = "held, commission unknown";
      html = `<p>We hold the <strong>${money(deposit)}</strong> deposit, but the commission % or price isn't on file, so HC Flow can't tell whether to retain or release it. Please check with Fran.</p>${numbers}`;
    } else if (deposit < commission) {
      decision = "retain";
      html = `<p>✅ <strong>Retain the ${money(deposit)} deposit</strong> against our commission — don't send the check.</p>${numbers}
<p><strong>The attorney owes Hall Collins ${money(commission - deposit)} at closing</strong> (${money(commission)} net commission − ${money(deposit)} deposit we keep).</p>`;
    } else {
      decision = "release";
      html = `<p>📤 <strong>Deliver the ${money(deposit)} deposit check to ${escapeHtml(buyerAtty || "the buyer's attorney")}</strong> before closing — it covers our ${money(commission)} net commission, so we don't retain it.</p>${numbers}`;
    }

    if (partner && commission != null && decision === "retain") {
      html += `<p style="font-size:13px;color:#666;">Both sides are ours, so this is weighed against the combined commission for both sides.</p>`;
    }
    const agentEmails = [...new Set([tx.agent_id, tx.colist_agent_id, partner?.agent_id, partner?.colist_agent_id]
      .map((id: string | null) => roster.find((a) => a.id === id)?.email)
      .filter(Boolean) as string[])];
    const realTo = agentEmails.length ? agentEmails : [FRAN_EMAIL];
    const realCc = [...new Set([FRAN_EMAIL, HOLLY_EMAIL, ...coordinators])].filter((e) => !realTo.includes(e));
    const firstName = (roster.find((a) => a.id === tx.agent_id)?.name || "there").split(/\s+/)[0];
    let body = `<p>Hi ${escapeHtml(firstName)},</p>
<p><strong>${escapeHtml(tx.address)}</strong> closes on <strong>${escapeHtml(shortDate(closing))}</strong> — ${DEPOSIT_REMINDER_DAYS} days from now. Here's the deposit:</p>
${html}
<p><a href="${APP_URL}">Open HC Flow</a></p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;
    if (testMode) {
      body = `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">🧪 <strong>TEST MODE</strong> — this would have gone to <strong>${escapeHtml(realTo.join(", "))}</strong> (cc ${escapeHtml(realCc.join(", "))}).</div>${body}`;
    }
    const subject = `Deposit ${held && deposit ? (decision === "retain" ? "— RETAIN" : decision.startsWith("release") ? "— DELIVER CHECK" : "— check with Fran") : held ? "— amount missing" : "— NOT held by us, don't send anything"}: ${tx.address}`;
    try {
      // sendGmail takes one "to"; extra agents ride along on cc.
      await sendGmail(accessToken, testMode ? FRAN_EMAIL : realTo[0], subject, body, testMode ? [] : [...realTo.slice(1), ...realCc]);
      results.push({ address: tx.address, to: realTo, decision });
    } catch (e) {
      errors.push(`Deposit reminder ${tx.address}: ${String(e)}`);
    }
  }
  return results;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  try {
    const fromCron = Boolean(CRON_SECRET) && req.headers.get("x-cron-secret") === CRON_SECRET;
    // The broker "Test Daily Emails" button was removed (Nov 15, 2026) — the
    // 6:15 cron is the only way in now.
    const fromBroker = false;
    if (!fromCron && !fromBroker) return json({ error: "Forbidden" }, 403);

    let body: { force?: boolean; testMode?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // empty body from cron is fine
    }
    if (fromBroker) body = { force: true, testMode: true };
    // The test button always previews everything to Fran — even the people
    // who are live.
    const previewOnly = fromBroker || body.testMode === true;
    // Not live yet -> every run is a test run, the 6:15 cron included
    // (except the digest for DIGEST_LIVE_FOR, below).
    if (!EMAILS_LIVE) body.testMode = true;
    const { date: today, hour } = nowInVermont();
    if (!body.force && hour !== 6) return json({ skipped: `It's ${hour}:xx in Vermont, not 6` });

    const agentsRes = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=id,name,email`, { headers: serviceHeaders });
    const agents: { id: string; name: string; email: string | null }[] = await agentsRes.json();

    const txRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?terminated_at=is.null&select=*,todos(text,done,due_date)`,
      { headers: serviceHeaders }
    );
    const txs: Tx[] = await txRes.json();
    if (!txRes.ok) throw new Error(`Failed to load deals: ${JSON.stringify(txs)}`);

    const accessToken = await getGmailAccessToken();
    const sent: { agent: string; deals: number; todos: number }[] = [];
    const errors: string[] = [];

    // Kept short on purpose, so people actually read it instead of deleting
    // it: only to-dos that are overdue, due today, or due tomorrow on their
    // own deals — plus any to-do anywhere that @-tags them.
    const tomorrow = addDays(today, 1);
    const overdueCutoff = addDays(today, -3); // overdue by more than 3 days → left out
    for (const agent of agents) {
      if (!agent.email && EMAILS_LIVE) continue;
      const deals = txs
        .filter((tx) => !tx.compliance_closed_at)
        .map((tx) => {
          // Co-list agents get the deal's due to-dos too.
          const isOwn = tx.agent_id === agent.id || (tx as { colist_agent_id?: string }).colist_agent_id === agent.id;
          const open = (tx.todos || [])
            .filter((t) => !t.done)
            // Overdue to-dos only ride along for 3 days past due — after that
            // they drop off the email (still in the app) so it stays short.
            .filter((t) => !t.due_date || t.due_date >= overdueCutoff)
            .filter((t) => (isOwn && t.due_date && t.due_date <= tomorrow) || tagsAgent(t.text, agent.name))
            .sort((a, b) => rank(a, today) - rank(b, today) || (a.due_date || "").localeCompare(b.due_date || ""));
          return { tx, open };
        })
        .filter((d) => d.open.length);
      if (!deals.length) continue;

      // Deals with something overdue/due today first.
      deals.sort((a, b) => rank(a.open[0], today) - rank(b.open[0], today) || a.tx.address.localeCompare(b.tx.address));
      const all = deals.flatMap((d) => d.open);
      const overdue = all.filter((t) => t.due_date && t.due_date < today).length;
      const dueToday = all.filter((t) => t.due_date === today).length;

      const dueTomorrow = all.filter((t) => t.due_date === tomorrow).length;
      const tagged = all.filter((t) => !t.due_date || t.due_date > tomorrow).length;
      const summary = [
        overdue ? `${overdue} overdue` : null,
        dueToday ? `${dueToday} due today` : null,
        dueTomorrow ? `${dueTomorrow} due tomorrow` : null,
        tagged ? `${tagged} tagged to you` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      let html = `<p>Good morning ${escapeHtml(agent.name.split(/\s+/)[0])}!</p>
<p>Here's what needs your attention: <strong>${summary}</strong>.</p>`;
      for (const { tx, open } of deals) {
        html += `<h3 style="margin:18px 0 4px;font-size:15px;">${escapeHtml(tx.address)}</h3><ul style="margin:0;padding-left:20px;">${open
          .map((t) => todoLine(t, today, tomorrow))
          .join("")}</ul>`;
      }
      html += `<p style="margin-top:18px;"><a href="${APP_URL}">Open HC Flow</a></p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;

      const subject = overdue || dueToday ? `Today's To-Dos: ${[overdue ? `${overdue} overdue` : null, dueToday ? `${dueToday} due today` : null].filter(Boolean).join(", ")}` : "Today's To-Dos";
      // Live for this person? (Everyone, once EMAILS_LIVE; until then only DIGEST_LIVE_FOR.)
      const liveForAgent = !previewOnly && Boolean(agent.email) && (EMAILS_LIVE || DIGEST_LIVE_FOR.has(agent.email!.toLowerCase()));
      const to = liveForAgent ? agent.email! : FRAN_EMAIL;
      const finalHtml = !liveForAgent
        ? `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">🧪 <strong>TEST MODE</strong> — this would have gone to <strong>${agent.email ? escapeHtml(agent.email) : `${escapeHtml(agent.name)} — no email on file yet`}</strong>.</div>${html}`
        : html;
      try {
        await sendGmail(accessToken, to, subject, finalHtml);
        sent.push({ agent: agent.name, deals: deals.length, todos: all.length });
      } catch (e) {
        errors.push(`${agent.name}: ${String(e)}`);
      }
    }

    const closingReminders = await sendClosingReminders(accessToken, agents, today, Boolean(body.testMode), fromBroker, errors);
    const depositReminders = await sendDepositReminders(accessToken, today, Boolean(body.testMode), errors);
    // Only the real 6:15 run records a reminder as sent — the test button
    // just previews, so it never uses up a real reminder.
    const licenseReminders = await sendLicenseReminders(accessToken, today, Boolean(body.testMode), fromCron, errors);
    const teamAnnouncements = await sendPendingTeamAnnouncements(Boolean(body.testMode), errors);

    return json({ today, testMode: Boolean(body.testMode), sent, closingReminders, depositReminders, licenseReminders, teamAnnouncements, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
