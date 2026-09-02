import { supabase } from "./supabaseClient";

/**
 * Fetch transactions visible to the current user (RLS on the `transactions`
 * table already enforces broker-sees-all / agent-sees-own, so this is a
 * plain select — no client-side filtering needed for access control).
 */
export async function fetchTransactions() {
  const { data, error } = await supabase
    .from("transactions")
    .select(
      `
      *,
      agent:agents!transactions_agent_id_fkey(id, name),
      buyer_attorney:attorneys!transactions_buyer_attorney_id_fkey(id, name),
      seller_attorney:attorneys!transactions_seller_attorney_id_fkey(id, name),
      documents(*),
      activity_log(*)
    `
    )
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function updateTransactionStage(id, stage) {
  const { error } = await supabase.from("transactions").update({ stage, updated_at: new Date() }).eq("id", id);
  if (error) throw error;
}

export async function updateTransactionNotes(id, notes) {
  const { error } = await supabase.from("transactions").update({ notes, updated_at: new Date() }).eq("id", id);
  if (error) throw error;
}

export async function updateTransactionAttorneys(id, { buyerAttorneyId, sellerAttorneyId }) {
  const patch = {};
  if (buyerAttorneyId !== undefined) patch.buyer_attorney_id = buyerAttorneyId;
  if (sellerAttorneyId !== undefined) patch.seller_attorney_id = sellerAttorneyId;
  const { error } = await supabase.from("transactions").update(patch).eq("id", id);
  if (error) throw error;
}

export async function linkTransactions(idA, idB) {
  const { error: e1 } = await supabase.from("transactions").update({ linked_id: idB }).eq("id", idA);
  const { error: e2 } = await supabase.from("transactions").update({ linked_id: idA }).eq("id", idB);
  if (e1 || e2) throw e1 || e2;
}

export async function unlinkTransaction(id, otherId) {
  const { error: e1 } = await supabase.from("transactions").update({ linked_id: null }).eq("id", id);
  const { error: e2 } = otherId
    ? await supabase.from("transactions").update({ linked_id: null }).eq("id", otherId)
    : { error: null };
  if (e1 || e2) throw e1 || e2;
}

export async function createTransaction(fields) {
  const { data, error } = await supabase.from("transactions").insert(fields).select().single();
  if (error) throw error;
  return data;
}

/** Finds an existing transaction by case-insensitive address match (used by the Under Contract form). */
export async function findTransactionByAddress(address) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .ilike("address", address.trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addActivityLog(transactionId, label, detail) {
  const { error } = await supabase.from("activity_log").insert({ transaction_id: transactionId, label, detail });
  if (error) throw error;
}

// ---- Broker-only: commission data + close-outs ----
// RLS already blocks non-brokers from reading/writing these tables entirely,
// so a non-broker calling these functions will simply get an empty/error result.

export async function upsertCommissionData(transactionId, fields) {
  const { error } = await supabase
    .from("commission_data")
    .upsert({ transaction_id: transactionId, ...fields, updated_at: new Date() });
  if (error) throw error;
}

export async function saveCloseout(transactionId, closeoutFields) {
  const { error } = await supabase
    .from("closeouts")
    .upsert({ transaction_id: transactionId, ...closeoutFields, calculated_at: new Date() });
  if (error) throw error;

  await updateTransactionStage(transactionId, "closed");
}

// ---- Agents & Attorneys ----

export async function fetchAgents() {
  const { data, error } = await supabase.from("agents").select("*").eq("is_active", true).order("name");
  if (error) throw error;
  return data;
}

export async function addAgent(name, email = null) {
  const { data, error } = await supabase.from("agents").insert({ name, email, role: "agent" }).select().single();
  if (error) throw error;
  return data;
}

export async function removeAgent(id) {
  const { error } = await supabase.from("agents").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

export async function fetchAttorneys() {
  const { data, error } = await supabase.from("attorneys").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function addAttorney(name) {
  const { data, error } = await supabase.from("attorneys").insert({ name }).select().single();
  if (error) throw error;
  return data;
}
