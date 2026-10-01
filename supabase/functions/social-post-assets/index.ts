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

const PHOTOS_SUBFOLDER = "4) Photos";
const SHOWING_DOCS_SUBFOLDER = "3) Showing Docs";
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

async function listPhotos(accessToken: string, folderPath: string) {
  const entries = await listFolder(accessToken, `${folderPath}/${PHOTOS_SUBFOLDER}`);
  return entries
    .filter((e) => IMAGE_EXTENSIONS.some((ext) => e.name.toLowerCase().endsWith(ext)))
    .map((e) => ({ name: e.name, path: e.path_display }));
}

/** Finds the packet file (name contains "packet", case-insensitive) in Showing Docs —
 * if more than one matches, the most recently modified wins. */
async function findPacketFile(accessToken: string, folderPath: string) {
  const entries = await listFolder(accessToken, `${folderPath}/${SHOWING_DOCS_SUBFOLDER}`);
  const matches = entries
    .filter((e) => e.name.toLowerCase().includes("packet") && e.name.toLowerCase().endsWith(".pdf"))
    .sort((a, b) => new Date(b.server_modified).getTime() - new Date(a.server_modified).getTime());
  return matches[0] ?? null;
}

/** Best-effort: finds the first recognized MLS remarks/description heading in the
 * packet's text and returns the paragraph after it, trimmed to caption length. Falls
 * back to the top of the document if no heading is recognized — never throws, since
 * a bad extraction shouldn't block the rest of the Boost Post panel from working. */
function extractDescriptionFromText(text: string): { description: string; source: "heading" | "fallback" } {
  const searchArea = text.slice(0, 8000);
  for (const heading of DESCRIPTION_HEADINGS) {
    const headingRegex = new RegExp(`${heading}\\s*:?\\s*`, "i");
    const match = headingRegex.exec(searchArea);
    if (!match) continue;
    const afterHeading = searchArea.slice(match.index + match[0].length);
    // Stop at the next all-caps label-like line (another MLS field) or a blank line.
    const stopMatch = /\n\s*\n|\n[A-Z][A-Z \/]{3,}:?\s*\n/.exec(afterHeading);
    const paragraph = (stopMatch ? afterHeading.slice(0, stopMatch.index) : afterHeading).replace(/\s+/g, " ").trim();
    if (paragraph.length > 20) {
      return { description: truncateToCaption(paragraph), source: "heading" };
    }
  }
  return { description: truncateToCaption(searchArea.replace(/\s+/g, " ").trim()), source: "fallback" };
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
