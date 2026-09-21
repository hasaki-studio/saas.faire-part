-- Deux champs manquants dans 001, découverts en branchant le thème sur l'API :
-- - photo_couple_key : la photo des mariés vit aussi dans R2, comme celle du cocktail.
-- - message_invite : le mot (optionnel) que l'invité laisse aux mariés sur son RSVP,
--   distinct de message_perso qui est le mot des mariés à l'invité (retour personnalisé).

ALTER TABLE mariages ADD COLUMN photo_couple_key TEXT;
ALTER TABLE convives ADD COLUMN message_invite TEXT;
