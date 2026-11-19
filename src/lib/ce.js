// CE (continuing education) tracker + agent license renewals.
//
// Agents upload their own CE certificates (state, mandatory/elective, hours)
// and renewed license copies; both wait as "pending" until Fran reviews them
// (review card on her main screen). Only approved credits count toward the
// requirement. Files live in the private agent-licenses bucket in the agent's
// own folder ("<agent id>/ce-….pdf").
//
// Requirements (hours per 2-year license cycle) are editable on the CE page —
// stored in ce_requirements. Defaults: VT salesperson 16 (4 mandatory), VT
// broker 24 (4 mandatory), NH 15 (3 mandatory core).
import { supabase } from "./supabaseClient";
import { updateAgentFields, syncAgentDocsToDropbox } from "./transactions";

export const REVIEWER_EMAIL = "fran.collins@hallcollins.com";
export const DEFAULT_REQUIREMENTS = {
  "VT-salesperson": { label: "Vermont salesperson", mandatory_hours: 4, elective_hours: 12 },
  "VT-broker": { label: "Vermont broker", mandatory_hours: 4, elective_hours: 20 },
  NH: { label: "New Hampshire", mandatory_hours: 3, elective_hours: 12 },
};
export const STATE_NAMES = { VT: "Vermont", NH: "New Hampshire" };

const extOf = (file) => (file.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";

async function putFile(path, file) {
  const { error } = await supabase.storage.from("agent-licenses").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: true });
  if (error) throw new Error(/row-level security|not authorized|Unauthorized/i.test(error.message) ? "Uploads aren't switched on yet — Fran needs to run the CE tracker SQL." : error.message);
}

const changed = () => window.dispatchEvent(new Event("hcflow:ce-changed"));
const tableMissing = (e) => /ce_credits|ce_requirements|license_submissions|schema cache|does not exist/i.test(e?.message || "");

export async function fetchRequirements() {
  const { data, error } = await supabase.from("ce_requirements").select("*");
  if (error) {
    if (tableMissing(error)) return { ...DEFAULT_REQUIREMENTS, _missing: true };
    throw error;
  }
  const out = { ...DEFAULT_REQUIREMENTS };
  for (const r of data || []) out[r.key] = r;
  return out;
}

export async function saveRequirement(key, patch) {
  const { error } = await supabase.from("ce_requirements").upsert({ key, label: DEFAULT_REQUIREMENTS[key]?.label || key, ...patch, updated_at: new Date() }, { onConflict: "key" });
  if (error) throw error;
  changed();
}

/** CE credits — one agent's, or everyone's (brokers) when agentId is null. */
export async function fetchCeCredits(agentId = null) {
  let q = supabase.from("ce_credits").select("*").order("completed_on", { ascending: false, nullsFirst: false });
  if (agentId) q = q.eq("agent_id", agentId);
  const { data, error } = await q;
  if (error) {
    if (tableMissing(error)) return [];
    throw error;
  }
  return data || [];
}

export async function fetchLicenseSubmissions(agentId = null) {
  let q = supabase.from("license_submissions").select("*").order("created_at", { ascending: false });
  if (agentId) q = q.eq("agent_id", agentId);
  const { data, error } = await q;
  if (error) {
    if (tableMissing(error)) return [];
    throw error;
  }
  return data || [];
}

/** Agent uploads a CE certificate → pending review (auto-approved when the
 * reviewer uploads her own). */
export async function submitCeCredit(agent, { state, creditType, courseName, hours, completedOn, file }, { autoApprove = false } = {}) {
  const path = `${agent.id}/ce-${state}-${Date.now()}.${extOf(file)}`;
  await putFile(path, file);
  const row = {
    agent_id: agent.id,
    state,
    credit_type: creditType,
    course_name: courseName || null,
    hours: Number(hours),
    completed_on: completedOn || null,
    file_path: path,
    status: autoApprove ? "approved" : "pending",
    reviewed_at: autoApprove ? new Date() : null,
  };
  const { error } = await supabase.from("ce_credits").insert(row);
  if (error) throw new Error(tableMissing(error) ? "The CE tracker isn't switched on yet — Fran needs to run the CE tracker SQL." : error.message);
  changed();
}

