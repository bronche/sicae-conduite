-- SICAE Conduite GRD - Toutes les migrations en attente
-- Copier-coller dans Supabase > SQL Editor > Run
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / ON CONFLICT DO NOTHING)

-- 0. Rendre ouvrage nullable (champ supprime du formulaire)
ALTER TABLE interventions ALTER COLUMN ouvrage DROP NOT NULL;

-- 1. Colonne intervenants sur les interventions
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS intervenants jsonb DEFAULT '[]';

-- 2. Colonne sous_type sur les interventions
ALTER TABLE interventions ADD COLUMN IF NOT EXISTS sous_type text DEFAULT NULL;

-- 3. Table journal des passations de conduite
CREATE TABLE IF NOT EXISTS journal_conduite (
  id           serial PRIMARY KEY,
  from_email   text NOT NULL,
  from_name    text NOT NULL,
  to_email     text NOT NULL,
  to_name      text NOT NULL,
  observations text,
  statut       text NOT NULL DEFAULT 'En attente',
  demande_at   timestamptz NOT NULL DEFAULT now(),
  accepte_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journal_conduite_statut  ON journal_conduite(statut);
CREATE INDEX IF NOT EXISTS idx_journal_conduite_created ON journal_conduite(created_at DESC);

-- 4. Table audit des modifications
CREATE TABLE IF NOT EXISTS journal_modifications (
  id              bigserial PRIMARY KEY,
  intervention_id text NOT NULL,
  action          text NOT NULL,
  details         jsonb,
  fait_par_email  text NOT NULL,
  fait_a          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jmod_intervention ON journal_modifications(intervention_id);
CREATE INDEX IF NOT EXISTS idx_jmod_fait_a       ON journal_modifications(fait_a DESC);

-- 5. Colonne parent_key pour la hierarchie des listes
ALTER TABLE listes_parametres ADD COLUMN IF NOT EXISTS parent_key text DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_lp_parent ON listes_parametres(parent_key) WHERE parent_key IS NOT NULL;

-- 6. Entreprise SICAE par defaut
INSERT INTO listes_parametres (nom_liste, valeur, ordre) VALUES
  ('Entreprises', 'SICAE', 1)
ON CONFLICT DO NOTHING;

-- 7. Categories d intervention GRD (niveau 1)
INSERT INTO listes_parametres (nom_liste, valeur, ordre, parent_key) VALUES
  ('Type intervention', 'Consignation / Deconsignation',     1, NULL),
  ('Type intervention', 'Acces aux postes',                  2, NULL),
  ('Type intervention', 'Limitation de production / P0',     3, NULL),
  ('Type intervention', 'Alarme reseau',                     4, NULL),
  ('Type intervention', 'Manoeuvre HTA / BT',                5, NULL),
  ('Type intervention', 'Intervention SDIS',                 6, NULL),
  ('Type intervention', 'Acces SCADA',                       7, NULL),
  ('Type intervention', 'Visite mensuelle / Maintenance',    8, NULL)
ON CONFLICT DO NOTHING;

-- 8. Sous-types Consignation / Deconsignation
INSERT INTO listes_parametres (nom_liste, valeur, ordre, parent_key) VALUES
  ('Objet reseau', 'Antenne HTA',  1, 'Type intervention::Consignation / Deconsignation'),
  ('Objet reseau', 'Troncon HTA',  2, 'Type intervention::Consignation / Deconsignation'),
  ('Objet reseau', 'Depart BT',    3, 'Type intervention::Consignation / Deconsignation'),
  ('Objet reseau', 'CBS / CBU',    4, 'Type intervention::Consignation / Deconsignation'),
  ('Objet reseau', 'PAC',          5, 'Type intervention::Consignation / Deconsignation'),
  ('Objet reseau', 'RM6',          6, 'Type intervention::Consignation / Deconsignation'),
  ('Objet reseau', 'PDL',          7, 'Type intervention::Consignation / Deconsignation')
ON CONFLICT DO NOTHING;

-- 9. Sous-types Acces aux postes
INSERT INTO listes_parametres (nom_liste, valeur, ordre, parent_key) VALUES
  ('Type acces', 'Accompagnement travaux',  1, 'Type intervention::Acces aux postes'),
  ('Type acces', 'Visite mensuelle',        2, 'Type intervention::Acces aux postes'),
  ('Type acces', 'Livraison / Maintenance', 3, 'Type intervention::Acces aux postes'),
  ('Type acces', 'Acces prestataire',       4, 'Type intervention::Acces aux postes'),
  ('Type acces', 'Passage RTE',             5, 'Type intervention::Acces aux postes')
ON CONFLICT DO NOTHING;

-- 10. Sous-types Alarme reseau
INSERT INTO listes_parametres (nom_liste, valeur, ordre, parent_key) VALUES
  ('Type alarme', 'Porte SCADA ouverte',       1, 'Type intervention::Alarme reseau'),
  ('Type alarme', 'Defaut HTA',                2, 'Type intervention::Alarme reseau'),
  ('Type alarme', 'Decouplage parc eolien',    3, 'Type intervention::Alarme reseau'),
  ('Type alarme', 'Activation AMU',            4, 'Type intervention::Alarme reseau'),
  ('Type alarme', 'Perte de communication',    5, 'Type intervention::Alarme reseau'),
  ('Type alarme', 'Alarme presence personnel', 6, 'Type intervention::Alarme reseau')
ON CONFLICT DO NOTHING;

-- 11. Sous-types Manoeuvre HTA / BT
INSERT INTO listes_parametres (nom_liste, valeur, ordre, parent_key) VALUES
  ('Type manoeuvre', 'Depontage / Pontage',      1, 'Type intervention::Manoeuvre HTA / BT'),
  ('Type manoeuvre', 'Basculement de depart',    2, 'Type intervention::Manoeuvre HTA / BT'),
  ('Type manoeuvre', 'Separation de reseau',     3, 'Type intervention::Manoeuvre HTA / BT'),
  ('Type manoeuvre', 'MES groupe electrogene',   4, 'Type intervention::Manoeuvre HTA / BT'),
  ('Type manoeuvre', 'Mutation transformateur',  5, 'Type intervention::Manoeuvre HTA / BT'),
  ('Type manoeuvre', 'MES cable neuf',           6, 'Type intervention::Manoeuvre HTA / BT')
ON CONFLICT DO NOTHING;

-- 12. Sous-types Limitation de production / P0
INSERT INTO listes_parametres (nom_liste, valeur, ordre, parent_key) VALUES
  ('Detail limitation', 'Limitation MW sur ordre RTE', 1, 'Type intervention::Limitation de production / P0'),
  ('Detail limitation', 'Passage en P0',               2, 'Type intervention::Limitation de production / P0'),
  ('Detail limitation', 'Levee de limitation',         3, 'Type intervention::Limitation de production / P0'),
  ('Detail limitation', 'Retour en production',        4, 'Type intervention::Limitation de production / P0')
ON CONFLICT DO NOTHING;
