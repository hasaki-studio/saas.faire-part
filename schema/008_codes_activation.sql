-- Codes d'activation du tunnel self-service (Fiche B Etsy, CLAUDE.md §8).
--
-- Une ligne = une vente. Le couple qui achète sur Etsy reçoit un PDF qui
-- renvoie vers commande.faire-part.hasakistudio.fr ; il y saisit son numéro
-- de commande Etsy et l'email de sa commande, et le Worker les compare à
-- cette table pour décider s'il peut créer un mariage.
--
-- Aujourd'hui, la ligne est ajoutée à la main depuis le tableau admin dès
-- qu'une vente arrive — il n'y a pas encore d'intégration Etsy API, la
-- boutique elle-même n'existe pas encore. Le jour où l'API sera branchée
-- (lot 3, cf. CLAUDE.md §8), c'est elle qui écrira ces lignes automatiquement ;
-- le tunnel de vérification ne changera pas, seule la source de la ligne change.
--
-- L'email n'est pas vérifié contre une source de vérité tierce à ce stade :
-- c'est celui que l'admin a recopié depuis la commande Etsy réelle. C'est un
-- proxy manuel de "vérifié", pas une preuve cryptographique — suffisant tant
-- qu'un humain lit chaque commande avant de créer la ligne.
CREATE TABLE codes_activation (
  id              TEXT PRIMARY KEY,
  commande_etsy   TEXT NOT NULL,        -- ex. "1234567890", tel qu'affiché sur Etsy
  email           TEXT NOT NULL,        -- email de la commande Etsy

  cree_le         TEXT NOT NULL DEFAULT (datetime('now')),

  -- NULL = pas encore utilisé. Un code ne sert qu'une fois : sans cette
  -- colonne, un acheteur qui retape son numéro de commande créerait un
  -- nouveau mariage à chaque tentative.
  consomme_le     TEXT,
  mariage_id      TEXT REFERENCES mariages(id)
);

-- Un numéro de commande Etsy est unique côté Etsy ; le répéter chez nous
-- serait une erreur de saisie de l'admin, pas un cas légitime.
CREATE UNIQUE INDEX idx_codes_activation_commande ON codes_activation(commande_etsy);
