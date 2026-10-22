// Called when a Contract-stage Sell-side listing's buyer falls through and the
// seller wants to relist. Archives the "5) Under Contract" subfolder (renamed
// with the fallen-through buyer's name + TERMINATED) so their paperwork never
// mixes with the next buyer's, then creates a fresh clean "5) Under Contract"
// folder ready for round two — everything else in the listing folder (Pitch
// Docs, Listing Agreement, Showing Docs, Photos) is untouched, since it's the
// same physical listing being remarketed, not a new one.
//
// Expects POST { transactionId: string }.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
// See create-dropbox-folder's comment on this — same team-namespace requirement.
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const dropboxPathRootHeader = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });

const UNDER_CONTRACT_SUBFOLDER = "5) Under Contract";

function sanitizeFolderName(name: string): string {
  return name.replace(/[/\\<>:"|?*]/g, "-").trim().replace(/[. ]+$/, "");
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

// See create-dropbox-folder's comment on this — same Dropbox rate-limit pattern.
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

/** Renames the old "5) Under Contract" folder out of the way — autorename:true
 * so a retry (or a listing that's already been relisted once before) doesn't
 * fail if a same-named archive folder somehow already exists; a missing source
 * folder (nothing ever got put in Under Contract yet) is treated as already
 * handled rather than an error. */
async function moveDropboxPath(accessToken: string, fromPath: string, toPath: string) {
  return withDropboxRateLimitRetry(async () => {
    const res = await fetch("https://api.dropboxapi.com/2/files/move_v2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Dropbox-API-Path-Root": dropboxPathRootHeader,
      },
      body: JSON.stringify({ from_path: fromPath, to_path: toPath, autorename: true }),
    });
    const data = await res.json();
    if (res.ok) return data.metadata.path_display as string;
    if (String(data.error_summary || "").includes("from_lookup/not_found")) return null;
    throw new Error(`Dropbox move failed: ${JSON.stringify(data)}`);
  });
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
      `${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=id,buyer_name,dropbox_folder_path`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const [tx] = await txRes.json();
    if (!tx) return jsonResponse({ error: "Transaction not found" }, 404);
    if (!tx.dropbox_folder_path) {
      // Nothing to archive — e.g. this listing never got a Dropbox folder at all.
      // Not an error worth blocking the relist flow over.
      return jsonResponse({ ok: true, skipped: "No Dropbox folder on this listing" });
    }

    const accessToken = await getDropboxAccessToken();
    const buyerLabel = sanitizeFolderName(tx.buyer_name || "Unknown Buyer");
    const fromPath = `${tx.dropbox_folder_path}/${UNDER_CONTRACT_SUBFOLDER}`;
    const toPath = `${tx.dropbox_folder_path}/${UNDER_CONTRACT_SUBFOLDER} - TERMINATED - ${buyerLabel}`;

    await moveDropboxPath(accessToken, fromPath, toPath);
    await createDropboxFolder(accessToken, fromPath);

    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
