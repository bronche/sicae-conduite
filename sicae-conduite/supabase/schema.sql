-- Table interventions
create table if not exists interventions (
  id text primary key,
  date text not null,
  heure_debut text not null,
  heure_fin text,
  type text not null,
  ouvrage text not null,
  commune text not null,
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
  ('Commune', 'Amiens', 1),
  ('Commune', 'Péronne', 2),
  ('Commune', 'Ham', 3),
  ('Commune', 'Montdidier', 4),
  ('Commune', 'Roye', 5),
  ('Commune', 'Doullens', 6),
  ('Commune', 'Albert', 7),
  ('Commune', 'Chaulnes', 8),
  ('Commune', 'Nesle', 9),
  ('Commune', 'Autre', 10);
