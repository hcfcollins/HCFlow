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
  sellerEmails,
  timeframe,
  propertyStyle,
  electrical,
  heatingSystem,
  basement,
  waterSource,
  septic,
  recommendations,
  referralNote,
  leadType,
  clientSource,
  referralOwedTo,
  referralPct,
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
    seller_emails: sellerEmails,
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
  // Captured as early as possible so it's already in place by the time this deal
  // reaches Under Contract instead of only being tracked informally until then.
  await upsertCommissionData(tx.id, {
    lead_type: leadType,
    client_source: clientSource,
    referral_owed_to: clientSource === "Referral" ? referralOwedTo : null,
    referral_pct: clientSource === "Referral" ? referralPct : null,
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

/** Joins or leaves the social media daily rotation queue — called when the "Go Live" to-do
 * is checked/unchecked. Joining puts the listing at the very front (lowest order) so it
 * gets promoted right away; leaving just clears its position, it isn't deleted from history. */
export async function setSocialRotation(transactionId, joining) {
  if (!joining) {
    return updateTransactionFields(transactionId, { social_queue_order: null });
  }
  const { data: rows, error: selErr } = await supabase
    .from("transactions")
    .select("social_queue_order")
    .not("social_queue_order", "is", null)
    .order("social_queue_order", { ascending: true })
    .limit(1);
  if (selErr) throw selErr;
  const newOrder = rows?.length ? rows[0].social_queue_order - 1000 : 0;
  const { error } = await supabase
    .from("transactions")
    .update({ social_queue_order: newOrder, social_went_live_at: new Date(), updated_at: new Date() })
    .eq("id", transactionId);
  if (error) throw error;
}

/** Marks a listing as posted today and cycles it to the back of the rotation queue —
 * the "fair exposure" mechanic that keeps the same listing from getting posted twice
 * in a row while others wait. */
export async function markSocialPosted(transactionId) {
  const { data: rows, error: selErr } = await supabase
    .from("transactions")
    .select("social_queue_order")
    .not("social_queue_order", "is", null)
    .order("social_queue_order", { ascending: false })
    .limit(1);
  if (selErr) throw selErr;
  const newOrder = rows?.length ? rows[0].social_queue_order + 1000 : 0;
  const { error } = await supabase
    .from("transactions")
    .update({ social_last_posted_at: new Date(), social_queue_order: newOrder, updated_at: new Date() })
    .eq("id", transactionId);
  if (error) throw error;
}

/** Marks the one-time "closing" social shoutout as posted — after this the listing never
 * appears in the scheduler again. */
export async function markSocialClosingPosted(transactionId) {
  return updateTransactionFields(transactionId, {
    social_closing_posted_at: new Date(),
    social_last_posted_at: new Date(),
  });
}

/** Drag-and-drop reorder: given the full new id order for the rotation queue, renumbers
 * every row's position in one batch. */
export async function reorderSocialQueue(orderedIds) {
  await Promise.all(
    orderedIds.map((id, index) => updateTransactionFields(id, { social_queue_order: index * 1000 }))
  );
}

/** Lists the image files in a listing's Dropbox "4) Photos" subfolder, via the
 * social-post-assets Edge Function. Returns [{name, path}]. */
/** Returns { photos, source } — source is "Chosen Ones", "Compressed_MLS", or
 * "4) Photos", whichever the Edge Function actually found photos in first. */
export async function listListingPhotos(transactionId) {
  const { data, error } = await supabase.functions.invoke("social-post-assets", {
    body: { action: "listPhotos", transactionId },
  });
  if (error) throw error;
  return data;
}

function imageContentTypeForPath(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".heic")) return "image/heic";
  return "image/jpeg";
}

/** Fetches one Dropbox file's raw bytes as a Blob — used both for picker
 * thumbnails/previews (via URL.createObjectURL) and as the image source for
 * client-side canvas compositing (blob URLs are never cross-origin-tainted).
 * The Edge Function sends the bytes back as "application/octet-stream" (the
 * only content type the Supabase client auto-parses as a Blob rather than
 * mangling through .text()), so the real image mime type has to be re-tagged
 * here from the file extension before handing the Blob off to a caller. */
export async function fetchListingFile(transactionId, path) {
  const { data, error } = await supabase.functions.invoke("social-post-assets", {
    body: { action: "fetchFile", transactionId, path },
  });
  if (error) throw error;
  return new Blob([data], { type: imageContentTypeForPath(path) });
}

/** Best-effort caption draft pulled from the MLS description in the listing's
 * "packet" PDF (Showing Docs). Always meant to be reviewed/edited before use —
 * returns { description, source: "heading"|"fallback", note? }. */
export async function extractListingDescription(transactionId) {
  const { data, error } = await supabase.functions.invoke("social-post-assets", {
    body: { action: "extractDescription", transactionId },
  });
  if (error) throw error;
  return data;
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
export async function addTodo(transactionId, text, dueDate) {
  const { error } = await supabase.from("todos").insert({ transaction_id: transactionId, text, due_date: dueDate || null });
  if (error) throw error;
}

const WON_LISTING_BASELINE_TODOS = [
  "Schedule Photos",
  "Grab docs",
  "Send Listing Agreement",
  "Disclosures",
  "Create Packet",
  "Go Live",
];

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
  const { error } = await supabase.from("todos").update({ done, completed_at: done ? new Date() : null }).eq("id", id);
  if (error) throw error;
}

/** Edits a to-do's text and/or due date (whatever's in patch, e.g. {text} or {due_date}). */
export async function updateTodo(id, patch) {
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTodo(id) {
  const { error } = await supabase.from("todos").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Handles the Under Contract form's submit (Build Spec §5): matches an existing
 * transaction by address or creates a new one, then records the commission-related
 * inputs. commission_data is upserted (New Comp may have already created this row
 * with lead source/referral info) — still insert-with-swallowed-conflict for
 * closeouts, which really is only ever written once, at actual close-out.
 */
export async function submitUnderContract(fields) {
  const {
    region, agentId, side, sellerName, buyerName, address, propertyStyle, price,
    buyerAttorneyId, sellerAttorneyId, closingDate, leadType, commissionPct,
    inspectionDate, financingDate, appraiser, holdDeposit, depositAmount,
    secondDeposit, secondDepositAmount, secondDepositDueDate,
    clientSource, referralOwedTo, referralPct, tcFeeType,
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

  // Upsert, not insert — New Comp may have already created this row (lead source/
  // referral captured earlier), and an agent correcting it here on their own deal
  // now has update rights too (commission_update RLS policy), so this should
  // actually take effect instead of silently conflicting on a duplicate key.
  await upsertCommissionData(tx.id, {
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
    tc_fee_type: tcFeeType,
  });

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
