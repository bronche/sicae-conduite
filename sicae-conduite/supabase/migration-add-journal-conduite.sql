-- Journal des prises/passations de conduite réseau
create table if not exists journal_conduite (
  id           serial primary key,
  from_email   text not null,
  from_name    text not null,
  to_email     text not null,
  to_name      text not null,
  observations text,
  statut       text not null default 'En attente',  -- 'En attente' | 'Accepté' | 'Refusé'
  demande_at   timestamptz not null default now(),
  accepte_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_journal_conduite_statut  on journal_conduite(statut);
create index if not exists idx_journal_conduite_created on journal_conduite(created_at desc);
