// Backs the Social Scheduler's Boost Post / New Listing Graphic buttons: lists
// photos in a listing's Dropbox "4) Photos" subfolder and streams individual
// file bytes back to the browser (used both for picker thumbnails/previews and
// as the actual image source for client-side canvas compositing). Also drafts
// a Boost Post caption by pulling the MLS description out of the listing's
// "packet" PDF in "3) Showing Docs".
//
// Expects POST { action: "listPhotos" | "fetchFile" | "extractDescription", transactionId, path? }.

import pdfParse from "npm:pdf-parse@1.1.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

// A fallen-through buyer's archived paperwork ("5) Under Contract - TERMINATED - …",
// made by relist-listing). Nothing new ever goes in there.
const isArchivedFolder = (name: string) => /terminat/i.test(name);

const PHOTOS_SUBFOLDER = "4) Photos";
const SHOWING_DOCS_SUBFOLDER = "3) Showing Docs";
// Checked in this order for social media source photos: agents drop their hand-picked
// images in Chosen Ones; if that's missing/empty, fall back to the compressed MLS set;
// if neither exists (older listings that predate this convention), fall back to
// whatever's directly in 4) Photos.
const CHOSEN_ONES_SUBFOLDER = "Chosen Ones";
const COMPRESSED_MLS_SUBFOLDER = "Compressed_MLS";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];

// Common MLS export field labels — whichever appears first in the packet's text
// is treated as the start of the listing description. Checked in order so a more
// specific label (e.g. "Public Remarks") wins over a generic one if both exist.
const DESCRIPTION_HEADINGS = ["Public Remarks", "Marketing Remarks", "MLS Description", "Agent Remarks", "Remarks", "Description"];
const DESCRIPTION_MAX_LENGTH = 350;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

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

async function getTransactionFolderPath(transactionId: string): Promise<string> {
  const txRes = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=id,dropbox_folder_path`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
  );
  const [tx] = await txRes.json();
  if (!tx) throw new Error("Transaction not found");
  if (!tx.dropbox_folder_path) throw new Error("This listing doesn't have a Dropbox folder yet");
  const current = await resolveDealFolderPath(await getDropboxAccessToken(), transactionId, tx.dropbox_folder_path);
  return (current || tx.dropbox_folder_path) as string;
}


// Older listing folders are numbered differently ("2) Showing Documents",
// "3) Photos" vs. today's "3) Showing Docs", "4) Photos"), so subfolders are
// found by name, whatever their number. Falls back to today's name.
const subfolderCache = new Map<string, string[]>();
async function subfolderNames(accessToken: string, folderPath: string): Promise<string[]> {
  if (subfolderCache.has(folderPath)) return subfolderCache.get(folderPath)!;
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
    body: JSON.stringify({ path: folderPath }),
  });
  const data = res.ok ? await res.json() : { entries: [] };
  const names = (data.entries || []).filter((e: { [k: string]: string }) => e[".tag"] === "folder").map((e: { name: string }) => e.name);
  subfolderCache.set(folderPath, names);
  return names;
}
async function photosPath(accessToken: string, folderPath: string) {
  const names = await subfolderNames(accessToken, folderPath);
  const hit = names.find((n) => /^\s*\d*\)?\s*photos?\s*$/i.test(n)) || names.find((n) => /photo/i.test(n) && !/tour/i.test(n));
  return `${folderPath}/${hit || PHOTOS_SUBFOLDER}`;
}
async function showingDocsPath(accessToken: string, folderPath: string) {
  const names = await subfolderNames(accessToken, folderPath);
  const hit = names.find((n) => /showing/i.test(n));
  return `${folderPath}/${hit || SHOWING_DOCS_SUBFOLDER}`;
}

const svcHeaders = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

/** Signed-in caller who can see this deal: staff, or its agent / co-list agent. */
async function callerCanAccess(req: Request, transactionId: string): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  if (!user?.email) return false;
  const aRes = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&select=id,role,is_active`, { headers: svcHeaders });
  const [agent] = await aRes.json();
  if (!agent || agent.is_active === false) return false;
  if (agent.role === "broker" || agent.role === "coordinator") return true;
  const tRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=*`, { headers: svcHeaders });
  const [tx] = await tRes.json();
  return Boolean(tx) && (tx.agent_id === agent.id || tx.colist_agent_id === agent.id);
}

/** "3) Showing Docs" files for the listing packet, in file-name order
 * ("1) MLS Sheet", "2) Disclosure", … — numbers compared as numbers). */
async function listShowingDocs(accessToken: string, folderPath: string) {
  const entries = await listFolderIfExists(accessToken, await showingDocsPath(accessToken, folderPath));
  return entries
    .map((e: { name: string; path_display: string; size?: number }) => ({ name: e.name, path: e.path_display, size: e.size ?? 0 }))
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

async function listFolder(accessToken: string, folderPath: string) {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
    },
    body: JSON.stringify({ path: folderPath }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Dropbox list_folder failed: ${JSON.stringify(data)}`);
  return (data.entries ?? []).filter((e: { [key: string]: unknown }) => e[".tag"] === "file") as {
    name: string;
    path_display: string;
    server_modified: string;
  }[];
}

