// Backs the Social Scheduler's Boost Post / New Listing Graphic buttons: lists
// photos in a listing's Dropbox "4) Photos" subfolder and streams individual
// file bytes back to the browser (used both for picker thumbnails/previews and
// as the actual image source for client-side canvas compositing).
//
// Expects POST { action: "listPhotos" | "fetchFile", transactionId, path? }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const PHOTOS_SUBFOLDER = "4) Photos";
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".heic"];

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

function contentTypeForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
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
  return tx.dropbox_folder_path as string;
}

async function listPhotos(accessToken: string, folderPath: string) {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
    },
    body: JSON.stringify({ path: `${folderPath}/${PHOTOS_SUBFOLDER}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Dropbox list_folder failed: ${JSON.stringify(data)}`);

  return (data.entries ?? [])
    .filter((e: { [key: string]: unknown }) => e[".tag"] === "file")
    .filter((e: { name: string }) => IMAGE_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)))
    .map((e: { name: string; path_display: string }) => ({ name: e.name, path: e.path_display }));
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
    const { action, transactionId, path } = await req.json();
    if (!action || !transactionId) {
      return jsonResponse({ error: "action and transactionId required" }, 400);
    }

    const accessToken = await getDropboxAccessToken();
    const folderPath = await getTransactionFolderPath(transactionId);

    if (action === "listPhotos") {
      const photos = await listPhotos(accessToken, folderPath);
      return jsonResponse({ photos });
    }

    if (action === "fetchFile") {
      if (!path) return jsonResponse({ error: "path required" }, 400);
      const bytes = await downloadFile(accessToken, path);
      return new Response(bytes, {
        headers: { ...CORS_HEADERS, "Content-Type": contentTypeForPath(path) },
      });
    }

    return jsonResponse({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
