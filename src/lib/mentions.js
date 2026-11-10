import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

// Everyone who can be @-tagged in a to-do: every active roster member,
// including the transaction coordinator (fetchAgents() leaves her out, since
// it's the deal-owner picker). Fetched once per page load and shared.
let rosterPromise = null;
function loadRoster() {
  if (!rosterPromise) {
    rosterPromise = supabase
      .from("agents")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data, error }) => {
        if (error) throw error;
        return data || [];
      })
      .catch((e) => {
        rosterPromise = null; // let a later mount retry
        console.warn("Couldn't load the @-mention roster:", e.message);
        return [];
      });
  }
  return rosterPromise;
}

export function useMentionRoster() {
  const [roster, setRoster] = useState([]);
  useEffect(() => {
    let alive = true;
    loadRoster().then((r) => alive && setRoster(r));
    return () => {
      alive = false;
    };
  }, []);
  return roster;
}

export const firstName = (name) => name.split(/\s+/)[0];

/** What gets inserted for an agent: "@Rachel", or "@Rachel Noyes" if another
 * active person shares the first name (so notify-todo doesn't email both). */
export function mentionTokenFor(agent, roster) {
  const first = firstName(agent.name);
  const shared = roster.filter((a) => firstName(a.name).toLowerCase() === first.toLowerCase()).length > 1;
  return `@${shared ? agent.name : first}`;
}

/** Splits to-do text into plain strings and { mention, agent } parts, only for
 * @names that match a real roster member — same matching rules notify-todo
 * uses server-side (full name first, then first name). */
export function splitMentions(text, roster) {
  if (!text || !roster.length || !text.includes("@")) return [text];
  const parts = [];
  const re = /(^|\s)@([A-Za-z][A-Za-z'-]*)(?:\s+([A-Za-z][A-Za-z'-]*))?/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    const first = m[2].toLowerCase();
    const full = m[3] ? `${first} ${m[3].toLowerCase()}` : null;
    const fullMatch = full && roster.find((a) => a.name.toLowerCase() === full);
    const firstMatch = !fullMatch && roster.find((a) => firstName(a.name).toLowerCase() === first);
    if (!fullMatch && !firstMatch) continue;
    const tokenLen = fullMatch ? m[0].length - m[1].length : 1 + m[2].length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ mention: text.slice(start, start + tokenLen), agent: fullMatch || firstMatch });
    last = start + tokenLen;
    re.lastIndex = last;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
