// Fills in transactions.zip from the property address, automatically.
//
// Source: the US Census Bureau geocoder (free, no API key) — matches the
// full street address and returns its ZIP. If the street address doesn't
// match (new construction, typos, "Lot 4 off Rt 100"), falls back to the
// town: only used when that town has exactly one ZIP, so it never guesses
// between two.
//
// POST, signed-in user required:
//   { transactionId }  → { zip | null }   one deal (after it's added/edited)
//   { all: true }      → { filled, notFound }   broker only: every deal with
//                         an address but no zip yet

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

async function getCaller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.email) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&select=id,role,is_active`, { headers: svc });
  const [agent] = await res.json();
  return agent && agent.is_active !== false ? agent : null;
}

type Tx = { id: string; address: string | null; town: string | null; region: string | null };

async function censusZip(oneLine: string): Promise<string | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const data = await res.json();
  const matches = data?.result?.addressMatches || [];
  const zips = [...new Set(matches.map((m: { addressComponents?: { zip?: string } }) => m.addressComponents?.zip).filter(Boolean))];
  return zips.length === 1 ? (zips[0] as string) : null;
}

async function townZip(town: string, state: string): Promise<string | null> {
  const res = await fetch(`https://api.zippopotam.us/us/${state.toLowerCase()}/${encodeURIComponent(town.toLowerCase())}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const exact = (data.places || []).filter((p: { "place name": string }) => p["place name"].toLowerCase() === town.toLowerCase());
  const zips = [...new Set(exact.map((p: { "post code": string }) => p["post code"]))];
  return zips.length === 1 ? (zips[0] as string) : null;
}

async function lookupZip(tx: Tx): Promise<string | null> {
  const address = (tx.address || "").trim();
  if (!address) return null;
  const town = (tx.town || "").trim();
  const state = tx.region || "";
  // Some addresses already have the town/state typed in ("4 Odell Rd Strafford, VT").
  const parts = [address];
  if (town && !address.toLowerCase().includes(town.toLowerCase())) parts.push(town);
  if (state && !new RegExp(`\\b${state}\\b`, "i").test(address)) parts.push(state);
  try {
    const zip = await censusZip(parts.join(", "));
    if (zip) return zip;
  } catch {
    // fall through to the town lookup
  }
  if (town && state) {
    try {
      return await townZip(town, state);
    } catch {
      return null;
    }
  }
  return null;
}

async function saveZip(id: string, zip: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ zip }),
  });
  if (!res.ok) throw new Error(`Couldn't save the zip: ${await res.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: "Sign in first" }, 401);
    const body = await req.json();

    if (body.all) {
      if (caller.role !== "broker") return jsonResponse({ error: "Broker only" }, 403);
      const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?zip=is.null&address=not.is.null&select=id,address,town,region&limit=300`, { headers: svc });
      if (!res.ok) return jsonResponse({ error: `Run the zip column migration first: ${await res.text()}` }, 400);
      const rows: Tx[] = await res.json();
      let filled = 0;
      const notFound: string[] = [];
      for (const tx of rows) {
        const zip = await lookupZip(tx);
        if (zip) {
          await saveZip(tx.id, zip);
          filled++;
        } else {
          notFound.push(tx.address || tx.id);
        }
      }
      return jsonResponse({ filled, notFound });
    }

    const { transactionId } = body;
    if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${transactionId}&select=id,address,town,region,agent_id`, { headers: svc });
    const [tx] = await res.json();
    if (!tx) return jsonResponse({ error: "Deal not found" }, 404);
    const zip = await lookupZip(tx);
    if (zip) await saveZip(tx.id, zip);
    return jsonResponse({ zip });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