/** list_folder on a path that might not exist yet — returns [] instead of throwing
 * for a "not_found" path, since that's an expected/normal state here (an older
 * listing, or one where the agent hasn't dropped photos into that subfolder yet),
 * not a real error. */
async function listFolderIfExists(accessToken: string, folderPath: string) {
  try {
    return await listFolder(accessToken, folderPath);
  } catch (e) {
    if (String(e).includes("not_found")) return [];
    throw e;
  }
}

function toPhotoList(entries: { name: string; path_display: string }[]) {
  return entries
    .filter((e) => IMAGE_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)))
    .map((e) => ({ name: e.name, path: e.path_display }));
}

async function listPhotos(accessToken: string, folderPath: string) {
  // Searches the whole Photos folder, however deep — the photographer's
  // shared folder is often dropped in whole ("4) Photos/278 Coreys Drive -
  // Moretown, VT/Compressed_MLS/…"). Preference: Chosen Ones, then
  // Compressed_MLS, then any other photos; floor plans never.
  const photos = await photosPath(accessToken, folderPath);
  const all: { name: string; path_display: string }[] = [];
  let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
    body: JSON.stringify({ path: photos, recursive: true, limit: 2000 }),
  });
  for (let guard = 0; guard < 10; guard++) {
    if (!res.ok) break; // no Photos folder
    const data = await res.json();
    for (const e of data.entries || []) if (e[".tag"] === "file") all.push(e);
    if (!data.has_more) break;
    res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
      body: JSON.stringify({ cursor: data.cursor }),
    });
  }
  const images = toPhotoList(all).filter((p) => !/floor ?plans?/i.test(p.path));
  const inFolder = (re: RegExp) => images.filter((p) => re.test(p.path.slice(photos.length)));
  const chosen = inFolder(new RegExp(`/${CHOSEN_ONES_SUBFOLDER}/`, "i"));
  if (chosen.length) return { photos: chosen, source: CHOSEN_ONES_SUBFOLDER };
  const mls = inFolder(new RegExp(`/${COMPRESSED_MLS_SUBFOLDER}/`, "i"));
  if (mls.length) return { photos: mls, source: COMPRESSED_MLS_SUBFOLDER };
  return { photos: images, source: photos.split("/").pop() };
}

/** Finds the packet file (name contains "packet", case-insensitive) in Showing Docs —
 * if more than one matches, the most recently modified wins. */
async function findPacketFile(accessToken: string, folderPath: string) {
  const entries = await listFolder(accessToken, await showingDocsPath(accessToken, folderPath));
  const matches = entries
    .filter((e) => e.name.toLowerCase().includes("packet") && e.name.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => new Date(b.server_modified).getTime() - new Date(a.server_modified).getTime());
  return matches[0] ?? null;
}

/** Best-effort: finds the first recognized MLS remarks/description heading — most
 * importantly "Public Remarks" from the MLS Sheet page, checked first — anywhere
 * in the packet's text (not just the first page or two; the MLS Sheet can land
 * well into a multi-document packet) and returns the paragraph after it, trimmed
 * to caption length. Falls back to the top of the document if no heading is
 * recognized — never throws, since a bad extraction shouldn't block the rest of
 * the Boost Post panel from working. */
