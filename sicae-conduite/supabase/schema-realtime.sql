-- ============================================================
-- SICAE – Conduite GRD | schema-realtime.sql
-- À exécuter dans le SQL Editor de Supabase (une seule fois)
-- Permet à Supabase Realtime de filtrer les transferts par agent
-- via RLS sans casser les appels API (la service key bypass RLS)
-- ============================================================

-- Activer Row Level Security sur transferts_conduite
ALTER TABLE transferts_conduite ENABLE ROW LEVEL SECURITY;

-- Politique SELECT : un agent voit uniquement ses transferts (émis ou reçus)
CREATE POLICY "transferts_visibles_par_agent"
  ON transferts_conduite
  FOR SELECT
  USING (
    auth.email() = to_email
    OR auth.email() = from_email
  );
