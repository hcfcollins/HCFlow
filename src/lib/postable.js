// Postable (mailed cards) — see supabase/functions/postable-sync.
import { supabase } from "./supabaseClient";

async function call(body) {
  const { data, error } = await supabase.functions.invoke("postable-sync", { body });
  if (error) {
    let msg = error.message;
    try {
      msg = (await error.context.json())?.error || msg;
    } catch {
      // not JSON
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export const postableStatus = () => call({ action: "status" });
export const connectPostable = (email, password) => call({ action: "connect", email, password });
/** Adds/updates the deal's buyers in Postable. → { ok, action, name, group } or { skipped } */
export const syncDealToPostable = (transactionId) => call({ action: "sync", transactionId });
