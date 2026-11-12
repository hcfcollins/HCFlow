// Pairs an already-existing Dropbox folder with a deal (for bringing in
// listings that were set up before HC Flow), and keeps deals attached to
// their folder even after it's renamed or moved in Dropbox.
//
// Folders are tracked by Dropbox's permanent folder ID (transactions.
// dropbox_folder_id), not just by path — an ID never changes on rename/move,
// so any function can always look up the folder's *current* path from it.
//
// POST, signed-in user required. Actions:
//   { action: "list", agentId, side? }            → { folders: [{ id, name, path }] }
//       The agent's listing folder (or buyer folder for side "Buy"), one
//       level deep — what the picker shows.
//   { action: "search", agentId, address }        → { folders: [{ id, name, path }] }
//       Searches the agent's WHOLE Dropbox space (listings, buyers, and every
//       CLOSED / Terminated / year subfolder) for folders named with this
//       address — how closed deals get matched to their old folders.
//   { action: "pair", transactionId, folderId }   → { folderPath, folderUrl }
//   { action: "pair", transactionId, link }       → same, from a pasted
//       Dropbox share link or a folder path.
//   { action: "backfill" }  (broker only)         → { updated, missing }
//       Records the folder ID for every deal that only has a path saved, so
//       those survive renames from now on too.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
// Team account: every call needs the team root namespace — see
// create-dropbox-folder for the full story.
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

const svcHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

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
  return (await res.json()).access_token;
}

async function dbx(token: string, endpoint: string, body: unknown) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function getOrCreateSharedLink(token: string, path: string): Promise<string | null> {
  const created = await dbx(token, "sharing/create_shared_link_with_settings", { path });
  if (created.ok) return created.data.url;
  const listed = await dbx(token, "sharing/list_shared_links", { path, direct_only: true });
  return listed.data?.links?.[0]?.url ?? null;
}

/** The signed-in caller's agents row, or null. */
async function getCaller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.email) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&select=id,role,is_active`, { headers: svcHeaders });
  const [agent] = await res.json();
  return agent && agent.is_active !== false ? agent : null;
}

const isStaff = (a: { role: string }) => a.role === "broker" || a.role === "coordinator";

async function patchTx(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...svcHeaders, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`Couldn't save the folder on the deal: ${await res.text()}`);
}

/** Turn whatever was pasted into folder metadata: a dropbox.com share link,
 * a team-folder path ("/HC - Rachel Noyes/…"), or a path copied from the
 * Dropbox desktop app (everything up to "… Dropbox/" is trimmed off). */
