// Saves deals parsed by dealImportParse.js (the old Google Sheet Deal Tracker).
import { supabase } from "./supabaseClient";
import { resolveAttorneyId, fetchAttorneys, fillAllZipCodes, linkDealSides, addUpcomingContractTodos, addActivityLog, upsertCommissionData } from "./transactions";

export { parseDealTracker, addressKey, yearOf, IMPORT_SHEET_NAME } from "./dealImportParse";
export const IMPORT_ACTIVITY_LABEL = "Imported from Deal Tracker";

/** Creates the selected deals one at a time. onProgress(done, total, address).
 * Returns { created: [ids], failed: [{ address, error }] }. */
export async function importDeals(deals, onProgress) {
  let attorneys = await fetchAttorneys();
  const attorneyId = async (name) => {
    if (!name) return null;
    const id = await resolveAttorneyId(name, attorneys);
    if (!attorneys.some((a) => a.id === id)) attorneys = [...attorneys, { id, name }];
    return id;
  };

  const created = [];
  const failed = [];
  const pairIds = new Map(); // Split deal pairId → the two new deal ids
  for (let i = 0; i < deals.length; i++) {
    const d = deals[i];
    onProgress?.(i, deals.length, d.address);
    try {
      const notes = [d.notes, d.deposit.note].filter(Boolean).join("\n");
      const { data: tx, error } = await supabase
        .from("transactions")
        .insert({
          address: d.address,
          region: d.region,
          side: d.side,
          agent_id: d.agentId,
          stage: d.status === "closed" ? "closed" : "contract",
          next_date: d.closingDate,
          seller_name: d.sellerName,
          buyer_name: d.buyerName,
          price: d.price,
          property_style: d.propertyStyle,
          notes,
          seller_attorney_id: await attorneyId(d.sellerAttorney),
          buyer_attorney_id: await attorneyId(d.buyerAttorney),
          ...(d.status === "terminated"
            ? { terminated_at: `${d.closingDate}T12:00:00Z`, termination_reason: "Terminated (imported from Deal Tracker)" }
            : {}),
        })
        .select("id")
        .single();
      if (error) throw error;

      const { error: cdError } = await supabase.from("commission_data").upsert({
        transaction_id: tx.id,
        lead_type: d.leadType,
        client_source: d.clientSource,
        referral_pct: d.referralPct,
        hold_deposit: d.deposit.hold,
        deposit_amount: d.deposit.amount,
        inspection_date: d.inspectionDate,
        financing_date: d.financingDate,
        appraiser: d.appraiser,
        updated_at: new Date(),
      });
      if (cdError) throw cdError;

      const closeout = {
        transaction_id: tx.id,
        price: d.price,
        commission_pct: d.commissionPct,
        lead_type: d.leadType,
        referral_pct: d.referralPct,
        ...(d.status === "closed" ? { ...d.money, is_historical_import: true, check_received: "Yes" } : {}),
      };
      const { error: coError } = await supabase.from("closeouts").insert(closeout);
      if (coError) throw coError;

      await supabase
        .from("activity_log")
        .insert({ transaction_id: tx.id, label: IMPORT_ACTIVITY_LABEL, detail: `Sheet row${d.rowNums.length > 1 ? "s" : ""} ${d.rowNums.join(" & ")}` });
      created.push(tx.id);
      if (d.pairId) pairIds.set(d.pairId, [...(pairIds.get(d.pairId) || []), tx.id]);
    } catch (e) {
      failed.push({ address: d.address, error: e.message || String(e) });
    }
  }
  // Link the two sides of each Split deal to each other.
  for (const ids of pairIds.values()) {
    if (ids.length === 2) {
      try {
        await linkDealSides(ids[0], ids[1]);
      } catch (e) {
        console.error("Couldn't link the two sides of a Split deal:", e);
      }
    }
  }
  onProgress?.(deals.length, deals.length, null);
  // Zip + town from the address, in the background (can take a minute).
  fillAllZipCodes().catch((e) => console.error("ZIP/town lookup after import failed:", e));
  return { created, failed };
}

const TODOS_ADDED_LABEL = "Upcoming to-dos added";

/** Finishing touches for imported deals — run after an import and once per
 * broker session (so the deals imported before this existed get it too):
 *  - Under Contract: add the dated to-dos (closing, walkthrough, contingency
 *    deadlines…) whose dates haven't passed yet. Once per deal, so a to-do
 *    someone deleted on purpose doesn't come back.
 *  - A blank inspection date in the Deal Tracker means there was no
 *    inspection → "Waived / no inspection" (once that column exists).
 * Returns true if anything changed. */
export async function finishImportedDeals(transactions) {
  const imported = (transactions || []).filter(
    (t) => !t.terminated_at && (t.activity_log || []).some((a) => a.label === IMPORT_ACTIVITY_LABEL)
  );
  let changed = false;
  for (const tx of imported) {
    const cd = tx.commission_data;
    try {
      if (cd && "inspection_waived" in cd && !cd.inspection_date && !cd.inspection_waived) {
        await upsertCommissionData(tx.id, { inspection_waived: true });
        cd.inspection_waived = true;
        changed = true;
      }
      if (tx.stage === "contract" && !(tx.activity_log || []).some((a) => a.label === TODOS_ADDED_LABEL)) {
        const added = await addUpcomingContractTodos(tx);
        await addActivityLog(tx.id, TODOS_ADDED_LABEL, added ? `${added} to-do${added === 1 ? "" : "s"} with upcoming due dates` : "Nothing upcoming");
        changed = true;
      }
    } catch (e) {
      console.error(`Couldn't finish setting up imported deal ${tx.address}:`, e);
    }
  }
  return changed;
}
