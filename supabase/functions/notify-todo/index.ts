// Notifies the right people when a to-do is added:
// - Transaction coordinator adds a to-do on a deal -> that deal's agent.
// - Anyone writes "@FirstName" (or "@First Last") in a to-do -> that person,
//   matched against the active roster by first or full name, case-insensitive.
// Each recipient gets an in-app notification row (the bell in the header)
// AND an email via the same Gmail API mailbox the closeout email uses. The
// person who added the to-do is never notified about their own to-do.
//
// Caller identity is verified server-side from their own Supabase session
// (/auth/v1/user), never trusted from the request body, and they must be able
// to see the deal (broker/coordinator, or the deal's own agent) — so this
// can't be used to email arbitrary people about arbitrary deals.
//
// Expects POST { transactionId, text, dueDate?, appUrl? }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
const GMAIL_SENDER_EMAIL = Deno.env.get("GMAIL_SENDER_EMAIL") || "fran.collins@hallcollins.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const serviceHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDue(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(dateStr);
  if (!m) return dateStr;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

// RFC 2047 encoded-word, so an address with an em dash or accent in the
// subject line doesn't come through garbled.
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
  const raw = base64url(`${headers.join("\r\n")}\r\n\r\n${html}`);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
}

interface Agent {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

/** "@Rachel" -> agents whose first name is Rachel; "@Rachel Noyes" -> exact
 * full-name match wins if there is one. Unknown names are just ignored. */
function mentionedAgents(text: string, roster: Agent[]): Agent[] {
  const found = new Map<string, Agent>();
  const re = /(?:^|\s)@([A-Za-z][A-Za-z'-]*)(?:\s+([A-Za-z][A-Za-z'-]*))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const first = m[1].toLowerCase();
    const full = m[2] ? `${first} ${m[2].toLowerCase()}` : null;
    const fullMatch = full ? roster.find((a) => a.name.toLowerCase() === full) : null;
    if (fullMatch) {
      found.set(fullMatch.id, fullMatch);
      continue;
    }
    for (const a of roster) {
      if (a.name.split(/\s+/)[0].toLowerCase() === first) found.set(a.id, a);
    }
  }
  return [...found.values()];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Not signed in" }, 401);
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: SERVICE_ROLE_KEY },
    });
    const user = await userRes.json();
    if (!userRes.ok || !user.email) return jsonResponse({ error: "Could not verify who you're signed in as" }, 401);

    const { transactionId, text, dueDate, appUrl } = await req.json();
    if (!transactionId || !text) return jsonResponse({ error: "transactionId and text required" }, 400);

    const rosterRes = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=id,name,email,role`, {
      headers: serviceHeaders,
    });
    const roster: Agent[] = await rosterRes.json();
    const caller = roster.find((a) => a.email?.toLowerCase() === String(user.email).toLowerCase());
    if (!caller) return jsonResponse({ error: "No active agent record matches your sign-in email" }, 403);

    const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${encodeURIComponent(transactionId)}&select=id,address,agent_id`, {
      headers: serviceHeaders,
    });
    const [tx] = await txRes.json();
    if (!tx) return jsonResponse({ error: "Deal not found" }, 404);

    const isStaff = caller.role === "broker" || caller.role === "coordinator";
    if (!isStaff && tx.agent_id !== caller.id) return jsonResponse({ error: "Not your deal" }, 403);

    const recipients = new Map<string, { agent: Agent; reason: "assigned" | "mention" }>();
    if (caller.role === "coordinator" && tx.agent_id) {
      const owner = roster.find((a) => a.id === tx.agent_id);
      if (owner) recipients.set(owner.id, { agent: owner, reason: "assigned" });
    }
    for (const a of mentionedAgents(text, roster)) {
      if (!recipients.has(a.id)) recipients.set(a.id, { agent: a, reason: "mention" });
    }
    recipients.delete(caller.id);

    if (!recipients.size) return jsonResponse({ notified: [] });

    const due = formatDue(dueDate);
    const firstName = caller.name.split(/\s+/)[0];

    // In-app notifications first — they don't depend on Gmail working.
    const rows = [...recipients.values()].map(({ agent, reason }) => ({
      recipient_agent_id: agent.id,
      transaction_id: tx.id,
      kind: reason === "mention" ? "todo_mention" : "todo_assigned",
      message:
        reason === "mention"
          ? `${firstName} mentioned you in a to-do on ${tx.address}: "${text}"`
          : `${firstName} added a to-do on ${tx.address}: "${text}"`,
      created_by_agent_id: caller.id,
    }));
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: "POST",
      headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(rows),
    });
    const notificationError = insRes.ok ? null : await insRes.text();

    const emailErrors: string[] = [];
    const withEmail = [...recipients.values()].filter(({ agent }) => agent.email);
    if (withEmail.length) {
      const accessToken = await getGmailAccessToken();
      for (const { agent, reason } of withEmail) {
        const intro =
          reason === "mention"
            ? `${escapeHtml(caller.name)} mentioned you in a to-do on <strong>${escapeHtml(tx.address)}</strong>:`
            : `${escapeHtml(caller.name)} added a to-do on <strong>${escapeHtml(tx.address)}</strong>:`;
        const html = `<p>Hi ${escapeHtml(agent.name.split(/\s+/)[0])},</p>
<p>${intro}</p>
<blockquote style="border-left:3px solid #E8A0B4;margin:12px 0;padding:6px 12px;">${escapeHtml(text)}</blockquote>
${due ? `<p><strong>Due:</strong> ${escapeHtml(due)}</p>` : ""}
${appUrl ? `<p><a href="${escapeHtml(appUrl)}">Open HC Flow</a></p>` : ""}
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;
        try {
          await sendGmail(accessToken, agent.email!, `To-do: ${tx.address}`, html);
        } catch (e) {
          emailErrors.push(`${agent.name}: ${String(e)}`);
        }
      }
    }

    return jsonResponse({
      notified: [...recipients.values()].map(({ agent }) => agent.name),
      noEmailOnFile: [...recipients.values()].filter(({ agent }) => !agent.email).map(({ agent }) => agent.name),
      emailErrors,
      notificationError,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
