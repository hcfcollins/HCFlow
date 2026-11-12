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
      agent:agents!transactions_agent_id_fkey(id, name, cover_sheet_url, gusto_contractor_id),
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

  // A terminated deal with an earnest money deposit on file needs a deliberate
  // step to actually return it to the buyer — distinct from "deposit retained"
  // at an actual close-out, which means the brokerage applied an already-held
  // deposit toward the commission (a smaller check, not a withheld refund).
  // Best-effort: a failed lookup here must never block the termination itself.
  try {
    const { data: cd } = await supabase.from("commission_data").select("hold_deposit").eq("transaction_id", id).maybeSingle();
    if (cd?.hold_deposit === "Yes") {
      await addTodo(id, "Return Deposit to Buyer", null);
    }
  } catch {
    // ignore — termination itself already succeeded above
  }
}

export async function reactivateTransaction(id) {
  const { error } = await supabase
    .from("transactions")
    .update({ terminated_at: null, termination_reason: null, updated_at: new Date() })
    .eq("id", id);
  if (error) throw error;
}

/** When a Contract-stage Sell-side listing's buyer falls through and the seller
 * wants to relist: archives the "5) Under Contract" Dropbox subfolder (renamed
 * with the fallen-through buyer's name + TERMINATED, via the relist-listing
 * Edge Function) so their paperwork never mixes with the next buyer's,
 * terminates this transaction row (keeping buyer #1's info frozen for the
 * record, same as terminateTransaction above), then creates a fresh
 * transaction row for the same listing — same address/Dropbox folder/property
 * details, stage reset to On Market, buyer-specific fields cleared — linked
 * back to the terminated row via linked_id so the history stays traceable.
 * Dropbox is done first and must succeed before anything in the database
 * changes, so a failure here never leaves a half-relisted deal behind. */