function extractDescriptionFromText(text: string): { description: string; source: "heading" | "fallback" } {
  for (const heading of DESCRIPTION_HEADINGS) {
    const headingRegex = new RegExp(`${heading}\\s*:?\\s*`, "i");
    const match = headingRegex.exec(text);
    if (!match) continue;
    const afterHeading = text.slice(match.index + match[0].length, match.index + match[0].length + 4000);
    // Stop at the next all-caps label-like line (another MLS field) or a blank line.
    const stopMatch = /\n\s*\n|\n[A-Z][A-Z \/]{3,}:?\s*\n/.exec(afterHeading);
    const paragraph = (stopMatch ? afterHeading.slice(0, stopMatch.index) : afterHeading).replace(/\s+/g, " ").trim();
    if (paragraph.length > 20) {
      return { description: truncateToCaption(paragraph), source: "heading" };
    }
  }
  return { description: truncateToCaption(text.slice(0, 8000).replace(/\s+/g, " ").trim()), source: "fallback" };
}

function truncateToCaption(text: string): string {
  if (text.length <= DESCRIPTION_MAX_LENGTH) return text;
  const cut = text.slice(0, DESCRIPTION_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : DESCRIPTION_MAX_LENGTH)}…`;
}

async function downloadFile(accessToken: string, path: string): Promise<ArrayBuffer> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
      "Dropbox-API-Arg": JSON.stringify({ path }),
    },
  });
  if (!res.ok) throw new Error(`Dropbox download failed: ${await res.text()}`);
  return res.arrayBuffer();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const { action, transactionId, path, fileName, renames } = await req.json();
    subfolderCache.clear(); // folders can change between requests
    if (!action || !transactionId) {
      return jsonResponse({ error: "action and transactionId required" }, 400);
    }

    if (!(await callerCanAccess(req, transactionId))) return jsonResponse({ error: "Not allowed" }, 403);

    const accessToken = await getDropboxAccessToken();
    const folderPath = await getTransactionFolderPath(transactionId);

    if (action === "listPhotos") {
      const { photos, source } = await listPhotos(accessToken, folderPath);
      return jsonResponse({ photos, source });
    }

    if (action === "fetchFile") {
      if (!path) return jsonResponse({ error: "path required" }, 400);
      // Only files inside this deal's own folder.
      if (!String(path).toLowerCase().startsWith(`${folderPath.toLowerCase()}/`)) return jsonResponse({ error: "That file isn't in this deal's folder" }, 403);
      const bytes = await downloadFile(accessToken, path);
      // The Supabase JS client's functions.invoke() only auto-parses a response as a
      // Blob for "application/octet-stream" or "application/pdf" — any other content
      // type (e.g. the real "image/jpeg") falls through to .text(), which corrupts
      // the binary payload into mangled text. So we send octet-stream here and let
      // the caller (fetchListingFile in src/lib/transactions.js) re-tag the Blob with
      // the real image mime type it needs for <img>/canvas use.
      return new Response(bytes, {
        headers: { ...CORS_HEADERS, "Content-Type": "application/octet-stream" },
      });
    }

    if (action === "listShowingDocs") {
      return jsonResponse({ files: await listShowingDocs(accessToken, folderPath), folder: await showingDocsPath(accessToken, folderPath) });
    }

    // A one-time Dropbox upload link for the finished listing packet, so the
    // browser sends the (possibly large) PDF straight to Dropbox instead of
    // through this function. Saved in Showing Docs, replacing an older copy.
    if (action === "packetUploadLink") {
      const safe = String(fileName || "").replace(/[\\/:*?"<>|]/g, "").trim();
      if (!safe.toLowerCase().endsWith(".pdf")) return jsonResponse({ error: "fileName must be a .pdf" }, 400);
      const target = `${await showingDocsPath(accessToken, folderPath)}/${safe}`;
      const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_upload_link", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
        body: JSON.stringify({ commit_info: { path: target, mode: "overwrite", autorename: false, mute: true }, duration: 3600 }),
      });
      const data = await res.json();
      if (!res.ok) return jsonResponse({ error: `Couldn't get an upload link: ${JSON.stringify(data)}` }, 500);
      return jsonResponse({ link: data.link, path: target });
    }

    // Commission check copy (Close-Out Calculator) → the deal's contract
    // paperwork folder: "5) Under Contract" / "5) Contract Docs" on a listing,
    // "4) Closing Docs" on a buyer folder, else the deal folder itself.
    if (action === "commissionCheckUploadLink") {
      const safe = String(fileName || "").replace(/[\\/:*?"<>|]/g, "").trim();
      if (!/\.(pdf|jpe?g|png|heic)$/i.test(safe)) return jsonResponse({ error: "fileName must be a PDF or photo" }, 400);
      const listRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
        body: JSON.stringify({ path: folderPath }),
      });
      const listed = listRes.ok ? await listRes.json() : { entries: [] };
      const subfolders = (listed.entries || [])
        .filter((e: { [k: string]: string }) => e[".tag"] === "folder" && !isArchivedFolder(e.name))
        .map((e: { name: string }) => e.name);
      const target =
        subfolders.find((n: string) => /under contract|contract docs/i.test(n)) ||
        subfolders.find((n: string) => /closing docs/i.test(n)) ||
        subfolders.find((n: string) => /contract|closing/i.test(n)) ||
        null;
      const path = `${folderPath}${target ? `/${target}` : ""}/${safe}`;
      const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_upload_link", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
        body: JSON.stringify({ commit_info: { path, mode: "overwrite", autorename: false, mute: true }, duration: 3600 }),
      });
      const data = await res.json();
      if (!res.ok) return jsonResponse({ error: `Couldn't get an upload link: ${JSON.stringify(data)}` }, 500);
      return jsonResponse({ link: data.link, path });
    }

    // ── Drop files onto a deal (deal screen) ──
    // The deal folder's own subfolders ("1) Pitch Docs", "5) Under Contract", …).
    if (action === "dealSubfolders") {
      const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
        body: JSON.stringify({ path: folderPath }),
      });
      const data = await res.json();
      if (!res.ok) return jsonResponse({ error: `Couldn't open the deal folder: ${JSON.stringify(data)}` }, 500);
      const folders = (data.entries || [])
        .filter((e: { [k: string]: string }) => e[".tag"] === "folder" && !isArchivedFolder(e.name))
        .map((e: { name: string }) => e.name);
      return jsonResponse({ root: folderPath, folders });
    }

    // One-time upload link for a file dropped onto the deal: into the deal
    // folder or one of its own top-level subfolders. Never overwrites — a
    // same-named file gets "(1)" added.
    if (action === "dealUploadLink") {
      const subfolder = path ? String(path) : "";
      const safe = String(fileName || "").replace(/[\\/:*?"<>|]/g, "").trim();
      if (!safe) return jsonResponse({ error: "fileName required" }, 400);
      let target = folderPath;
      if (subfolder) {
        const list = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
          body: JSON.stringify({ path: folderPath }),
        });
        const data = await list.json();
        if (isArchivedFolder(subfolder)) return jsonResponse({ error: "That's a terminated deal's archived folder — nothing new goes in there." }, 400);
        const ok = (data.entries || []).some((e: { [k: string]: string }) => e[".tag"] === "folder" && e.name === subfolder);
        if (!ok) return jsonResponse({ error: `No "${subfolder}" folder in this deal` }, 400);
        target = `${folderPath}/${subfolder}`;
      }
      const res = await fetch("https://api.dropboxapi.com/2/files/get_temporary_upload_link", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
        body: JSON.stringify({ commit_info: { path: `${target}/${safe}`, mode: "add", autorename: true, mute: true }, duration: 3600 }),
      });
      const data = await res.json();
      if (!res.ok) return jsonResponse({ error: `Couldn't get an upload link: ${JSON.stringify(data)}` }, 500);
      return jsonResponse({ link: data.link, path: `${target}/${safe}` });
    }

    // ── Folder organizer ──
    // Every file in the deal folder except the Photos folder, with when it was
    // added to Dropbox (the order things happened).
    if (action === "listDealFiles") {
      const files: { name: string; path: string; folder: string; added: string; size: number }[] = [];
      let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
        body: JSON.stringify({ path: folderPath, recursive: true, limit: 2000 }),
      });
      for (let guard = 0; guard < 20; guard++) {
        const data = await res.json();
        if (!res.ok) return jsonResponse({ error: `Couldn't list the deal folder: ${JSON.stringify(data)}` }, 500);
        for (const e of data.entries || []) {
          if (e[".tag"] !== "file") continue;
          const rel = String(e.path_display).slice(folderPath.length + 1);
          const parts = rel.split("/");
          if (parts.slice(0, -1).some((p: string) => /photo/i.test(p) || isArchivedFolder(p))) continue; // skip Photos + terminated archives
          if (/^(\.|icon\r?$|desktop\.ini$)/i.test(e.name)) continue;
          files.push({ name: e.name, path: e.path_display, folder: parts.slice(0, -1).join("/"), added: e.server_modified, size: e.size || 0 });
        }
        if (!data.has_more) break;
        res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
          body: JSON.stringify({ cursor: data.cursor }),
        });
      }
      return jsonResponse({ root: folderPath, files });
    }

    // Renames files in place (never moves them to another folder). Two
    // passes — everything to a temporary name first, then to its final name —
    // so swapping numbers ("1)" ↔ "2)") never collides.
    if (action === "renameDealFiles") {
      const list = Array.isArray(renames) ? renames : [];
      const lower = folderPath.toLowerCase() + "/";
      const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/"));
      for (const r of list) {
        const from = String(r.from || "");
        const toName = String(r.toName || "").replace(/[\\/:*?"<>|]/g, "").trim();
        const relDirs = from.slice(lower.length).split("/").slice(0, -1);
        if (!from.toLowerCase().startsWith(lower) || !toName || relDirs.some((d) => /photo/i.test(d) || isArchivedFolder(d))) {
          return jsonResponse({ error: `Not allowed: ${from}` }, 400);
        }
        r.to = `${parentOf(from)}/${toName}`;
      }
      // One Dropbox batch per pass (a few seconds total), instead of one call
      // per file — a big folder one-by-one ran past the function's time limit
      // and stranded files under temporary names. The temporary name carries
      // the final name ("__renaming__ 3) 12 Main St - Deed.pdf"), so if
      // anything is ever interrupted, the next Clean Up finishes the job.
      const dbx = (endpoint: string, body: unknown) =>
        fetch(`https://api.dropboxapi.com/2/files/${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": dropboxPathRootHeader },
          body: JSON.stringify(body),
        });
      const moveBatch = async (pairs: { from: string; to: string }[]) => {
        if (!pairs.length) return [] as { ok: boolean; why?: string }[];
        const res = await dbx("move_batch_v2", { entries: pairs.map((p) => ({ from_path: p.from, to_path: p.to })), autorename: false });
        let data = await res.json();
        if (!res.ok) throw new Error(`Dropbox rename failed: ${JSON.stringify(data)}`);
        const jobId = data.async_job_id;
        for (let tries = 0; data[".tag"] === "async_job_id" || data[".tag"] === "in_progress"; tries++) {
          if (tries > 100) throw new Error("Dropbox is still renaming — check back in a minute");
          await new Promise((r) => setTimeout(r, 700));
          const check = await dbx("move_batch/check_v2", { async_job_id: jobId });
          data = await check.json();
          if (!check.ok) throw new Error(`Dropbox rename failed: ${JSON.stringify(data)}`);
        }
        if (data[".tag"] === "failed") throw new Error(`Dropbox rename failed: ${JSON.stringify(data)}`);
        return (data.entries || []).map((e: { [k: string]: unknown }) =>
          e[".tag"] === "success" ? { ok: true } : { ok: false, why: JSON.stringify(e.failure || e) }
        );
      };
      const todo = list.filter((r: { from: string; to: string }) => r.from !== r.to);
      const failed: string[] = [];
      const firstPass = todo.map((r: { from: string; to: string }) => ({ from: r.from, to: `${parentOf(r.from)}/__renaming__ ${r.to.slice(r.to.lastIndexOf("/") + 1)}`, final: r.to }));
      const r1 = await moveBatch(firstPass);
      const moved = firstPass.filter((p, i) => {
        if (r1[i]?.ok) return true;
        failed.push(`${p.from.split("/").pop()}: ${r1[i]?.why || "not renamed"}`);
        return false;
      });
      const secondPass = moved.map((p) => ({ from: p.to, to: p.final }));
      const r2 = await moveBatch(secondPass);
      let renamed = 0;
      secondPass.forEach((p, i) => {
        if (r2[i]?.ok) renamed++;
        else failed.push(`${p.to.split("/").pop()}: ${r2[i]?.why || "not renamed"}`);
      });
      return jsonResponse({ renamed, failed });
    }

    if (action === "extractDescription") {
      const packet = await findPacketFile(accessToken, folderPath);
      if (!packet) {
        return jsonResponse({ description: null, note: "No packet PDF found in Showing Docs" });
      }
      const bytes = await downloadFile(accessToken, packet.path_display);
      const parsed = await pdfParse(new Uint8Array(bytes));
      const { description, source } = extractDescriptionFromText(parsed.text ?? "");
      return jsonResponse({ description, source, packetFileName: packet.name });
    }

    return jsonResponse({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
