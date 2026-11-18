// Sends the commission closeout email for a deal, replicating the branching
// logic from the old Google Sheet's MailApp-based Apps Script trigger (the
// "handleCommissionEmail" function Fran shared) — fed the Close-Out
// Calculator's own already-computed numbers directly (the same values shown
// in its own Preview section, same shape as buildSheetPayload) rather than
// reading a saved closeouts row, so this works from Run Close-Out Calculator
// too, before anything's actually been saved. Sends via the Gmail API (a real
// Workspace mailbox, not a transactional-email provider) so it looks and
// behaves like a genuine email from Hall Collins.
//
// Branches (same as the legacy script):
// - Owner deal (agent is Holly or Fran): one email to Fran + Holly with the
//   full breakdown.
// - Outside agent: an email to that agent (cc partners@hallcollins.com) with
//   just their own commission, PLUS — if it's a Provided lead and Holly/Fran
//   actually have a cut — a second email to Fran + Holly with the team's side
//   of it. No agent email on file -> that email is just skipped, like legacy.
//
// Expects POST { address, agentName, agentEmail, leadType, grossCommission,
// commissionAfterReferral, referralOwedTo, referralPct, referralAmount,
// agentCommission, hollyCommission, franCommission, bankAmount, tcFeeAmount,
// totalToDistribute, testMode? }. In test mode, every email that *would* have
// gone out is instead sent only to Fran's own address, with a banner naming
// who the real recipients would have been.
//
// Needs Gmail API OAuth (Cloud Console project + OAuth client + a refresh
// token authorized with the gmail.send scope against the sending mailbox) —
// see the app's project memory for the exact one-time setup steps.

const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
// Whatever mailbox authorized the refresh token above — Gmail's API sends as
// that account regardless of any From header, so this is informational (used
// for the display name) rather than something that actually picks the sender.
const GMAIL_SENDER_EMAIL = Deno.env.get("GMAIL_SENDER_EMAIL") || "fran.collins@hallcollins.com";

const FRAN_EMAIL = "fran.collins@hallcollins.com";
const HOLLY_EMAIL = "holly.hall@hallcollins.com";
const PARTNERS_EMAIL = "partners@hallcollins.com";
// The transaction coordinator is copied on every closeout email.
const KERRY_EMAIL = "kerry.dawson@hallcollins.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Only a signed-in broker can send closeout emails. */
async function isBroker(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!u.ok) return false;
  const { email } = await u.json();
  if (!email) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(email)}&role=eq.broker&is_active=eq.true&select=id`, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}
const OWNER_NAMES = ["Fran Collins", "Holly Hall"];

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "$0.00";
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  const data = await res.json();
  return data.access_token;
}

// Base64url per RFC 4648 §5 — Gmail's API requires this (not plain base64)
// for the raw message field, and rejects a message with padding/+//.
function base64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendGmail(accessToken: string, { to, cc, subject, html }: { to: string[]; cc: string[]; subject: string; html: string }) {
  const headers = [
    `From: Hall Collins Flow <${GMAIL_SENDER_EMAIL}>`,
    `To: ${to.join(", ")}`,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
  ].filter(Boolean);
  const raw = base64url(`${headers.join("\r\n")}\r\n\r\n${html}`);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
}

function referralLine(referralOwedTo: string | null, referralPct: number | null, referralAmount: number): string {
  if (!referralOwedTo || !referralPct) return "";
  return `<p><strong>Referral:</strong> ${referralPct}% to ${referralOwedTo} = ${money(referralAmount)}</p>`;
}

const SIGNOFF = `<p><em>Love, Jeeves - your happy Hall Collins robot!</em></p>`;

// Fran's format (Nov 2026): one line per number, with the % that got there.
const line = (label: string, value: string) => `<p><strong>${label}:</strong> ${value}</p>`;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;
const sideWord = (side: string | null) => (side === "Sell" ? "Seller" : side === "Buy" ? "Buyer" : side === "Split" ? "Split" : "");

function receivedLines(d: EmailData): string {
  return [
    line("Total Commission Received", money(d.grossCommission)),
    d.referralOwedTo && d.referralPct ? line("Referral", `${d.referralPct}% to ${d.referralOwedTo} = ${money(d.referralAmount)}`) : "",
    // Exactly what the deal's notes say (or Ramsey Solutions' address).
    d.referralPct && d.referralSendTo
      ? line("Send Referral To", d.referralSendTo.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br/>"))
      : "",
    d.referralPct ? line("Commission After Referral", money(d.commissionAfterReferral)) : "",
  ].join("\n");
}

/** Owner deal (Holly or Fran): 20% to the brokerage, the 80% split between them. */
function ownerEmailHtml(d: EmailData): string {
  const first = (d.agentName || "").split(" ")[0];
  const remainder = d.commissionAfterReferral * 0.8;
  const isHolly = d.agentName === "Holly Hall";
  const [mine, theirs] = d.side === "Sell" ? [0.6, 0.4] : d.side === "Buy" ? [0.8, 0.2] : [1, 0];
  const hollyPct = isHolly ? mine : theirs;
  const franPct = isHolly ? theirs : mine;
  return `<p>Congratulations on your closing of ${d.address}</p>
