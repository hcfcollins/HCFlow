// Creates an ACCREC Invoice in Xero for an anticipated earnest money deposit —
// one per deposit (first and/or second) — the moment Under Contract is
// submitted, so there's a record to reconcile the real deposit against once
// it actually clears into the trust account. Addressed to the buyer (found or
// created as a Contact by name) and coded to the region's trust liability
// account: 2001 (VT Earnest Money Held) or 2002 (NH Earnest Money Held).
//
// Same Xero Custom Connection (client_credentials grant) as xero-push-closeout
// — duplicated helpers here rather than shared, matching this project's
// existing per-function style (see create-dropbox-folder / relist-listing).
//
// Expects POST { address, region, buyer_name, closing_date, deposits: [{ label,
// amount, due_date }] } — see pushDepositsToXero in src/lib/transactions.js
// for the exact shape.
//
// First build, untested against live Xero data — same caveats as
// xero-push-closeout (Contacts `where` filter syntax, Items/account codes).

const XERO_CLIENT_ID = Deno.env.get("XERO_CLIENT_ID")!;
const XERO_CLIENT_SECRET = Deno.env.get("XERO_CLIENT_SECRET")!;

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

async function getXeroAccessToken(): Promise<string> {
  const basic = btoa(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`);
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "accounting.contacts accounting.invoices",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Xero token request failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function getXeroTenantId(accessToken: string): Promise<string> {
  const res = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Xero connections lookup failed: ${JSON.stringify(data)}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("No Xero organisation is connected to this Custom Connection yet");
  }
  return data[0].tenantId;
}

async function xeroFetch(accessToken: string, tenantId: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Xero API ${path} failed: ${JSON.stringify(data)}`);
  return data;
}

async function findOrCreateContact(accessToken: string, tenantId: string, name: string): Promise<string> {
  const escaped = name.replace(/"/g, '\\"');
  const found = await xeroFetch(accessToken, tenantId, `/Contacts?where=${encodeURIComponent(`Name=="${escaped}"`)}`);
  if (found.Contacts?.length) return found.Contacts[0].ContactID;

  const created = await xeroFetch(accessToken, tenantId, "/Contacts", {
    method: "PUT",
    body: JSON.stringify({ Contacts: [{ Name: name }] }),
  });
  return created.Contacts[0].ContactID;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  try {
    const payload = await req.json();
    const { address, region, buyer_name, closing_date, deposits } = payload;

    if (!buyer_name) {
      return jsonResponse({ ok: true, skipped: "No buyer name on file yet" });
    }
    if (!Array.isArray(deposits) || deposits.length === 0) {
      return jsonResponse({ ok: true, skipped: "No deposit amounts to record" });
    }

    const accessToken = await getXeroAccessToken();
    const tenantId = await getXeroTenantId(accessToken);
    const buyerContactId = await findOrCreateContact(accessToken, tenantId, buyer_name);
    const accountCode = region === "NH" ? "2002" : "2001";
    const date = new Date().toISOString().slice(0, 10);

    const results: unknown[] = [];
    for (const deposit of deposits) {
      if (!deposit.amount) continue;
      const body = {
        Invoices: [
          {
            Type: "ACCREC",
            Contact: { ContactID: buyerContactId },
            Date: date,
            DueDate: deposit.due_date || closing_date || date,
            Reference: `${deposit.label} - ${address}`,
            Status: "AUTHORISED",
            CurrencyCode: "USD",
            LineAmountTypes: "NoTax",
            LineItems: [
              {
                Description: deposit.label,
                Quantity: 1,
                UnitAmount: deposit.amount,
                AccountCode: accountCode,
              },
            ],
          },
        ],
      };
      results.push(await xeroFetch(accessToken, tenantId, "/Invoices", { method: "POST", body: JSON.stringify(body) }));
    }

    return jsonResponse({ ok: true, results });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
