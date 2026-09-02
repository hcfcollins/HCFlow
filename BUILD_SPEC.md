# Hall Collins Real Estate Group — Transaction Dashboard Build Spec

This document consolidates everything decided in planning so it can be handed to Claude Code (or any dev) as a single source of truth. A working prototype (mock data, no backend) exists as `hall_collins_dashboard.jsx` — this spec describes what to build for real.

---

## 1. Company Context

- **Company**: Hall Collins Real Estate Group — Vermont-based, also licensed in New Hampshire (VT is primary market).
- **Owners**: Franchesca "Fran" Collins and Holly Hall (co-owners/brokers, both also producing agents).
- **Current tools**: dotloop (contracts, VT Association templates — NOT to be integrated, too unreliable), Dropbox (file storage), Google Sheets (protected deal tracker with commission data — Fran/Holly access only), Gmail, Zapier, Xero (accounting), Gusto (payroll).
- **Brand**: Primary Pink `#C7155B`, Primary Navy `#173348`, Light Blush Pink `#F2B2C1`, Light Blue `#D7E2EF`, Warm Grey `#D7D1C2`, Sage Green `#A4B792`. Logo font: Playfair Display. Body font: Montserrat. Logo is a circular flower/key mark with full-text lockup variant.

## 2. Core Problem Being Solved

Manual, error-prone processes across:
1. Transaction coordination (a TC currently does this manually and inconsistently)
2. Social media (a social media person often misses posting)
3. Commission/close-out math (currently a fragile Google Sheet with broken formula references, `#REF!` errors)
4. Attorney/document tracking (info often unknown at contract time, same handful of attorneys reused)
5. Dual-agency deals creating confusing duplicate-looking rows in the deal tracker

## 3. Architecture Decisions

