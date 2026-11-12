// Finds the most recently modified file in a listing's "3) Showing Docs"
// Dropbox subfolder and returns a Dropbox share link to it. The app then
// opens a pre-filled email FROM THE AGENT'S OWN ACCOUNT (their phone's mail
// app, or a Gmail tab on a computer) with that link in the body.
//
// It used to download the file and build a Gmail draft with it attached, in
// the one Gmail account the app is connected to — that (a) put every agent's
// draft in Fran's mailbox, and (b) ran out of memory on big packet PDFs
// (WORKER_RESOURCE_LIMIT). A link has neither problem, and has no size limit.
//
// Expects POST { transactionId: string } → { fileName, url, address }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const SHOWING_DOCS_SUBFOLDER = "3) Showing Docs";

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
    const dealFolder = (await resolveDealFolderPath(dropboxToken, transactionId, tx.dropbox_folder_path)) || tx.dropbox_folder_path;
    const file = await findLatestShowingDoc(dropboxToken, dealFolder);
    const url = await getOrCreateFileLink(dropboxToken, file.path_lower);

    return jsonResponse({ fileName: file.name, url, address: tx.address });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
