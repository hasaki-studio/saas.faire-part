-- Cérémonie et cocktail n'ont plus de colonnes dédiées : ils deviennent des
-- lignes de `programme_items` comme n'importe quelle autre étape de la
-- journée (titre, heure, lieu en texte libre — cf. worker/src/db.ts,
-- PROGRAMME_PAR_DEFAUT). Revenu sur schema/010_programme_faq.sql : avoir deux
-- systèmes d'édition différents pour la même frise (des champs à part pour
-- cérémonie/cocktail, une liste pour le reste) rendait le formulaire du
-- tunnel incohérent, et un champ "facultatif" pré-rempli par erreur a suffi à
-- faire apparaître un cocktail fantôme sur un mariage qui n'en avait pas.
--
-- `cocktail_photo_key` reste seule : la section "Le lieu" du thème n'affiche
-- plus qu'une photo (déjà gérée à part depuis le tableau de bord), le nom et
-- l'adresse se lisent maintenant dans la frise avec le reste.
--
-- SQLite (donc D1) sait faire DROP COLUMN depuis la 3.35 : pas de table à
-- recréer à la main pour ces six colonnes, aucune n'a d'index ni de clé
-- étrangère qui en dépende.

ALTER TABLE mariages DROP COLUMN ceremonie_nom;
ALTER TABLE mariages DROP COLUMN ceremonie_adresse;
ALTER TABLE mariages DROP COLUMN heure_ceremonie;
ALTER TABLE mariages DROP COLUMN cocktail_nom;
ALTER TABLE mariages DROP COLUMN cocktail_adresse;
ALTER TABLE mariages DROP COLUMN heure_cocktail;
