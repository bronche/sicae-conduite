-- Table interventions
create table if not exists interventions (
  id text primary key,
  date text not null,
  heure_debut text not null,
  heure_fin text,
  type text not null,
  ouvrage text not null,
  site text,
  statut text not null default 'En cours',
  observations text,
  created_at timestamp with time zone default now()
);

-- Table listes déroulantes
create table if not exists listes_parametres (
  id serial primary key,
  nom_liste text not null,
  valeur text not null,
  ordre integer default 0
);

-- Index pour performance
create index if not exists idx_interventions_date on interventions(date);
create index if not exists idx_interventions_statut on interventions(statut);
create index if not exists idx_listes_nom on listes_parametres(nom_liste);

-- Données par défaut
insert into listes_parametres (nom_liste, valeur, ordre) values
  ('Type intervention', 'Dépannage BT', 1),
  ('Type intervention', 'Dépannage HTA', 2),
  ('Type intervention', 'Manœuvre réseau', 3),
  ('Type intervention', 'Coupure programmée', 4),
  ('Type intervention', 'Mise en service', 5),
  ('Type intervention', 'Raccordement', 6),
  ('Type intervention', 'Contrôle / Visite', 7),
  ('Type intervention', 'Incident réseau', 8),
  ('Type intervention', 'Autre', 9),
  ('Site', 'Amiens', 1),
  ('Site', 'Péronne', 2),
  ('Site', 'Ham', 3),
  ('Site', 'Montdidier', 4),
  ('Site', 'Roye', 5),
  ('Site', 'Doullens', 6),
  ('Site', 'Albert', 7),
  ('Site', 'Chaulnes', 8),
  ('Site', 'Nesle', 9),
  ('Site', 'Autre', 10);
