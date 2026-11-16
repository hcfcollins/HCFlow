// Copies agent licenses / signed paperwork uploaded on Manage Agents (kept in
// the private Supabase "agent-licenses" bucket) into Dropbox, named the same
// way every time:
//
//   "<Name> - VT License - Exp 5-31-28.pdf"   (NH License, Broker License too)
//   "Hall Collins Real Estate Group - VT Brokerage License - Exp 5-31-28.pdf"
//   "<Name> - Independent Contractor Agreement (Signed).pdf"
//   "<Name> - Policy Manual (Signed).pdf"
//
// Two copies of each license:
//   1. Brokers-only (Fran + Holly), so nothing gets deleted by accident:
//      Hall Collins REG Team Folder/Education & Licenses & Taxes & Insurance/
//        Active Licenses/VT Licenses | NH Licenses
//      (signed paperwork → …/Agent Onboarding/<Name> - Onboarding)
//   2. The agent's own copy, in the license folder in their Dropbox space
//      ("Rachel - VT NH Licenses", "Bekka - Licenses and Continuing
//      Education" → its "VT License"/"NH License" subfolder if it has one),
//      created as "<First> - Licenses" if they don't have one yet. Not for
//      Fran/Holly, whose space IS the team folder.
//
// Licenses only copy once the expiration date is set (it's in the name). A new
// expiration date makes a new file; the old one is left as history.
//
// POST (broker only):
//   { agentId, kind: "vt" | "nh" | "broker" | "policy_manual" | "ica" }
//   { brokerage: "VT" | "NH" }
//   { all: true }   — everything currently uploaded (catch-up)
// → { copied: [paths], skipped: [reasons] }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DROPBOX_APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const DROPBOX_APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const DROPBOX_REFRESH_TOKEN = Deno.env.get("DROPBOX_REFRESH_TOKEN")!;
const DROPBOX_TEAM_ROOT_NAMESPACE_ID = Deno.env.get("DROPBOX_TEAM_ROOT_NAMESPACE_ID")!;
const pathRoot = JSON.stringify({ ".tag": "root", root: DROPBOX_TEAM_ROOT_NAMESPACE_ID });
const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

const TEAM = "/Hall Collins REG Team Folder";
const ADMIN = `${TEAM}/Education & Licenses & Taxes & Insurance`;
const FIRM = "Hall Collins Real Estate Group";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

async function isBroker(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!u.ok) return false;
  const { email } = await u.json();
  if (!email) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(email)}&role=eq.broker&is_active=eq.true&select=id`, { headers: svc });
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}

async function dropboxToken() {
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: DROPBOX_REFRESH_TOKEN, client_id: DROPBOX_APP_KEY, client_secret: DROPBOX_APP_SECRET }),
  });
  if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function listFolders(token: string, path: string): Promise<string[]> {
  const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Dropbox-API-Path-Root": pathRoot },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.entries || []).filter((e: { [k: string]: string }) => e[".tag"] === "folder").map((e: { name: string }) => e.name);
}

/** Dropbox creates any missing parent folders on upload. Same name → replaced. */
async function upload(token: string, path: string, bytes: Uint8Array) {
  const res = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Path-Root": pathRoot,
      // Non-ASCII characters must be escaped in this header.
      "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", mute: true }).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")),
    },
    body: bytes,
  });
  if (!res.ok) throw new Error(`Dropbox upload failed for ${path}: ${await res.text()}`);
}

async function fromStorage(path: string): Promise<Uint8Array> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/agent-licenses/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: svc });
  if (!res.ok) throw new Error(`Couldn't read ${path} from app storage: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

