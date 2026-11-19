// "✨ Polish" for the CMA's Agent Notes: Claude tidies an agent's rough notes
// into Hall Collins' usual flow — a compliment, then any hurdles, then
// excitement about listing and a marketing package tailored to the property.
// Returns a suggestion only; the agent decides whether to use it.
//
// Style examples: the longest Agent Notes already saved on other comps, so
// the output drifts toward how the team actually writes as more get saved.
//
// POST { notes, property } (signed-in user) → { text }
// Needs the ANTHROPIC_API_KEY secret.

import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SYSTEM = `You polish a real estate agent's rough notes into the "Agent Notes" section of a Comparative Market Analysis (CMA) from Hall Collins Real Estate Group, a brokerage in Vermont and New Hampshire. The reader is the homeowner who is deciding whether to list with us, so it should feel personal and honest, not like an ad.

Write it as flowing prose in 2-4 short paragraphs (no headings, bullets, or sign-off), following this order:
1. Open with a sincere, specific compliment about the property, drawn from the notes and property details.
2. Address any potential hurdles candidly and constructively: condition, repairs, layout, location, access, septic/well, market timing, pricing expectations, and so on. Frame each as something we'll plan around, and say how when the notes suggest it. If the notes raise no hurdles, keep this short rather than inventing problems.
3. Close with genuine excitement about listing the property and how we customize our marketing package to fit this particular property, naming what we'd highlight.

Keep every fact from the notes. Don't add facts, numbers, features, or prices that aren't in the notes or property details. Write in the agent's own voice: warm, friendly, plain-spoken and confident, using "we" for Hall Collins. Fix grammar and flow, but keep it natural rather than salesy or flowery. Aim for roughly the length of the notes, up to about double if the notes are very terse. Reply with only the finished text.`;

async function signedIn(req: Request): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` } });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  if (!user?.email) return false;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agents?email=ilike.${encodeURIComponent(user.email)}&is_active=eq.true&select=id`, { headers: svc });
  return Boolean((await res.json())?.length);
}

/** Up to 3 real Agent Notes from other comps (longest first) as style samples. */
async function styleExamples(): Promise<string[]> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/transactions?select=comp_analysis&comp_analysis=not.is.null&limit=300`, { headers: svc });
    const rows = await res.json();
    return (rows || [])
      .map((r: { comp_analysis?: { agentNotes?: string } }) => String(r.comp_analysis?.agentNotes || "").trim())
      .filter((t: string) => t.length >= 250)
      .sort((a: string, b: string) => b.length - a.length)
      .slice(0, 3);
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await signedIn(req))) return json({ error: "Not signed in" }, 401);
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "AI polishing isn't set up yet — the ANTHROPIC_API_KEY secret needs to be added in Supabase." }, 500);

    const { notes, property } = await req.json();
    const rough = String(notes || "").trim();
    if (!rough) return json({ error: "Write some notes first, then polish them." }, 400);

    const details = Object.entries(property || {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && !v.length))
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\n");
    const examples = await styleExamples();

    const prompt = [
      examples.length
        ? `<style_examples>\nAgent Notes the team has written before, for voice and rhythm only (don't reuse their facts):\n${examples.map((e) => `<example>\n${e}\n</example>`).join("\n")}\n</style_examples>`
        : null,
      `<property_details>\n${details || "(none given)"}\n</property_details>`,
      `<rough_notes>\n${rough}\n</rough_notes>`,
      "Polish these notes for the CMA.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const client = new Anthropic();
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // Re-runs on a fallback model if a safety classifier declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") return json({ error: "The AI couldn't polish these notes — try rewording them." }, 422);
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!text) return json({ error: "The AI came back empty — try again." }, 502);
    return json({ text });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return json({ error: "The Anthropic API key isn't valid — check the ANTHROPIC_API_KEY secret." }, 500);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "The AI is busy — try again in a minute." }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `AI error (${e.status}): ${e.message}` }, 502);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
