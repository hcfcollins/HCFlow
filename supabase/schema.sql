-- Hall Collins Real Estate Group — Supabase Schema
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New Query) after creating your project.

-- ============================================================
-- 1. AGENTS (the team roster)
-- ============================================================
create table agents (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  email text unique,
  role text not null default 'agent' check (role in ('agent', 'broker')),
  is_active boolean not null default true,
  dropbox_listing_path text, -- this agent's Dropbox listing folder, read by the create-dropbox-folder Edge Function
  dropbox_buyer_path text, -- captured for a future buyer-side Dropbox automation; not read by any function yet
  cover_sheet_url text, -- public Storage URL to this agent's personalized CMA cover PDF, if they have one (falls back to the generic cover)
  created_at timestamptz not null default now()
);

-- Seed the initial roster (edit before running, or run once and adjust in the app).
-- Dropbox paths reflect the designated-agency folder separation described in the
-- app's project memory "dropbox_folder_structure" — Fran and Holly share one team
-- folder, every other agent has their own isolated space.
insert into agents (name, email, role, dropbox_listing_path, dropbox_buyer_path) values
  ('Fran Collins', 'fran.collins@hallcollins.com', 'broker', '/Hall Collins REG Team Folder/Listings', '/Hall Collins REG Team Folder/Fran - Buyers'),
  ('Holly Hall', 'holly.hall@hallcollins.com', 'broker', '/Hall Collins REG Team Folder/Listings', null),
  ('Andrew Kimbell', null, 'agent', '/HC - Andrew Kimbell/Andrew - Listings', null),
  ('Rachel Noyes', null, 'agent', '/HC - Rachel Noyes/Rachel - Listings', '/HC - Rachel Noyes/Rachel - Buyers'),
  ('Bekka Soule', null, 'agent', '/HC - Bekka Soule/Bekka - Listings', null);