const ext = (p: string) => (p.split(".").pop() || "pdf").toLowerCase();
/** "2028-05-31" → "5-31-28" (the style already used in Active Licenses). */
const expText = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}-${d}-${String(y).slice(2)}`;
};
const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();

type Agent = { id: string; name: string; role: string; dropbox_listing_path: string | null; [k: string]: unknown };

const LICENSE_KINDS: Record<string, { label: string; state: "VT" | "NH" }> = {
  vt: { label: "VT License", state: "VT" },
  nh: { label: "NH License", state: "NH" },
  broker: { label: "Broker License", state: "VT" },
};
const DOC_KINDS: Record<string, string> = {
  policy_manual: "Policy Manual (Signed)",
  ica: "Independent Contractor Agreement (Signed)",
};

/** The agent's own license folder in their Dropbox space (not for Fran/Holly). */
async function agentLicenseFolder(token: string, agent: Agent, state: "VT" | "NH"): Promise<string | null> {
  const top = (agent.dropbox_listing_path || "").split("/").filter(Boolean)[0];
  if (!top || `/${top}` === TEAM) return null;
  const space = `/${top}`;
  const first = agent.name.split(/\s+/)[0];
  const existing = (await listFolders(token, space)).find((n) => /licens/i.test(n));
  const folder = `${space}/${existing || `${first} - Licenses`}`;
  if (!existing) return folder;
  // e.g. Bekka's folder has "VT License" / "NH License" subfolders.
  const sub = (await listFolders(token, folder)).find((n) => new RegExp(`\\b${state}\\b.*licen`, "i").test(n));
  return sub ? `${folder}/${sub}` : folder;
}

async function syncAgent(token: string, agent: Agent, kind: string, copied: string[], skipped: string[]) {
  const path = agent[`${kind}_path`] ?? agent[`${kind}_license_path`];
  if (!path) return;
  const name = clean(agent.name);
  if (DOC_KINDS[kind]) {
    const bytes = await fromStorage(path as string);
    const target = `${ADMIN}/Agent Onboarding/${name} - Onboarding/${name} - ${DOC_KINDS[kind]}.${ext(path as string)}`;
    await upload(token, target, bytes);
    copied.push(target);
    return;
  }
  const lic = LICENSE_KINDS[kind];
  if (!lic) return;
  const expires = agent[`${kind}_license_expires`] as string | null;
  if (!expires) {
    skipped.push(`${agent.name} ${lic.label}: no expiration date yet`);
    return;
  }
  const bytes = await fromStorage(path as string);
  const fileName = `${name} - ${lic.label} - Exp ${expText(expires)}.${ext(path as string)}`;
  const brokerCopy = `${ADMIN}/Active Licenses/${lic.state} Licenses/${fileName}`;
  await upload(token, brokerCopy, bytes);
  copied.push(brokerCopy);
  const own = await agentLicenseFolder(token, agent, lic.state);
  if (own) {
    await upload(token, `${own}/${fileName}`, bytes);
    copied.push(`${own}/${fileName}`);
  }
}

async function syncBrokerage(token: string, state: string, copied: string[], skipped: string[]) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/brokerage_licenses?state=eq.${state}&select=*`, { headers: svc });
  if (!r.ok) return;
  const [row] = await r.json();
  if (!row?.license_path) return;
  if (!row.expires) {
    skipped.push(`${state} brokerage license: no expiration date yet`);
    return;
  }
  const bytes = await fromStorage(row.license_path);
  const target = `${ADMIN}/Active Licenses/${state} Licenses/${FIRM} - ${state} Brokerage License - Exp ${expText(row.expires)}.${ext(row.license_path)}`;
  await upload(token, target, bytes);
  copied.push(target);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  try {
    if (!(await isBroker(req))) return json({ error: "Broker only" }, 403);
    const body = await req.json();
    const token = await dropboxToken();
    const copied: string[] = [];
    const skipped: string[] = [];

    if (body.brokerage) {
      await syncBrokerage(token, String(body.brokerage).toUpperCase(), copied, skipped);
    } else if (body.all) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=*`, { headers: svc });
      for (const agent of (await r.json()) as Agent[]) {
        for (const kind of ["vt", "nh", "broker", "policy_manual", "ica"]) {
          try {
            await syncAgent(token, agent, kind, copied, skipped);
          } catch (e) {
            skipped.push(`${agent.name} ${kind}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      for (const st of ["VT", "NH"]) await syncBrokerage(token, st, copied, skipped).catch(() => {});
    } else {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/agents?id=eq.${body.agentId}&select=*`, { headers: svc });
      const [agent] = await r.json();
      if (!agent) return json({ error: "Agent not found" }, 404);
      await syncAgent(token, agent, String(body.kind), copied, skipped);
    }
    return json({ copied, skipped });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
