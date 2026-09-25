-- Programme de la journée et FAQ, jusqu'ici du texte figé dans le thème
-- (des horaires inventés, une FAQ écrite pour un couple précis) — révélé par
-- l'aperçu encastré du tunnel self-service, jamais branché sur de vraies
-- données pour aucun mariage, catalogue ou sur-mesure.
--
-- Cérémonie et cocktail restent des colonnes sur `mariages` (ci-dessous,
-- juste l'heure qui manquait) : ils alimentent aussi la section "Le lieu"
-- du thème, pas seulement le programme, et changer leur forme casserait
-- cette section pour rien. Le reste de la journée (dîner, soirée, ou
-- n'importe quelle étape propre à un mariage) est une vraie liste : un
-- couple ne suit pas tous le même déroulé, et une liste s'ajoute ou se
-- retire, contrairement à des colonnes fixes.
--
-- La FAQ suit le même principe pour la même raison : les questions par
-- défaut (transport, hébergement, dress code...) couvrent la plupart des
-- mariages, mais un couple doit pouvoir en retirer une qui ne s'applique
-- pas ou en ajouter une qui lui est propre.
--
-- Les deux sont pré-remplies à la création (cf. worker/src/db.ts,
-- PROGRAMME_PAR_DEFAUT / FAQ_PAR_DEFAUT) : un couple qui ne touche à rien
-- garde un programme et une FAQ raisonnables, jamais une page vide.

ALTER TABLE mariages ADD COLUMN heure_ceremonie TEXT; -- "HH:MM", facultatif
ALTER TABLE mariages ADD COLUMN heure_cocktail  TEXT;

CREATE TABLE programme_items (
  id          TEXT PRIMARY KEY,
  mariage_id  TEXT NOT NULL REFERENCES mariages(id) ON DELETE CASCADE,
  heure       TEXT,                        -- "HH:MM", facultatif
  titre       TEXT NOT NULL,               -- "Dîner", "Soirée dansante"...
  lieu        TEXT,                        -- facultatif, texte libre
  ordre       INTEGER NOT NULL
);

CREATE INDEX idx_programme_items_mariage ON programme_items(mariage_id, ordre);

CREATE TABLE faq_items (
  id          TEXT PRIMARY KEY,
  mariage_id  TEXT NOT NULL REFERENCES mariages(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  reponse     TEXT NOT NULL,
  ordre       INTEGER NOT NULL
);

CREATE INDEX idx_faq_items_mariage ON faq_items(mariage_id, ordre);
