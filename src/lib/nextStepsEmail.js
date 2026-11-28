// "Congratulations! Next Steps!" — the email a buyer gets right after going
// under contract (Fran's template, Nov 2026). Built from the deal's dates;
// the agent can edit anything before it's sent.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "2026-08-25" → "August 25th" (or "TBD"). */
export function niceDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return "TBD";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${ordinal(d.getUTCDate())}`;
}

export function minusDays(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || "");
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] - days));
  return d.toISOString().slice(0, 10);
}

const money = (n) => (n ? `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Your");

/** The fields the agent can adjust before the body is built. */
export function nextStepsDefaults(tx) {
  const cd = Array.isArray(tx?.commission_data) ? tx.commission_data[0] : tx?.commission_data || {};
  return {
    depositAmount: cd?.deposit_amount ?? "",
    depositDate: cd?.deposit_due_date || "",
    secondDepositAmount: cd?.second_deposit === "Yes" ? cd?.second_deposit_amount ?? "" : "",
    secondDepositDate: cd?.second_deposit === "Yes" ? cd?.second_deposit_due_date || "" : "",
    inspectionDate: cd?.inspection_date || "",
    financingDate: cd?.financing_date || "",
    closingDate: tx?.next_date || "",
  };
}

export const nextStepsSubject = (tx) => `Congratulations! Next Steps! ${String(tx?.address || "").split(",")[0].trim()}`;

export function buildNextStepsHtml(tx, f, agentName) {
  const inspectBy = niceDate(minusDays(f.inspectionDate, 3));
  // No financing contingency (cash) → no lender step; the rest renumber.
  let n = 0;
  const step = () => `${++n})`;
  const lenderStep = f.financingDate
    ? `<p>${step()} Send your lender a copy of your Fully Executed contract (attached) - I already did this so they can get everything rolling.</p>\n`
    : "";
  const link = (href, text) => `<a href="${esc(href)}">${esc(text || href)}</a>`;
  const mail = (e) => link(`mailto:${e}`, e);
  const dates = [
    `<strong>${esc(niceDate(f.depositDate))}</strong> - ${esc(money(f.depositAmount))} Earnest Money Deposit Due - See instructions below`,
    f.secondDepositAmount || f.secondDepositDate ? `<strong>${esc(niceDate(f.secondDepositDate))}</strong> - ${esc(money(f.secondDepositAmount))} Second Earnest Money Deposit Due` : null,
    `<strong>${esc(niceDate(f.inspectionDate))}</strong> - Inspection Response Deadline - all the inspections should be done no later than ${esc(inspectBy)}.`,
    f.financingDate ? `<strong>${esc(niceDate(f.financingDate))}</strong> - Financing Commitment Date` : null,
    `<strong>${esc(niceDate(f.closingDate))}</strong> - Closing Date`,
  ].filter(Boolean);

  return `<p>Congratulations!! You did it!! Here is the whole next steps list and all the files for your records.</p>
<p><strong>Important Dates:</strong></p>
<p>${dates.join("<br>")}</p>
<p><strong>Next steps:</strong></p>
${lenderStep}<p>${step()} Send your ${f.depositAmount ? `${esc(money(f.depositAmount))} ` : ""}deposit to the listing agent - I will follow up with more instructions about this.</p>
<p>${step()} Contact an attorney and have them get started on title work - if you would like me to call and see who is free let me know. I will send them all the pieces they need to get started, but they will have you sign an engagement letter with their firm. Your attorney will do the title search, coordinate with your bank for mortgage documents and offer title insurance.</p>
<p><strong>Some recommendations:</strong></p>
<p>Brooke Trottier<br>(802) 889-9401<br>Kim - her assistant: ${mail("kim@btrottierlaw.com")}</p>
<p>Ben Percy<br>Davis Steadman Percy &amp; Sluka, LLC<br>${mail("Percy@whiteriverlawyers.com")}<br>(802) 295-5631 (Tel)</p>
<p>Jeff Lewis<br>JD Lewis Law<br>${mail("jeff@jdlewislaw.com")}</p>
<p>Kerry Rigas<br>${mail("kar@lawmaj.com")}</p>
<p>${step()} Inspections - Book inspections to be no later than ${esc(inspectBy)}. Inspectors generally take 1-2 days to get the report back so you need time to review. I can help you get booked if you are struggling to get in touch. Oftentimes it helps if I call. I will be there for all inspections and would recommend you be there as well so you can see more context of things, but I am happy to be there on your behalf if you can't make it.</p>
<p>Some recommendations for home inspectors: Expect somewhere between $600-$850 depending on what you want done</p>
<p>River Valley Home Inspections<br>${mail("ddrvhi@gmail.com")}<br>(603)-667-5616</p>
<p>Alex Solverson<br>(802) 777-0142<br>${link("https://www.whiteriverhomeinspection.com/about")}<br>- If you book Alex, book him online and use HallCollins as the code for 10% off</p>
<p>C3 Home Inspections<br>${link("https://c3propertyinspections.com/")} - you can book this one online<br>John Calamaio - ${mail("john@c3propertyinspections.com")}</p>
<p><strong>Septic Inspectors:</strong></p>
<p>VLK Septic Inspections<br>John - (603)-236-1334<br>${mail("jvlkseptic@gmail.com")}</p>
<p>Inspections by Eric<br>Eric Eichner<br>(603) 313-8600<br>${mail("inspectionsbyeric@yahoo.com")}</p>
<p>We will do a final walkthrough either the morning of ${esc(niceDate(f.closingDate))}, or the evening before depending on your work schedule and what time of day you want to close. I would recommend requesting at least a half day off work for closing since it can take a few hours.</p>
${f.financingDate ? "<p>Do not open any new lines of credit/buy a car/rock the boat with your credit in any way until after closing!</p>\n" : ""}<p>When we get about ~7-10 days out I will send you all the utility providers to contact to switch everything over to your name. Don't try to call too early or the utility folks get confused.</p>
<p>Let me know if you have any questions!</p>
${agentName ? `<p>${esc(agentName)}<br>Hall Collins Real Estate Group</p>` : ""}`;
}