<p>Here is the breakdown of the closing:</p>
${receivedLines(d)}
${line("80% after Brokerage Split", money(remainder))}
${d.tcFeeAmount ? line("TC Fee", money(d.tcFeeAmount)) : ""}
${line("Total to Distribute", money(d.totalToDistribute))}
${line("Transaction Type", `${first} ${sideWord(d.side)}`.trim())}
${hollyPct ? line("Total Due to Holly", `${pct(hollyPct)} = ${money(d.hollyCommission)}`) : ""}
${franPct ? line("Total Due to Fran", `${pct(franPct)} = ${money(d.franCommission)}`) : ""}
${SIGNOFF}`;
}

/** The agent's own email: the full commission, their own share, and the TC
 * fee — never the brokerage's cut or what Holly/Fran make. */
function agentEmailHtml(d: EmailData): string {
  const first = (d.agentName || "").split(" ")[0];
  return `<p>Congratulations on your closing of ${d.address}</p>
<p>Here is the breakdown of the closing:</p>
${receivedLines(d)}
${line("Transaction Type", `${first} ${sideWord(d.side)}${d.leadType ? ` (${d.leadType} lead)` : ""}`.trim())}
${line("Total Due to " + (first || "you"), `${pct(d.agentPct ?? 0.8)} = ${money(d.agentCommission)}`)}
${d.tcFeeAmount ? line("TC Fee (Kerry)", money(d.tcFeeAmount)) : ""}
${SIGNOFF}`;
}

/** Provided lead: the brokerage share and Holly/Fran's quarter each. */
function providedLeadPartnerEmailHtml(d: EmailData): string {
  const first = (d.agentName || "").split(" ")[0];
  const agentPct = d.agentPct ?? 0.6;
  const bucket = d.commissionAfterReferral * (1 - agentPct);
  return `<p><strong>Provided Lead Closeout</strong> — ${d.address}</p>
<p>What Holly and Fran receive for providing this lead:</p>
${receivedLines(d)}
${line("Transaction Type", `${first} ${sideWord(d.side)} (Provided lead)`.trim())}
${line(`Total Due to ${first || "Agent"}`, `${pct(agentPct)} = ${money(d.agentCommission)}`)}
${line("Brokerage Share", `${pct(1 - agentPct)} = ${money(bucket)}`)}
${d.tcFeeAmount ? line("TC Fee", money(d.tcFeeAmount)) : ""}
${line("Total to Distribute", money(d.totalToDistribute))}
${line("Total Due to Holly", `25% of the brokerage share = ${money(d.hollyCommission)}`)}
${line("Total Due to Fran", `25% of the brokerage share = ${money(d.franCommission)}`)}
${SIGNOFF}`;
}

function testBanner(realTo: string[], realCc: string[]): string {
  return `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">
