// Grabs the most recently modified file in a listing's "3) Showing Docs"
// Dropbox subfolder and drops it into a new Gmail DRAFT (not sent — Fran
// still needs to pick a recipient and review it), with the subject and body
// already filled in. Saves re-finding and re-attaching the same file by hand
// every time someone asks for the showing packet.
//
// Expects POST { transactionId: string }.
//
// Reuses the Dropbox and Gmail OAuth secrets already configured for
// create-dropbox-folder and send-closeout-email — duplicated here rather
// than imported, since Edge Functions don't share a deployment boundary.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID")!;
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET")!;
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN")!;
const GMAIL_SENDER_EMAIL = Deno.env.get("GMAIL_SENDER_EMAIL") || "fran.collins@hallcollins.com";

const SHOWING_DOCS_SUBFOLDER = "3) Showing Docs";

async function getDropboxAccessToken(): Promise<string> {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_APP_KEY,
      client_secret: DROPBOX_APP_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
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

/** Most recently modified file directly inside the listing's Showing Docs
 * subfolder — not recursive, and skips subfolders if someone's organized
 * files into them. Picking "most recent" is a judgment call: if several
 * showing-related files exist, this assumes the newest one is the current
 * packet. */
async function findLatestShowingDoc(accessToken: string, listingFolderPath: string) {
  const path = `${listingFolderPath}/${SHOWING_DOCS_SUBFOLDER}`;
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
    },
    body: JSON.stringify({ path, recursive: false }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Couldn't list Showing Docs: ${JSON.stringify(data)}`);

  const files = (data.entries || []).filter((e: { [".tag"]: string }) => e[".tag"] === "file");
  if (!files.length) throw new Error(`No file found in "${SHOWING_DOCS_SUBFOLDER}" — add the packet there first.`);

  files.sort((a: { server_modified: string }, b: { server_modified: string }) =>
    b.server_modified.localeCompare(a.server_modified)
  );
  return files[0] as { name: string; path_lower: string };
}

async function downloadDropboxFile(accessToken: string, path: string): Promise<ArrayBuffer> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  if (!res.ok) throw new Error(`Couldn't download the file from Dropbox: ${await res.text()}`);
  return res.arrayBuffer();
}

function mimeTypeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  return map[ext || ""] || "application/octet-stream";
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunkSize = 0x8000; // avoid call-stack blowup from String.fromCharCode(...hugeArray)
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function buildMimeMessage({
  subject,
  bodyText,
  attachmentName,
  attachmentMimeType,
  attachmentBase64,
}: {
  subject: string;
  bodyText: string;
  attachmentName: string;
  attachmentMimeType: string;
  attachmentBase64: string;
}): string {
  const boundary = `hcflow_${crypto.randomUUID().replace(/-/g, "")}`;
  return [
    `From: Hall Collins Flow <${GMAIL_SENDER_EMAIL}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "",
    bodyText,
    "",
    `--${boundary}`,
    `Content-Type: ${attachmentMimeType}; name="${attachmentName}"`,
    `Content-Disposition: attachment; filename="${attachmentName}"`,
    "Content-Transfer-Encoding: base64",
    "",
    attachmentBase64,
    "",
    `--${boundary}--`,
  ].join("\r\n");
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
    const { transactionId } = await req.json();
    if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);

    const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=address,dropbox_folder_path`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    const [tx] = await txRes.json();
    if (!tx) return jsonResponse({ error: "Transaction not found" }, 404);
    if (!tx.dropbox_folder_path) return jsonResponse({ error: "No Dropbox folder on record for this listing yet" }, 400);

    const dropboxToken = await getDropboxAccessToken();
    const file = await findLatestShowingDoc(dropboxToken, tx.dropbox_folder_path);
    const fileBytes = await downloadDropboxFile(dropboxToken, file.path_lower);

    const mime = buildMimeMessage({
      subject: `Listing Packet - ${tx.address}`,
      bodyText: `Here is the listing packet for ${tx.address}. Let us know if you have any questions!`,
      attachmentName: file.name,
      attachmentMimeType: mimeTypeFor(file.name),
      attachmentBase64: arrayBufferToBase64(fileBytes),
    });

    const gmailToken = await getGmailAccessToken();
    const draftRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: { Authorization: `Bearer ${gmailToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw: base64url(mime) } }),
    });
    const draftData = await draftRes.json();
    if (!draftRes.ok) throw new Error(`Gmail draft creation failed: ${JSON.stringify(draftData)}`);

    return jsonResponse({
      fileName: file.name,
      draftUrl: `https://mail.google.com/mail/u/0/#drafts/${draftData.message?.id}`,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
