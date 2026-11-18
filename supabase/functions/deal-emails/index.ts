// Deal emails sent from the app's Gmail account (same one as the closeout
// emails):
//
// - action "under_contract": the congratulations email when a deal first goes
//   Under Contract, confirming every detail from the form. To the deal's agent
//   (+ co-list agent), cc Kerry + partners@ so everyone knows what's going on.
//   Never to clients.
//
// - action "closing_docs_preview" / "closing_docs_send": after closing, the
//   client gets a copy of the closing docs (attached, from the deal's Dropbox
//   folder) and a request for a Google review. To the client emails on the
//   deal, cc the agent, replies go to the agent. Too big to attach (Gmail's
//   25 MB limit) → view-only Dropbox links instead.
//
// POST { action, transactionId } (signed-in user on the deal, or staff)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
const GMAIL_SENDER_EMAIL = Deno.env.get("GMAIL_SENDER_EMAIL") || "fran.collins@hallcollins.com";
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const PARTNERS_EMAIL = "partners@hallcollins.com";
const REVIEW_LINK = "https://g.page/r/CQqNLCVhrYdhEBM/review";
// Raw bytes; base64 grows them ~37%, and Gmail caps a message at 25 MB.
const MAX_ATTACH_BYTES = 17 * 1024 * 1024;

const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Agent = { id: string; name: string; email: string | null; role: string };

async function getCaller(req: Request): Promise<Agent | null> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.email) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&is_active=eq.true&select=id,name,email,role`, { headers: svc });
  const [agent] = await res.json();
  return agent || null;
}

async function getGmailAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: GMAIL_REFRESH_TOKEN, client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

async function getDropboxAccessToken(): Promise<string> {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: DROPBOX_REFRESH_TOKEN, client_id: DROPBOX_APP_KEY, client_secret: DROPBOX_APP_SECRET }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Standard base64 of bytes, in chunks (a multiple of 3) so big files don't blow the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 3 * 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK))));
  }
  return parts.join("");
}
const utf8B64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8B64(s)}?=`);
const wrap76 = (s: string) => s.replace(/.{1,76}/g, "$&\r\n");

type Attachment = { name: string; bytes: Uint8Array };

/** Sends through Gmail's media upload endpoint (raw MIME, no outer base64),
 * which keeps memory down for messages with attachments. */
async function sendGmail(
  accessToken: string,
  { to, cc, replyTo, fromName, subject, html, attachments = [] }: { to: string[]; cc: string[]; replyTo?: string | null; fromName: string; subject: string; html: string; attachments?: Attachment[] }
) {
  const boundary = `hcflow_${crypto.randomUUID()}`;
  const head = [
    `From: ${encodeHeader(fromName)} <${GMAIL_SENDER_EMAIL}>`,
    `To: ${to.join(", ")}`,
    cc.length ? `Cc: ${cc.join(", ")}` : null,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);
  const parts = [
    `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(utf8B64(html))}`,
    ...attachments.map((a) => {
      const safe = a.name.replace(/"/g, "'");
      const type = /\.pdf$/i.test(a.name) ? "application/pdf" : "application/octet-stream";
      return `--${boundary}\r\nContent-Type: ${type}; name="${encodeHeader(safe)}"\r\nContent-Disposition: attachment; filename="${encodeHeader(safe)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(bytesToBase64(a.bytes))}`;
    }),
  ];
  const mime = `${head.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--`;
  const res = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "message/rfc822" },
    body: mime,
  });
  if (!res.ok) throw new Error(`Gmail send failed: ${await res.text()}`);
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: unknown) =>
  n == null || n === "" || Number.isNaN(Number(n)) ? null : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function longDate(d: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || "");
  if (!m) return d || null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function time12(t: string | null | undefined) {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || "");
  if (!m) return t || null;
  const h = +m[1];
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
const clientSide = (tx: Record<string, string>) => (tx.side === "Split" ? tx.split_client_side || null : tx.side);
function firstNames(full: string | null | undefined) {
  const f = String(full || "")
    .split(/\s*(?:&|\band\b|,|\/)\s*/i)
    .map((n) => n.trim().split(/\s+/)[0])
    .filter(Boolean);
  if (f.length <= 1) return f[0] || "";
  return f.length === 2 ? `${f[0]} and ${f[1]}` : `${f.slice(0, -1).join(", ")}, and ${f[f.length - 1]}`;
}

