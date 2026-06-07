-- Hiérarchie multi-niveaux pour les listes
-- parent_key = '{nom_liste}::{valeur}' de la valeur parente, NULL = liste racine
alter table listes_parametres add column if not exists parent_key text default null;
create index if not exists idx_lp_parent on listes_parametres(parent_key) where parent_key is not null;

-- Sous-type pour les interventions (2ème niveau de la cascade)
alter table interventions add column if not exists sous_type text default null;

-- Données GRD par défaut (adapter selon vos besoins)
insert into listes_parametres (nom_liste, valeur, ordre, parent_key) values
  -- Types d'intervention (niveau 1)
  ('Type intervention', 'Consignation / Déconsignation', 1, null),
  ('Type intervention', 'Accès aux postes', 2, null),
  ('Type intervention', 'Limitation de production / P0', 3, null),
  ('Type intervention', 'Alarme réseau', 4, null),
  ('Type intervention', 'Manœuvre HTA / BT', 5, null),
  ('Type intervention', 'Intervention SDIS', 6, null),
  ('Type intervention', 'Accès SCADA', 7, null),
  ('Type intervention', 'Visite mensuelle / Maintenance', 8, null),

  -- Sous-types Consignation
  ('Objet réseau', 'Antenne HTA', 1, 'Type intervention::Consignation / Déconsignation'),
  ('Objet réseau', 'Tronçon HTA', 2, 'Type intervention::Consignation / Déconsignation'),
  ('Objet réseau', 'Départ BT', 3, 'Type intervention::Consignation / Déconsignation'),
  ('Objet réseau', 'CBS / CBU', 4, 'Type intervention::Consignation / Déconsignation'),
  ('Objet réseau', 'PAC', 5, 'Type intervention::Consignation / Déconsignation'),
  ('Objet réseau', 'RM6', 6, 'Type intervention::Consignation / Déconsignation'),
  ('Objet réseau', 'PDL', 7, 'Type intervention::Consignation / Déconsignation'),

  -- Sous-types Accès aux postes
  ('Type accès', 'Accompagnement travaux', 1, 'Type intervention::Accès aux postes'),
  ('Type accès', 'Visite mensuelle', 2, 'Type intervention::Accès aux postes'),
  ('Type accès', 'Livraison / Maintenance', 3, 'Type intervention::Accès aux postes'),
  ('Type accès', 'Accès prestataire', 4, 'Type intervention::Accès aux postes'),
  ('Type accès', 'Passage RTE', 5, 'Type intervention::Accès aux postes'),

  -- Sous-types Alarme réseau
  ('Type alarme', 'Porte SCADA ouverte', 1, 'Type intervention::Alarme réseau'),
  ('Type alarme', 'Défaut HTA', 2, 'Type intervention::Alarme réseau'),
  ('Type alarme', 'Découplage parc éolien', 3, 'Type intervention::Alarme réseau'),
  ('Type alarme', 'Activation AMU', 4, 'Type intervention::Alarme réseau'),
  ('Type alarme', 'Perte de communication', 5, 'Type intervention::Alarme réseau'),
  ('Type alarme', 'Alarme présence personnel', 6, 'Type intervention::Alarme réseau'),

  -- Sous-types Manœuvre HTA/BT
  ('Type manœuvre', 'Dépontage / Pontage', 1, 'Type intervention::Manœuvre HTA / BT'),
  ('Type manœuvre', 'Basculement de départ', 2, 'Type intervention::Manœuvre HTA / BT'),
  ('Type manœuvre', 'Séparation de réseau', 3, 'Type intervention::Manœuvre HTA / BT'),
  ('Type manœuvre', 'MES groupe électrogène', 4, 'Type intervention::Manœuvre HTA / BT'),
  ('Type manœuvre', 'Mutation transformateur', 5, 'Type intervention::Manœuvre HTA / BT'),
  ('Type manœuvre', 'MES câble neuf', 6, 'Type intervention::Manœuvre HTA / BT'),

  -- Sous-types Limitation P0
  ('Détail limitation', 'Limitation MW sur ordre RTE', 1, 'Type intervention::Limitation de production / P0'),
  ('Détail limitation', 'Passage en P0', 2, 'Type intervention::Limitation de production / P0'),
  ('Détail limitation', 'Levée de limitation', 3, 'Type intervention::Limitation de production / P0'),
  ('Détail limitation', 'Retour en production', 4, 'Type intervention::Limitation de production / P0')

on conflict do nothing;