-- ============================================================
-- 2. ATTORNEYS (shared autocomplete list)
-- ============================================================
create table attorneys (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3. TRANSACTIONS (core deal record — visible to all agents for their own deals)
-- ============================================================
create table transactions (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  town text,
  region text check (region in ('VT', 'NH')),
  side text not null check (side in ('Buy', 'Sell', 'Split')), -- 'Split' only when the producing agent is Fran or Holly personally repping both sides
  stage text not null default 'comps' check (stage in ('comps', 'won', 'market', 'contract', 'closed')),
  terminated_at timestamptz, -- set when a listing or under-contract deal falls through; stage is left as-is for history, this just flags it out of the active pipeline. Any future reminder-email automation (second deposit, closeout, etc.) must check this is null before sending.
  termination_reason text,
  agent_id uuid references agents(id),
  next_date text,
  notes text default '',
  sign_status text default 'No' check (sign_status in ('Yes', 'No', 'Seller Declined')),
  has_lockbox boolean default false,
  lockbox_code text,
  lockbox_note text,
  dropbox_folder_url text, -- set by the create-dropbox-folder Edge Function when a deal first moves to Won
  dropbox_folder_path text, -- raw Dropbox path (not the shared link) for the same folder, used to target its Pitch Docs subfolder
  comp_analysis jsonb, -- price band, agent write-up, and conditional land/multi-family analysis inputs from the Generate Comp form
  last_comp_url text, -- shared Dropbox link to the most recently generated comp PDF
  ba_comp text,
  buyer_attorney_id uuid references attorneys(id),
  seller_attorney_id uuid references attorneys(id),
  seller_name text,
  buyer_name text,
  property_style text check (property_style in ('Residential', 'Land', 'Commercial', 'Multi Family')),
  price numeric,
  comps_status text check (comps_status in ('Need to Send Comp', 'Waiting to List')), -- only meaningful while stage = 'comps'
  seller_emails text[], -- any number of contact emails (seller/buyer depending on side) — was a single seller_email column
  timeframe text check (timeframe in ('Now', '6 months', 'Next year')),
  electrical text check (electrical in ('200 amp', '150 amp', '100 amp', 'Fuses', 'Knob and Tube')),
  heating_system text[], -- multi-select: Baseboard, Hot Water, Oil, Propane, Electric, Direct Vent/Rinnai, Mini Splits, Wood Stove, Radiant, or freeform "Other" entries
  basement text[], -- multi-select: Dirt Floor, Concrete Block, Poured Concrete, Fieldstone, Crawlspace
  water_source text,
  septic text,
  recommendations text[], -- multi-select: standard seller recommendations checklist (Wait for Spring, Septic Inspection, etc.)
  referral_note text, -- internal note on where this client/lead came from, so a referral payment isn't missed at closing; never included in the generated comp PDF
  linked_id uuid references transactions(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on transactions (agent_id);
create index on transactions (stage);
create index on transactions (lower(address));

-- ============================================================
-- 4. DOCUMENTS (per-transaction file records — metadata only; actual files stay in Dropbox)
-- ============================================================
create table documents (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  name text not null,
  file_name text,
  status text not null default 'missing' check (status in ('complete', 'needs_review', 'missing')),
  doc_date date,
  created_at timestamptz not null default now()
);

create index on documents (transaction_id);

-- ============================================================
-- 5. ACTIVITY LOG (per-transaction timeline)
-- ============================================================
create table activity_log (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  label text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index on activity_log (transaction_id);

-- ============================================================
-- 5b. TODOS (per-transaction checklist — used for the "Won Listing" to-do list)
-- ============================================================
create table todos (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  completed_at timestamptz, -- set when done is checked, cleared when unchecked
  created_at timestamptz not null default now()
);

create index on todos (transaction_id);

-- ============================================================
-- 6. COMMISSION DATA (broker-only visibility — Lead Type, Client Source, referral info)
-- Separate table so Row Level Security can restrict it independently of the main transaction.
-- ============================================================
create table commission_data (
  transaction_id uuid primary key references transactions(id) on delete cascade,
  lead_type text check (lead_type in ('Organic', 'Provided')),
  client_source text check (client_source in (
    'Prior Client/Sphere', 'Zillow', 'Postcard/Mailer',
    'Random Direct Contact', 'Website/Floorday', 'Referral'
  )),
  referral_owed_to text,
  referral_pct numeric,
  hold_deposit text check (hold_deposit in ('No', 'Yes')),
  deposit_amount numeric,
  second_deposit text check (second_deposit in ('No', 'Yes')),
  second_deposit_amount numeric,
  second_deposit_due_date date, -- when set, drives the second-deposit email reminder (not yet built)
  inspection_date date,
  financing_date date,
  appraiser text,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 7. CLOSE-OUTS (broker-only — the calculated commission breakdown)
-- ============================================================
create table closeouts (
  transaction_id uuid primary key references transactions(id) on delete cascade,
  price numeric,
  commission_pct numeric,
  agent_split_pct numeric,
  lead_type text check (lead_type in ('Organic', 'Provided')),
  referral_pct numeric,
  net_override boolean default false,
  net_amount numeric,
  commission_after_referral numeric,
  agent_commission numeric,
  holly_commission numeric,
  fran_commission numeric,
  bank_amount numeric,
  is_historical_import boolean default false, -- true for rows imported from the old Google Sheet
  calculated_at timestamptz not null default now()
);

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================

alter table agents enable row level security;
alter table attorneys enable row level security;
alter table transactions enable row level security;
alter table documents enable row level security;
alter table activity_log enable row level security;
alter table todos enable row level security;
alter table commission_data enable row level security;
alter table closeouts enable row level security;

-- Helper: is the logged-in user a broker? (matches their auth email to the agents table)
create or replace function is_broker()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from agents
    where email = auth.jwt() ->> 'email'
    and role = 'broker'
  );
$$;

-- Helper: get the logged-in user's agent_id
create or replace function current_agent_id()
returns uuid
language sql
security definer
stable
as $$
  select id from agents where email = auth.jwt() ->> 'email';
$$;

-- Agents table: everyone can read (needed for pickers), only brokers can write
create policy "agents_select" on agents for select using (true);
create policy "agents_insert" on agents for insert with check (is_broker());
create policy "agents_update" on agents for update using (is_broker());
create policy "agents_delete" on agents for delete using (is_broker());

-- Attorneys: everyone can read and add new ones (per the autocomplete "add new" feature); only brokers can delete
create policy "attorneys_select" on attorneys for select using (true);
create policy "attorneys_insert" on attorneys for insert with check (true);
create policy "attorneys_delete" on attorneys for delete using (is_broker());

-- Transactions: brokers see everything; agents see only their own deals
create policy "transactions_select" on transactions for select
  using (is_broker() or agent_id = current_agent_id());
create policy "transactions_insert" on transactions for insert
  with check (is_broker() or agent_id = current_agent_id());
create policy "transactions_update" on transactions for update
  using (is_broker() or agent_id = current_agent_id());
create policy "transactions_delete" on transactions for delete
  using (is_broker());

-- Documents & activity log: follow the parent transaction's visibility
create policy "documents_select" on documents for select
  using (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));
create policy "documents_insert" on documents for insert
  with check (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));
create policy "documents_update" on documents for update
  using (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));

create policy "activity_select" on activity_log for select
  using (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));
