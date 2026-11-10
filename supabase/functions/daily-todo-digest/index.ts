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
// Deployed with --no-verify-jwt. Two ways in:
// - pg_cron, with the x-cron-secret header matching the CRON_SECRET secret.
// - TEMPORARY: a signed-in broker from the app's "Test Daily Digest" button.
//   That path always forces testMode + force, so it can never email agents.
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

/** True if the Authorization header is a real session for a broker. */
async function isBrokerCaller(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: authHeader, apikey: SERVICE_ROLE_KEY } });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  if (!user.email) return false;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=eq.${encodeURIComponent(user.email)}&role=eq.broker&select=id`, { headers: serviceHeaders });
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0;
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

async function sendGmail(accessToken: string, to: string, subject: string, html: string) {
  const headers = [
    `From: Hall Collins Flow <${GMAIL_SENDER_EMAIL}>`,
    `To: ${to}`,
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

function todoLine(t: Todo, today: string): string {
  let badge = "";
  if (t.due_date && t.due_date < today) badge = `<span style="color:#B42318;font-weight:700;">Overdue (${shortDate(t.due_date)})</span> `;
  else if (t.due_date === today) badge = `<span style="color:#B54708;font-weight:700;">Due today</span> `;
  else if (t.due_date) badge = `<span style="color:#667085;">Due ${shortDate(t.due_date)}</span> `;
  return `<li style="margin:3px 0;">${badge}${escapeHtml(t.text)}</li>`;
}

function rank(t: Todo, today: string): number {
  if (!t.due_date) return 3;
  if (t.due_date < today) return 0;
  if (t.due_date === today) return 1;
  return 2;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  try {
    const fromCron = Boolean(CRON_SECRET) && req.headers.get("x-cron-secret") === CRON_SECRET;
    const fromBroker = !fromCron && (await isBrokerCaller(req.headers.get("Authorization")));
    if (!fromCron && !fromBroker) return json({ error: "Forbidden" }, 403);

    let body: { force?: boolean; testMode?: boolean } = {};
    try {
      body = await req.json();
    } catch {
      // empty body from cron is fine
    }
    if (fromBroker) body = { force: true, testMode: true };
    const { date: today, hour } = nowInVermont();
    if (!body.force && hour !== 6) return json({ skipped: `It's ${hour}:xx in Vermont, not 6` });

    const agentsRes = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=id,name,email`, { headers: serviceHeaders });
    const agents: { id: string; name: string; email: string | null }[] = await agentsRes.json();

    const txRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?terminated_at=is.null&select=id,address,agent_id,stage,terminated_at,compliance_closed_at,todos(text,done,due_date)`,
      { headers: serviceHeaders }
    );
    const txs: Tx[] = await txRes.json();
    if (!txRes.ok) throw new Error(`Failed to load deals: ${JSON.stringify(txs)}`);

    const accessToken = await getGmailAccessToken();
    const sent: { agent: string; deals: number; todos: number }[] = [];
    const errors: string[] = [];

    for (const agent of agents) {
      if (!agent.email) continue;
      const deals = txs
        .filter((tx) => tx.agent_id === agent.id && !tx.compliance_closed_at)
        .map((tx) => ({ tx, open: (tx.todos || []).filter((t) => !t.done).sort((a, b) => rank(a, today) - rank(b, today) || (a.due_date || "").localeCompare(b.due_date || "")) }))
        .filter((d) => d.open.length);
      if (!deals.length) continue;

      // Deals with something overdue/due today first.
      deals.sort((a, b) => rank(a.open[0], today) - rank(b.open[0], today) || a.tx.address.localeCompare(b.tx.address));
      const all = deals.flatMap((d) => d.open);
      const overdue = all.filter((t) => t.due_date && t.due_date < today).length;
      const dueToday = all.filter((t) => t.due_date === today).length;

      const summary = [overdue ? `${overdue} overdue` : null, dueToday ? `${dueToday} due today` : null, `${all.length} open in total`]
        .filter(Boolean)
        .join(" · ");

      let html = `<p>Good morning ${escapeHtml(agent.name.split(/\s+/)[0])}!</p>
<p>Here's your to-do list for today: <strong>${summary}</strong>.</p>`;
      for (const { tx, open } of deals) {
        html += `<h3 style="margin:18px 0 4px;font-size:15px;">${escapeHtml(tx.address)}</h3><ul style="margin:0;padding-left:20px;">${open
          .map((t) => todoLine(t, today))
          .join("")}</ul>`;
      }
      html += `<p style="margin-top:18px;"><a href="${APP_URL}">Open HC Flow</a></p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;

      const subject = overdue || dueToday ? `Today's To-Dos: ${[overdue ? `${overdue} overdue` : null, dueToday ? `${dueToday} due today` : null].filter(Boolean).join(", ")}` : "Today's To-Dos";
      const to = body.testMode ? FRAN_EMAIL : agent.email;
      const finalHtml = body.testMode
        ? `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">🧪 <strong>TEST MODE</strong> — this would have gone to <strong>${escapeHtml(agent.email)}</strong>.</div>${html}`
        : html;
      try {
        await sendGmail(accessToken, to, subject, finalHtml);
        sent.push({ agent: agent.name, deals: deals.length, todos: all.length });
      } catch (e) {
        errors.push(`${agent.name}: ${String(e)}`);
      }
    }

    return json({ today, testMode: Boolean(body.testMode), sent, errors });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