async function resolvePasted(token: string, input: string) {
  const text = input.trim();
  if (/^https?:\/\//i.test(text)) {
    const meta = await dbx(token, "sharing/get_shared_link_metadata", { url: text });
    if (!meta.ok) throw new Error("That Dropbox link didn't work — make sure it's a link to the folder itself.");
    if (meta.data[".tag"] !== "folder") throw new Error("That link is to a file, not a folder.");
    if (meta.data.id) {
      const byId = await dbx(token, "files/get_metadata", { path: meta.data.id });
      if (byId.ok) return byId.data;
    }
    if (meta.data.path_lower) {
      const byPath = await dbx(token, "files/get_metadata", { path: meta.data.path_lower });
      if (byPath.ok) return byPath.data;
    }
    throw new Error("Found the link, but the app's Dropbox account can't open that folder.");
  }
  let path = text.replace(/\\/g, "/");
  const m = /Dropbox[^/]*\/(.*)$/i.exec(path);
  if (m && !path.startsWith("/Hall Collins REG Team Folder") && !path.startsWith("/HC - ")) path = `/${m[1]}`;
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "");
  const meta = await dbx(token, "files/get_metadata", { path });
  if (!meta.ok) throw new Error(`Couldn't find a folder at ${path}`);
  return meta.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });

  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: "Sign in first" }, 401);
    const body = await req.json();
    const token = await getDropboxAccessToken();

    if (body.action === "list") {
      const agentId = body.agentId;
      if (!agentId) return jsonResponse({ error: "agentId required" }, 400);
      if (!isStaff(caller) && caller.id !== agentId) return jsonResponse({ error: "Not allowed" }, 403);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}&select=name,dropbox_listing_path,dropbox_buyer_path`, { headers: svcHeaders });
      const [agent] = await res.json();
      const root = body.side === "Buy" ? agent?.dropbox_buyer_path : agent?.dropbox_listing_path;
      if (!root) {
        return jsonResponse({ error: `No Dropbox ${body.side === "Buy" ? "buyer" : "listing"} folder set for ${agent?.name || "this agent"} — add it in Manage Agents, or paste a folder link instead.` }, 400);
      }
      const folders: { id: string; name: string; path: string }[] = [];
      let page = await dbx(token, "files/list_folder", { path: root, recursive: false, limit: 2000 });
      if (!page.ok) return jsonResponse({ error: `Couldn't open ${root} in Dropbox` }, 400);
      for (let guard = 0; guard < 20; guard++) {
        for (const e of page.data.entries || []) {
          if (e[".tag"] === "folder") folders.push({ id: e.id, name: e.name, path: e.path_display });
        }
        if (!page.data.has_more) break;
        page = await dbx(token, "files/list_folder/continue", { cursor: page.data.cursor });
        if (!page.ok) break;
      }
      folders.sort((a, b) => a.name.localeCompare(b.name));
      return jsonResponse({ root, folders });
    }

    if (body.action === "search") {
      const { agentId, address } = body;
      if (!agentId || !address) return jsonResponse({ error: "agentId and address required" }, 400);
      if (!isStaff(caller) && caller.id !== agentId) return jsonResponse({ error: "Not allowed" }, 403);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?id=eq.${agentId}&select=name,dropbox_listing_path,dropbox_buyer_path`, { headers: svcHeaders });
      const [agent] = await res.json();
      // Top-level space(s): "/Hall Collins REG Team Folder", "/HC - Rachel Noyes".
      const spaces = [...new Set([agent?.dropbox_listing_path, agent?.dropbox_buyer_path].filter(Boolean).map((p: string) => `/${p.split("/").filter(Boolean)[0]}`))];
      if (!spaces.length) return jsonResponse({ folders: [] });
      // "3673 Fish Hill Road Randolph, VT" → "3673 Fish" (number + first street word).
      const words = String(address).replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
      const numIdx = words.findIndex((w) => /^\d+[A-Za-z]?$/.test(w));
      const query = (numIdx >= 0 ? words.slice(numIdx, numIdx + 2) : words.slice(0, 2)).join(" ");
      if (!query) return jsonResponse({ folders: [] });
      const seen = new Set<string>();
      const folders: { id: string; name: string; path: string }[] = [];
      for (const path of spaces) {
        const r = await dbx(token, "files/search_v2", {
          query,
          options: { path, max_results: 25, file_categories: ["folder"], filename_only: true },
        });
        if (!r.ok) continue;
        for (const m of r.data.matches || []) {
          const md = m.metadata?.metadata;
          if (!md || md[".tag"] !== "folder" || seen.has(md.id)) continue;
          const segs = String(md.path_display).split("/").filter(Boolean);
          const parents = segs.slice(0, -1);
          // Skip folders INSIDE a deal folder ("4) Photos/3673 Fish Hill…"), CMA
          // folders, and the space itself.
          if (parents.some((p) => /^\d+[a-z]?\)\s/i.test(p) || /cma/i.test(p))) continue;
          seen.add(md.id);
          folders.push({ id: md.id, name: md.name, path: md.path_display });
        }
      }
      // Drop a match nested inside another match (keep the deal folder itself).
      const top = folders.filter((f) => !folders.some((o) => o !== f && f.path.toLowerCase().startsWith(`${o.path.toLowerCase()}/`)));
      // The side's own kind of folder first: buyer deals → "Buyers" paths,
      // listings → "Listings"/"Sellers" paths.
      const buy = body.side === "Buy";
      const sideScore = (f: { path: string }) => (buy ? /buyer/i.test(f.path) : /listing|seller/i.test(f.path) && !/buyer/i.test(f.path)) ? 1 : 0;
      top.sort((a, b) => sideScore(b) - sideScore(a));
      return jsonResponse({ query, folders: top });
    }

    if (body.action === "pair") {
      const { transactionId } = body;
      if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);
      const txRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=id,agent_id`, { headers: svcHeaders });
      const [tx] = await txRes.json();
      if (!tx) return jsonResponse({ error: "Deal not found" }, 404);
      if (!isStaff(caller) && caller.id !== tx.agent_id) return jsonResponse({ error: "Not allowed" }, 403);

      let meta;
      if (body.folderId) {
        const r = await dbx(token, "files/get_metadata", { path: body.folderId });
        if (!r.ok) return jsonResponse({ error: "That folder couldn't be found in Dropbox anymore" }, 400);
        meta = r.data;
      } else if (body.link) {
        meta = await resolvePasted(token, body.link);
      } else {
        return jsonResponse({ error: "folderId or link required" }, 400);
      }
      if (meta[".tag"] !== "folder") return jsonResponse({ error: "That's a file, not a folder" }, 400);

      const folderUrl = await getOrCreateSharedLink(token, meta.path_display);
      const patch: Record<string, unknown> = { dropbox_folder_path: meta.path_display, dropbox_folder_id: meta.id };
      if (folderUrl) patch.dropbox_folder_url = folderUrl;
      try {
        await patchTx(transactionId, patch);
      } catch (e) {
        // dropbox_folder_id column not added yet — still pair by path.
        if (!String(e).includes("dropbox_folder_id")) throw e;
        delete patch.dropbox_folder_id;
        await patchTx(transactionId, patch);
      }
      return jsonResponse({ folderPath: meta.path_display, folderUrl, folderId: meta.id });
    }

    if (body.action === "backfill") {
      if (caller.role !== "broker") return jsonResponse({ error: "Broker only" }, 403);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/transactions?dropbox_folder_path=not.is.null&dropbox_folder_id=is.null&select=id,dropbox_folder_path`,
        { headers: svcHeaders }
      );
      if (!res.ok) return jsonResponse({ error: `Run the dropbox_folder_id migration first: ${await res.text()}` }, 400);
      const rows = await res.json();
      let updated = 0;
      const missing: string[] = [];
      for (const row of rows) {
        const r = await dbx(token, "files/get_metadata", { path: row.dropbox_folder_path });
        if (r.ok && r.data.id) {
          await patchTx(row.id, { dropbox_folder_id: r.data.id });
          updated++;
        } else {
          missing.push(row.id);
        }
      }
      return jsonResponse({ updated, missing });
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
