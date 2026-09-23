-- D'où vient une ligne de convives.
--
-- Un token inconnu ne donne jamais un 404 (CLAUDE.md §3, règle #4) : le Worker
-- crée une ligne avec un token frais et le nom que la personne a saisi. Sans
-- cette colonne, cette ligne est ensuite indistinguable d'un invité importé par
-- le couple, qui n'a donc aucun moyen de repérer les réponses qu'il n'attendait
-- pas. Le renseigner à l'insertion est le seul moment où l'information existe.
--
-- Un accompagnant hérite de l'origine de la personne qui l'a annoncé : le +1
-- d'un inconnu n'est pas davantage sur la liste que lui.
--
-- Défaut 'liste' : les lignes existantes viennent toutes d'un import.

ALTER TABLE convives ADD COLUMN origine TEXT NOT NULL DEFAULT 'liste'
  CHECK (origine IN ('liste', 'hors_liste'));
