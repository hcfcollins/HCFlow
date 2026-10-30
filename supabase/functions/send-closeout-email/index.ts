// Sends the commission closeout email for a deal, replicating the branching
// logic from the old Google Sheet's MailApp-based Apps Script trigger (the
// "handleCommissionEmail" function Fran shared) — but reads the authoritative,
// already-saved closeouts row instead of recalculating, and sends via the
// Gmail API (a real Workspace mailbox, not a transactional-email provider) so
// it looks and behaves like a genuine email from Hall Collins.
//
// Branches (same as the legacy script):
// - Owner deal (agent is Holly or Fran): one email to Fran + Holly with the
//   full breakdown.
// - Outside agent: an email to that agent (cc partners@hallcollins.com) with
//   just their own commission, PLUS — if it's a Provided lead and Holly/Fran
//   actually have a cut — a second email to Fran + Holly with the team's side
//   of it. No agent email on file -> that email is just skipped, like legacy.
//
// Expects POST { transactionId: string, testMode?: boolean }. In test mode,
// every email that *would* have gone out is instead sent only to Fran's own
// address, with a banner naming who the real recipients would have been.
//
// Needs Gmail API OAuth (Cloud Console project + OAuth client + a refresh
// token authorized with the gmail.send scope against the sending mailbox) —
// see the app's project memory for the exact one-time setup steps.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
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

const SIGNOFF = `<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;

function ownerEmailHtml(d: ReturnType<typeof buildData>): string {
  return `<p>Congratulations on your closing of ${d.address}!</p>
<p></p>
<p>Here is the breakdown of the closing:</p>
<p><strong>Commission After Referral:</strong> ${money(d.commissionAfterReferral)}</p>
${referralLine(d.referralOwedTo, d.referralPct, d.referralAmount)}
${d.tcFeeAmount ? `<p><strong>Transaction Coordinator Fee:</strong> −${money(d.tcFeeAmount)}</p>` : ""}
<p><strong>Brokerage Keeps:</strong> ${money(d.bankAmount)}</p>
<p><strong>Total to Distribute:</strong> ${money(d.totalToDistribute)}</p>
<p></p>
<p><strong>Holly's Commission:</strong> ${money(d.hollyCommission)}</p>
<p><strong>Fran's Commission:</strong> ${money(d.franCommission)}</p>
${SIGNOFF}`;
}

function agentEmailHtml(d: ReturnType<typeof buildData>): string {
  return `<p>Congratulations on your closing of ${d.address}!</p>
<p></p>
<h3>Here is your commission breakdown:</h3>
<p><strong>Total Commission Received:</strong> ${money(d.grossCommission)}</p>
${referralLine(d.referralOwedTo, d.referralPct, d.referralAmount)}
<p><strong>Your Commission:</strong> ${money(d.agentCommission)}</p>
${SIGNOFF}`;
}

function providedLeadPartnerEmailHtml(d: ReturnType<typeof buildData>): string {
  return `<p>Commission breakdown for provided lead closing at ${d.address}:</p>
<p></p>
<h3>Hall Collins Team Commission:</h3>
<p><strong>Total Commission Received:</strong> ${money(d.grossCommission)}</p>
${referralLine(d.referralOwedTo, d.referralPct, d.referralAmount)}
<p><strong>Agent Commission:</strong> ${money(d.agentCommission)}</p>
<p><strong>Total Due to Holly:</strong> ${money(d.hollyCommission)}</p>
<p><strong>Total Due to Fran:</strong> ${money(d.franCommission)}</p>
${SIGNOFF}`;
}

function testBanner(realTo: string[], realCc: string[]): string {
  return `<div style="background:#FBF2D5;border:1px solid #E0C23A;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-family:sans-serif;font-size:13px;">
🧪 <strong>TEST MODE</strong> — this did not actually send to the real recipients.<br/>
If sent for real, this would have gone to: <strong>${realTo.join(", ")}</strong>${realCc.length ? ` (cc: ${realCc.join(", ")})` : ""}
</div>`;
}

function buildData(tx: any) {
  const c = tx.closeouts;
  const grossCommission = Number(c.price || 0) * (Number(c.commission_pct || 0) / 100);
  const referralAmount = round2(grossCommission - Number(c.commission_after_referral || 0));
  const bankAmount = Number(c.bank_amount || 0);
  const agentCommission = c.agent_commission != null ? Number(c.agent_commission) : null;
  const hollyCommission = Number(c.holly_commission || 0);
  const franCommission = Number(c.fran_commission || 0);
  return {
    address: tx.address,
    agentName: tx.agent?.name || null,
    agentEmail: tx.agent?.email || null,
    leadType: c.lead_type,
    grossCommission,
    commissionAfterReferral: Number(c.commission_after_referral || 0),
    referralOwedTo: tx.commission_data?.referral_owed_to || null,
    referralPct: c.referral_pct != null ? Number(c.referral_pct) : null,
    referralAmount,
    agentCommission,
    hollyCommission,
    franCommission,
    bankAmount,
    tcFeeAmount: c.tc_fee_amount != null ? Number(c.tc_fee_amount) : 0,
    totalToDistribute: round2((agentCommission || 0) + hollyCommission + franCommission + bankAmount),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    const { transactionId, testMode } = await req.json();
    if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);

    const txRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=address,agent:agents!transactions_agent_id_fkey(name,email),commission_data(referral_owed_to),closeouts(*)`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const [tx] = await txRes.json();
    if (!tx) return jsonResponse({ error: "Transaction not found" }, 404);
    if (!tx.closeouts) return jsonResponse({ error: "This deal has no saved close-out yet" }, 400);

    const d = buildData(tx);
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

    if (isOwnerDeal) {
      await deliver([FRAN_EMAIL, HOLLY_EMAIL], [], subject, ownerEmailHtml(d));
    } else {
      if (d.agentEmail) {
        await deliver([d.agentEmail], [PARTNERS_EMAIL], subject, agentEmailHtml(d));
      }
      if (d.leadType === "Provided" && (d.hollyCommission > 0 || d.franCommission > 0)) {
        await deliver([FRAN_EMAIL, HOLLY_EMAIL], [], `Provided Lead Commission - ${d.address}`, providedLeadPartnerEmailHtml(d));
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
