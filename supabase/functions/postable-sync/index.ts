// Postable (postable.com — mailed cards) address book sync.
//
// When a deal's close-out is saved, our BUYER clients go into Postable with
// their new mailing address (the property they just bought), in a
// "Closed <year>" group. Sellers aren't sent: after closing their old address
// isn't theirs and we rarely have a forwarding address. Companies/trusts are
// skipped (Postable needs a person's first + last name).
//
// Auth: Postable has no API keys — POST /auth/login with the account's email +
// password returns a long-lived token. Fran connects once from Manage Agents
// (action "connect"); the token is kept in app_secrets (service-role only),
// never the password. A POSTABLE_API_TOKEN secret overrides it if set.
//
// POST JSON (signed-in broker):
//   { action: "status" }                         → { connected, account }
//   { action: "connect", email, password }       → logs in, stores the token
//   { action: "sync", transactionId }            → add/update that deal's buyers
// The deal keeps the Postable contact uuid (transactions.postable_contact_id),
// so re-running never duplicates.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API = "https://www.postable.com/api/v1";
const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function rows(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...svc, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(/app_secrets|postable_contact_id|schema cache|does not exist/i.test(text) ? "Run the Postable SQL first (end of supabase/schema.sql)." : text);
  return text ? JSON.parse(text) : null;
}

async function caller(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!u.ok) return null;
  const email = (await u.json())?.email;
  if (!email) return null;
  return (await rows(`agents?email=ilike.${encodeURIComponent(email)}&is_active=eq.true&select=id,role,name`))?.[0] || null;
}

// ---------- token ----------

async function getToken(): Promise<string | null> {
  const env = Deno.env.get("POSTABLE_API_TOKEN");
  if (env) return env;
  const r = await rows(`app_secrets?key=eq.postable_token&select=value`);
  return r?.[0]?.value || null;
}

async function postable(token: string, path: string, init: RequestInit = {}, tries = 3): Promise<any> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", ...(init.headers || {}) } });
  if (res.status === 429 && tries > 1) {
    await new Promise((r) => setTimeout(r, 2000));
    return postable(token, path, init, tries - 1);
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return { message: text }; } })() : null;
  if (res.status === 401) throw new Error("Postable sign-in has expired or was revoked — reconnect it in Manage Agents → Brokerage.");
  if (!res.ok) throw new Error(`Postable error (${res.status}): ${data?.message || text}${data?.errors ? ` ${JSON.stringify(data.errors)}` : ""}`);
  return data;
}

// ---------- names ----------

const ENTITY_RE = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|company|co\.|ltd|trust|trustee|estate of|properties|holdings|partners|partnership|lp|llp|foundation|church|bank|association)\b/i;

type Person = { first: string; middle?: string; last: string };
/** "John and Jane Smith" / "John Smith & Jane Doe" / "Smith, John" → people. */
export function parseBuyers(full: string): { people: Person[]; skip?: string } {
  // Contract boilerplate isn't a person: "…and/or assigns", "et al".
  const name = String(full || "").replace(/\s+/g, " ").replace(/,?\s*(and\s*\/?\s*or|or)\s+assigns?\b|,?\s*et\.?\s*al\.?/gi, "").trim();
  if (!name) return { people: [], skip: "no buyer name" };
  if (ENTITY_RE.test(name)) return { people: [], skip: "the buyer is a company or trust" };
  const parts = name.split(/\s*(?:&|\band\b|\/|;)\s*|,\s*(?=\S+\s+\S+)/i).map((p) => p.trim()).filter(Boolean);
  const people: Person[] = parts.map((p) => {
    const w = p.replace(/,/g, " ").split(/\s+/).filter(Boolean);
    if (w.length === 1) return { first: w[0], last: "" };
    return { first: w[0], middle: w.length > 2 ? w.slice(1, -1).join(" ") : undefined, last: w[w.length - 1] };
  });
  // "John and Jane Smith": share the last name.
  const shared = [...people].reverse().find((p) => p.last)?.last || "";
  for (const p of people) if (!p.last) p.last = shared;
  if (!people[0]?.last) return { people: [], skip: "couldn't tell the buyer's last name" };
  return { people };
}

// ---------- sync one deal ----------

const clientBuys = (tx: Record<string, any>) => tx.side === "Buy" || (tx.side === "Split" && tx.split_client_side !== "Sell");

async function ensureGroup(token: string, name: string): Promise<number> {
  const groups = (await postable(token, "/groups"))?.data || [];
  const found = groups.find((g: { name: string }) => g.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  return (await postable(token, "/groups", { method: "POST", body: JSON.stringify({ name, description: "Hall Collins buyers who closed this year (added by HC Flow)" }) })).data.id;
}

async function findExisting(token: string, email: string | null, first: string, last: string, street: string) {
  const q = email || last;
  const found = (await postable(token, `/contacts?per_page=50&query=${encodeURIComponent(q)}`))?.data || [];
  const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    found.find((c: any) => email && norm(c.email) === norm(email)) ||
    found.find((c: any) => norm(c.last_name) === norm(last) && norm(c.first_name) === norm(first) && norm(c.address) === norm(street)) ||
    null
  );
}

