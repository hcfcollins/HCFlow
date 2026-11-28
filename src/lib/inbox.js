// flow@hallcollins.com inbox — see supabase/functions/inbound-docs.
import { supabase } from "./supabaseClient";

export const INBOX_ADDRESS = "flow@hallcollins.com";
export const INBOX_CHANGED = "hcflow:inbox-changed";

async function call(body) {
  const { data, error } = await supabase.functions.invoke("inbound-docs", { body });
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

/** Documents waiting to be filed (newest first), or { missing } before the SQL is run. */
export async function fetchInbox() {
  const { data, error } = await supabase
    .from("inbound_docs")
    .select("*")
    .in("status", ["pending", "processing"])
    .order("received_at", { ascending: false })
    .limit(50);
  if (error) return { docs: [], missing: /inbound_docs|schema cache|does not exist/i.test(error.message) };
  return { docs: data || [], missing: false };
}

export const pollInbox = () => call({ action: "poll" });
export const fileInboxDoc = (id, transactionId, docName) => call({ action: "file", id, transactionId, docName });
export const dismissInboxDoc = (id) => call({ action: "dismiss", id });

/** The scan itself, for a quick look before filing. */
export async function viewInboxDoc(id) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbound-docs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "view", id }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `Couldn't open it (${res.status})`);
  return res.blob();
}

/** A file picked/dropped in the app goes through the same reading + matching. */
export async function uploadToInbox(file) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/inbound-docs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      "Content-Type": "application/octet-stream",
      "x-action": "upload",
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Upload failed (${res.status})`);
  return data;
}

/** What to file it as, from what Claude saw. */
export const defaultDocName = (doc) => (doc.doc_type === "commission_check" ? "Commission Check" : "Closing Docs");