export async function relistAfterTermination(transactionId, reason) {
  const { data: oldTx, error: fetchError } = await supabase.from("transactions").select("*").eq("id", transactionId).single();
  if (fetchError) throw fetchError;

  const { error: folderError } = await supabase.functions.invoke("relist-listing", { body: { transactionId } });
  if (folderError) throw folderError;

  await terminateTransaction(transactionId, reason);

  const newTx = await createTransaction({
    address: oldTx.address,
    town: oldTx.town,
    region: oldTx.region,
    side: "Sell",
    stage: "market",
    agent_id: oldTx.agent_id,
    notes: oldTx.notes,
    sign_status: oldTx.sign_status,
    has_lockbox: oldTx.has_lockbox,
    lockbox_code: oldTx.lockbox_code,
    lockbox_note: oldTx.lockbox_note,
    dropbox_folder_url: oldTx.dropbox_folder_url,
    dropbox_folder_path: oldTx.dropbox_folder_path,
    comp_analysis: oldTx.comp_analysis,
    last_comp_url: oldTx.last_comp_url,
    ba_comp: oldTx.ba_comp,
    seller_attorney_id: oldTx.seller_attorney_id,
    seller_name: oldTx.seller_name,
    seller_emails: oldTx.seller_emails,
    property_style: oldTx.property_style,
    price: oldTx.price,
    timeframe: oldTx.timeframe,
    electrical: oldTx.electrical,
    heating_system: oldTx.heating_system,
    basement: oldTx.basement,
    water_source: oldTx.water_source,
    septic: oldTx.septic,
    recommendations: oldTx.recommendations,
    referral_note: oldTx.referral_note,
    beds: oldTx.beds,
    baths: oldTx.baths,
    garage_spaces: oldTx.garage_spaces,
    lot_acres: oldTx.lot_acres,
    year_built: oldTx.year_built,
    features_notes: oldTx.features_notes,
    finishes_note: oldTx.finishes_note,
    fuel_types: oldTx.fuel_types,
    private_septic: oldTx.private_septic,
    private_well: oldTx.private_well,
    has_view: oldTx.has_view,
    solar: oldTx.solar,
    boundary_notes: oldTx.boundary_notes,
    town_water_sewer: oldTx.town_water_sewer,
    social_went_live_at: oldTx.social_went_live_at,
    linked_id: transactionId,
  });

  await addActivityLog(transactionId, "Buyer fell through — relisted", `New deal created: ${newTx.address}`);
  await addActivityLog(newTx.id, "Relisted after buyer fell through", "Carried forward from the terminated deal");

  return newTx;
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
  region,
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
  beds,
  baths,
  garageSpaces,
  lotAcres,
  yearBuilt,
  featuresNotes,
  finishesNote,
  fuelTypes,
  privateSeptic,
  privateWell,
  hasView,
  solar,
  boundaryNotes,
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
    region: region || null,
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
    beds,
    baths,
    garage_spaces: garageSpaces,
    lot_acres: lotAcres,
    year_built: yearBuilt,
    features_notes: featuresNotes,
    finishes_note: finishesNote,
    fuel_types: fuelTypes,
    private_septic: privateSeptic,
    private_well: privateWell,
    has_view: hasView,
    solar,
    boundary_notes: boundaryNotes,
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

/** Permanently deletes a deal and everything attached to it (to-dos, docs,
 * activity, commission data, close-out, notifications all cascade). Broker
 * only (RLS transactions_delete). Does NOT touch its Dropbox folder. */
export async function deleteTransaction(id) {
  // Another deal may point at this one (relist/linked pair) — unlink first or
  // the foreign key blocks the delete.
  await supabase.from("transactions").update({ linked_id: null }).eq("linked_id", id);
  const { data, error } = await supabase.from("transactions").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't delete this deal — only Fran or Holly can delete deals.");
}

export async function createTransaction(fields) {
  const { data, error } = await supabase.from("transactions").insert(fields).select().single();
  if (error) throw error;
  // Zip is looked up from the address in the background — never blocks or
  // fails adding the deal.
  if (data?.address && !data.zip) fillZipCode(data.id).catch(() => {});
  return data;
}

/** Finds an existing transaction by case-insensitive address match (used by the Under Contract form). */
/** Excludes terminated rows — otherwise, once a listing has been relisted (see
 * relistAfterTermination below), this address matches both the terminated
 * original and its active replacement, and .maybeSingle() throws instead of
 * picking one. There should only ever be one non-terminated row per address. */
export async function findTransactionByAddress(address) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .ilike("address", address.trim())
    .is("terminated_at", null)
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

/** "@Kerry " (every active transaction coordinator's first name), so a
 * seeded to-do shows her tagged — "" if there's no coordinator on the roster. */
async function coordinatorTag() {
  const { data } = await supabase.from("agents").select("name").eq("role", "coordinator").eq("is_active", true);
  return (data || []).map((a) => `@${a.name.split(/\s+/)[0]} `).join("");
}

export const MLS_PARTIAL_TODO = "Input Partial in MLS";

/** Pre-populates the standard checklist when a deal first moves into Listing
 * Won, plus the coordinator's tagged "Input Partial in MLS" to-do. Returns
 * that to-do's text so the caller can email her about it. */
export async function seedWonListingTodos(transactionId) {
  const mlsTodo = `${await coordinatorTag()}${MLS_PARTIAL_TODO}`;
  const { error } = await supabase
    .from("todos")
    .insert([...WON_LISTING_BASELINE_TODOS, mlsTodo].map((text) => ({ transaction_id: transactionId, text })));
  if (error) throw error;
  return mlsTodo;
}

export const REVIEW_LINK = "https://g.page/r/CQqNLCVhrYdhEBM/review";
const COMPLIANCE_TODOS = [
  "Review the file for any missing information",
  `Send the closing docs to the agent and remind them to ask for a review: ${REVIEW_LINK}`,
  "Add the buyer and seller details to the Postable list",
];

/** The coordinator's post-closing compliance checklist, created (tagged to
 * her) the first time a broker closes the deal out. Idempotent — re-saving
 * an existing close-out doesn't duplicate it. Returns the created texts, or
 * [] if they already existed. */
export async function seedComplianceTodos(transactionId) {
  const { data: existing } = await supabase
    .from("todos")
    .select("id")
    .eq("transaction_id", transactionId)
    .ilike("text", "%Postable list%");
  if (existing?.length) return [];
  const tag = await coordinatorTag();
  const texts = COMPLIANCE_TODOS.map((t) => `${tag}${t}`);
  const { error } = await supabase.from("todos").insert(texts.map((text) => ({ transaction_id: transactionId, text })));
  if (error) throw error;
  return texts;
}

/** `date` (a "YYYY-MM-DD" string) minus `days` days, as another "YYYY-MM-DD"
 * string — null in, null out, so callers can pass a possibly-unset date field
 * straight through without a separate guard. */
function dateMinusDays(date, days) {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Keeps a contingency deadline to-do in sync with its date field on the Under
 * Contract form (Financing/Inspection) — inserts it the first time a date is set,
 * updates its due date if the agent corrects the date later, and removes it (if
 * not already checked off) if the date gets cleared out entirely, e.g. a cash
 * deal that no longer has a financing contingency. */
async function syncContingencyTodo(transactionId, text, dueDate) {
  const { data: existing, error: findError } = await supabase
    .from("todos")
    .select("id, done")
    .eq("transaction_id", transactionId)
    .eq("text", text)
    .maybeSingle();
  if (findError) throw findError;

  if (!dueDate) {
    if (existing && !existing.done) {
      const { error } = await supabase.from("todos").delete().eq("id", existing.id);
      if (error) throw error;
    }
    return;
  }

  if (existing) {
    const { error } = await supabase.from("todos").update({ due_date: dueDate }).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("todos").insert({ transaction_id: transactionId, text, due_date: dueDate });
    if (error) throw error;
  }
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

/** Creates the agent's Dropbox buyer folder via the create-dropbox-buyer-folder
 * Edge Function — the Buy-side counterpart to createDropboxFolderForListing. */
export async function createDropboxFolderForBuyer(transactionId) {
  const { data, error } = await supabase.functions.invoke("create-dropbox-buyer-folder", {
    body: { transactionId },
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

/** `initials` (e.g. "FC") is recorded alongside the completion date so the
 * to-do shows who checked it off. */
export async function toggleTodo(id, done, initials = null) {
  const patch = { done, completed_at: done ? new Date() : null, completed_by_initials: done ? initials : null };
  let { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error && /completed_by_initials/.test(error.message || "")) {
    // Column migration not run yet — still check the to-do off.
    delete patch.completed_by_initials;
    ({ error } = await supabase.from("todos").update(patch).eq("id", id));
  }
  if (error) throw error;
}

export function initialsFor(name) {
  return (name || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase())
    .join("")
    .slice(0, 3);
}

/** Edits a to-do's text and/or due date (whatever's in patch, e.g. {text} or {due_date}). */
export async function updateTodo(id, patch) {
  const { error } = await supabase.from("todos").update(patch).eq("id", id);
  if (error) throw error;
}

/** .select() so a delete that RLS silently filtered out (0 rows, no error —
 * how Postgres reports "no permission" on DELETE) surfaces as a real error
 * instead of the X button just appearing to do nothing. */
export async function deleteTodo(id) {
  const { data, error } = await supabase.from("todos").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The to-do couldn't be deleted (no permission, or it was already removed).");
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
    region, agentId, side, splitClientSide, sellerName, buyerName, address, propertyStyle, price,
    buyerAttorneyId, sellerAttorneyId, closingDate, leadType, commissionPct,
    inspectionDate, financingDate, appraiser, holdDeposit, depositAmount, depositDueDate,
    secondDeposit, secondDepositAmount, secondDepositDueDate,
    clientSource, referralOwedTo, referralPct, tcFeeType,
    townWaterSewer,
  } = fields;

  const txPatch = {
    region,
    side,
    // Only sent on Split deals, so a database missing this newer column
    // doesn't break every other Under Contract submission.
    ...(side === "Split" ? { split_client_side: splitClientSide || null } : {}),
    agent_id: agentId,
    seller_name: sellerName,
    buyer_name: buyerName,
    property_style: propertyStyle,
    price,
    buyer_attorney_id: buyerAttorneyId,
    seller_attorney_id: sellerAttorneyId,
    next_date: closingDate || null,
    stage: "contract",
    town_water_sewer: townWaterSewer,
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
    deposit_due_date: depositDueDate,
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

  await syncContingencyTodo(tx.id, "Financing Contingency Deadline", financingDate || null);
  await syncContingencyTodo(tx.id, "Inspection Contingency Deadline", inspectionDate || null);
  await syncContingencyTodo(tx.id, "Financing Check-In", dateMinusDays(financingDate, 7));
  await syncContingencyTodo(tx.id, "Closing", closingDate || null);
  await syncContingencyTodo(tx.id, "Schedule Final Walkthrough", dateMinusDays(closingDate, 7));
  await syncContingencyTodo(tx.id, "Send Utilities", dateMinusDays(closingDate, 10));
  await syncContingencyTodo(tx.id, "Deposit Due", holdDeposit === "Yes" ? depositDueDate || null : null);
  await syncContingencyTodo(tx.id, "Second Deposit Due", secondDeposit === "Yes" ? secondDepositDueDate || null : null);

  // Everything below is listing-side logistics — doesn't apply when Hall Collins
  // is only representing the buyer, since there's no seller-side deposit/utility
  // reading to coordinate on someone else's listing.
  if (side !== "Buy") {
    await syncContingencyTodo(tx.id, "Send the Deposit", dateMinusDays(closingDate, 5));
    // Town water/sewer final readings have to be ordered from the municipality,
    // which takes longer to schedule than a private well/septic reading — 2
    // weeks out instead of 1.
    await syncContingencyTodo(tx.id, "Final Oil/Water/Sewer Reading", dateMinusDays(closingDate, townWaterSewer ? 14 : 7));
  }

  await addActivityLog(tx.id, "Under Contract form submitted", address);

  // Best-effort, non-blocking — a Xero hiccup must never stop the actual
  // Under Contract submission from going through. Surfaced to the caller as
  // tx._xeroWarning so the form can toast it rather than fail silently.
  const deposits = [
    holdDeposit === "Yes" && depositAmount
      ? { label: "Earnest Money Deposit", amount: depositAmount, due_date: depositDueDate || null }
      : null,
    secondDeposit === "Yes" && secondDepositAmount
      ? { label: "Second Earnest Money Deposit", amount: secondDepositAmount, due_date: secondDepositDueDate || null }
      : null,
  ].filter(Boolean);
  if (deposits.length) {
    try {
      await pushDepositsToXero({ address, region, buyer_name: buyerName, closing_date: closingDate || null, deposits });
    } catch (e) {
      tx._xeroWarning = `Couldn't create the Xero deposit record${deposits.length > 1 ? "s" : ""}: ${e.message}`;
    }
  }

  // A pure Buy-side deal never passes through the Won Listing step, so it
  // never gets a Dropbox folder that way — this is its first and only chance.
  // Sell/Split deals already have one from Won Listing by the time they get
  // here, hence the dropbox_folder_url guard (also makes this safe to re-run).
  if (side === "Buy" && !tx.dropbox_folder_url) {
    try {
      const folderResult = await createDropboxFolderForBuyer(tx.id);
      tx.dropbox_folder_url = folderResult.folderUrl;
      tx.dropbox_folder_path = folderResult.folderPath;
    } catch (e) {
      tx._dropboxWarning = `Couldn't create the Dropbox buyer folder: ${e.message}`;
    }
  }

  return tx;
}

/** Creates a Xero Invoice (ACCREC, billed to the buyer, coded to the region's
 * trust liability account) for each anticipated earnest money deposit — see
 * xero-push-deposit for the full shape/reasoning. */
export async function pushDepositsToXero(payload) {
  const { error } = await supabase.functions.invoke("xero-push-deposit", { body: payload });
  if (error) throw error;
}

/** Sends the commission closeout email from the Close-Out Calculator's own
 * already-computed numbers (payload shape matches buildEmailPayload there) —
 * see send-closeout-email for the recipient/branching logic. testMode routes
 * every email it would have sent to Fran's own address instead, with a
 * banner naming who the real recipients would have been. */
export async function sendCloseoutEmail(payload, testMode = false) {
  const { data, error } = await supabase.functions.invoke("send-closeout-email", {
    body: { ...payload, testMode },
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

/** Grabs the most recently modified file in the listing's Dropbox "3) Showing
 * Docs" subfolder and drops it into a new (unsent) Gmail draft, subject/body
 * pre-filled — see email-showing-packet for the full logic. Returns
 * { fileName, draftUrl } so the caller can open the draft for review. */
export async function emailShowingPacket(transactionId) {
  const { data, error } = await supabase.functions.invoke("email-showing-packet", {
    body: { transactionId },
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

  // Hand off to the transaction coordinator: her checklist + one email.
  // Best-effort — the close-out itself already saved.
  try {
    const created = await seedComplianceTodos(transactionId);
    if (created.length) {
      await notifyTodo({ transactionId, event: "compliance_ready", text: created.map((t) => `• ${t.replace(/^(@\S+\s)+/, "")}`).join("\n") });
    }
  } catch (e) {
    console.error("Couldn't set up the compliance checklist:", e);
  }
}

export async function fetchSignInventory() {
  const { data, error } = await supabase.from("sign_inventory").select("available_count").eq("id", 1).single();
  if (error) throw error;
  return data.available_count;
}

/** Read-then-write, not an atomic SQL increment — acceptable here since sign
 * pickups are confirmed one close-out at a time by a single broker, not a
 * high-concurrency counter. */
export async function incrementSignInventory() {
  const current = await fetchSignInventory();
  const { error } = await supabase
    .from("sign_inventory")
    .update({ available_count: current + 1, updated_at: new Date() })
    .eq("id", 1);
  if (error) throw error;
  return current + 1;
}

/** Patches the closeouts row directly — e.g. Spreadsheet View's Check Received
 * toggle — without saveCloseout's "mark the deal Closed" side effect. Safe as
 * a plain upsert: every deal already has a closeouts row from Under Contract
 * onward (submitUnderContract creates an early one with just price/commission
 * basics), so this never needs to be a first-time insert in practice. */
export async function updateCloseoutFields(transactionId, patch) {
  const { error } = await supabase.from("closeouts").upsert({ transaction_id: transactionId, ...patch });
  if (error) throw error;
}

/** Sends a closed deal's fully pre-calculated numbers to the Deal Tracker Form
 * Google Sheet (via the push-closeout-to-sheet Edge Function -> a Zapier
 * webhook), which is what the existing "Create Xero Invoice and Bills" Zap
 * reads from. Deliberately separate from saveCloseout — a failure here (the
 * new Zap isn't wired up yet, Zapier's down, whatever) must never block the
 * actual close-out from saving, so callers should catch this independently. */
export async function pushCloseoutToSheet(payload) {
  const { error } = await supabase.functions.invoke("push-closeout-to-sheet", { body: payload });
  if (error) throw error;
}

/** Creates the Xero Sales Invoice + per-payee Bills directly (see
 * xero-push-closeout) — separate call from pushCloseoutToSheet so either one
 * failing never blocks the other; both are best-effort, non-blocking steps
 * after the real close-out save. */
export async function pushCloseoutToXero(payload) {
  const { error } = await supabase.functions.invoke("xero-push-closeout", { body: payload });
  if (error) throw error;
}

/** The signed-in agent's own earnings only (see agent-earnings) — their own
 * deals, their own earned/projected commission, never Holly/Fran's cut or
 * what the brokerage keeps, even on their own deals. */
export async function fetchMyEarnings() {
  const { data, error } = await supabase.functions.invoke("agent-earnings", { body: {} });
  if (error) throw error;
  return data;
}

// ---- Agents & Attorneys ----

/** Excludes role='coordinator' (e.g. the transaction coordinator) — she's in the
 * roster for Gusto routing purposes but never produces a deal, so she shouldn't
 * be a selectable option here. */
export async function fetchAgents() {
  const { data, error } = await supabase.from("agents").select("*").eq("is_active", true).neq("role", "coordinator").order("name");
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
  const row = {
    name,
    email,
    role,
    dropbox_listing_path: dropboxListingPath,
    dropbox_buyer_path: dropboxBuyerPath,
    cover_sheet_url: coverSheetUrl,
    // New agents start with their onboarding checklist being tracked — see
    // lib/onboarding.js. The transaction coordinator isn't onboarded as an agent.
    ...(role === "coordinator" ? {} : { onboarding: {} }),
  };
  let { data, error } = await supabase.from("agents").insert(row).select().single();
  if (error && /onboarding/.test(error.message || "")) {
    // agents.onboarding migration not run yet — still add the agent.
    delete row.onboarding;
    ({ data, error } = await supabase.from("agents").insert(row).select().single());
  }
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

/** True when a to-do's text @-mentions anyone (e.g. "@Rachel call the
 * appraiser") — the cheap client-side check for whether notifyTodo is worth
 * calling at all for a non-coordinator. */
export function todoHasMention(text) {
  return /(^|\s)@[A-Za-z]/.test(text || "");
}

/** Emails + in-app-notifies whoever a new to-do concerns: the property's agent
 * when the transaction coordinator adds it, plus anyone @-mentioned by first
 * name. All recipient resolution happens server-side in notify-todo (it
 * verifies the caller from their own session). Returns { notified: [names] }. */
export async function notifyTodo({ transactionId, text, dueDate, notifyOwner = false, remindAgentId = null, event = "todo" }) {
  const { data, error } = await supabase.functions.invoke("notify-todo", {
    body: { transactionId, text, dueDate: dueDate || null, notifyOwner, remindAgentId, event, appUrl: window.location.origin },
  });
  if (error) {
    if (error.context?.json) {
      let detail;
      try {
        const body = await error.context.json();
        detail = body?.error;
      } catch {
        // not JSON — fall through
      }
      if (detail) throw new Error(detail);
    }
    throw error;
  }
  return data;
}

/** The signed-in user's own notifications, newest first — RLS limits rows to
 * recipient_agent_id = current_agent_id(), so no filter is needed here. */
export async function fetchNotifications() {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data;
}

export async function markNotificationsRead(ids) {
  if (!ids.length) return;
  const { error } = await supabase.from("notifications").update({ read_at: new Date() }).in("id", ids);
  if (error) throw error;
}

/** Agent/TC side of closing: flags the deal for Fran's commission review
 * without changing its stage — only a broker actually closes it (via the
 * Close-Out Calculator). Pass false to un-flag. */
export async function setReadyForCloseout(id, ready) {
  const { error } = await supabase
    .from("transactions")
    .update({ ready_for_closeout_at: ready ? new Date() : null, updated_at: new Date() })
    .eq("id", id);
  if (error) throw error;
  await addActivityLog(id, ready ? "Marked Ready for Closeout" : "Ready for Closeout cleared", null);
}

/** Transaction coordinator's final step after a broker has closed the deal:
 * file reviewed for missing info, closed for compliance. Pass null agentId to
 * reopen. */
export async function setComplianceClosed(id, agentId) {
  const closed = Boolean(agentId);
  const { error } = await supabase
    .from("transactions")
    .update({
      compliance_closed_at: closed ? new Date() : null,
      compliance_closed_by: closed ? agentId : null,
      updated_at: new Date(),
    })
    .eq("id", id);
  if (error) throw error;
  await addActivityLog(id, closed ? "Closed for compliance" : "Compliance review reopened", null);
}

/** Broker + coordinator only (the RPC checks is_staff() itself) — the one
 * commission figure the coordinator's Spreadsheet View shows, without giving
 * her read access to the closeouts table. Returns { [transactionId]: amount }. */
export async function fetchStaffTotalCommissions() {
  const { data, error } = await supabase.rpc("staff_total_commissions");
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.transaction_id, r.total_commission]));
}

/** Simple bulk-entry path for listings that already exist outside the app —
 * no Dropbox folder, no seeded checklist, no social rotation side effects. */
export async function createActiveListing(fields) {
  const existing = await findTransactionByAddress(fields.address);
  if (existing) throw new Error(`${fields.address} is already in the app.`);
  let tx;
  try {
    tx = await createTransaction(fields);
  } catch (e) {
    // showing_access column not added yet — save the listing without it.
    if (!fields.showing_access || !String(e.message).includes("showing_access")) throw e;
    const { showing_access: _skip, ...rest } = fields;
    tx = await createTransaction(rest);
  }
  await addActivityLog(tx.id, "Added as an existing active listing", fields.address);
  return tx;
}

/** TEMPORARY test button: runs the daily digest right now. The function only
 * accepts a browser call from a broker, and always forces test mode for it —
 * every digest goes to Fran's inbox, never the real agents. */
export async function sendTestDailyDigest() {
  const { data, error } = await supabase.functions.invoke("daily-todo-digest", { body: { testMode: true, force: true } });
  if (error) {
    if (error.context?.json) {
      let detail;
      try {
        detail = (await error.context.json())?.error;
      } catch {
        // not JSON
      }
      if (detail) throw new Error(detail);
    }
    throw error;
  }
  return data;
}

/** Pulls the real error message out of a failed Edge Function call. */
async function functionError(error) {
  if (error?.context?.json) {
    try {
      const detail = (await error.context.json())?.error;
      if (detail) return new Error(detail);
    } catch {
      // not JSON
    }
  }
  return error;
}

/** Folders one level inside the agent's Dropbox listing folder (or buyer
 * folder for side "Buy") — the choices in the "Pair Existing Folder" picker. */
export async function listDropboxFolders(agentId, side) {
  const { data, error } = await supabase.functions.invoke("pair-dropbox-folder", { body: { action: "list", agentId, side } });
  if (error) throw await functionError(error);
  return data;
}

/** Attach an existing Dropbox folder to a deal — by folder ID (picked from the
 * list) or a pasted share link / folder path. Saves the folder's permanent ID
 * so renaming the folder later doesn't disconnect it. */
export async function pairDropboxFolder(transactionId, { folderId, link }) {
  const { data, error } = await supabase.functions.invoke("pair-dropbox-folder", {
    body: { action: "pair", transactionId, folderId, link },
  });
  if (error) throw await functionError(error);
  return data;
}

/** Broker-only, fire-and-forget: records the permanent folder ID for any deal
 * that only has a folder path saved so far. */
export async function backfillDropboxFolderIds() {
  const { data, error } = await supabase.functions.invoke("pair-dropbox-folder", { body: { action: "backfill" } });
  if (error) throw await functionError(error);
  return data;
}

/** Looks up and saves this deal's ZIP from its address (fill-zip-codes).
 * Returns the zip, or null if the address couldn't be matched. */
export async function fillZipCode(transactionId) {
  const { data, error } = await supabase.functions.invoke("fill-zip-codes", { body: { transactionId } });
  if (error) throw await functionError(error);
  return data?.zip ?? null;
}

/** Broker-only: fills every missing ZIP. Returns { filled, notFound }. */
export async function fillAllZipCodes() {
  const { data, error } = await supabase.functions.invoke("fill-zip-codes", { body: { all: true } });
  if (error) throw await functionError(error);
  return data;
}