async function syncDeal(transactionId: string) {
  const token = await getToken();
  if (!token) return { skipped: "Postable isn't connected yet (Manage Agents → Brokerage)." };
  const [tx] = await rows(
    `transactions?id=eq.${transactionId}&select=id,address,town,region,zip,side,split_client_side,stage,terminated_at,buyer_name,seller_emails,next_date,postable_contact_id,other_side_id,agent:agents!transactions_agent_id_fkey(name)`
  );
  if (!tx) throw new Error("Deal not found");
  if (tx.terminated_at) return { skipped: "terminated deal" };
  if (!clientBuys(tx)) return { skipped: "our client here is the seller (no new mailing address)" };
  if (tx.postable_contact_id) return { skipped: "already in Postable", uuid: tx.postable_contact_id };

  const { people, skip } = parseBuyers(tx.buyer_name);
  if (skip) {
    await rows(`activity_log`, { method: "POST", body: JSON.stringify({ transaction_id: tx.id, label: "Not added to Postable", detail: `${skip} (${tx.buyer_name || "—"})` }) }).catch(() => {});
    return { skipped: skip };
  }
  const street = String(tx.address || "").split(",")[0].trim();
  const town = String(tx.town || "").replace(/[,\s]+(VT|NH)\.?$/i, "").trim();
  const [p1, p2] = people;
  const email = (tx.seller_emails || []).find(Boolean) || null;
  const closed = tx.next_date ? String(tx.next_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const body: Record<string, unknown> = {
    first_name: p1.first,
    ...(p1.middle ? { middle_name: p1.middle } : {}),
    last_name: p1.last,
    ...(p2 ? { spouse_first_name: p2.first, spouse_last_name: p2.last } : {}),
    ...(email ? { email } : {}),
    address: street,
    city: town || undefined,
    state: tx.region || undefined,
    zip: tx.zip || undefined,
    country: "United States",
    notes: `Bought ${street}${town ? `, ${town}` : ""} — closed ${closed}${tx.agent?.name ? ` with ${tx.agent.name}` : ""} (Hall Collins). ${people.length > 2 ? `Also on the deal: ${people.slice(2).map((p) => `${p.first} ${p.last}`).join(", ")}. ` : ""}Added by HC Flow.`,
  };

  const existing = await findExisting(token, email, p1.first, p1.last, street);
  let uuid: string;
  let action: string;
  if (existing) {
    uuid = existing.uuid;
    await postable(token, `/contacts/${uuid}`, { method: "PUT", body: JSON.stringify(body) });
    action = "updated";
  } else {
    uuid = (await postable(token, "/contacts", { method: "POST", body: JSON.stringify(body) })).data.uuid;
    action = "added";
  }
  const groupName = `Closed ${closed.slice(0, 4)}`;
  const groupId = await ensureGroup(token, groupName);
  await postable(token, `/groups/${groupId}/contacts/${uuid}`, { method: "POST" });

  await rows(`transactions?id=eq.${tx.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ postable_contact_id: uuid }) });
  await rows(`activity_log`, {
    method: "POST",
    body: JSON.stringify({ transaction_id: tx.id, label: `Buyer ${action} in Postable`, detail: `${[p1, p2].filter(Boolean).map((p) => `${p!.first} ${p!.last}`).join(" & ")} — ${street}${town ? `, ${town}` : ""} · group "${groupName}"` }),
  }).catch(() => {});
  return { ok: true, action, uuid, group: groupName, name: `${p1.first} ${p1.last}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const who = await caller(req);
    if (!who || who.role !== "broker") return json({ error: "Broker only" }, 403);
    const body = await req.json().catch(() => ({}));

    if (body.action === "status") {
      const token = await getToken().catch(() => null);
      if (!token) return json({ connected: false });
      try {
        const acct = await postable(token, "/account");
        return json({ connected: true, account: acct?.data?.email || acct?.email || null });
      } catch (e) {
        return json({ connected: false, error: String(e instanceof Error ? e.message : e) });
      }
    }

    if (body.action === "connect") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      if (!email || !password) return json({ error: "Enter the Postable email and password." }, 400);
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ app_id: "hc-flow", email, password }),
      });
      const raw = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = { _text: raw.slice(0, 200) };
      }
      // The docs say { data: { token } } — accept wherever the token actually is.
      const findToken = (o: any, depth = 0): string | null => {
        if (!o || typeof o !== "object" || depth > 4) return typeof o === "string" && depth > 0 ? null : null;
        for (const k of ["token", "access_token", "plainTextToken", "plain_text_token", "api_token"]) if (typeof o[k] === "string" && o[k].length > 10) return o[k];
        for (const v of Object.values(o)) {
          const t = findToken(v, depth + 1);
          if (t) return t;
        }
        return null;
      };
      const tokenValue = typeof data === "string" ? data : findToken(data);
      if (!res.ok || !tokenValue) {
        const shape = (o: any): string => (o && typeof o === "object" ? `{${Object.keys(o).map((k) => (o[k] && typeof o[k] === "object" ? `${k}:${shape(o[k])}` : k)).join(",")}}` : typeof o);
        return json({ error: res.status === 401 ? "Postable didn't accept that email/password." : `Postable login failed (${res.status}): ${data?.message || data?._text || `no token in the reply — fields: ${shape(data)}`}` }, 400);
      }
      data = { data: { token: tokenValue } };
      await rows(`app_secrets?on_conflict=key`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "postable_token", value: data.data.token, updated_at: new Date().toISOString() }),
      });
      return json({ connected: true, account: email });
    }

    if (body.action === "sync") {
      if (!body.transactionId) return json({ error: "transactionId required" }, 400);
      return json(await syncDeal(body.transactionId));
    }
    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
