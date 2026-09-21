-- Fondations multi-tenant : un mariage, ses convives.
-- Migration numérotée : ne jamais modifier ce fichier après application (cf. CLAUDE.md §6).
-- Ajouter un nouveau fichier 00X_xxx.sql pour toute évolution ultérieure.

CREATE TABLE mariages (
  id                      TEXT PRIMARY KEY,
  slug                    TEXT NOT NULL UNIQUE,     -- sous-domaine partagé : <slug>.SHARED_DOMAIN
  domaine_personnalise    TEXT UNIQUE,               -- domaine dédié optionnel (ex: mariage-x-y.fr), NULL sinon

  theme                   TEXT NOT NULL DEFAULT 'botanique',
  messager                TEXT NOT NULL DEFAULT 'pigeon',

  prenom_1                TEXT NOT NULL,
  prenom_2                TEXT NOT NULL,
  date_mariage            TEXT NOT NULL,             -- ISO 8601 (YYYY-MM-DD)
  date_limite_rsvp        TEXT NOT NULL,

  ceremonie_nom           TEXT,
  ceremonie_adresse       TEXT,                      -- NULL si le couple ne veut pas la diffuser publiquement
  cocktail_nom            TEXT,
  cocktail_adresse        TEXT,
  cocktail_photo_key      TEXT,                      -- clé R2, NULL si pas encore uploadée

  reponse_generique_oui   TEXT NOT NULL,             -- 2 réponses génériques obligatoires (cf. CLAUDE.md §4)
  reponse_generique_non   TEXT NOT NULL,

  cree_le                 TEXT NOT NULL DEFAULT (datetime('now')),
  supprimer_le            TEXT NOT NULL              -- date_mariage + 90 jours, calculé à l'insertion (RGPD, cf. CLAUDE.md §5)
);

CREATE UNIQUE INDEX idx_mariages_slug          ON mariages(slug);
CREATE UNIQUE INDEX idx_mariages_domaine       ON mariages(domaine_personnalise);
CREATE INDEX idx_mariages_supprimer_le         ON mariages(supprimer_le);

-- Un invité = une ligne. Un accompagnant = une autre ligne, jamais un compteur (cf. CLAUDE.md §4).
CREATE TABLE convives (
  id                    TEXT PRIMARY KEY,
  mariage_id            TEXT NOT NULL REFERENCES mariages(id) ON DELETE CASCADE,
  token                 TEXT NOT NULL UNIQUE,        -- immuable, jamais régénéré (cf. CLAUDE.md §3)
  accompagnant_de       TEXT REFERENCES convives(id) ON DELETE CASCADE, -- NULL = invité principal

  prenom                TEXT NOT NULL,
  nom                   TEXT NOT NULL,

  message_perso         TEXT,                        -- vide = offre catalogue, réponse générique utilisée
  photo_key             TEXT,                         -- clé R2, vide = offre catalogue

  presence              TEXT CHECK (presence IS NULL OR presence IN ('oui', 'non')),
  regime_alimentaire    TEXT CHECK (
    regime_alimentaire IS NULL OR
    regime_alimentaire IN ('vegetarien', 'vegan', 'halal', 'casher', 'sans_gluten')
  ),
  repondu_le            TEXT
);

CREATE UNIQUE INDEX idx_convives_token   ON convives(token);
CREATE INDEX idx_convives_mariage        ON convives(mariage_id);
CREATE INDEX idx_convives_accompagnant   ON convives(accompagnant_de);
