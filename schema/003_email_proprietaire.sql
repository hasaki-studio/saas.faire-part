-- Relie un mariage à l'email du couple qui le possède. C'est cette colonne qui
-- porte l'isolation du tableau de bord : le Worker déduit le mariage de
-- l'identité authentifiée par Cloudflare Access, jamais d'un paramètre envoyé
-- par le navigateur (D1 n'a pas de RLS, l'autorisation vit dans le code —
-- cf. CLAUDE.md §2).
--
-- Nullable : les mariages existants n'en ont pas, et un mariage sans
-- propriétaire est simplement inaccessible depuis le tableau de bord.

ALTER TABLE mariages ADD COLUMN email_proprietaire TEXT;

CREATE INDEX idx_mariages_email_proprietaire ON mariages(email_proprietaire);
