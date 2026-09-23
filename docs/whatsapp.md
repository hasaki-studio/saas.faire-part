# L'aperçu WhatsApp

Tous les liens partent par WhatsApp. L'aperçu — la vignette avec la photo, les
prénoms et la date — est **la première chose que voit un invité**, avant même
d'ouvrir le lien. Sans lui, le lien arrive en texte brut : sur un faire-part,
ça fait « lien suspect ».

## La règle qui commande tout le reste

**WhatsApp garde l'aperçu en mémoire plusieurs semaines et n'offre aucun moyen
de le rafraîchir.** Une fois qu'un lien est parti avec un mauvais aperçu, il
garde ce mauvais aperçu jusqu'à expiration du cache, pour tout le monde.

Conséquence pratique : l'aperçu se valide **avant** le premier envoi réel, sur
une URL jetable. Jamais sur le lien d'un vrai invité.

## Comment c'est fabriqué

Le robot de WhatsApp n'exécute pas de JavaScript. Or le thème charge tout son
contenu après coup, via `/api/faire-part/<token>` : le robot ne verrait qu'une
coquille vide. Les balises sont donc écrites **côté serveur**, avant que la page
ne parte :

```
navigateur/robot → Pages → functions/_middleware.js
                              └→ GET /api/og (Worker) → D1
                           réécrit le <head> en flux
```

Trois propriétés de ce montage, toutes voulues :

- L'accès à la base reste dans le Worker (CLAUDE.md §2) ; le middleware ne
  connaît que l'API, il n'a pas de binding D1.
- Si l'API ne répond pas, la page est servie quand même, avec les balises de
  repli neutres du thème. L'invité qui ouvre le lien compte plus que l'aperçu
  de celui qui l'envoie.
- L'aperçu ne dit **rien d'un invité** — seulement les prénoms du couple et les
  dates. Un lien transféré dans une conversation de groupe y affiche sa
  vignette : elle n'a pas à nommer son destinataire.

`og:url` reprend l'URL demandée, token compris : c'est la cible du clic dans la
vignette. La remplacer par la racine ferait perdre son lien personnel à
l'invité.

## L'image

| | |
|---|---|
| Dimensions | **1200 × 630** |
| Poids | **moins de 600 Ko** |
| Format | JPG, PNG ou WebP — **ni SVG ni GIF**, WhatsApp les ignore |
| Emplacement | R2, clé `og/<mariage>-v1.jpg` |
| Colonne | `mariages.og_image_key` |

Ce n'est pas la photo du couple : celle-ci est un portrait 640 × 840, l'aperçu
veut un paysage. À défaut d'image dédiée, le Worker retombe sur la photo du
couple — aperçu mal cadré, mais mieux qu'un lien nu. `/api/og` renvoie
`image_dediee: false` dans ce cas, ce qui permet de le diagnostiquer sans
ouvrir la base.

```bash
cd worker
npx wrangler r2 object put faire-part-photos-dev/og/justine-raphael-v1.jpg \
  --file=apercu.jpg --content-type=image/jpeg
npx wrangler d1 execute DB --remote \
  --command="UPDATE mariages SET og_image_key='og/justine-raphael-v1.jpg' WHERE slug='justine-raphael'"
```

Le `-v1` dans le nom de fichier sert au remplacement : une image remplacée sous
le même nom reste dans le cache des aperçus déjà générés. Incrémenter.

## Protocole de validation, avant le premier envoi

1. Vérifier que **Bot Fight Mode est désactivé** sur le domaine. Il bloque le
   robot de WhatsApp, et l'aperçu échoue alors **sans aucun message d'erreur**.
2. Vérifier ce que voit le robot, sans passer par WhatsApp :
   ```bash
   curl -s https://<domaine>/test-VALIDATION1 | grep 'og:'
   ```
   Les balises doivent y être **dans le HTML brut**. Si elles n'y sont pas, le
   middleware n'est pas déployé ou l'API ne répond pas.
3. S'envoyer à soi-même, dans une conversation WhatsApp avec soi-même, une URL
   **jetable** : `https://<domaine>/test-VALIDATION1`. Un token inconnu donne le
   faire-part générique, jamais un 404 (§3), donc l'aperçu se teste sans toucher
   au lien de personne.
4. L'aperçu est faux ? Corriger, puis retester avec `VALIDATION2`, `VALIDATION3`…
   **Ne jamais retester la même URL** : elle renverra l'aperçu mis en cache, et
   on conclura à tort que la correction n'a pas marché.
5. Une fois l'aperçu validé, alors seulement diffuser les liens des invités.

## Le reste du <head>

Les pages portent `noindex, nofollow`. Un lien à token n'a rien à faire dans un
index de moteur de recherche, et la liste des invités se déduirait des URL
indexées.
