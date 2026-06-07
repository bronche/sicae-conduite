-- Ajout du flag administrateur sur les utilisateurs applicatifs
alter table app_users add column if not exists is_admin boolean not null default false;

-- !! Bootstrapping : après avoir créé le premier utilisateur via le tableau de bord Supabase,
-- exécuter cette ligne en remplaçant l'email interne (format: prenom.nom@sicae.internal) :
-- update app_users set is_admin = true where email = 'prenom.nom@sicae.internal';
