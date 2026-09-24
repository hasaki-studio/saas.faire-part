# Liens du projet

Où sont les choses. Les identifiants et jetons ne sont pas ici : ceux qui
comptent vivent dans `worker/wrangler.toml` (les hôtes et l'AUD) ou en variable
d'environnement (rien ne doit être commité en clair, cf. CLAUDE.md §6).

## Dépôt

| Quoi | Où |
|---|---|
| Dépôt GitHub (privé) | https://github.com/hasaki-studio/saas.faire-part |
| Pull requests | https://github.com/hasaki-studio/saas.faire-part/pulls |
| GitHub Actions (déploiement Worker) | https://github.com/hasaki-studio/saas.faire-part/actions |
| Branche de travail Claude | https://github.com/hasaki-studio/saas.faire-part/tree/claude/kind-hamilton-a41two |

## Applications en dev

Ce qui tourne aujourd'hui.

| Quoi | Adresse |
|---|---|
| Tableau de bord du couple (Cloudflare Pages) | https://tableau.dev.faire-part.hasakistudio.fr |
| Suivi admin (à créer côté Cloudflare, cf. `docs/admin.md`) | https://admin.dev.faire-part.hasakistudio.fr |
| API Worker (URL directe, utile pour `curl`) | https://faire-part-worker.azouzi-achraf.workers.dev |
| Faire-part invité, par slug (offre catalogue) | `https://<slug>.dev.faire-part.hasakistudio.fr/<prenom>-<TOKEN>` |
| Faire-part invité, par domaine dédié (offre sur-mesure) | `https://mariage-<prenoms>.fr/<prenom>-<TOKEN>` |
| Photos R2 (public) | https://photos-dev.hasakistudio.fr |
| Base D1 (nom du binding) | `faire-part-dev` |
| Bucket R2 | `faire-part-photos-dev` |

Rappel §3 règle 4 : un token inconnu **ne** doit **jamais** renvoyer un 404
mais un faire-part générique avec une ligne sobre. Un 404 confirmerait le
format à un attaquant.

## Applications en prod

Rien de tout ceci n'existe encore ; les entrées listent le nom attendu quand
elles seront créées, pour que la migration se fasse en remplaçant les valeurs
correspondantes dans `worker/wrangler.toml` (section `[env.prod]`).

| Quoi | Adresse prévue |
|---|---|
| Domaine de marque (à acheter) | `unouiunehistoire.fr` — décision CLAUDE.md §8 |
| Tableau de bord | `tableau.faire-part.hasakistudio.fr` |
| Suivi admin | `admin.faire-part.hasakistudio.fr` |
| Faire-part invité (catalogue) | `<slug>.faire-part.hasakistudio.fr/<prenom>-<TOKEN>` |
| Photos R2 (public) | `photos.hasakistudio.fr` |
| Base D1 | `faire-part-prod` (à créer avec `wrangler d1 create`) |
| Bucket R2 | `faire-part-photos-prod` |

L'application Access de prod n'est pas encore créée non plus. Le team domain
reste `small-bird-358e.cloudflareaccess.com` — pas de renommage prévu, cf. §8
« Questions non tranchées ».

## Consoles internes (usage propriétaire du compte)

| Quoi | Où |
|---|---|
| Tableau de bord Cloudflare | https://dash.cloudflare.com |
| Workers & Pages | https://dash.cloudflare.com/?to=/:account/workers-and-pages |
| D1 (bases, console SQL) | https://dash.cloudflare.com/?to=/:account/workers/d1 |
| R2 (buckets, objets) | https://dash.cloudflare.com/?to=/:account/r2/overview |
| Zero Trust (Access, Custom Pages) | https://one.dash.cloudflare.com |
| Page de connexion Access (ce que voient les mariés) | https://small-bird-358e.cloudflareaccess.com |

Note : le team domain n'a **rien à voir** avec `hasakistudio.fr`. Cloudflare
l'attribue à l'inscription à Zero Trust sous une forme tirée au sort. Le
deviner d'après la marque ne marche pas — l'avoir supposé a coûté une soirée
de 403 silencieux (cf. commit « Corrige le team domain Access »).

## Documentation dans ce dépôt

| Fichier | Sujet |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Contexte du projet — à lire en premier |
| [`docs/tableau-de-bord.md`](tableau-de-bord.md) | Déploiement Pages + Access, pièges |
| [`docs/deploiement.md`](deploiement.md) | Déploiement du Worker depuis le navigateur |
| [`docs/whatsapp.md`](whatsapp.md) | Open Graph, cache, Bot Fight Mode |
| [`docs/photos.md`](photos.md) | Formats, HEIC, orientation EXIF |
| [`docs/rgpd.md`](rgpd.md) | Mention d'information et purge J+90 |
| [`docs/admin.md`](admin.md) | Vue de suivi admin, périmètre et déploiement |
| [`docs/etsy.md`](etsy.md) | Contenu des deux fiches Etsy, prix, tags, workflow |
| [`docs/etsy/pdf-fiche-b.md`](etsy/pdf-fiche-b.md) | Contenu du PDF téléchargeable de la Fiche B |
| [`docs/liens.md`](liens.md) | Ce fichier |

## Références externes utiles

| Sujet | Où |
|---|---|
| Cloudflare Workers | https://developers.cloudflare.com/workers/ |
| Cloudflare Pages | https://developers.cloudflare.com/pages/ |
| D1 (SQLite hébergé) | https://developers.cloudflare.com/d1/ |
| R2 (stockage objet) | https://developers.cloudflare.com/r2/ |
| Access (Zero Trust) | https://developers.cloudflare.com/cloudflare-one/applications/ |
| Rate Limiting binding Workers | https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ |
| Wrangler (CLI) | https://developers.cloudflare.com/workers/wrangler/ |
| CNIL — modèles de contrat de sous-traitance (RGPD art. 28) | https://www.cnil.fr/fr/rgpd-exemple-de-clauses-de-sous-traitance |
