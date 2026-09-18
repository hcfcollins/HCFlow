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
      agent:agents!transactions_agent_id_fkey(id, name, cover_sheet_url),
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

/** Flags a listing or under-contract deal as fallen-through, without losing its stage
 * history. Pulls it out of the active pipeline pages into the "Terminated" bucket on
 * the All page. Any future reminder-email automation must treat this as the cancel
 * signal (check terminated_at is null before sending). */
export async function terminateTransaction(id, reason) {
  const { error } = await supabase
    .from("transactions")
    .update({ terminated_at: new Date(), termination_reason: reason || null, updated_at: new Date() })
    .eq("id", id);
  if (error) throw error;
}

export async function reactivateTransaction(id) {
  const { error } = await supabase
    .from("transactions")
    .update({ terminated_at: null, termination_reason: null, updated_at: new Date() })
    .eq("id", id);
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
  referralNote,
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
    referral_note: referralNote,
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
  if (error) {
    // supabase-js only gives a generic "non-2xx status code" message on
    // FunctionsHttpError — the actual reason is JSON in the response body,
    // which it stashes on error.context instead of surfacing.
    if (error.context?.json) {
      let detail;
      try {
        const body = await error.context.json();
        detail = body?.error;
      } catch {
        // response body wasn't JSON — fall through to the generic error below
      }
      if (detail) throw new Error(detail);
    }
    throw error;
  }
  return data;
}

/** Uploads a generated comp PDF via the upload-comp-pdf Edge Function; routes to the
 * listing's Pitch Docs subfolder if Won, or the shared general comps repository otherwise. */
export async function uploadCompPdf(transactionId, pdfBytes, fileName) {
  // supabase-js only auto-detects Content-Type for Blob/ArrayBuffer/File/FormData/String —
  // a raw Uint8Array (what pdf-lib returns) isn't in that list and would silently get
  // JSON-stringified, corrupting the binary. Wrap it in a Blob explicitly.
  const { data, error } = await supabase.functions.invoke("upload-comp-pdf", {
    body: new Blob([pdfBytes], { type: "application/pdf" }),
    headers: {
      "x-transaction-id": transactionId,
      "x-file-name": encodeURIComponent(fileName),
      "Content-Type": "application/pdf",
    },
  });
  if (error) {
    if (error.context?.json) {
      let detail;
      try {
        const body = await error.context.json();
        detail = body?.error;
      } catch {
        // response body wasn't JSON — fall through to the generic error below
      }
      if (detail) throw new Error(detail);
    }
    throw error;
  }
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

/** Broker-only roster view — includes inactive agents, unlike fetchAgents(). */
export async function fetchAllAgents() {
  const { data, error } = await supabase.from("agents").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function addAgent({
  name,
  email = null,
  role = "agent",
  dropboxListingPath = null,
  dropboxBuyerPath = null,
  coverSheetUrl = null,
}) {
  const { data, error } = await supabase
    .from("agents")
    .insert({
      name,
      email,
      role,
      dropbox_listing_path: dropboxListingPath,
      dropbox_buyer_path: dropboxBuyerPath,
      cover_sheet_url: coverSheetUrl,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Generic patch for editing an agent's own fields, and for reactivating (is_active: true). */
export async function updateAgentFields(id, patch) {
  const { error } = await supabase.from("agents").update(patch).eq("id", id);
  if (error) throw error;
}

export async function removeAgent(id) {
  const { error } = await supabase.from("agents").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}

/** Uploads an agent's personalized CMA cover sheet PDF to the agent-assets Storage
 * bucket and returns its public URL, for saving into agents.cover_sheet_url. */
export async function uploadAgentCoverSheet(file, agentName) {
  const safeName = agentName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const path = `${safeName}-${Date.now()}.pdf`;
  const { error } = await supabase.storage.from("agent-assets").upload(path, file, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("agent-assets").getPublicUrl(path);
  return data.publicUrl;
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
