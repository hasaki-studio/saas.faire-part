-- Réponses de groupe : un niveau entre le message individuel et la réponse
-- générique du mariage.
--
-- Pourquoi : les messages individuels sont ce qui se vend (CLAUDE.md §1), mais
-- ils coûtent 3 à 5 h par client. Six groupes couvrent trente invités pour une
-- fraction du temps. Le groupe est donc un filet SOUS le message individuel,
-- jamais un remplacement — d'où l'ordre de résolution, qui vit dans le Worker :
--
--     message_perso  →  réponse du groupe  →  réponse générique du mariage
--
-- L'étiquette est libre (« témoins », « collègues », « famille de Justine ») :
-- un couple ne sait pas dire « j'en veux cinq », il sait nommer ses tablées.
-- La contrepartie est que « Témoins » et « temoins » font deux groupes ; c'est
-- à la saisie de proposer les étiquettes déjà utilisées.
--
-- Pas de variante « non » : sur un refus, toujours la réponse générique du
-- mariage (§4). La règle vaut pour le groupe comme pour l'individuel.

ALTER TABLE convives ADD COLUMN groupe TEXT;

CREATE INDEX idx_convives_groupe ON convives(mariage_id, groupe);

CREATE TABLE reponses_groupe (
  mariage_id  TEXT NOT NULL REFERENCES mariages(id) ON DELETE CASCADE,
  groupe      TEXT NOT NULL,
  message     TEXT NOT NULL,
  photo_key   TEXT,                       -- clé R2, vide = pas de photo de groupe
  PRIMARY KEY (mariage_id, groupe)
);