🧪 <strong>TEST MODE</strong> — this did not actually send to the real recipients.<br/>
If sent for real, this would have gone to: <strong>${realTo.join(", ")}</strong>${realCc.length ? ` (cc: ${realCc.join(", ")})` : ""}
</div>`;
}

interface EmailData {
  address: string;
  agentName: string | null;
  agentEmail: string | null;
  leadType: string | null;
  grossCommission: number;
  commissionAfterReferral: number;
  referralOwedTo: string | null;
  referralPct: number | null;
  referralAmount: number;
  referralSendTo: string | null;
  agentCommission: number | null;
  hollyCommission: number;
  franCommission: number;
  bankAmount: number;
  tcFeeAmount: number;
  totalToDistribute: number;
  side: string | null;
  agentPct: number | null;
  coordinatorEmail: string | null;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  try {
    // Takes the Close-Out Calculator's own live, already-computed numbers
    // directly (the same shape buildSheetPayload sends to Sheet/Xero) rather
    // than reading a saved closeouts row — so "Send Test Email" works from
    // Run Close-Out Calculator too, before anything's actually been saved.
    if (!(await isBroker(req))) return jsonResponse({ error: "Broker only" }, 403);
    const reqBody = await req.json();
    const { testMode } = reqBody;
    if (!reqBody.address) return jsonResponse({ error: "address required" }, 400);

    const d: EmailData = {
      address: reqBody.address,
      agentName: reqBody.agentName || null,
      agentEmail: reqBody.agentEmail || null,
      leadType: reqBody.leadType,
      grossCommission: Number(reqBody.grossCommission || 0),
      commissionAfterReferral: Number(reqBody.commissionAfterReferral || 0),
      referralOwedTo: reqBody.referralOwedTo || null,
      referralPct: reqBody.referralPct != null ? Number(reqBody.referralPct) : null,
      referralAmount: Number(reqBody.referralAmount || 0),
      referralSendTo: reqBody.referralSendTo ? String(reqBody.referralSendTo) : null,
      agentCommission: reqBody.agentCommission != null ? Number(reqBody.agentCommission) : null,
      hollyCommission: Number(reqBody.hollyCommission || 0),
      franCommission: Number(reqBody.franCommission || 0),
      bankAmount: Number(reqBody.bankAmount || 0),
      tcFeeAmount: Number(reqBody.tcFeeAmount || 0),
      totalToDistribute: Number(reqBody.totalToDistribute || 0),
      side: reqBody.side || null,
      agentPct: reqBody.agentPct != null ? Number(reqBody.agentPct) : null,
      coordinatorEmail: reqBody.coordinatorEmail || KERRY_EMAIL,
    };
    const isOwnerDeal = d.agentName && OWNER_NAMES.includes(d.agentName);
    const accessToken = await getGmailAccessToken();
    const sentEmails: { to: string[]; cc: string[]; subject: string }[] = [];

    async function deliver(realTo: string[], realCc: string[], subject: string, html: string) {
      const to = testMode ? [FRAN_EMAIL] : realTo;
      const cc = testMode ? [] : realCc;
      const body = testMode ? testBanner(realTo, realCc) + html : html;
      await sendGmail(accessToken, { to, cc, subject, html: body });
      sentEmails.push({ to: realTo, cc: realCc, subject });
    }

    const subject = `Closeout - ${d.address}`;

    const kerry = d.coordinatorEmail ? [d.coordinatorEmail] : [];
    if (isOwnerDeal) {
      await deliver([FRAN_EMAIL, HOLLY_EMAIL], kerry, subject, ownerEmailHtml(d));
    } else {
      if (d.agentEmail) {
        await deliver([d.agentEmail], [PARTNERS_EMAIL, ...kerry], subject, agentEmailHtml(d));
      }
      if (d.leadType === "Provided" && (d.hollyCommission > 0 || d.franCommission > 0)) {
        // Holly + Fran only — never Kerry or the agent.
        await deliver([FRAN_EMAIL, HOLLY_EMAIL], [], `Provided Lead Closeout - ${d.address}`, providedLeadPartnerEmailHtml(d));
      }
    }

    if (!sentEmails.length) {
      return jsonResponse({ error: "Nothing to send — no agent email on file and this wasn't an owner or provided-lead deal" }, 400);
    }

    return jsonResponse({ sent: sentEmails, testMode: Boolean(testMode) });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