create policy "activity_insert" on activity_log for insert
  with check (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));

create policy "todos_select" on todos for select
  using (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));
create policy "todos_insert" on todos for insert
  with check (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));
create policy "todos_update" on todos for update
  using (exists (select 1 from transactions t where t.id = transaction_id
    and (is_broker() or t.agent_id = current_agent_id())));

-- Commission data & close-outs: reading is BROKER ONLY — this is the sensitive layer.
-- Insert is open to any signed-in user because the Under Contract form (filled out by
-- regular agents) writes some of these fields; agents just can't read them back. See
-- Build Spec §6 and §5 for why writes and reads have different access rules here.
create policy "commission_select" on commission_data for select using (is_broker());
create policy "commission_insert" on commission_data for insert with check (auth.uid() is not null);
create policy "commission_update" on commission_data for update using (is_broker());

create policy "closeouts_select" on closeouts for select using (is_broker());
create policy "closeouts_insert" on closeouts for insert with check (auth.uid() is not null);
create policy "closeouts_update" on closeouts for update using (is_broker());

-- ============================================================
-- 8b. STORAGE — agent-assets bucket (cover sheets uploaded via Manage Agents)
-- Public read (these are just letterhead-style cover art, not sensitive), broker-only
-- write — same is_broker() gate as the agents table itself.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('agent-assets', 'agent-assets', true)
on conflict (id) do nothing;

create policy "agent_assets_select" on storage.objects for select
  using (bucket_id = 'agent-assets');
create policy "agent_assets_insert" on storage.objects for insert
  with check (bucket_id = 'agent-assets' and is_broker());
create policy "agent_assets_update" on storage.objects for update
  using (bucket_id = 'agent-assets' and is_broker());
create policy "agent_assets_delete" on storage.objects for delete
  using (bucket_id = 'agent-assets' and is_broker());

-- ============================================================
-- 9. NOTES FOR CLAUDE CODE / WHOEVER WIRES THIS UP
-- ============================================================
-- - Agents authenticate via Google Sign-In (Supabase Auth → Providers → Google).
--   Their auth.jwt() email must match a row in `agents.email` for RLS to work.
--   New agents added via the app's "Manage Agents" screen need an email captured
--   at that point (or matched later when they first sign in) for this to function.
-- - The commission_data and closeouts tables are intentionally separate from
--   `transactions` so a single, simple RLS policy on each fully locks agents out —
--   no risk of a broker-only field leaking through a broader `select *` on transactions.
-- - `is_historical_import` on closeouts distinguishes rows brought in from the old
--   Google Sheet (frozen, potentially using an older formula version) from rows
--   calculated by the current app logic — see Build Spec §13 before writing the importer.
