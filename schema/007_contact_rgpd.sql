-- Contact du couple pour les demandes RGPD.
--
-- Le couple est responsable de traitement, nous sommes sous-traitant
-- (CLAUDE.md §5). C'est donc à lui qu'un invité adresse une demande d'accès ou
-- d'effacement, et l'article 13 du RGPD veut que la mention d'information
-- donne de quoi le joindre.
--
-- Nullable, et c'est voulu : les liens partent par WhatsApp, donc l'invité a
-- déjà un canal vers les mariés. Sans cette colonne, le faire-part dit
-- « répondez au message par lequel vous avez reçu ce lien » — vrai, suffisant
-- pour un événement privé, et ça n'expose aucune adresse de plus. Le couple qui
-- préfère une adresse explicite la met ici, en sachant qu'elle sera publique
-- sur une page que tous ses invités ouvrent.
--
-- Séparée de email_proprietaire : celle-là sert à l'authentification du tableau
-- de bord et n'a aucune raison d'être affichée à qui que ce soit.

ALTER TABLE mariages ADD COLUMN contact_rgpd TEXT;
