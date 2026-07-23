create table if not exists account_roles (
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null check (role in ('STUDENT', 'EDUCATOR', 'ADMIN')),
  created_at timestamptz not null default now(),
  primary key (account_id, role)
);

create table if not exists educator_profile_access (
  educator_account_id uuid not null references accounts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  granted_by_account_id uuid references accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (educator_account_id, profile_id)
);

create table if not exists assessment_attempts (
  id text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  chapter_id text not null,
  created_at timestamptz not null default now(),
  unique (id, profile_id)
);

create table if not exists open_responses (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  attempt_id text not null,
  prompt_id text not null,
  prompt_version text not null,
  prompt_hash text not null,
  rubric_id text not null,
  rubric_version text not null,
  rubric_hash text not null,
  source_packet_id text not null,
  source_packet_version text not null,
  source_packet_hash text not null,
  ciphertext bytea not null,
  ciphertext_iv bytea not null,
  ciphertext_tag bytea not null,
  wrapped_key bytea not null,
  wrapped_key_iv bytea not null,
  wrapped_key_tag bytea not null,
  key_version text not null,
  consent_snapshot jsonb not null,
  policy_snapshot jsonb not null,
  retention_deadline timestamptz not null,
  request_hash text not null,
  idempotency_key text not null,
  classifier_observation jsonb not null,
  deterministic_resolution jsonb not null,
  grading_status text not null check (
    grading_status in ('PENDING', 'CLASSIFIED', 'FALLBACK')
  ),
  challenge_status text not null default 'NONE' check (
    challenge_status in ('NONE', 'CHALLENGED', 'CORRECTED', 'CLOSED')
  ),
  challenge_note text,
  created_at timestamptz not null default now(),
  graded_at timestamptz,
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (profile_id, attempt_id, idempotency_key),
  foreign key (attempt_id, profile_id)
    references assessment_attempts(id, profile_id)
    on delete cascade
);

create index if not exists open_responses_profile_created_idx
  on open_responses(profile_id, created_at desc)
  where deleted_at is null;
create index if not exists open_responses_retention_idx
  on open_responses(retention_deadline)
  where deleted_at is null;

create table if not exists open_response_audit (
  id bigserial primary key,
  response_id uuid references open_responses(id) on delete set null,
  profile_id uuid not null references profiles(id) on delete cascade,
  actor_account_id uuid references accounts(id) on delete set null,
  action text not null check (
    action in (
      'CREATED',
      'CLASSIFIED',
      'FALLBACK',
      'VIEWED',
      'EXPORTED',
      'DELETED',
      'RETENTION_EXPIRED',
      'CHALLENGED',
      'CORRECTED'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists open_response_audit_profile_created_idx
  on open_response_audit(profile_id, created_at desc);

