// What each agent's profile still needs — shown to brokers at the top of the
// To-Dos tab (DealPages → AllTodosPage), clears itself once it's filled in on
// Manage Agents. Hall Collins requires a Vermont license for everyone; New
// Hampshire is optional ("Not licensed in NH" turns those checks off).

const has = (v) => v != null && String(v).trim() !== "";

function todayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

/** ["VT license copy", …] — empty when the profile is complete. */
export function agentMissingItems(agent) {
  if (!agent || agent.is_active === false || agent.role === "coordinator") return [];
  const out = [];
  if (!has(agent.email)) out.push("Email");
  if ("vt_license_expires" in agent) {
    const today = todayYmd();
    if (!has(agent.vt_license_expires)) out.push("VT license expiration");
    else if (agent.vt_license_expires < today) out.push("VT license EXPIRED");
    if (!has(agent.vt_license_path)) out.push("VT license copy");
    if (!agent.nh_not_licensed) {
      if (!has(agent.nh_license_expires)) out.push("NH license expiration (or check “Not licensed in NH”)");
      else if (agent.nh_license_expires < today) out.push("NH license EXPIRED");
      if (!has(agent.nh_license_path)) out.push("NH license copy");
    }
  }
  if (!has(agent.cover_sheet_url)) out.push("Cover sheet");
  if (!has(agent.dropbox_listing_path)) out.push("Dropbox listing folder");
  if (!has(agent.dropbox_buyer_path)) out.push("Dropbox buyer folder");
  return out;
}
