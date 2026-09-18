// Uploads a generated comp/CMA PDF to Dropbox and saves a shared link back onto the
// transaction. If the listing already has a Dropbox folder (Won), the PDF goes into
// that folder's "Pitch Docs" subfolder; otherwise it goes into the shared general
// repository that pre-dates HC Flow (confirmed via the Streamlit CMA generator's own
// dropbox_upload.py, which already wrote comps there).
//
// Expects POST with headers:
//   x-transaction-id: <uuid>
//   x-file-name: <URI-encoded file name>
// and the raw PDF bytes as the request body (application/pdf) — not JSON, to avoid
// base64 bloat on a multi-MB file.

const GENERAL_COMPS_PATH = "/Hall Collins REG Team Folder/Listings/0. CMAs/CMAs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-transaction-id, x-file-name",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
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

/** Idempotent: treats "already exists" as success rather than erroring or autorenaming. */
async function ensureFolder(accessToken: string, path: string) {
  const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
    },
    body: JSON.stringify({ path, autorename: false }),
  });
  if (res.ok) return;
  const data = await res.json();
  const isFolderConflict =
    data.error?.[".tag"] === "path" && data.error.path?.[".tag"] === "conflict" && data.error.path.conflict?.[".tag"] === "folder";
  if (!isFolderConflict) throw new Error(`Dropbox folder creation failed: ${JSON.stringify(data)}`);
}

async function uploadFile(accessToken: string, path: string, bytes: ArrayBuffer): Promise<string> {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true }),
    },
    body: bytes,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Dropbox upload failed: ${JSON.stringify(data)}`);
  return data.path_display as string;
}

async function getOrCreateSharedLink(accessToken: string, path: string): Promise<string> {
  const createRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Dropbox-API-Path-Root": dropboxPathRootHeader,
    },
    body: JSON.stringify({ path }),
  });
  const createData = await createRes.json();
  if (createRes.ok) return createData.url;

  if (createData.error?.[".tag"] === "shared_link_already_exists") {
    const listRes = await fetch("https://api.dropboxapi.com/2/sharing/list_shared_links", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Dropbox-API-Path-Root": dropboxPathRootHeader,
      },
      body: JSON.stringify({ path, direct_only: true }),
    });
    const listData = await listRes.json();
    if (listData.links?.length) return listData.links[0].url;
  }
  throw new Error(`Dropbox shared link failed: ${JSON.stringify(createData)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const transactionId = req.headers.get("x-transaction-id");
    const fileNameHeader = req.headers.get("x-file-name");
    if (!transactionId || !fileNameHeader) {
      return jsonResponse({ error: "x-transaction-id and x-file-name headers are required" }, 400);
    }
    const fileName = decodeURIComponent(fileNameHeader);
    const pdfBytes = await req.arrayBuffer();
    if (!pdfBytes.byteLength) {
      return jsonResponse({ error: "Empty PDF body" }, 400);
    }

    const txRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=id,dropbox_folder_path`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
      }
    );
    const [tx] = await txRes.json();
    if (!tx) {
      return jsonResponse({ error: "Transaction not found" }, 404);
    }

    const targetFolder = tx.dropbox_folder_path ? `${tx.dropbox_folder_path}/Pitch Docs` : GENERAL_COMPS_PATH;

    const accessToken = await getDropboxAccessToken();
    await ensureFolder(accessToken, targetFolder);
    const actualPath = await uploadFile(accessToken, `${targetFolder}/${fileName}`, pdfBytes);
    const sharedLink = await getOrCreateSharedLink(accessToken, actualPath);

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ last_comp_url: sharedLink }),
    });
    if (!updateRes.ok) throw new Error(`Failed to save comp link: ${await updateRes.text()}`);

    return jsonResponse({ fileUrl: sharedLink, filePath: actualPath });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