async function loadDeal(transactionId: string) {
  const sel =
    "*,agent:agents!transactions_agent_id_fkey(id,name,email),colist:agents!transactions_colist_agent_id_fkey(id,name,email)," +
    "buyer_attorney:attorneys!transactions_buyer_attorney_id_fkey(*),seller_attorney:attorneys!transactions_seller_attorney_id_fkey(*)," +
    "commission_data(*),closeouts(*)";
  let res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${encodeURIComponent(transactionId)}&select=${encodeURIComponent(sel)}`, { headers: svc });
  if (!res.ok) {
    // No co-list column/foreign key on an older database — load without it.
    const plain = sel.replace(/colist:[^,]+\),/, "");
    res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${encodeURIComponent(transactionId)}&select=${encodeURIComponent(plain)}`, { headers: svc });
  }
  if (!res.ok) throw new Error(`Couldn't load the deal: ${await res.text()}`);
  const [tx] = await res.json();
  return tx || null;
}

// ---------- Under Contract congratulations ----------

function underContractHtml(tx: Record<string, any>) {
  const cd = tx.commission_data || {};
  const co = tx.closeouts || {};
  const side = clientSide(tx);
  const sideLabel = tx.side === "Split" ? `Split (we represent the ${side === "Buy" ? "buyer" : "seller"})` : tx.side === "Buy" ? "Buyer side" : "Listing side";
  const price = Number(tx.price ?? co.price) || 0;
  const credit = Number(cd.seller_credit) || 0;
  const pct = Number(cd.commission_pct ?? co.commission_pct) || 0;
  const net = price && pct ? ((price - credit) * pct) / 100 : null;
  const rows: [string, string | null][] = [
    ["Property", tx.address],
    ["Side", sideLabel],
    ["Seller(s)", tx.seller_name],
    ["Buyer(s)", tx.buyer_name],
    ["Purchase price", money(tx.price ?? co.price)],
    ["Seller credit", credit ? money(credit) : null],
    ["Commission", pct ? `${pct}%` : null],
    ["Net commission", net != null ? `${money(net)}${credit ? " (price less seller credit × commission %)" : ""}` : null],
    ["Closing date", longDate(tx.next_date)],
    ["Closing time", time12(tx.closing_time)],
    ["Closing location", tx.closing_location],
    ["Deposit", cd.hold_deposit === "Yes" ? `${money(cd.deposit_amount) || "Amount TBD"} held by Hall Collins${cd.deposit_due_date ? `, due ${longDate(cd.deposit_due_date)}` : ""}` : "Not held by Hall Collins"],
    ["Second deposit", cd.second_deposit === "Yes" ? `${money(cd.second_deposit_amount) || "Amount TBD"}${cd.second_deposit_due_date ? `, due ${longDate(cd.second_deposit_due_date)}` : ""}` : null],
    ["Inspection deadline", cd.inspection_waived ? "Waived / no inspection" : longDate(cd.inspection_date)],
    ["Financing deadline", longDate(cd.financing_date)],
    ["Appraiser", cd.appraiser],
    ["Buyer's attorney", tx.buyer_attorney?.name],
    ["Seller's attorney", tx.seller_attorney?.name],
    ["Lead type", cd.lead_type],
    ["Client source", cd.client_source],
    ["Referral", cd.referral_owed_to || cd.referral_pct ? `${cd.referral_pct != null ? `${cd.referral_pct}%` : ""}${cd.referral_owed_to ? ` to ${cd.referral_owed_to}` : ""}`.trim() : null],
    ["Property style", tx.property_style],
    ["Town water/sewer", tx.town_water_sewer ? "Yes" : null],
  ];
  const table = rows
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 14px 4px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:4px 0;"><strong>${esc(v)}</strong></td></tr>`
    )
    .join("");
  const agentFirst = String(tx.agent?.name || "").split(/\s+/)[0];
  return `<p>Congratulations${agentFirst ? `, ${esc(agentFirst)}` : ""}! 🎉 <strong>${esc(tx.address)}</strong> is officially under contract.</p>
<p>Here are the details we have on file — please reply if anything needs correcting:</p>
<table style="border-collapse:collapse;font-size:14px;">${table}</table>
<p>Kerry will review the initial set of files for compliance and signatures.</p>
<p><em>Love, Jeeves — your happy Hall Collins robot!</em></p>`;
}

