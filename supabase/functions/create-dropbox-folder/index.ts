// Creates a Dropbox folder for a Won Listing in the correct per-agent path
// (designated-agency separation — see the app's project memory
// "dropbox_folder_structure" for why this mapping isn't a simple formula),
// then saves a shared link back onto the transaction row.
//
// Invoked by the app when a deal's stage first moves to "won".
// Expects POST { transactionId: string }.
//
// Per-agent listing folder paths live in agents.dropbox_listing_path (set via
// the app's Manage Agents screen), not hardcoded here — onboarding a new agent
// no longer requires editing or redeploying this function.

// Standard subfolder set created inside every new listing folder. Numbered so they
// stay in this order in Dropbox's default alphabetical sort. upload-comp-pdf hardcodes
// the "1) Pitch Docs" name too — keep both in sync if this ever changes again.
const LISTING_SUBFOLDERS = ["1) Pitch Docs", "2) Listing Docs", "3) Showing Docs", "4) Photos", "5) Under Contract"];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
// Hall Collins is a Dropbox Business/Team account. The shared team folder
// structure (Hall Collins REG Team Folder, HC - <agent>, etc.) lives in a
// separate TEAM namespace, not the authorizing user's own individual Dropbox
// space — every call must pass this header or paths silently resolve against
// the wrong namespace and fail as "not found".
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\<>:"|?*]/g, "-").trim().replace(/[. ]+$/, "");
}

// Seller Name is freeform (e.g. "John & Jane Doe"), so this is a best-effort
// guess — the last whitespace-separated word — not a real name parser.
function getSellerLastName(sellerName: string | null | undefined): string | null {
  if (!sellerName) return null;
  const words = sellerName.trim().split(/\s+/);
  return words.length ? words[words.length - 1] : null;
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Dropbox rate-limits write operations against the same parent tree — creating a
// folder's subfolders back-to-back (previously done in parallel via Promise.all)
// reliably triggers too_many_write_operations. Retry, respecting the retry_after
// Dropbox sends (falling back to a small fixed backoff if it's absent/zero).
async function withDropboxRateLimitRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const message = String(e);
      const isRateLimit = message.includes("too_many_write_operations") || message.includes("too_many_requests");
      if (!isRateLimit || attempt === maxAttempts) throw e;
      const retryAfterMatch = /"retry_after"\s*:\s*(\d+)/.exec(message);
      const retryAfterSeconds = retryAfterMatch ? Number(retryAfterMatch[1]) : 0;
      await sleep(Math.max(retryAfterSeconds, 1) * 1000);
    }
  }
  throw new Error("unreachable");
}

async function createDropboxFolder(accessToken: string, path: string) {
  return withDropboxRateLimitRetry(async () => {
    const res = await fetch("https://api.dropboxapi.com/2/files/create_folder_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Dropbox-API-Path-Root": dropboxPathRootHeader,
      },
      // autorename:false on purpose: a retry (e.g. after the earlier step of
      // saving the link back to the transaction failed) must be idempotent,
      // not spawn a "Name (1)" duplicate folder for the same listing. A
      // path/conflict/folder error below is treated as "already exists,
      // reuse it" rather than an autorenamed duplicate.
      body: JSON.stringify({ path, autorename: false }),
    });
    const data = await res.json();
    if (res.ok) return data.metadata.path_display as string;

    const isFolderConflict =
      data.error?.[".tag"] === "path" && data.error.path?.[".tag"] === "conflict" && data.error.path.conflict?.[".tag"] === "folder";
    if (isFolderConflict) return path;

    throw new Error(`Dropbox folder creation failed: ${JSON.stringify(data)}`);
  });
}

async function getOrCreateSharedLink(accessToken: string, path: string): Promise<string> {
  return withDropboxRateLimitRetry(() => getOrCreateSharedLinkOnce(accessToken, path));
}

async function getOrCreateSharedLinkOnce(accessToken: string, path: string): Promise<string> {
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

  // If a link already exists (e.g. re-triggered), look it up instead of failing.
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

// Called from the browser via supabase-js, which means the browser sends a CORS
// preflight (OPTIONS) before the real POST — without handling it and setting
// these headers on every response, the browser blocks the call before it ever
// reaches this code, surfacing only as "Failed to send a request to the Edge
// Function" client-side with no server-side error to debug.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const { transactionId } = await req.json();
    if (!transactionId) {
      return jsonResponse({ error: "transactionId required" }, 400);
    }

    const txRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=id,address,seller_name,agent:agents!transactions_agent_id_fkey(name,dropbox_listing_path)`,
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

    const agentName = tx.agent?.name;
    const parentPath = tx.agent?.dropbox_listing_path;
    if (!parentPath) {
      return jsonResponse(
        { error: `No Dropbox listing folder configured for agent "${agentName}" — set one in Manage Agents` },
        400
      );
    }

    const folderLabel = getSellerLastName(tx.seller_name)
      ? `${getSellerLastName(tx.seller_name)} - ${tx.address}`
      : tx.address;
    const folderPath = `${parentPath}/${sanitizeFolderName(folderLabel)}`;

    const accessToken = await getDropboxAccessToken();
    // createDropboxFolder is idempotent (treats "already exists" as success), so
    // any error here is a real problem and should surface, not be swallowed.
    const actualPath = await createDropboxFolder(accessToken, folderPath);
    // Sequential, not Promise.all — creating these back-to-back in parallel is
    // exactly what triggers Dropbox's too_many_write_operations rate limit.
    for (const name of LISTING_SUBFOLDERS) {
      await createDropboxFolder(accessToken, `${actualPath}/${name}`);
    }
    const sharedLink = await getOrCreateSharedLink(accessToken, actualPath);

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}`, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ dropbox_folder_url: sharedLink, dropbox_folder_path: actualPath }),
    });
    if (!updateRes.ok) throw new Error(`Failed to save folder link: ${await updateRes.text()}`);

    return jsonResponse({ folderUrl: sharedLink, folderPath: actualPath });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
