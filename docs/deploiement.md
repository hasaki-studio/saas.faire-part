# Déployer sans terminal

Tout ce qui suit se fait depuis un navigateur. C'est délibéré : le projet doit
rester pilotable depuis un poste où l'on ne peut rien installer.

## Ce qui se déploie tout seul

| Quoi | Déclencheur |
|---|---|
| Le Worker (API) | fusion sur `main` touchant `worker/`, ou bouton **Run workflow** dans l'onglet Actions |
| Le front (Pages) | chaque push, si le projet Pages est connecté au dépôt |

Le workflow est `.github/workflows/deploy-worker.yml`. Il vérifie les types
avant de déployer : le RSVP d'un client tourne sur ce Worker un samedi de juin,
on n'y envoie pas du TypeScript qui ne compile pas.

## Mise en place, une seule fois

### 1. Créer le jeton d'API Cloudflare

Tableau de bord Cloudflare → **Manage Account → Account API Tokens → Create
Token** → modèle **Edit Cloudflare Workers**.

Dans *Account Resources*, restreindre au **seul compte** concerné. Ne pas
laisser « All accounts » : ce jeton peut déployer du code, c'est la clé la plus
puissante du projet.

Copier la valeur affichée — elle ne sera plus jamais montrée.

Relever aussi l'**Account ID**, visible dans l'URL du tableau de bord
(`dash.cloudflare.com/<account_id>/...`) ou dans le panneau latéral d'un Worker.

### 2. Déposer les deux secrets dans GitHub

Dépôt → **Settings → Secrets and variables → Actions → New repository secret** :

| Nom | Valeur |
|---|---|
| `CLOUDFLARE_API_TOKEN` | le jeton créé à l'étape 1 |
| `CLOUDFLARE_ACCOUNT_ID` | l'identifiant de compte |

Un secret déposé là n'apparaît jamais dans le dépôt ni dans les journaux. **Ne
jamais le coller dans un fichier** : un jeton commité reste dans l'historique
git pour toujours, même en dépôt privé (CLAUDE.md §6).

### 3. Vérifier que ça marche

Onglet **Actions** → *Déployer le Worker* → **Run workflow**. Le premier
lancement sert de test : s'il est vert, tous les suivants partiront tout seuls
à la fusion.

## Les migrations, elles, restent manuelles

Les fichiers de `schema/` ne sont **pas rejouables** — `ALTER TABLE ADD COLUMN`
échoue si la colonne existe déjà. Les lancer automatiquement casserait le
déploiement au deuxième passage, et un déploiement rouge un samedi de juin
coûte plus cher que trente secondes de copier-coller.

Au navigateur : Cloudflare → **Workers & Pages → D1 → faire-part-dev →
Console**. Coller le contenu du fichier, exécuter, une fois.

Dans l'ordre, et une seule fois chacune :

```
schema/001_init.sql
schema/002_photo_couple_et_message_invite.sql
schema/003_email_proprietaire.sql
schema/004_origine_convive.sql
schema/005_groupes.sql
schema/006_og_image.sql
```

**Jamais `schema/dev-seed.sql` sur la base distante** : il écraserait un mariage
réel. C'est un jeu d'essai local, rien d'autre.

## Ordre conseillé pour mettre le tableau de bord en ligne

1. Les migrations 003 à 006 (ci-dessus).
2. Le jeton et les secrets (§1 et §2), puis un **Run workflow** pour que le
   Worker connaisse les routes `/api/tableau/*` et `/api/og`.
3. `UPDATE mariages SET email_proprietaire='<votre email>' WHERE slug='<slug>'`
   depuis la console D1 — sans ça le tableau de bord ne montre rien.
4. Le projet Pages du tableau de bord, son sous-domaine et son application
   Access : les 7 étapes de `docs/tableau-de-bord.md`.
5. L'aperçu WhatsApp : `docs/whatsapp.md`.

## Et la production ?

Le workflow déploie l'environnement par défaut, celui de
`dev.faire-part.hasakistudio.fr`. L'environnement `prod` attend encore sa base :
`database_id` vaut `REMPLACER_APRES_wrangler_d1_create` dans `wrangler.toml`.
Tant que c'est le cas, un déploiement `--env prod` échouerait.
