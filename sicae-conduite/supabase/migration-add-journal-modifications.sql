-- Historique de toutes les modifications d'interventions (audit admin)
create table if not exists journal_modifications (
  id         bigserial primary key,
  intervention_id text    not null,
  action     text    not null,   -- 'Création' | 'Modification' | 'Suppression'
  details    jsonb,              -- champs modifiés / état au moment de l'action
  fait_par_email text not null,
  fait_a     timestamptz not null default now()
);

create index if not exists idx_jmod_intervention on journal_modifications(intervention_id);
create index if not exists idx_jmod_fait_a       on journal_modifications(fait_a desc);
