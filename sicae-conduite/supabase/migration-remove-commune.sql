-- Suppression du champ commune de la table interventions
alter table interventions drop column if exists commune;

-- Suppression de la liste Site dans listes_parametres
delete from listes_parametres where nom_liste = 'Site';