export async function deleteCeCredit(id) {
  const { error } = await supabase.from("ce_credits").delete().eq("id", id);
  if (error) throw error;
  changed();
}

export async function reviewCeCredit(id, status, note = null) {
  const { data, error } = await supabase.from("ce_credits").update({ status, review_note: note, reviewed_at: new Date() }).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't save the review (broker only).");
  changed();
}

/** Agent uploads a renewed license → pending until Fran approves it. */
export async function submitLicense(agent, { state, expires, licenseNumber, file }) {
  const path = `${agent.id}/${state.toUpperCase()}-license-submitted-${Date.now()}.${extOf(file)}`;
  await putFile(path, file);
  const { error } = await supabase.from("license_submissions").insert({ agent_id: agent.id, state, file_path: path, expires: expires || null, license_number: licenseNumber || null });
  if (error) throw new Error(tableMissing(error) ? "License uploads aren't switched on yet — Fran needs to run the CE tracker SQL." : error.message);
  changed();
}

/** Approve → it becomes the agent's license on file (copy, expiration,
 * number) and is copied to Dropbox like a Manage Agents upload. */
export async function reviewLicense(sub, status, note = null) {
  if (status === "approved") {
    const patch = { [`${sub.state}_license_path`]: sub.file_path };
    if (sub.expires) patch[`${sub.state}_license_expires`] = sub.expires;
    if (sub.license_number && sub.state !== "broker") patch[`${sub.state}_license_number`] = sub.license_number;
    await updateAgentFields(sub.agent_id, patch);
  }
  const { data, error } = await supabase.from("license_submissions").update({ status, review_note: note, reviewed_at: new Date() }).eq("id", sub.id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Couldn't save the review (broker only).");
  if (status === "approved") syncAgentDocsToDropbox({ agentId: sub.agent_id, kind: sub.state }).catch((e) => console.error("License Dropbox copy failed:", e));
  changed();
}

/** States an agent is licensed in, with the requirement that applies. */
export function licensedStates(agent) {
  if (!agent || agent.role === "coordinator") return [];
  const out = [{ state: "VT", key: agent.role === "broker" ? "VT-broker" : "VT-salesperson" }];
  if (!agent.nh_not_licensed) out.push({ state: "NH", key: "NH" });
  return out;
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

/** This license cycle: the 2 years before the license's expiration (or the
 * last 2 years if no expiration is on file). */
export function cycleFor(agent, state) {
  const exp = agent?.[`${state.toLowerCase()}_license_expires`];
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp || "")) {
    const [y, m, d] = exp.split("-").map(Number);
    return { start: ymd(new Date(Date.UTC(y - 2, m - 1, d))), end: exp, fromLicense: true };
  }
  const now = new Date();
  return { start: ymd(new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate()))), end: null, fromLicense: false };
}

/** Where an agent stands in one state: approved hours (extra mandatory hours
 * count toward electives), plus what's still waiting on review. */
export function ceProgress(agent, state, reqKey, credits, requirements) {
  const req = requirements[reqKey] || DEFAULT_REQUIREMENTS[reqKey];
  const needM = Number(req.mandatory_hours) || 0;
  const needE = Number(req.elective_hours) || 0;
  const cycle = cycleFor(agent, state);
  const inCycle = credits.filter((c) => c.agent_id === agent.id && c.state === state && String(c.completed_on || c.created_at).slice(0, 10) > cycle.start);
  const sum = (list, type) => list.filter((c) => c.credit_type === type).reduce((n, c) => n + (Number(c.hours) || 0), 0);
  const approved = inCycle.filter((c) => c.status === "approved");
  const pending = inCycle.filter((c) => c.status === "pending");
  const m = sum(approved, "mandatory");
  const e = sum(approved, "elective");
  const mandatoryDone = Math.min(m, needM);
  const electiveDone = Math.min(e + Math.max(0, m - needM), needE);
  const need = needM + needE;
  const done = mandatoryDone + electiveDone;
  const pendingHours = pending.reduce((n, c) => n + (Number(c.hours) || 0), 0);
  return { state, label: req.label, needM, needE, need, mandatoryDone, electiveDone, done, pendingHours, complete: done >= need, cycle };
}

export const fmtHours = (n) => (Math.round(n * 10) / 10).toString();
