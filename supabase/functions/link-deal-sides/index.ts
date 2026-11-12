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
//   { transactionId, endOtherSide: { reason, relisted } }
//        → this side fell through: also terminate the linked other side, give
//          it a "Return Deposit to Buyer" to-do if it held the deposit, and
//          tell that agent (bell notification)
//   { transactionId, notifyOtherSide: true }
//        → a buy side was terminated: just tell the listing agent (their
//          listing is left alone — they decide whether to relist)
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&select=id,name,role,is_active`, { headers: svc });
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
  linked_id?: string | null;
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

/** "@Rachel " (full name if two people share the first name) for a to-do. */
async function agentTag(t: Tx): Promise<string> {
  const name = t.agent?.name;
  if (!name) return "";
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?is_active=eq.true&select=name`, { headers: svc });
  const roster: { name: string }[] = res.ok ? await res.json() : [];
  const first = name.split(/\s+/)[0];
  const shared = roster.filter((a) => a.name.split(/\s+/)[0].toLowerCase() === first.toLowerCase()).length > 1;
  return `@${shared ? name : first} `;
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
    const { transactionId, otherId, endOtherSide, notifyOtherSide } = await req.json();
    if (!transactionId) return jsonResponse({ error: "transactionId required" }, 400);

    const tx = await getTx(transactionId);
    if (!tx) return jsonResponse({ error: "Deal not found" }, 404);
    const isStaff = caller.role === "broker" || caller.role === "coordinator";
    if (!isStaff && tx.agent_id !== caller.id && tx.colist_agent_id !== caller.id) {
      return jsonResponse({ error: "Not your deal" }, 403);
    }
    // Column not added yet — nothing to link, but don't break the submission.
    if (!("other_side_id" in tx)) return jsonResponse({ linked: null, otherSideHoldsDeposit: false, needsMigration: true });

    if (endOtherSide || notifyOtherSide) {
      if (!tx.other_side_id) return jsonResponse({ ok: true, otherSide: null });
      const otherTx = await getTx(tx.other_side_id);
      if (!otherTx) return jsonResponse({ ok: true, otherSide: null });
      const who = caller.name || "Someone";
      let message: string;
      if (endOtherSide) {
        if (!otherTx.terminated_at) {
          const reason = endOtherSide.relisted
            ? `Fell through on the listing side — ${who} relisted it${endOtherSide.reason ? `: ${endOtherSide.reason}` : ""}`
            : `Deal fell through (terminated by ${who})${endOtherSide.reason ? `: ${endOtherSide.reason}` : ""}`;
          const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${otherTx.id}`, {
            method: "PATCH",
            headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ terminated_at: new Date().toISOString(), termination_reason: reason, updated_at: new Date().toISOString() }),
          });
          if (!res.ok) throw new Error(`Couldn't terminate the other side: ${await res.text()}`);
          await fetch(`${SUPABASE_URL}/rest/v1/activity_log`, {
            method: "POST",
            headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ transaction_id: otherTx.id, label: "Terminated with the other side", detail: reason }),
          });
        }
        message = endOtherSide.relisted
          ? `${who} relisted ${tx.address} — the deal fell through, so your side was terminated too.`
          : `${who} terminated ${tx.address} — the deal fell through, so your side was terminated too.`;
      } else {
        message = `${who} terminated their buyer side of ${tx.address}. If the listing is going back on the market, open it and choose Terminate Deal → "Seller is still selling".`;
      }
      // The deposit goes back to the buyer from the SELLER's side only (the
      // listing brokerage holds it) — a tagged to-do for the listing agent,
      // whichever side recorded holding it. Never on the buyer side.
      let sellerSide = clientSide(otherTx) === "Buy" ? tx : clientSide(tx) === "Buy" ? otherTx : null;
      // Relisted: the seller's to-do belongs on the NEW active listing (the
      // old row is terminated). Only accepted if it really is the relist of tx.
      if (sellerSide === tx && endOtherSide?.relistedId) {
        const relisted = await getTx(endOtherSide.relistedId);
        if (relisted && relisted.linked_id === tx.id) sellerSide = relisted;
      }
      let depositTodoFor: Tx | null = null;
      if (sellerSide && (holdsDeposit(tx) || holdsDeposit(otherTx))) {
        const existing = await fetch(
          `${SUPABASE_URL}/rest/v1/todos?transaction_id=eq.${sellerSide.id}&done=eq.false&text=ilike.*Return%20Deposit%20to%20Buyer*&select=id`,
          { headers: svc }
        );
        const open = existing.ok ? await existing.json() : [];
        if (!open.length) {
          await fetch(`${SUPABASE_URL}/rest/v1/todos`, {
            method: "POST",
            headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
            body: JSON.stringify({ transaction_id: sellerSide.id, text: `${await agentTag(sellerSide)}Return Deposit to Buyer` }),
          });
          depositTodoFor = sellerSide;
        }
      }
      if (depositTodoFor === otherTx) message += " Please return the buyer's deposit (it's on your to-do list).";
      if (depositTodoFor && depositTodoFor !== otherTx && depositTodoFor.agent_id && depositTodoFor.agent_id !== caller.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify([{ recipient_agent_id: depositTodoFor.agent_id, transaction_id: depositTodoFor.id, kind: "todo_assigned", message: `Return the buyer's deposit on ${depositTodoFor.address} — it's on your to-do list.`, created_by_agent_id: caller.id }]),
        });
      }

      const recipients = [otherTx.agent_id, otherTx.colist_agent_id].filter((id) => id && id !== caller.id);
      if (recipients.length) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST",
          headers: { ...svc, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify(
            recipients.map((id) => ({ recipient_agent_id: id, transaction_id: otherTx.id, kind: "todo_assigned", message, created_by_agent_id: caller.id }))
          ),
        });
      }
      return jsonResponse({ ok: true, otherSide: { id: otherTx.id, agentName: otherTx.agent?.name || null } });
    }

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
