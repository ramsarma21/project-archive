-- Localhost schema for Project Archive (subset of Backend-AI-System / Localhost spec,
-- sufficient for Google login, per-account profiles, and durable saves).

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists external_identities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  issuer text not null,
  subject text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (issuer, subject)
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  display_name text not null,
  variation_root_seed_hex text not null,
  onboarding_preferences jsonb,
  created_at timestamptz not null default now(),
  unique (account_id)
);

alter table profiles add column if not exists onboarding_preferences jsonb;

create table if not exists oauth_login_attempts (
  state text primary key,
  code_verifier text not null,
  nonce text,
  created_at timestamptz not null default now()
);
alter table oauth_login_attempts add column if not exists nonce text;
delete from oauth_login_attempts where nonce is null;
alter table oauth_login_attempts alter column nonce set not null;

create table if not exists access_sessions (
  id text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists saves (
  profile_id uuid primary key references profiles(id) on delete cascade,
  chapter_id text not null,
  package_id text not null,
  variation_root_seed_hex text not null,
  flow_version integer not null default 1,
  committed_events jsonb not null,
  revision integer not null,
  status text not null,
  updated_at timestamptz not null default now()
);

alter table saves add column if not exists flow_version integer not null default 1;

create table if not exists mastery_reports (
  profile_id uuid primary key references profiles(id) on delete cascade,
  chapter_id text not null,
  package_id text not null,
  save_revision integer not null,
  report jsonb not null,
  generated_at timestamptz not null,
  updated_at timestamptz not null default now()
);
