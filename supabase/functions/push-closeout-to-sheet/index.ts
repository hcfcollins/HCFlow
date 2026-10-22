// Forwards a closed deal's fully pre-calculated numbers to the "push closeout"
// Zap (Catch Hook -> Create Spreadsheet Row in the "Deal Tracker Form" sheet),
// which the existing, unmodified "Create Xero Invoice and Bills" Zap watches.
//
// "Check Received" is deliberately never part of this payload — Fran flips
// that cell to "Cashed Out" herself, in the sheet, once the check actually
// clears. That's what fires the Xero automation; this function only ever
// gets the row sitting there ready for her, never touches Xero directly.
//
// Just forwards the given JSON body as-is — see CloseoutCalculator.jsx
// (buildSheetPayload) for the exact field shape/meaning of each key.
//
// Needs ZAPIER_CLOSEOUT_WEBHOOK_URL set as an Edge Function secret once Fran's
// created the new Zap and has its Catch Hook URL.

const ZAPIER_CLOSEOUT_WEBHOOK_URL = Deno.env.get("ZAPIER_CLOSEOUT_WEBHOOK_URL");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  if (!ZAPIER_CLOSEOUT_WEBHOOK_URL) {
    return jsonResponse(
      { error: "ZAPIER_CLOSEOUT_WEBHOOK_URL isn't set yet — set it once the new Zap's Catch Hook URL exists." },
      500
    );
  }

  try {
    const payload = await req.json();
    const res = await fetch(ZAPIER_CLOSEOUT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Zapier webhook returned ${res.status}: ${await res.text()}`);
    return jsonResponse({ ok: true });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
