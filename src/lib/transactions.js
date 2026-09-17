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
      activity_log(*),
      todos(*),
      commission_data(*),
      closeouts(*)
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

export async function updateTransactionCompsStatus(id, compsStatus) {
  const { error } = await supabase
    .from("transactions")
    .update({ comps_status: compsStatus, updated_at: new Date() })
    .eq("id", id);
  if (error) throw error;
}

/** Quick-capture flow (Build Spec §10): logs a listing appointment straight into the Comps stage. */
export async function createComp({
  agentId,
  address,
  town,
  side,
  notes,
  sellerName,
  sellerEmail,
  timeframe,
  propertyStyle,
  electrical,
  heatingSystem,
  basement,
  waterSource,
  septic,
  recommendations,
}) {
  const tx = await createTransaction({
    agent_id: agentId,
    address,
    town,
    side,
    notes,
    stage: "comps",
    comps_status: "Need to Send Comp",
    seller_name: sellerName,
    seller_email: sellerEmail,
    timeframe,
    property_style: propertyStyle,
    electrical,
    heating_system: heatingSystem,
    basement,
    water_source: waterSource,
    septic,
    recommendations,
  });
  await addActivityLog(tx.id, "Added from Comps quick-capture", address);
  return tx;
}

export async function updateTransactionLockbox(id, { hasLockbox, lockboxCode, lockboxNote }) {
  const { error } = await supabase
    .from("transactions")
    .update({ has_lockbox: hasLockbox, lockbox_code: lockboxCode, lockbox_note: lockboxNote, updated_at: new Date() })
    .eq("id", id);
  if (error) throw error;
}

export async function updateTransactionAttorneys(id, { buyerAttorneyId, sellerAttorneyId }) {
  const patch = {};
  if (buyerAttorneyId !== undefined) patch.buyer_attorney_id = buyerAttorneyId;
  if (sellerAttorneyId !== undefined) patch.seller_attorney_id = sellerAttorneyId;
  const { error } = await supabase.from("transactions").update(patch).eq("id", id);
  if (error) throw error;
}

/** Generic single/multi-field patch for the quick inline edits on the detail screen. */
export async function updateTransactionFields(id, patch) {
  const { error } = await supabase.from("transactions").update({ ...patch, updated_at: new Date() }).eq("id", id);
  if (error) throw error;
}

/** Resolves an attorney name to an id, creating a new attorney record if there's no match yet. */
export async function resolveAttorneyId(name, attorneys) {
  if (!name.trim()) return null;
  const match = attorneys.find((a) => a.name.toLowerCase() === name.trim().toLowerCase());
  if (match) return match.id;
  const created = await addAttorney(name.trim());
  return created.id;
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

/** Won Listing to-do list. */
export async function addTodo(transactionId, text) {
  const { error } = await supabase.from("todos").insert({ transaction_id: transactionId, text });
  if (error) throw error;
}

const WON_LISTING_BASELINE_TODOS = ["Schedule Photos", "Grab docs", "Send Listing Agreement", "Disclosures"];

/** Pre-populates the standard checklist when a deal first moves into Listing Won. */
export async function seedWonListingTodos(transactionId) {
  const { error } = await supabase
    .from("todos")
    .insert(WON_LISTING_BASELINE_TODOS.map((text) => ({ transaction_id: transactionId, text })));
  if (error) throw error;
}

/** Creates the agent's Dropbox listing folder via the create-dropbox-folder Edge Function. */
export async function createDropboxFolderForListing(transactionId) {
  const { data, error } = await supabase.functions.invoke("create-dropbox-folder", {
    body: { transactionId },
  });
  if (error) throw error;
  return data;
}

export async function toggleTodo(id, done) {
  const { error } = await supabase.from("todos").update({ done }).eq("id", id);
  if (error) throw error;
}

/**
 * Handles the Under Contract form's submit (Build Spec §5): matches an existing
 * transaction by address or creates a new one, then records the commission-related
 * inputs. Uses insert (not upsert) for commission_data/closeouts because RLS only
 * allows brokers to update those tables — a duplicate-row conflict here means this
 * address's commission info was already submitted, so it's swallowed rather than
 * thrown; a broker can correct it directly if needed.
 */
export async function submitUnderContract(fields) {
  const {
    region, agentId, side, sellerName, buyerName, address, propertyStyle, price,
    buyerAttorneyId, sellerAttorneyId, closingDate, leadType, commissionPct,
    inspectionDate, financingDate, appraiser, holdDeposit, depositAmount,
    secondDeposit, secondDepositAmount, secondDepositDueDate,
    clientSource, referralOwedTo, referralPct,
  } = fields;

  const txPatch = {
    region,
    side,
    agent_id: agentId,
    seller_name: sellerName,
    buyer_name: buyerName,
    property_style: propertyStyle,
    price,
    buyer_attorney_id: buyerAttorneyId,
    seller_attorney_id: sellerAttorneyId,
    next_date: closingDate || null,
    stage: "contract",
  };

  let tx = await findTransactionByAddress(address);
  if (tx) {
    const { data, error } = await supabase
      .from("transactions")
      .update({ ...txPatch, updated_at: new Date() })
      .eq("id", tx.id)
      .select()
      .single();
    if (error) throw error;
    tx = data;
  } else {
    tx = await createTransaction({ address, ...txPatch });
  }

  const { error: commissionError } = await supabase.from("commission_data").insert({
    transaction_id: tx.id,
    lead_type: leadType,
    client_source: clientSource,
    referral_owed_to: referralOwedTo,
    referral_pct: referralPct,
    hold_deposit: holdDeposit,
    deposit_amount: depositAmount,
    second_deposit: secondDeposit,
    second_deposit_amount: secondDepositAmount,
    second_deposit_due_date: secondDepositDueDate,
    inspection_date: inspectionDate || null,
    financing_date: financingDate || null,
    appraiser,
  });
  if (commissionError && commissionError.code !== "23505") throw commissionError;

  const { error: closeoutError } = await supabase.from("closeouts").insert({
    transaction_id: tx.id,
    price,
    commission_pct: commissionPct,
    lead_type: leadType,
    referral_pct: referralPct,
  });
  if (closeoutError && closeoutError.code !== "23505") throw closeoutError;

  await addActivityLog(tx.id, "Under Contract form submitted", address);

  return tx;
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
