# Tableau de bord du couple — mise en service

> À ne pas confondre avec le tableau de bord n8n du projet `Mon-Mariage`, qui
> est en ligne et ne sert qu'au suivi du mariage de l'auteur. Celui-ci est
> celui du produit, multi-tenant, et n'est pas encore déployé.

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
   personnalisé. Commande de build **vide** (pas de framework, c'est du HTML
   natif) et **Build output directory = `dashboard`**. Laisser ce champ vide
   publie la racine du dépôt, où il n'y a pas d'`index.html` : la racine du
   domaine répond 404 alors que `/dashboard/index.html` fonctionne.
5. **Access** — une application self-hosted sur `tableau.dev.faire-part.hasakistudio.fr`,
   politique *Allow* limitée aux emails des couples (un email par mariage, ajouté
   à la main : **il n'y a pas d'inscription libre**, et il ne doit pas y en avoir
   tant qu'on vend en direct). Relever l'**Application Audience (AUD) Tag** dans
   l'onglet Overview et le reporter dans `worker/wrangler.toml` (`ACCESS_AUD`).
   L'**Application ID**, affiché juste à côté, n'est pas la même valeur : l'AUD
   fait 64 caractères hexadécimaux sans tiret, l'Application ID est un UUID de
   36 caractères avec tirets. Prendre l'un pour l'autre donne un déploiement qui
   réussit et un tableau de bord qui répond 403 à chaque requête, page vide et
   sans message utile.

   Relever au passage le **Team domain** (Settings > Custom Pages) et le reporter
   dans `ACCESS_TEAM_DOMAIN`. Cloudflare l'attribue à l'inscription et il ne
   ressemble à rien de connu — `small-bird-358e.cloudflareaccess.com` chez nous.
   Le déduire du nom de la marque ne marche pas : sans lui, le Worker ne peut pas
   télécharger les clés publiques d'Access et répond 403 à tout, exactement comme
   si l'AUD était faux.
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

Sur une base locale vide, jouer les migrations puis le jeu d'essai — des
personnes inventées, jamais d'invités réels (§5) :

```bash
cd worker
npx wrangler d1 execute DB --local --file=../schema/001_init.sql
npx wrangler d1 execute DB --local --file=../schema/002_photo_couple_et_message_invite.sql
npx wrangler d1 execute DB --local --file=../schema/003_email_proprietaire.sql
npx wrangler d1 execute DB --local --file=../schema/004_origine_convive.sql
npx wrangler d1 execute DB --local --file=../schema/005_groupes.sql
npx wrangler d1 execute DB --local --file=../schema/dev-seed.sql
```

Puis deux terminaux, l'un pour l'API, l'autre pour la page :

```bash
cd worker && npx wrangler dev          # API sur :8787
node proxy-local.js --tableau          # tableau de bord sur :8081
```

`no such table: mariages` signifie simplement que les migrations n'ont pas été
jouées sur la base **locale** (elle est distincte de la base `--remote`).

## Ce qu'il fait, et ce qu'il ne fait pas encore

Fait : cinq indicateurs en tête (réponses oui, personnes à table, réponses non,
taux de réponse, sans réponse), répartition des réponses en anneau, régimes &
allergies, avancement de la saisie des messages, et la liste de récap avec
filtres, recherche et tri par colonne — dont un filtre « hors liste », qui
isole les réponses arrivées avec un token inconnu (`convives.origine`) et les
sort du taux de réponse : le dénominateur, c'est la liste déposée par le
couple, pas ce qui lui est arrivé en plus. Copie du lien personnel invité par
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

La carte « Messages personnalisés » compte les invités qui reçoivent **un mot
écrit pour eux**, individuel ou de groupe — phrase, jauge et pourcentage disent
tous les trois la même chose, sans quoi le couple ne sait plus où il en est. Le
filtre « Réponse générique » est sa contrepartie : la liste de ce qu'il reste à
écrire. Les pastilles sous la jauge disent quel groupe attend encore son
message.

Repris du tableau de bord `Mon-Mariage`, mais **pas portable en l'état** : le
suivi des relances et la courbe cumulée. Les deux reposaient sur l'email de
chaque invité (`invites.csv`, `relances.csv`) ; ici les liens partent par
WhatsApp et `convives` n'a pas de colonne email. Un suivi des relances
demanderait d'abord de décider ce qu'on enregistre — date d'envoi du lien, date
de chaque relance — et où. À trancher quand le besoin se posera pour de vrai,
c'est-à-dire en avril.

**Le couple dépose sa liste lui-même**, comme l'exige §5 — ne jamais la
recevoir par mail ou WhatsApp, ce serait en détenir une copie non maîtrisée.

Le chemin principal est **le collage** : la liste vit dans un tableur, et
« exportez en CSV » est l'étape où les gens décrochent. Coller des cellules
donne du texte séparé par des tabulations, sans fichier, sans encodage, sans
séparateur à deviner. Le fichier reste en secours, avec ses deux pièges :
Excel français exporte en **point-virgule** et en **Windows-1252**, tous deux
détectés — on lit en UTF-8, et des caractères de remplacement font relire dans
l'autre encodage.

L'ordre des colonnes n'est jamais imposé : on lit la ligne d'en-tête, avec des
variantes tolérées (`prénom`/`prenom`/`first name`…). Sans en-tête reconnu, la
page demande quelle colonne est quoi, plutôt que de deviner — imposer l'ordre
garantirait l'inversion prénom / nom un jour ou l'autre.

**Rien n'entre en base sans aperçu** : les premières lignes, les alertes
(prénom manquant, doublon, étiquettes de groupe voisines) et le bilan. L'aperçu
dit aussi **quelles colonnes ont été lues et lesquelles ont été écartées** —
sans ça, on ne sait pas si une colonne a été comprise puis ignorée ou
simplement perdue, et dans un champ de collage les tabulations ne s'alignent
pas, ce qui donne l'impression d'un décalage qui n'existe pas.

Les colonnes `email` et `telephone` sont couramment présentes dans les listes
des couples : elles sont reconnues et écartées. Le produit n'a pas de champ
email — les liens partent par WhatsApp, à l'initiative du couple.

Et le contrôle qui compte vraiment : **réimporter ne régénère jamais un
token**. Un couple qui ajoute dix personnes en mars redépose souvent sa liste
entière ; recréer les lignes existantes invaliderait autant de liens déjà
envoyés, parfois imprimés (§3, règle 3). La comparaison se fait sur
prénom + nom sans accent ni casse, côté serveur, et vaut aussi à l'intérieur du
fichier déposé. L'aperçu l'annonce : « 10 nouveaux, 97 déjà dans votre liste —
leurs liens sont conservés ».

**Deux onglets, parce que le couple a deux métiers séparés dans le temps.** En
novembre il écrit cent messages, sans aucune réponse à suivre ; en avril il suit
les réponses et prépare le traiteur. Une page qui fait les deux à la fois ne
fait bien ni l'un ni l'autre : elle accueillait le couple avec des compteurs à
zéro, un anneau vide et un tableau de dix colonnes dont huit étaient des tirets,
en cachant l'écriture derrière un clic sur une cellule que personne ne devine.

- **Messages** — une fiche par invité : le prénom, son groupe, un grand champ de
  texte, la photo à côté. Filtre par défaut « à écrire », donc la page s'ouvre
  sur le travail qui reste. Dans cet onglet, les invités ne sont pas à trouver,
  ils *sont* la page. **Filtrer sur un groupe place son message commun en tête
  de la liste** : on écrit le message du groupe là où l'on regarde ses invités,
  et l'on voit aussitôt lesquels basculent de « générique » à « message de
  groupe ».
- **Réponses** — le tableau de suivi, ses filtres, ses graphiques et l'export
  traiteur.

L'onglet ouvert au chargement dépend de l'état : tant qu'un invité n'a pas son
mot, c'est Messages ; une fois tout écrit, le suivi devient le sujet.

**L'écriture des messages**, au fil de l'eau : on clique sur ce que la cellule
« Retour prévu » annonce, l'éditeur se déplie sous la ligne, et le texte part
tout seul 700 ms après la dernière frappe — ainsi qu'à la sortie du champ, pour
qu'un onglet fermé dans la seconde ne perde rien. Pas de bouton Enregistrer :
un couple qui rédige trente messages ne doit jamais se demander s'il a perdu le
précédent (CLAUDE.md §4). Les messages de groupe s'écrivent en cliquant leur
pastille. Vider un champ est une action légitime : l'invité revient à la
réponse générique, et le groupe vidé disparaît de la table.

Trois contrôles sur les routes d'écriture, chacun pour une raison distincte :

- le `mariage_id` de la clause `WHERE` vient de l'identité authentifiée, jamais
  de l'URL — l'id d'un convive envoyé par le navigateur ne suffit pas à écrire
  chez un autre couple ;
- l'en-tête `Origin` doit être celui du tableau de bord. Le jeton d'Access vit
  dans un cookie : sans ce contrôle, une page ouverte dans le même navigateur
  pourrait déclencher une écriture à l'insu du couple ;
- un groupe doit déjà compter au moins un invité, sinon la route permettrait de
  remplir la table de groupes fantômes.

**Les photos par invité**, dans le même éditeur : le navigateur décode, recadre
en carré (centré, décalé vers le haut comme le médaillon du faire-part),
redimensionne en 400 × 400 et réencode en JPEG 82 avant d'envoyer. Une photo de
3000 × 2000 part ainsi en 3 Ko. Le Worker ne fait que ranger dans R2 sous une
clé qu'il calcule lui-même — `invite/<token>-<suffixe>.jpg`, dérivée du token et
jamais séquentielle (§4) ; laisser le navigateur choisir la clé, ce serait lui
laisser écraser la photo d'un autre. Le suffixe aléatoire donne une URL neuve à
chaque remplacement, sinon les caches serviraient l'ancienne image, et l'objet
précédent est supprimé dans la foulée.

Pas encore fait : les photos du couple et du lieu, qui suivront le même chemin
avec d'autres dimensions.
