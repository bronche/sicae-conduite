-- Ajout champs interventions
alter table interventions add column if not exists agent_email text;

-- Statuts supplémentaires sont gérés en application, pas de contrainte SQL

-- Table utilisateurs applicatifs (liste pour les transferts)
create table if not exists app_users (
  email text primary key,
  display_name text not null,
  created_at timestamp with time zone default now()
);

-- Table transferts de conduite
create table if not exists transferts_conduite (
  id serial primary key,
  intervention_id text references interventions(id) on delete cascade,
  from_email text not null,
  to_email text not null,
  observation text,
  statut text not null default 'En attente',  -- 'En attente' | 'Accepté' | 'Refusé'
  created_at timestamp with time zone default now(),
  responded_at timestamp with time zone
);

create index if not exists idx_transferts_to_email on transferts_conduite(to_email);
create index if not exists idx_transferts_intervention on transferts_conduite(intervention_id);
create index if not exists idx_transferts_statut on transferts_conduite(statut);