- **Frontend**: Mobile-first Progressive Web App (PWA) — installable via "Add to Home Screen" on iOS/Android, no native App Store build needed for v1.
- **Backend/DB**: Supabase (Postgres + Auth + Storage). Free tier is sufficient at this team's scale (well under 50k MAU, small dataset).
- **Auth**: Google Sign-In only. Deliberately chosen because: (a) team is already Gmail-based, (b) revoking a departed agent's Google Workspace access automatically cuts off app access — no separate account cleanup needed.
- **Roles**: `broker` (Fran, Holly — full visibility, all-agents toggle, commission data, agent/attorney management, close-out calculator) vs `agent` (own deals only, no commission visibility).
- **Documents**: Dropbox remains the file storage system of record. NOT syncing incoming signed docs from dotloop automatically — that stays a manual human step (too unreliable across other agents' loops). Dropbox webhook + AI judgment-matching (see §7) is the automation surface.
- **Deal tracker Google Sheet**: Contains sensitive commission data. Decision needed before build: does the new app **replace** this Sheet as source of truth for commission data, or does it need to **sync** with it? (Recommend replace — see §6 for why the Sheet's formulas are already fragile.)

## 4. Data Model (Transactions)

Core transaction fields (visible to all agents on their own deals):
```
id, address, town, side (Buy/Sell), stage, agent, nextDate, notes,
hasSign (bool), hasLockbox (bool), lockboxCode, lockboxNote,
baComp (buyer agency compensation %),
buyerAttorney, sellerAttorney,
documents[] (name, file, status: complete/needs_review/missing, date),
activity[] (log entries),
linkedId (for dual-agency — see §8)
```

Broker-only / commission-sensitive fields (separate visibility tier — see §6):
```
leadType (Organic/Provided), clientSource, referralOwedTo, referralPct,
holdDeposit, depositAmount, inspectionDate, financingDate,
_closeout { price, commissionPct, agentSplitPct, netOverride, netAmount,
            agentCommission, hollyCommission, franCommission, bankAmount }
```

### Stages (5, not 6 — Listing Won and Paperwork were merged)
`Comped` → `Listing Won` (covers doc/photo gathering through going live) → `On Market` → `Under Contract` → `Closed`

### Dashboard filters
Comps/Follow-up | Active Listings (On Market + Listing Won) | Under Contract | All

## 5. The "Under Contract" Form

Rebuilds the team's existing Google Form natively. Fields, in order:
- VT or NH (radio)
- Agent (radio — dynamic list, broker can add/remove agents)
- Which Side? (Seller / Buyer / Split)
- Lead Type (Organic / Provided) — helper text: "Did the brokerage provide this lead, or did you bring it organically? Not related to referrals or client source."
- Seller Name, Buyer Name (text)
- Address, Property Style (Residential/Land/Commercial), Price
- Buyer Attorney, Seller Attorney — **autocomplete** against a saved attorney list, with inline "add new" if no match, or explicit TBD
- Commission % (e.g. 2.5)
- Closing Date, Inspection Deadline, Financing Date (dates)
- Appraiser (TBD / Other)
- Will we hold the deposit? (No / Other — amount field if Other)
- Client Source (Prior Client/Sphere, Zillow, Postcard/Mailer, Random Direct Contact, Website/Floorday, Referral)
  - If **Referral** selected: reveal "Who is the referral owed to?" (text) AND "Referral % owed" (number) — two separate fields.

Submitting: matches to an existing transaction by address (case-insensitive) or creates a new one, sets stage to `Under Contract`.

**Reminder banner**: dashboard shows a banner when any Under Contract deal is missing buyer and/or seller attorney info ("2 under-contract deals still need attorney info"), tapping filters to those. *Note: this is a UI-only banner in the prototype — for a real daily reminder (push/email), a scheduled backend job is needed (see §9).*

## 6. Commission / Close-Out Formula (CONFIRMED — this is real money, follow exactly)

Inputs: `Price`, `Commission %`, `Referral %` (optional) → `Commission After Referral = Price × Commission% − Referral Amount`.

**When the producing Agent is NOT Fran or Holly:**

| Lead Type | Agent keeps | "Brokerage Keeps" bucket |
|---|---|---|
| Organic | 80% | 20% — entirely to bank account, $0 to Holly/Fran |
| Provided | 60% (editable per-deal) | 40% — split: **80% of the bucket → bank account, 10% of the bucket → Holly, 10% of the bucket → Fran** |

Worked example ($9,780 Commission After Referral, Provided): Agent $5,868 (60%) · Bucket $3,912 (40%) → Bank $3,129.60 (80% of bucket) + Holly $391.20 (10% of bucket) + Fran $391.20 (10% of bucket).

**When the producing Agent IS Fran or Holly** (no separate "Agent Commission" — the two owner-commission fields alone sum to 100% of Commission After Referral):

| Side | Holly (if Holly is agent) | Fran (if Holly is agent) | Holly (if Fran is agent) | Fran (if Fran is agent) |
|---|---|---|---|---|
| Seller | 60% | 40% | 40% | 60% |
| Buyer | 80% | 20% | 20% | 80% |
| Split (dual agency, one owner both sides) | 100% | 0% | 0% | 100% |

**Net Proceeds override**: a checkbox ("Based on Net Proceeds") reveals a plain dollar-amount field that replaces the calculated commission entirely, for the edge case where a deal's commission was based on net rather than gross proceeds. Do not try to auto-detect this — always a manual override.

⚠️ **Do not port the Google Sheet's live formulas as-is.** They contain a broken `#REF!` helper column and at least one confirmed cell-reference bug (an early draft mistakenly referenced "Leftover for Team" instead of "Brokerage Keeps" for the Holly/Fran 10% cut — verified against real closed-deal numbers in the CSV export and corrected above). Build from the formula table above, not from the spreadsheet.

**Access control**: this entire commission layer (Lead Type, Client Source, referral fields, deposit, and all `_closeout` data) should be visible only to Fran and Holly — mirroring the current Sheet's access restriction. Regular agents fill out the Under Contract form (which touches some of these fields) but should not see other agents' commission breakdowns, and ideally not their own dollar breakdown either unless that's explicitly wanted.

## 7. Dropbox Automation (Phase 2 — not yet built)

- Watch transaction folders via Dropbox webhook.
- On new file: extract text (OCR if needed), use AI to identify document type + which transaction it belongs to.
- **Confidence-based matching, not rigid rules**: high confidence → auto-file and rename (convention: `{Address}_{DocType}_{Status}_{MM-DD-YY}.pdf`); low/ambiguous confidence → flag to a human rather than guessing (folder naming is inconsistent, and buy/sell-side rows can share an address, so exact-match rules will fail regularly).
- Once matched, use it to: (a) update transaction stage automatically when a triggering doc appears (e.g., signed listing agreement → Listing Won), (b) route new addendums to the correct attorney(s) via email — handle the case where the buyer side is unrepresented (send to seller's attorney only, or flag for confirmation).

## 8. Dual-Agency Linking

Buy-side and sell-side rows stay **separate** (required for commission math), but can be manually linked from the transaction detail view ("Link the other side of this deal") — picks another existing row, sets a bidirectional `linkedId`. Linked transactions show a banner ("🔗 Dual agency — linked to Buy side (Agent Name)") with a tap-through and an unlink option. This solves the "confusing duplicate-looking row" problem without merging commission-relevant data.

## 9. Social Media Automation

- **Post types**: New Listing, Under Contract, Sold, Open House (prompts for date + time), Regular Boost (no property tied — falls back to local market stats or area events when there's no active listing news; content source for this still needs to be decided).
- **Real image/caption generation**: an existing working Streamlit + Tkinter app already does this — see `github.com/hcfcollins/hall-collins-listing-packet-combiner`. It uses PyPDF2 + reportlab + Pillow + qrcode to: merge PDFs/ZIPs/JPGs into a listing packet, generate a branded cover page (agent-specific templates: Standard/Rachel/Andrew), and generate New Listing / Under Contract / Sold Instagram PNGs from existing branded templates with the real property photo and address overlaid. **Port this logic rather than rebuilding it** — it already produces the correct branded output. Open House and Regular Boost templates still need to be designed (matching the existing PNG template style).
- **Instagram publishing**: Instagram's API has no concept of "drafts" — it supports direct or scheduled publishing to a connected Business/Creator account via the Graph API (requires Meta Business Manager setup + app review). The in-app post preview screen effectively serves as the "draft review" step before a real publish action.
- **MLS packet**: MLS has no usable API — stays a manual upload. The app should generate the packet and email it to the broker as a reminder/delivery mechanism (also makes forwarding to leads trivial).

## 10. Other Confirmed Features

- **Agent management**: broker-only screen to add/remove agents from the roster (Fran and Holly are not removable). New agents immediately available in all agent-picker fields.
- **Attorney autocomplete**: typeahead against a saved attorney list; type-to-add if no match; explicit TBD option. List should be shared/global, not per-form.
- **Stats page**: per-agent Closed Volume (YTD), Closed Deals (YTD), Projected Year-End Volume, Avg. Days on Market, and a "closed so far vs. year-end goal" progress bar with plain-language explanation (avoid unlabeled percentages). Broker view includes an agent selector.
- **$5,000 annual company-dollar goal indicator**: quick-glance dot per agent (green = met, red = behind) in the agent selector, plus a clear pass/fail card with dollar amounts and shortfall when behind.
- **Listing appointment note-taking**: quick-capture flow (address, town, side, agent, free-text or dictated notes) that files directly into the Comps stage — solves notes currently living nowhere until a listing is won.
- **Calendar/showing tracking** (not yet built): monitor calendar for showings, match to a transaction address (same confidence-based approach as §7), log to that transaction for seller reporting. Decide whether just logging occurrence is enough for v1, or whether buyer-agent feedback capture (a follow-up prompt) is needed too.

## 11. Explicitly Rejected / Deprioritized Approaches

- **dotloop integration**: rejected — interface is complicated and other agents' inconsistent loop usage makes it unreliable as an automation trigger. Dropbox is the system of record instead.
- **Automating "save signed doc from email into Dropbox"**: rejected — signed docs aren't always attachments (sometimes must be pulled from inside dotloop manually), not worth automating a step that's already a reliable human habit.
- **Native App Store app**: deprioritized in favor of PWA for v1 — revisit only once the tool has proven itself.
- **Airtable / enhanced Google Sheet as the agent-facing dashboard**: rejected — commission data in the existing Sheet must stay restricted to Fran/Holly, so a separate purpose-built dashboard was needed regardless.

## 12. Suggested Build Order

1. Supabase project + schema (§4) + Google Auth
2. Core PWA shell: transaction list, detail view, stage management (port from prototype JSX, replace mock state with real Supabase queries)
3. Under Contract form (§5) wired to real submit → Supabase
4. Commission/close-out calculator (§6) — broker-only visibility enforced at the query/RLS level, not just UI-hidden
5. Agent + attorney management (§10)
6. Dual-agency linking (§8)
7. Port listing packet / Instagram generation logic (§9) from the existing Python app into a callable backend function
8. Dropbox webhook + AI judgment-matching (§7) — the most technically involved piece, build last once the core data model is stable
9. Calendar/showing tracking, Regular Boost content source, Instagram direct-publish integration

## 13. Migration Plan: Google Sheet Remains Primary Until Go-Live

The Google Sheet stays the operational source of truth during the build. The new app needs a **one-time bulk import** capability for cutover day, not an ongoing sync — do not build live two-way sync between the Sheet and the app; that's unnecessary complexity for a system being retired.

**Import requirements:**
- Accept a CSV export of the deal tracker (same structure as `1__Deal_Tracker_-_Deal_Tracker_Form.csv`, confirmed columns below).
- Map each CSV row to a transaction record using the field mapping in the table below.
- Historical rows may reflect **older versions of the commission formula** (confirmed during planning — e.g., some historical rows show Holly/Fran's 10% calculated against a different base than the current formula in §6). Import historical `_closeout` values **as static/frozen data**, not recalculated — do not re-run the current formula against old rows, since it will not match what was actually paid out.
- Run as an authenticated, broker-only, one-time (or re-runnable-but-idempotent) import screen — not a public/agent-facing feature.
- After import, the Sheet should be treated as archived/read-only; the app becomes the system of record going forward.

**CSV column → app field mapping** (from the confirmed export):

| CSV Column | App Field |
|---|---|
| Closing Date | `nextDate` / closing date on `_closeout` |
| Check Received (3) | (status note — map to `notes` or a new `checkReceived` field) |
| Will we hold the deposit? (4) | `holdDeposit` / `depositAmount` |
| Address (5) | `address` (also split out `town`/state if formatted as one string) |
| Seller Attorney (6) | `sellerAttorney` |
| Buyer Attorney (7) | `buyerAttorney` |
| Agent (8) | `agent` |
| Which Side? (9) | `side` |
| Lead Type (10) | `_commissionData.leadType` |
| Price (11) | `_closeout.price` |
| Commission % (12) | `_closeout.commissionPct` |
| Real Percentage (13) | (derived — decimal form of 12, can be dropped on import) |
| Total Commission Check (14) | `_closeout` gross commission (pre-referral) |
| Hidden helper column (15) | drop — known broken `#REF!` artifact, not needed |
| Brokerage Split 80/20 (16) | `_closeout.agentSplitPct` (this is the AGENT's %, confirmed) |
| Referral % | `_commissionData.referralPct` |
| Referral Amount (18) | derived from Referral % — can be dropped on import |
| Commission After Referral (19) | `_closeout.commissionAfterReferral` |
| Brokerage Keeps (20) | `_closeout` bucket amount (frozen historical value) |
| Leftover for Team: (21) | `_closeout.agentCommission` (frozen historical value) |
| Holly Commission (22) | `_closeout.hollyCommission` (frozen historical value) |
| Fran Commission (23) | `_closeout.franCommission` (frozen historical value) |
| Agent Commission (24) | `_closeout.agentCommission` (for non-owner agents) |
| Seller Name (25) | new `sellerName` field |
| Buyer Name (26) | new `buyerName` field |
| Client Source (27) | `_commissionData.clientSource` |
| Timestamp (28) | form-submission metadata, informational only |
| Notes (29) | `notes` |
| Inspection Deadline (30) | `_commissionData.inspectionDate` |
| Financing Date (31) | `_commissionData.financingDate` |
| Appraiser (32) | new `appraiser` field |
| Deposit/Inspection/Finance Reminder (33–35) | reminder-sent flags, informational only |
| Cashout Email Column (36) | informational only |
| Email Address (37) | agent's email, for reference |
| Property Style (38) | new `propertyStyle` field |
| VT or NH (39) | `town` region flag |
| TC Fee | new `tcFee` field |

All 222 historical rows should import as **Closed** stage (this is a closed-deal ledger), with `_closeout` marked as historical/frozen so the UI can visually distinguish "calculated by current formula" vs. "imported historical record" if ever displayed side by side.

---

*Reference prototype: `hall_collins_dashboard.jsx` (React, mock data) — useful for UI/UX reference and component structure, not for its in-memory state management, which needs to be replaced with real Supabase calls throughout.*
