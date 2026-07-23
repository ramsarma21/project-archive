-- Presenter-side spatial restore point (feel-audit-1 P0-11). Optional and
-- purely presentational: replay validation ignores it; the event log stays
-- the only authority for game state.
alter table saves add column if not exists presenter_spatial jsonb;
