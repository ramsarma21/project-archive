alter table open_responses
  add column if not exists content_package_id text not null
    default 'PA.BOS.ACT01.OPENRESPONSE.LEGACY',
  add column if not exists content_package_version text not null
    default 'legacy-v1',
  add column if not exists content_package_hash text not null
    default 'sha256:legacy',
  add column if not exists classifier_schema_id text not null
    default 'PA.BOS.ACT01.CLASSIFIER.LEGACY',
  add column if not exists classifier_schema_version text not null
    default 'legacy-v1';

comment on column open_responses.content_package_hash is
  'Immutable generated content-package hash; legacy rows retain an explicit legacy marker.';
comment on column open_responses.classifier_schema_version is
  'Classifier boundary version. Gameplay remains compatible through deterministic resolver normalization.';

