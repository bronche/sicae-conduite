-- Ajout du champ intervenants (JSON) sur les interventions
alter table interventions add column if not exists intervenants jsonb default '[]';

-- Données par défaut : entreprise SICAE avec quelques postes à adapter
insert into listes_parametres (nom_liste, valeur, ordre) values
  ('Entreprises', 'SICAE', 1),
  ('Agents SICAE', 'Agent 1', 1),
  ('Agents SICAE', 'Agent 2', 2)
on conflict do nothing;
