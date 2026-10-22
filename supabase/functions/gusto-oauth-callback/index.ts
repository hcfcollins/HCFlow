// Handles the redirect back from Gusto's OAuth consent screen. Gusto sends the
// browser here with ?code=... — this exchanges that one-time code for a
// refresh token (long-lived) and access token (2hr, per Gusto's docs), and
// saves them to the single-row gusto_connection table so the actual payroll-push
// function (not built yet) can use the refresh token to mint fresh access
// tokens on demand, without a human in the loop again.
//
// This is a browser redirect target, not something the app calls via
// supabase-js — it must respond with an actual HTML page, not JSON.
//
// Register this exact URL as the app's Redirect URI in the Gusto developer
// portal: https://<project>.supabase.co/functions/v1/gusto-oauth-callback
//
// Needs these secrets set before this will work (see Build Spec / ask Fran for
// the Client ID + Secret once she's created the Gusto application):
//   GUSTO_CLIENT_ID, GUSTO_CLIENT_SECRET, GUSTO_REDIRECT_URI,
//   GUSTO_API_BASE (https://api.gusto-demo.com while testing, https://api.gusto.com once live)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GUSTO_CLIENT_ID = Deno.env.get("GUSTO_CLIENT_ID")!;
const GUSTO_CLIENT_SECRET = Deno.env.get("GUSTO_CLIENT_SECRET")!;
const GUSTO_REDIRECT_URI = Deno.env.get("GUSTO_REDIRECT_URI")!;
const GUSTO_API_BASE = Deno.env.get("GUSTO_API_BASE") || "https://api.gusto-demo.com";

function htmlResponse(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><body style="font-family: sans-serif; max-width: 480px; margin: 60px auto; text-align: center;">${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html" } }
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return htmlResponse(`<h2>Gusto connection failed</h2><p>${oauthError}</p>`, 400);
  }
  if (!code) {
    return htmlResponse(`<h2>Missing authorization code</h2><p>Gusto didn't send a code back — try connecting again.</p>`, 400);
  }

  try {
    const tokenRes = await fetch(`${GUSTO_API_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: GUSTO_CLIENT_ID,
        client_secret: GUSTO_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: GUSTO_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return htmlResponse(`<h2>Gusto token exchange failed</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre>`, 500);
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 7200) * 1000).toISOString();

    // Singleton row (id fixed to 1) — this app only ever connects to one Gusto
    // company (Hall Collins' own), so there's nothing to key this on.
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/gusto_connection`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: 1,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upsertRes.ok) {
      return htmlResponse(`<h2>Saved tokens failed</h2><pre>${await upsertRes.text()}</pre>`, 500);
    }

    return htmlResponse(`<h2>✅ Gusto connected</h2><p>You can close this tab and go back to HC Flow.</p>`);
  } catch (e) {
    return htmlResponse(`<h2>Unexpected error</h2><pre>${String(e)}</pre>`, 500);
  }
});
