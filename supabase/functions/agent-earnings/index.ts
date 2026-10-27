// Returns ONLY what the signed-in agent needs to see about their own
// earnings — their own deals, with their own earned/projected commission —
// and nothing about what Holly, Fran, or the brokerage keeps, even on their
// own deals. closeouts/commission_data are broker-only under RLS (see
// closeouts_select/commission_select in schema.sql), so a regular agent has
// no client-side way to read this at all — this function uses the service
// role to read the real numbers server-side, but only ever returns the one
// field relevant to the caller, never the row.
//
// Identity is verified server-side from the caller's own Supabase session
// (via /auth/v1/user), never trusted from anything the client sends — so
// there's no way to pass a different id and see someone else's numbers.
//
// Expects POST {} — supabase.functions.invoke() already attaches the
// caller's normal session Authorization header.
//
// The commission formula below is a deliberate, careful duplicate of
// calculateCloseout in src/lib/commissionCalc.js (Deno functions can't import
// across the supabase/functions boundary into src/) — if that formula ever
// changes again, this must be updated to match, or agents will see a
// different "projected" number here than what the real Close-Out Calculator
// will eventually produce.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Duplicate of calculateCloseout — see file header. Returns just the one
 * figure relevant to `agentName` (their own commission on this deal), never
 * the other parties'. */
function earnedAmountFor(
  agentName: string,
  opts: { commissionAfterReferral: number; side: string; leadType: string; agentSplitPct: number | null }
): number {
  const { commissionAfterReferral, side, leadType, agentSplitPct } = opts;
  const isHolly = agentName === "Holly Hall";
  const isFran = agentName === "Fran Collins";

  if (isHolly || isFran) {
    const bankAmount = commissionAfterReferral * 0.2;
    const remainder = commissionAfterReferral - bankAmount;
    let pct = 0;
    if (side === "Sell") pct = isHolly ? 0.6 : 0.4;
    else if (side === "Buy") pct = isHolly ? 0.8 : 0.2;
    else if (side === "Split") pct = 1; // the acting owner (isHolly or isFran, whichever got us into this branch) always keeps the full remainder on a Split deal
    return round2(remainder * pct);
  }

  const agentPct = leadType === "Provided" ? (agentSplitPct != null ? agentSplitPct / 100 : 0.6) : 0.8;
  return round2(commissionAfterReferral * agentPct);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Not signed in" }, 401);

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: SERVICE_ROLE_KEY },
    });
    const userData = await userRes.json();
    if (!userRes.ok || !userData.email) {
      return jsonResponse({ error: "Could not verify who you're signed in as" }, 401);
    }

    const agentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/agents?email=eq.${encodeURIComponent(userData.email)}&select=id,name`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const [agent] = await agentRes.json();
    if (!agent) return jsonResponse({ error: "No agent record matches your sign-in email" }, 404);

    const txRes = await fetch(
      `${SUPABASE_URL}/rest/v1/transactions?agent_id=eq.${agent.id}&terminated_at=is.null&stage=in.(contract,closed)&select=` +
        encodeURIComponent(
          "id,address,stage,side,price,next_date," +
            "commission_data(lead_type,referral_pct)," +
            "closeouts(price,commission_pct,referral_pct,lead_type,agent_split_pct,commission_after_referral,agent_commission,holly_commission,fran_commission)"
        ),
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const txs = await txRes.json();
    if (!txRes.ok) throw new Error(`Failed to load deals: ${JSON.stringify(txs)}`);

    const earnedField = agent.name === "Holly Hall" ? "holly_commission" : agent.name === "Fran Collins" ? "fran_commission" : "agent_commission";

    let actualEarned = 0;
    let projectedEarned = 0;
    const deals = [];

    for (const tx of txs) {
      const co = tx.closeouts;
      const alreadyClosed = co && co.commission_after_referral != null;

      if (alreadyClosed) {
        const amount = Number(co[earnedField]) || 0;
        actualEarned += amount;
        deals.push({ address: tx.address, stage: tx.stage, closing_date: tx.next_date, amount, is_actual: true });
        continue;
      }

      const price = co?.price ?? tx.price;
      const commissionPct = co?.commission_pct;
      if (price == null || commissionPct == null) {
        deals.push({ address: tx.address, stage: tx.stage, closing_date: tx.next_date, amount: null, is_actual: false });
        continue;
      }
      const leadType = co?.lead_type ?? tx.commission_data?.lead_type ?? "Organic";
      const referralPct = Number(co?.referral_pct ?? tx.commission_data?.referral_pct ?? 0) || 0;
      const grossCommission = Number(price) * (Number(commissionPct) / 100);
      const commissionAfterReferral = grossCommission * (1 - referralPct / 100);
      const amount = earnedAmountFor(agent.name, {
        commissionAfterReferral,
        side: tx.side,
        leadType,
        agentSplitPct: co?.agent_split_pct ?? null,
      });
      projectedEarned += amount;
      deals.push({ address: tx.address, stage: tx.stage, closing_date: tx.next_date, amount, is_actual: false });
    }

    deals.sort((a, b) => (a.closing_date || "").localeCompare(b.closing_date || ""));

    return jsonResponse({
      agentName: agent.name,
      actualEarned: round2(actualEarned),
      projectedEarned: round2(projectedEarned),
      deals,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
