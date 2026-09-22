# Tableau de bord du couple — mise en service

Le tableau de bord est la deuxième surface du produit. Il ne partage **ni son
hôte ni son régime d'authentification** avec la page des invités :

| | Invités | Tableau de bord |
|---|---|---|
| Hôte | `<slug>.dev.faire-part.hasakistudio.fr` | `tableau.dev.faire-part.hasakistudio.fr` |
| Accès | ouvert, un token par invité | Cloudflare Access (code OTP) |
| Routes Worker | `/api/faire-part/*`, `/api/rsvp/*` | `/api/tableau/*` |

Deux hôtes parce qu'un seul ne peut pas être les deux : l'API des invités doit
rester joignable sans authentification, et mettre Access devant elle fermerait
le faire-part à tout le monde.

## L'isolation, en une phrase

Le `mariage_id` est déduit de l'email authentifié (`mariages.email_proprietaire`),
**jamais d'un paramètre envoyé par le navigateur**. Une route qui accepterait
`?mariage_id=…` laisserait un couple lire la liste d'invités d'un autre — D1 n'a
pas de RLS, l'autorisation vit entièrement dans le code du Worker (CLAUDE.md §2).

Le Worker **vérifie la signature** du jeton Access plutôt que de lire l'en-tête
`Cf-Access-Authenticated-User-Email`. Un en-tête se forge ; tant que la requête
traverse Access il est fiable, mais une règle mal écrite ou une route trop large
suffirait à laisser n'importe qui se déclarer propriétaire de n'importe quel
mariage. Test de non-régression, à refaire après toute modification du routage :

```bash
curl -s -H "Host: tableau.faire-part.hasakistudio.fr" \
     -H "Cf-Access-Authenticated-User-Email: couple@exemple.fr" \
     https://tableau.faire-part.hasakistudio.fr/api/tableau/convives
# attendu : {"erreur":"Non authentifié"} — 403
```

## Mise en service

1. **Migration** — `wrangler d1 execute DB --remote --file=schema/003_email_proprietaire.sql`
2. **Rattacher le mariage à son couple** :
   ```sql
   UPDATE mariages SET email_proprietaire = 'adresse@du-couple.fr' WHERE slug = '<slug>';
   ```
   Un mariage sans `email_proprietaire` est simplement invisible depuis le
   tableau de bord ; c'est l'état par défaut, et c'est le bon.
3. **DNS** — enregistrement `tableau.dev.faire-part` (proxifié, orange).
4. **Pages** — un projet servant `dashboard/`, avec ce sous-domaine en domaine
   personnalisé.
5. **Access** — une application self-hosted sur `tableau.dev.faire-part.hasakistudio.fr`,
   politique *Allow* limitée aux emails des couples (un email par mariage, ajouté
   à la main : **il n'y a pas d'inscription libre**, et il ne doit pas y en avoir
   tant qu'on vend en direct). Relever l'**Application Audience (AUD)** dans
   l'onglet Overview et la reporter dans `worker/wrangler.toml` (`ACCESS_AUD`).
6. **Route Worker** — `tableau.dev.faire-part.hasakistudio.fr/api/*` vers
   `faire-part-worker`. Ne **jamais** utiliser `*.hasakistudio.fr/*` : ce motif
   capterait tous les sous-domaines du compte.
7. `wrangler deploy`.

L'email saisi dans Access et celui de `email_proprietaire` doivent être
identiques (comparaison en minuscules). Un couple autorisé par Access mais
rattaché à aucun mariage reçoit le même 403 qu'un visiteur non authentifié :
on ne confirme pas quelles adresses existent en base.

## En local

Il n'y a pas d'Access devant `wrangler dev`, donc pas de jeton à vérifier. La
variable `DEV_EMAIL` simule la connexion — uniquement sur `localhost`, et elle
est absente de `[env.prod.vars]`. Deux verrous plutôt qu'un : une variable
oubliée en production ne suffirait pas à ouvrir le tableau de bord.

```bash
cd worker && npx wrangler dev          # API sur :8787
node proxy-local.js --tableau          # tableau de bord sur :8081
```

## Ce qu'il fait, et ce qu'il ne fait pas encore

Fait : cinq indicateurs en tête (réponses oui, personnes à table, réponses non,
taux de réponse, sans réponse), répartition des réponses en anneau, régimes &
allergies, avancement de la saisie des messages, et la liste de récap avec
filtres, recherche et tri par colonne. Copie du lien personnel invité par
invité, export CSV pour le traiteur — construit dans le navigateur à partir des
données déjà chargées, donc sans route supplémentaire à protéger.

Deux comptages à ne pas confondre, et c'est la raison d'être de deux
indicateurs séparés : **un accompagnant ne répond pas**, il est annoncé. Il
compte dans « personnes à table », jamais dans le taux de réponse — sinon
celui-ci dépasse 100 % dès qu'un invité vient accompagné. Même logique dans la
carte des régimes : un accompagnant sans régime renseigné n'est pas « sans
contrainte », il est **à déterminer** (barre hachurée), parce que le formulaire
ne pose la question qu'à la personne qui répond. Donner au traiteur ces deux-là
dans la même barre, c'est lui donner un chiffre faux.

Repris du tableau de bord `Mon-Mariage`, mais **pas portable en l'état** : le
suivi des relances et la courbe cumulée. Les deux reposaient sur l'email de
chaque invité (`invites.csv`, `relances.csv`) ; ici les liens partent par
WhatsApp et `convives` n'a pas de colonne email. Un suivi des relances
demanderait d'abord de décider ce qu'on enregistre — date d'envoi du lien, date
de chaque relance — et où. À trancher quand le besoin se posera pour de vrai,
c'est-à-dire en avril.

Pas encore fait : **aucune écriture**. Les messages personnalisés et les photos
se saisissent encore en base. C'est délibéré pour cette première tranche : une
route d'écriture mal cadrée est plus coûteuse qu'une lecture mal cadrée, et les
indicateurs du tableau de bord seront choisis une fois les vraies données sous
les yeux.
