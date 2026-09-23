-- Image d'aperçu WhatsApp, propre au mariage.
--
-- Pourquoi une colonne à part plutôt que réutiliser photo_couple_key : les deux
-- emplacements n'ont pas le même cadrage. La photo du couple est un portrait
-- 640 × 840 ; l'aperçu WhatsApp veut un paysage 1200 × 630 de moins de 600 Ko
-- (CLAUDE.md §7). Servir l'un à la place de l'autre donne un aperçu rogné au
-- petit bonheur, et l'aperçu est ce que voient tous les invités avant même
-- d'ouvrir le lien.
--
-- Nullable : sans elle, le Worker retombe sur la photo du couple — un aperçu
-- mal cadré reste préférable à un lien nu, qui fait « lien suspect » sur un
-- faire-part.

ALTER TABLE mariages ADD COLUMN og_image_key TEXT;
