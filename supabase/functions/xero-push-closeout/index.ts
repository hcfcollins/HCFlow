// Creates the Sales Invoice (gross commission, ACCREC) and up to 5 per-payee
// Bills (Referral/Holly/Fran/Agent/TC Fee, ACCPAY — one each, skipped when
// there's nothing to pay) directly in Xero when a deal closes. Each Bill is
// addressed to its real payee (not bundled under Hall Collins itself), so it
// matches exactly one Gusto payout 1:1 for bank reconciliation — Gusto is run
// per-transaction, never batched.
//
// This replaces the old Google Sheet -> Zapier -> Xero relay for the Xero
// side specifically. The Deal Tracker Form sheet push (push-closeout-to-sheet)
// still happens separately — other automations (deposit/inspection/financing
// reminder emails) still read from that sheet. The OLD "Create Xero Invoice
// and Bills" Zap should be turned OFF once this is confirmed working, or
// every closeout will double-post to Xero.
//
// Uses a Xero Custom Connection (OAuth2 client_credentials grant — no
// per-request user consent, exactly one connected org) rather than a full
// multi-tenant OAuth app, since this is a single company's own integration.
//
// Expects POST with the same payload shape CloseoutCalculator.jsx's
// buildSheetPayload() already produces for push-closeout-to-sheet.
//
// First build, never tested against live Xero data yet — the Contact
// lookup/creation `where` filter syntax and the Items (ItemCode) behavior are
// the two things most likely to need adjustment once tried for real; check
// the response `results` or any `error` closely on the first live closeout.

const XERO_CLIENT_ID = Deno.env.get("XERO_CLIENT_ID")!;
const XERO_CLIENT_SECRET = Deno.env.get("XERO_CLIENT_SECRET")!;

const HC_CONTACT_NAME = "Hall Collins Real Estate Group";

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

/** Finds a Contact by exact name, creating one if it doesn't exist yet —
 * lets every payee (including a referral recipient who's never been paid
 * before) get billed correctly without Fran having to pre-create them. */
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

async function createInvoice(
  accessToken: string,
  tenantId: string,
  opts: {
    type: "ACCREC" | "ACCPAY";
    contactId: string;
    date: string;
    dueDate: string;
    reference: string;
    description: string;
    amount: number;
    accountCode: string;
  }
) {
  const body = {
    Invoices: [
      {
        Type: opts.type,
        Contact: { ContactID: opts.contactId },
        Date: opts.date,
        DueDate: opts.dueDate,
        Reference: opts.reference,
        Status: "AUTHORISED",
        CurrencyCode: "USD",
        LineAmountTypes: "NoTax",
        LineItems: [
          {
            Description: opts.description,
            Quantity: 1,
            UnitAmount: opts.amount,
            AccountCode: opts.accountCode,
          },
        ],
      },
    ],
  };
  return xeroFetch(accessToken, tenantId, "/Invoices", { method: "POST", body: JSON.stringify(body) });
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
    const accessToken = await getXeroAccessToken();
    const tenantId = await getXeroTenantId(accessToken);

    const date = payload.closing_date || new Date().toISOString().slice(0, 10);
    const results: Record<string, unknown> = {};

    if (payload.total_commission_check) {
      const hcContactId = await findOrCreateContact(accessToken, tenantId, HC_CONTACT_NAME);
      results.invoice = await createInvoice(accessToken, tenantId, {
        type: "ACCREC",
        contactId: hcContactId,
        date,
        dueDate: date,
        reference: payload.address,
        description: "Gross Commission per CD",
        amount: payload.total_commission_check,
        accountCode: payload.vt_or_nh === "NH" ? "4001" : "4000",
      });
    }

    // One Bill per payee — skipped whenever there's no amount or no name to
    // bill, so e.g. an owner deal with no agent, or a deal with no referral,
    // never creates an empty/malformed Bill.
    const bills = [
      {
        key: "referral",
        amount: payload.referral_amount,
        contactName: payload.referral_owed_to,
        description: "REFER",
        accountCode: "5100",
        reference: payload.referral_reference,
      },
      {
        key: "holly",
        amount: payload.holly_commission,
        contactName: "Holly Hall",
        description: "PAYOUT Holly",
        accountCode: "5000",
        reference: payload.commission_reference,
      },
      {
        key: "fran",
        amount: payload.fran_commission,
        contactName: "Fran Collins",
        description: "PAYOUT Fran",
        accountCode: "5000",
        reference: payload.commission_reference,
      },
      {
        key: "agent",
        amount: payload.agent_commission,
        contactName: payload.agent_name,
        description: "PAYOUT - Agent",
        accountCode: "5000",
        reference: payload.commission_reference,
      },
      {
        key: "tc_fee",
        amount: payload.tc_fee,
        contactName: payload.tc_fee_payee_name,
        description: "Transaction Coordinator Fee",
        accountCode: "5000",
        reference: payload.tc_fee_reference,
      },
    ];

    for (const bill of bills) {
      if (!bill.amount || !bill.contactName) continue;
      const contactId = await findOrCreateContact(accessToken, tenantId, bill.contactName);
      results[bill.key] = await createInvoice(accessToken, tenantId, {
        type: "ACCPAY",
        contactId,
        date,
        dueDate: date,
        reference: bill.reference,
        description: bill.description,
        amount: bill.amount,
        accountCode: bill.accountCode,
      });
    }

    return jsonResponse({ ok: true, results });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
