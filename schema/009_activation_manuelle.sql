-- Fiche B (tunnel self-service, CLAUDE.md §8) : le mariage est créé tout de
-- suite en base, mais son sous-domaine (`<slug>.SHARED_DOMAIN`) doit être
-- ajouté à la main côté Cloudflare avant d'être réellement joignable — le
-- joker DNS/TLS qui permettrait de s'en passer n'est pas construit
-- (cf. docs/commande.md, section « Activation manuelle »). `active_le`
-- marque ce pas fait ; NULL = en attente. Sans objet pour un mariage créé
-- autrement (Fiche A, jeu d'essai) : ces chemins ne passent pas par le
-- tunnel et n'ont pas ce délai.
ALTER TABLE mariages ADD COLUMN active_le TEXT;

-- Remarque libre laissée par l'acheteur à l'écran final du tunnel (un souhait
-- sur le format du faire-part, le nom du site, autre chose à signaler avant
-- l'activation) : lue par l'admin, jamais montrée à un invité.
ALTER TABLE mariages ADD COLUMN remarque_acheteur TEXT;
