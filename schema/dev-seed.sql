-- Jeu d'essai pour le développement local. **Uniquement `--local`, jamais
-- `--remote`.**
--
-- Toutes les personnes ci-dessous sont inventées. Jamais de données d'invité
-- réelles dans le dépôt : ni fixtures, ni captures, ni exports (CLAUDE.md §5).
--
-- Couvre volontairement tous les cas que le tableau de bord doit savoir
-- montrer : une réponse oui avec accompagnant, une réponse non, une attente,
-- un régime alimentaire, un invité hors liste avec son +1, un groupe qui a sa
-- réponse écrite et un groupe qui ne l'a pas encore.
--
--   cd worker
--   npx wrangler d1 execute DB --local --file=../schema/001_init.sql
--   npx wrangler d1 execute DB --local --file=../schema/002_photo_couple_et_message_invite.sql
--   npx wrangler d1 execute DB --local --file=../schema/003_email_proprietaire.sql
--   npx wrangler d1 execute DB --local --file=../schema/004_origine_convive.sql
--   npx wrangler d1 execute DB --local --file=../schema/005_groupes.sql
--   npx wrangler d1 execute DB --local --file=../schema/010_programme_faq.sql
--   npx wrangler d1 execute DB --local --file=../schema/011_programme_unifie.sql
--   npx wrangler d1 execute DB --local --file=../schema/dev-seed.sql

DELETE FROM programme_items WHERE mariage_id = 'mdev';
DELETE FROM faq_items WHERE mariage_id = 'mdev';
DELETE FROM convives WHERE mariage_id = 'mdev';
DELETE FROM reponses_groupe WHERE mariage_id = 'mdev';
DELETE FROM mariages WHERE id = 'mdev';

-- messager renseigné explicitement : '' voudrait dire « pas d'animation », et
-- le défaut 'pigeon' du schéma pointe vers un messager qui n'existe pas (§4).
INSERT INTO mariages (
  id, slug, domaine_personnalise, theme, messager,
  prenom_1, prenom_2, date_mariage, date_limite_rsvp,
  reponse_generique_oui, reponse_generique_non,
  email_proprietaire, supprimer_le
) VALUES (
  -- domaine_personnalise = 'localhost' : le Worker résout le mariage par le
  -- Host de la requête, et en local tout arrive sur localhost, quel que soit le
  -- port. Sans ça, le faire-part local répond « Domaine non configuré ».
  'mdev', 'test', 'localhost', 'botanique', 'voiture',
  'Justine', 'Raphael', '2027-07-17', '2027-01-20',
  'Quelle joie de vous compter parmi nous !',
  'Vous nous manquerez, mais on pense fort à vous.',
  -- doit correspondre à DEV_EMAIL dans worker/wrangler.toml
  'couple@exemple.fr', '2027-10-15'
);

-- Cérémonie et cocktail sont des lignes de programme comme les autres
-- depuis schema/011_programme_unifie.sql.
INSERT INTO programme_items (id, mariage_id, heure, titre, lieu, ordre) VALUES
  ('pi1', 'mdev', '14:00', 'Cérémonie', 'Mairie de Pau, Place Royale, 64000 Pau', 0),
  ('pi2', 'mdev', '17:00', 'Cocktail', 'Domaine des Vergers', 1),
  ('pi3', 'mdev', '20:30', 'Dîner', 'Grande salle', 2),
  ('pi4', 'mdev', '23:00', 'Soirée dansante', NULL, 3);

-- Réponse écrite pour un groupe ; « Collègues » reste volontairement sans
-- réponse, pour voir l'étiquette « message à écrire » dans le tableau de bord.
INSERT INTO reponses_groupe (mariage_id, groupe, message, photo_key) VALUES
  ('mdev', 'Témoins', 'Sans vous, rien de tout ça n''existerait. À très vite !', NULL);

INSERT INTO convives
  (id, mariage_id, token, accompagnant_de, prenom, nom, message_perso, groupe, presence, regime_alimentaire, message_invite, repondu_le, origine)
VALUES
  -- message à elle + accompagnant annoncé
  ('c1', 'mdev', 'R5SMGBAN', NULL, 'Héloïse', 'MARTIN', 'Hâte de te voir danser, comme à Reims !', 'Témoins', 'oui', 'vegetarien', 'On arrive le vendredi soir.', '2026-09-20T18:30:00.000Z', 'liste'),
  ('c2', 'mdev', 'K7F2X9PQ', 'c1', 'Marc', 'MARTIN', NULL, NULL, 'oui', NULL, NULL, '2026-09-20T18:30:00.000Z', 'liste'),
  -- pas de message à lui, mais son groupe en a un
  ('c3', 'mdev', 'XH8PMQR5', NULL, 'Zoé', 'LEROY', NULL, 'Témoins', NULL, NULL, NULL, NULL, 'liste'),
  -- groupe sans réponse écrite → réponse générique
  ('c4', 'mdev', 'GD6ZDMWT', NULL, 'Camille', 'BERNARD', NULL, 'Collègues', 'non', NULL, 'Désolée, je serai à l''étranger.', '2026-09-19T09:00:00.000Z', 'liste'),
  ('c5', 'mdev', '75AESW63', NULL, 'Paul', 'MARTIN', 'On compte sur toi pour l''ambiance', 'Collègues', 'oui', 'sans_gluten', NULL, '2026-09-21T11:00:00.000Z', 'liste'),
  ('c6', 'mdev', 'XYQAWKSZ', NULL, 'Imen', 'HADDAD', NULL, NULL, 'oui', 'halal', 'On sera là avec plaisir.', '2026-09-21T14:30:00.000Z', 'liste'),
  ('c7', 'mdev', 'M4TQ8ZRW', 'c6', 'Sofia', 'HADDAD', NULL, NULL, 'oui', NULL, NULL, '2026-09-21T14:30:00.000Z', 'liste'),
  -- Arrivé sans lien personnel valable : token absent de la base, donc
  -- faire-part générique et ligne créée à la réponse (§3 règle #4). Attention,
  -- un lien *transféré* ne produit pas ce cas — il est reconnu comme son
  -- destinataire d'origine. Alice n'a jamais rien reçu : c'est Thomas qui l'a
  -- annoncée, et elle hérite de son origine.
  ('c8', 'mdev', 'VW9JNP24', NULL, 'Thomas', 'DUVAL', NULL, NULL, 'oui', NULL, 'On nous a donné l''adresse du site, on n''avait pas de lien personnel.', '2026-09-22T20:10:00.000Z', 'hors_liste'),
  ('c9', 'mdev', 'ZT6HKB83', 'c8', 'Alice', 'DUVAL', NULL, NULL, 'oui', NULL, NULL, '2026-09-22T20:10:00.000Z', 'hors_liste');