// ---------- Closing docs to the client ----------

const CLOSING_RE = /closing doc|\bhud\b|settlement statement|closing disclosure|\balta\b|signed closing/i;

async function findClosingDocs(dbx: string, folderPath: string) {
  const headers = { Authorization: `Bearer ${dbx}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader };
  let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", { method: "POST", headers, body: JSON.stringify({ path: folderPath, recursive: true, limit: 2000 }) });
  if (!res.ok) throw new Error(`Couldn't open the deal's Dropbox folder: ${await res.text()}`);
  let data = await res.json();
  const entries = [...data.entries];
  while (data.has_more) {
    res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", { method: "POST", headers, body: JSON.stringify({ cursor: data.cursor }) });
    if (!res.ok) break;
    data = await res.json();
    entries.push(...data.entries);
  }
  return entries
    .filter((e: any) => e[".tag"] === "file" && CLOSING_RE.test(e.name) && !/commission/i.test(e.name) && !/\/photos?\//i.test(e.path_lower))
    .sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true })) as { name: string; path_lower: string; size: number }[];
}

async function downloadFile(dbx: string, path: string): Promise<Uint8Array> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { Authorization: `Bearer ${dbx}`, "Dropbox-API-Arg": JSON.stringify({ path }).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`), "Dropbox-API-Path-Root": dropboxPathRootHeader },
  });
  if (!res.ok) throw new Error(`Couldn't download ${path.split("/").pop()} from Dropbox`);
  return new Uint8Array(await res.arrayBuffer());
}

