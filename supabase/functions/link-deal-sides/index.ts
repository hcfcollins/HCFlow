// Links the two sides of one property's deal — a Split (Fran on one side,
// Holly on the other) or an in-house deal (e.g. Holly's listing, Rachel's
// buyer). Each side is its OWN transaction row with its own id, agent,
// commission %, referral and close-out; nothing is ever merged. This only
// records which row is the other side (transactions.other_side_id), so the
// app can show "In-house deal" and not record the earnest deposit twice.
//
// Runs with the service role because an agent can't see the other agent's
// side (RLS), so couldn't find or link it themselves.
//
// POST, signed in:
//   { transactionId }            → find the other side by address and link it
//   { transactionId, otherId }   → broker only: link these two directly (import)
// Returns { linked: { id, agentName } | null, otherSideHoldsDeposit: boolean }

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

type Tx = {
  id: string;
  address: string;
  town: string | null;
  side: string;
  split_client_side: string | null;
  stage: string;
  agent_id: string | null;
  colist_agent_id?: string | null;
  terminated_at: string | null;
  other_side_id?: string | null;
  agent?: { name: string } | null;
  commission_data?: { hold_deposit: string | null } | { hold_deposit: string | null }[] | null;
};

const SUFFIX: Record<string, string> = {
  road: "rd", street: "st", avenue: "ave", lane: "ln", drive: "dr", highway: "hwy", route: "rt", rte: "rt",
  court: "ct", circle: "cir", boulevard: "blvd", place: "pl", terrace: "ter", north: "n", south: "s", east: "e", west: "w",
};
const DROP = new Set(["vt", "nh", "vermont", "new", "hampshire", "usa"]);

/** "1100 Stock Farm Road, Randolph VT 05060" → ["1100","stock","farm","rd","randolph"] */
function tokens(address: string): string[] {
  return address
    .toLowerCase()
    .replace(/^\s*(terminated|term)\b[\s\-–—:]*/i, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !DROP.has(t) && !/^\d{5}$/.test(t))
    .map((t) => SUFFIX[t] || t);
}

/** Same property? Street number + first street word must match; if both
 * deals have a town, it must match too. Returns a score (higher = closer). */
function sameProperty(a: Tx, b: Tx): number {
  const ta = tokens(a.address);
  const tb = tokens(b.address);
  if (ta.length < 2 || tb.length < 2 || ta[0] !== tb[0] || ta[1] !== tb[1]) return 0;
  const townA = (a.town || "").trim().toLowerCase();
  const townB = (b.town || "").trim().toLowerCase();
  if (townA && townB && townA !== townB) return 0;
  // Town typed into the address itself ("12 Main St Bethel" vs "12 Main St
  // Randolph"): the last words must agree.
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  if (ta.length >= 4 && tb.length >= 4 && lastA !== lastB && !tb.includes(lastA) && !ta.includes(lastB)) return 0;
  const setB = new Set(tb);
  return ta.filter((t) => setB.has(t)).length;
}

/** Which side our client is on for this row. */
const clientSide = (t: Tx) => (t.side === "Split" ? t.split_client_side : t.side);

const holdsDeposit = (t: Tx) => {
  const cd = Array.isArray(t.commission_data) ? t.commission_data[0] : t.commission_data;
  return cd?.hold_deposit === "Yes";
};

async function getTx(id: string): Promise<Tx | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}&select=*,agent:agents!transactions_agent_id_fkey(name),commission_data(hold_deposit)`,
    { headers: svc }
  );
  if (!res.ok) throw new Error(await res.text());
  const [tx] = await res.json();
  return tx || null;
}

async function setOtherSide(id: string, otherId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ other_side_id: otherId }),
  });
  if (!res.ok) throw new Error(await res.text());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: "Sign in first" }, 401);
    const { transactionId, otherId } = await req.json();
    if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);

    const tx = await getTx(transactionId);
    if (!tx) return jsonResponse({ error: "Deal not found" }, 404);
    const isStaff = caller.role === "broker" || caller.role === "coordinator";
    if (!isStaff && tx.agent_id !== caller.id && tx.colist_agent_id !== caller.id) {
      return jsonResponse({ error: "Not your deal" }, 403);
    }
    // Column not added yet — nothing to link, but don't break the submission.
    if (!("other_side_id" in tx)) return jsonResponse({ linked: null, otherSideHoldsDeposit: false, needsMigration: true });

    let other: Tx | null = null;
    if (otherId) {
      if (caller.role !== "broker") return jsonResponse({ error: "Broker only" }, 403);
      other = await getTx(otherId);
    } else if (tx.other_side_id) {
      other = await getTx(tx.other_side_id);
    } else {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/transactions?id=neq.${tx.id}&terminated_at=is.null&stage=neq.comps&other_side_id=is.null&select=*,agent:agents!transactions_agent_id_fkey(name),commission_data(hold_deposit)&limit=2000`,
        { headers: svc }
      );
      if (!res.ok) throw new Error(await res.text());
      const rows: Tx[] = await res.json();
      const mine = clientSide(tx);
      const scored = rows
        .filter((r) => {
          const theirs = clientSide(r);
          // The other side means the opposite client — never a second copy of the same side.
          return !(mine && theirs && mine === theirs);
        })
        .map((r) => ({ r, score: sameProperty(tx, r) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      // Only link when one property is clearly the best match.
      if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) other = scored[0].r;
    }

    if (!other) return jsonResponse({ linked: null, otherSideHoldsDeposit: false });
    if (!tx.other_side_id || tx.other_side_id !== other.id) await setOtherSide(tx.id, other.id);
    if (other.other_side_id !== tx.id) await setOtherSide(other.id, tx.id);
    return jsonResponse({
      linked: { id: other.id, agentName: other.agent?.name || null },
      otherSideHoldsDeposit: holdsDeposit(other),
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
