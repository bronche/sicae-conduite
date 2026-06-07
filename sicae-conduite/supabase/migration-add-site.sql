-- Ajout du champ site (remplace l'ancien champ commune)
alter table interventions add column if not exists site text;

-- Réajout de la liste Site dans listes_parametres
insert into listes_parametres (nom_liste, valeur, ordre) values
  ('Site', 'Amiens', 1),
  ('Site', 'Péronne', 2),
  ('Site', 'Ham', 3),
  ('Site', 'Montdidier', 4),
  ('Site', 'Roye', 5),
  ('Site', 'Doullens', 6),
  ('Site', 'Albert', 7),
  ('Site', 'Chaulnes', 8),
  ('Site', 'Nesle', 9),
  ('Site', 'Autre', 10)
on conflict do nothing;