async function shareLink(dbx: string, path: string): Promise<string> {
  const headers = { Authorization: `Bearer ${dbx}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader };
  const created = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers,
    body: JSON.stringify({ path, settings: { requested_visibility: "public", access: "viewer" } }),
  });
  const d = await created.json();
  if (created.ok) return d.url;
  if (d.error?.shared_link_already_exists?.metadata?.url) return d.error.shared_link_already_exists.metadata.url;
  const listed = await (await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", { method: "POST", headers, body: JSON.stringify({ path, direct_only: true }) })).json();
  if (listed.links?.length) return listed.links[0].url;
  throw new Error("Couldn't create a Dropbox link for the closing docs");
}

function closingDocsEmail(tx: Record<string, any>, files: { name: string }[], links: string[] | null) {
  const names = firstNames(clientSide(tx) === "Buy" ? tx.buyer_name : tx.seller_name);
  const agentName = tx.agent?.name || "";
  const docs = links
    ? `<p>Here are your closing documents for your records (too large to attach, so they're view-only links):</p><ul>${files.map((f, i) => `<li><a href="${esc(links[i])}">${esc(f.name)}</a></li>`).join("")}</ul>`
    : `<p>Attached ${files.length === 1 ? "is a copy of your closing documents" : "are copies of your closing documents"} for your records — we recommend saving them somewhere safe.</p>`;
  const html = `<p>Hi${names ? ` ${esc(names)}` : ""},</p>
<p>Congratulations again on closing on <strong>${esc(tx.address)}</strong>!</p>
${docs}
<p>It was such a pleasure working with you. If you have a minute, a Google review would mean the world to us: <a href="${REVIEW_LINK}">${REVIEW_LINK}</a></p>
<p>Fondly,<br/>${agentName ? `${esc(agentName)}<br/>` : ""}Hall Collins Real Estate Group</p>`;
  return { subject: `Your Closing Documents - ${tx.address}`, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return json({ error: "Not signed in" }, 401);
    const { action, transactionId } = await req.json();
    if (!transactionId) return json({ error: "transactionId required" }, 400);
    const tx = await loadDeal(transactionId);
    if (!tx) return json({ error: "Deal not found" }, 404);
    const isStaff = caller.role === "broker" || caller.role === "coordinator";
    if (!isStaff && tx.agent_id !== caller.id && tx.colist_agent_id !== caller.id) return json({ error: "Not your deal" }, 403);

    const agentEmails = [tx.agent?.email, tx.colist?.email].filter(Boolean) as string[];

    if (action === "under_contract") {
      const coordRes = await fetch(`${SUPABASE_URL}/rest/v1/agents?role=eq.coordinator&is_active=eq.true&select=email`, { headers: svc });
      const coordinators = ((await coordRes.json()) || []).map((a: { email: string | null }) => a.email).filter(Boolean) as string[];
      const to = agentEmails.length ? agentEmails : [PARTNERS_EMAIL];
      const cc = [...new Set([...coordinators, PARTNERS_EMAIL])].filter((e) => !to.includes(e));
      const gmail = await getGmailAccessToken();
      await sendGmail(gmail, { to, cc, fromName: "Hall Collins Flow", subject: `Under Contract: ${tx.address} 🎉`, html: underContractHtml(tx) });
      return json({ sent: true, to, cc });
    }

    if (action === "closing_docs_preview" || action === "closing_docs_send") {
      const clientEmails = (tx.seller_emails || []).filter(Boolean) as string[];
      if (!clientEmails.length) return json({ error: "No client email on file — add one on the deal first." }, 400);
      if (!tx.dropbox_folder_path && !tx.dropbox_folder_id) return json({ error: "This deal doesn't have a Dropbox folder." }, 400);
      const dbx = await getDropboxAccessToken();
      // The folder's permanent id survives renames/moves; fall back to the path.
      let files;
      try {
        files = await findClosingDocs(dbx, tx.dropbox_folder_id || tx.dropbox_folder_path);
      } catch (e) {
        if (!tx.dropbox_folder_id || !tx.dropbox_folder_path) throw e;
        files = await findClosingDocs(dbx, tx.dropbox_folder_path);
      }
      if (!files.length) return json({ error: "No closing docs found in the deal's Dropbox folder (looking for names with Closing Docs, HUD, Settlement Statement, Closing Disclosure or ALTA)." }, 400);
      const total = files.reduce((n, f) => n + (f.size || 0), 0);
      const attach = total <= MAX_ATTACH_BYTES;
      const cc = agentEmails.filter((e) => !clientEmails.includes(e));
      if (action === "closing_docs_preview") {
        return json({ to: clientEmails, cc, files: files.map((f) => f.name), attach, totalMb: Math.round((total / 1048576) * 10) / 10 });
      }
      let attachments: Attachment[] = [];
      let links: string[] | null = null;
      if (attach) {
        attachments = [];
        for (const f of files) attachments.push({ name: f.name, bytes: await downloadFile(dbx, f.path_lower) });
      } else {
        links = [];
        for (const f of files) links.push(await shareLink(dbx, f.path_lower));
      }
      const { subject, html } = closingDocsEmail(tx, files, links);
      const gmail = await getGmailAccessToken();
      await sendGmail(gmail, { to: clientEmails, cc, replyTo: tx.agent?.email || null, fromName: "Hall Collins Real Estate Group", subject, html, attachments });
      return json({ sent: true, to: clientEmails, cc, files: files.map((f) => f.name), attached: attach });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
