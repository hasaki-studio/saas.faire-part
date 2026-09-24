# Suivi admin — mode d'emploi

Vue opérationnelle qui liste **tous les mariages** avec leurs métriques
agrégées : dates, jours restants, taux de réponses, avancement des messages,
statut des photos, date de purge. Utilisée par la personne qui fait tourner le
projet (aujourd'hui l'auteur, seul admin), pour savoir où sont les couples
sans avoir à ouvrir chacun de leurs tableaux de bord.

## Le périmètre — à respecter

La vue ne renvoie **que des agrégats**, jamais un nom d'invité ni un message.
C'est ce qui la rend compatible avec CLAUDE.md §2 : « aucun point d'entrée ne
liste les invités ». Les couples sont nos clients, on les connaît. Les invités
sont les leurs, ils ne sont pas listés ici. La requête SQL vit dans
`worker/src/db.ts` (`listerMariagesPourAdmin`) — la modifier pour renvoyer des
lignes de convives serait un changement de régime RGPD, pas une simple
extension. Ne jamais ajouter un `SELECT *` de convives ici.

L'assistance à un couple — se glisser dans son tableau de bord pour l'aider
sur une photo qui ne monte pas, une liste qui a un doublon — est un
**deuxième niveau** qui n'est pas construit à ce jour, et qui ne le sera pas
sans les deux préalables :

1. La mention d'information aux invités doit dire qu'un support existe.
2. Le contrat de sous-traitance signé avec le couple doit l'autoriser.

## Trois portes avant qu'une requête arrive au handler

1. **L'hôte doit être `admin.dev.faire-part.hasakistudio.fr`** (ou localhost
   avec `DEV_ADMIN_EMAIL`). Sur un autre hôte, les routes `/api/admin/*`
   tombent en 404 comme n'importe quelle URL inconnue.
2. **Le jeton Access doit être signé pour `ADMIN_ACCESS_AUD`**, distinct de
   celui du tableau de bord des couples. Un couple qui présenterait son jeton
   du tableau se verrait refuser.
3. **L'email vérifié doit figurer dans `ADMIN_EMAILS`** (variable, comparaison
   insensible à la casse). Un compte Access valide chez nous mais pas dans
   cette liste ne suffit pas.

La liste des admins vit en variable et non en base : on ne construit pas d'UI
pour gérer des admins qu'on est un, et un attaquant qui obtiendrait un accès
D1 ne peut pas s'ajouter tout seul.

## Déploiement (à faire une fois)

Comme pour le tableau de bord, sept étapes côté Cloudflare :

1. **DNS** — enregistrement `admin.dev.faire-part` (proxifié, orange).
2. **Application Access** self-hosted sur
   `admin.dev.faire-part.hasakistudio.fr`, policy *Allow* limitée à ton email
   personnel. Ne pas ajouter d'autres emails ici tant qu'on n'est qu'un.
   Relever l'**Application Audience (AUD) Tag** (Overview) — c'est la valeur
   à mettre dans `ADMIN_ACCESS_AUD` de `wrangler.toml`. Ne pas confondre avec
   l'Application ID : 64 caractères hex sans tiret, pas 36 avec tirets. Se
   tromper donne un déploiement qui réussit et une page qui répond 403 en
   silence — l'erreur a déjà été faite pour l'application du tableau, la voir
   revenir ici est facile.
3. **Projet Pages** `admin-faire-part`, connecté au dépôt, branche `main`.
   Commande de build **vide**, **Build output directory = `admin`**. Laisser
   ce champ vide publie la racine du dépôt, où il n'y a pas d'index.html
   utilisable : la racine du domaine répondrait 404 alors que
   `/admin/index.html` fonctionnerait. Rencontré une fois côté tableau de
   bord.
4. **Domaine personnalisé** `admin.dev.faire-part.hasakistudio.fr` sur ce
   projet Pages.
5. **Route Worker** — `admin.dev.faire-part.hasakistudio.fr/api/*` vers
   `faire-part-worker`. **Jamais** `*.hasakistudio.fr/*`, motif qui capterait
   tous les sous-domaines.
6. Renseigner l'AUD relevée à l'étape 2 dans `worker/wrangler.toml` (dev),
   pousser sur `main`. Le workflow redéploie le Worker seul.
7. Ouvrir `https://admin.dev.faire-part.hasakistudio.fr`, saisir le code OTP,
   vérifier que la table s'affiche avec tes mariages.

Prod : refaire les mêmes étapes avec `admin.faire-part.hasakistudio.fr`, une
autre application Access (donc un autre AUD), un autre projet Pages
`admin-faire-part-prod`. C'est le prix d'avoir dev et prod isolés
proprement.

## Tester en local

```bash
# Terminal 1 : le Worker
wrangler dev

# Terminal 2 : la page admin, servie sur 8082
node proxy-local.js --admin
```

Sur `localhost`, `DEV_ADMIN_EMAIL` fait office de connexion simulée pour
l'hôte admin — la même mécanique que `DEV_EMAIL` pour le tableau de bord des
couples. La variable est absente du bloc `[env.prod.vars]` : deux verrous
plutôt qu'un, une variable oubliée en prod ne suffirait pas à ouvrir la vue.
