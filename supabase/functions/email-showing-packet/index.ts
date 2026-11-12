// "Email Showing Packet": finds the listing's packet — the file in
// "3) Showing Docs" whose name ends in "- Packet" (e.g. "1) 99 Sunset Lane
// - Packet.pdf"; the newest if there are several) — and returns a VIEW-ONLY
// Dropbox link to it. The app then opens a pre-filled email from the
// agent's own account (phone mail app, or a Gmail tab on a computer) with
// the link in the body; they add the recipient and send.
//
// (It once built a Gmail draft with the PDF attached, in the app's one
// connected Gmail account — that ran out of memory on big packets and put
// every agent's draft in Fran's mailbox. Fran chose the link instead.)
//
// POST { transactionId } (signed-in user) → { fileName, url, address }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const SHOWING_DOCS_SUBFOLDER = "3) Showing Docs";

const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

// ----- Rename-proof folder lookup (same helper in each function that uses a
// deal's Dropbox folder — see pair-dropbox-folder). Looks the folder up by its
// permanent Dropbox ID when one is saved, so a folder renamed or moved in
// Dropbox is still found; saves the new path (and, for deals that only had a
// path, the ID) back onto the deal. Falls back to the saved path if anything
// goes wrong, so it never makes things worse than before.
async function resolveDealFolderPath(accessToken: string, transactionId: string, storedPath: string | null): Promise<string | null> {
  try {
    const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
    const rowRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=dropbox_folder_id`, { headers: svc });
    const folderId = rowRes.ok ? (await rowRes.json())?.[0]?.dropbox_folder_id : undefined;
    const lookup = folderId || storedPath;
    if (!lookup) return storedPath;
    const metaRes = await fetch("https://api.dropboxapi.com/2/files/get_metadata", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
      body: JSON.stringify({ path: lookup }),
    });
    if (!metaRes.ok) return storedPath;
    const meta = await metaRes.json();
    const patch: Record<string, string> = {};
    if (meta.path_display && meta.path_display !== storedPath) patch.dropbox_folder_path = meta.path_display;
    if (rowRes.ok && !folderId && meta.id) patch.dropbox_folder_id = meta.id;
    if (Object.keys(patch).length) {
      await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}`, {
        method: "PATCH",
        headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    }
    return meta.path_display || storedPath;
  } catch {
    return storedPath;
  }
}

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

/** The packet: a file directly in Showing Docs whose name (before the
 * extension) ends in "- Packet". Newest one wins if there are several. */
async function findPacket(accessToken: string, listingFolderPath: string) {
  const path = `${listingFolderPath}/${SHOWING_DOCS_SUBFOLDER}`;
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
    body: JSON.stringify({ path, recursive: false }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Couldn't open the "${SHOWING_DOCS_SUBFOLDER}" folder in Dropbox`);
  const packets = (data.entries || []).filter(
    (e: { [".tag"]: string; name: string }) => e[".tag"] === "file" && /-\s*packet$/i.test(e.name.replace(/\.[^.]+$/, "").trim())
  );
  if (!packets.length) throw new Error(`No file ending in "- Packet" in "${SHOWING_DOCS_SUBFOLDER}" — name the packet like "123 Main St - Packet.pdf".`);
  packets.sort((a: { server_modified: string }, b: { server_modified: string }) => b.server_modified.localeCompare(a.server_modified));
  return packets[0] as { name: string; path_lower: string; size: number };
}

/** A view-only share link to the file. Uses an existing link if there is one
 * (create_shared_link_with_settings errors with shared_link_already_exists). */
async function getOrCreateFileLink(accessToken: string, path: string): Promise<string> {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader };
  const created = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers,
    body: JSON.stringify({ path, settings: { requested_visibility: "public", access: "viewer" } }),
  });
  const createdData = await created.json();
  if (created.ok) return createdData.url;
  const existing = createdData.error?.shared_link_already_exists?.metadata?.url;
  if (existing) return existing;
  const listed = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
    method: "POST",
    headers,
    body: JSON.stringify({ path, direct_only: true }),
  });
  const listedData = await listed.json();
  if (listedData.links?.length) return listedData.links[0].url;
  throw new Error(`Couldn't create a Dropbox link for the packet: ${JSON.stringify(createdData)}`);
}

async function getCaller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.email) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&select=id,name,email,role,is_active`, { headers: svc });
  const [agent] = await res.json();
  return agent && agent.is_active !== false ? agent : null;
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
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: "Sign in first" }, 401);
    const { transactionId } = await req.json();
    if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);

    const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=address,agent_id,dropbox_folder_path`, { headers: svc });
    const [tx] = await txRes.json();
    if (!tx) return jsonResponse({ error: "Transaction not found" }, 404);
    const staff = caller.role === "broker" || caller.role === "coordinator";
    if (!staff && caller.id !== tx.agent_id) return jsonResponse({ error: "Not allowed" }, 403);
    if (!tx.dropbox_folder_path) return jsonResponse({ error: "No Dropbox folder on record for this listing yet" }, 400);

    const dropboxToken = await getDropboxAccessToken();
    const dealFolder = (await resolveDealFolderPath(dropboxToken, transactionId, tx.dropbox_folder_path)) || tx.dropbox_folder_path;
    const file = await findPacket(dropboxToken, dealFolder);
    const url = await getOrCreateFileLink(dropboxToken, file.path_lower);

    return jsonResponse({ fileName: file.name, url, address: tx.address });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
