# Tunnel self-service — mode d'emploi

Le chemin de la Fiche B Etsy (CLAUDE.md §8) : un acheteur crée lui-même son
faire-part, sans qu'on y touche. Front `commande/index.html`, API sous
`/api/commande/*`, table `codes_activation` (`schema/008_codes_activation.sql`).

**Le site n'est pas joignable tout de suite après le tunnel** — cf. « Ce qui
n'est PAS automatisé » plus bas. Le formulaire crée bien la ligne `mariages`
à l'instant, mais son sous-domaine (`<slug>.SHARED_DOMAIN`) doit être ajouté
à la main côté Cloudflare avant de répondre : le joker DNS/TLS qui rendrait
ce pas inutile n'est pas construit. L'écran final le dit clairement — pas de
lien cliquable, un aperçu du nom du site et un message d'attente.

## Le principe

Quatre étapes côté acheteur :

1. **Vérification** — il saisit son numéro de commande Etsy et l'email de sa
   commande. `POST /api/commande/verifier` compare aux lignes de
   `codes_activation`, sans rien modifier.
2. **Informations** — prénoms, dates, lieu et heure de la cérémonie et du
   cocktail, deux réponses génériques obligatoires (§4), une animation, le
   **programme de la journée** (dîner, soirée, ou toute étape propre au
   mariage — pré-rempli, éditable, ajoutable/retirable) et la **FAQ**
   (questions pré-rédigées, éditables et complétables de la même façon).
   Cérémonie et cocktail restent des champs du mariage — ils alimentent
   aussi la section « Le lieu » du thème — le reste de la journée et la FAQ
   sont de vraies listes (cf. `schema/010_programme_faq.sql`).
3. **Photos et aperçu** — photo du couple (obligatoire) et photo du lieu
   (facultative), redimensionnées dans le navigateur avant l'envoi — même
   pipeline que le tableau de bord (§4 : jamais l'original). Un bouton
   « Voir l'aperçu » affiche le vrai thème, avec le messager, le programme et
   la FAQ tels que saisis (cf. « L'aperçu encastré » plus bas) — avant de
   décider, pas après : on ne demande pas un avis sur un rendu que personne
   n'a encore vu. Un bouton « Modifier mes informations » revient à l'étape 2
   sans rien renvoyer au serveur (rien n'est encore soumis). Deux boutons de
   décision ferment le formulaire :
   - **« Je valide les infos »** — le chemin normal.
   - **« Envoyer cette remarque »** — exige un texte non vide (se plaindre de
     rien n'a pas de sens) ; enregistre exactement les mêmes données, mais
     l'étape 4 affiche un message de prise en charge plutôt que l'aperçu du
     site, et la remarque (`mariages.remarque_acheteur`) attire l'attention de
     l'admin avant l'activation.
4. **Terminé** — `POST /api/commande/creer` crée la ligne `mariages`, le
   programme et la FAQ, écrit les photos dans R2, consomme le code. Le
   message dépend du bouton cliqué à l'étape précédente ; sur le chemin
   normal, un aperçu du nom du site (pas encore actif) — jamais un lien à
   cliquer tout de suite, jamais l'accès au tableau de bord (qui suit de toute
   façon un délai distinct, cf. plus
   bas).

## Ce qui protège l'ensemble

- **Pas de Cloudflare Access sur cet hôte.** Au moment où l'acheteur arrive,
  il n'a par définition pas encore de tableau de bord — c'est cette route qui
  le lui crée. La légitimité tient à la connaissance du couple
  `{numéro de commande, email}`, sur le même principe que le lien à token des
  invités (§3) : un secret partagé, pas une session.
- **Limitation de débit dédiée** (`COMMANDE_RATE`, 10 req/min/IP, namespace
  distinct de `LOOKUP_RATE`) sur `verifier` et `creer` — une rafale sur l'un
  des deux publics ne doit jamais entamer le crédit de l'autre.
- **Vérification `Origin`** sur les deux routes, comme pour le tableau de
  bord — mais ici sans cookie de session à protéger : c'est un filtre bon
  marché contre un site tiers qui imiterait le formulaire, pas une défense
  CSRF au sens strict.
- **Consommation atomique du code** : `creerOuMettreAJourMariageSelfService`
  réécrit `consomme_le` avec une clause `WHERE consomme_le IS NULL`. Un double
  clic ou deux onglets ouverts sur la même commande, lors de la création
  initiale, ne créent jamais deux mariages — le second appel échoue et le
  mariage qu'il venait d'insérer est retiré.
- **Un slug jamais réutilisé** : `genererSlugMariage` vérifie l'unicité et
  ajoute un suffixe numérique en cas de collision (deux couples "Léa & Tom"
  un jour donné ne sont pas un cas si rare qu'on puisse l'ignorer).
- **`supprimer_le` calculé en SQL** (`date(?, '+90 days')`), pas en JS — même
  expression que celle utilisée par la purge automatique (`mariagesAPurger`),
  une seule source de vérité.

## La fenêtre de correction de 48 h

Un code consommé n'est pas mort pour autant : pendant 48 h après sa première
consommation (`FENETRE_MODIFICATION_HEURES` dans `worker/src/db.ts`),
retaper le même couple `{numéro de commande, email}` sur `/api/commande/verifier`
n'affiche pas « déjà utilisé » — ça rouvre le tunnel en mode modification sur
le mariage déjà créé.

- **Jamais une deuxième ligne `mariages`, jamais un nouveau slug.** Le chemin
  modification fait un `UPDATE ... WHERE id = ?`, jamais un `INSERT`. Le lien
  envoyé aux invités et celui du tableau de bord restent valables même après
  correction — cf. §3 règle 3, le même principe qui interdit de régénérer un
  token d'invité s'applique ici au slug.
- **La fenêtre est revérifiée en SQL au moment de l'écriture**
  (`(julianday('now') - julianday(consomme_le)) * 24 <= 48`), jamais faite
  confiance depuis la lecture précédente : `verifier` et `creer` peuvent être
  appelés à plusieurs minutes d'écart.
- **Le formulaire est pré-rempli** avec les données existantes du mariage
  (`GET` implicite via la réponse de `verifier`) : comme `UPDATE` écrit
  exactement ce qu'on lui donne, un champ facultatif non retouché (l'adresse
  de la cérémonie dans sa ligne de programme, par exemple) doit repartir avec
  sa valeur actuelle, jamais avec un champ vide.
- **Les photos sont optionnelles en modification, obligatoires à la
  création.** Ne pas redéposer la photo du couple ne l'efface pas — la
  colonne n'est simplement pas touchée. Si une nouvelle photo est envoyée,
  elle est écrite dans R2 et la ligne mise à jour *avant* que l'ancien objet
  R2 soit supprimé, jamais l'inverse (un objet orphelin est moins grave qu'une
  ligne qui pointe sur un fichier disparu).
- **Passé le délai**, le code redevient un « déjà utilisé » classique : même
  message d'erreur, sur `verifier` comme sur `creer`. Il n'y a pas de
  prolongation ni d'exception manuelle — la ligne `mariages` reste éditable
  ensuite depuis le tableau de bord, comme pour n'importe quel client.

## L'aperçu encastré

Avant de cliquer « Terminer », l'acheteur peut voir le vrai rendu — thème et
messager compris — sans qu'aucun mariage n'existe encore en base et sans
dépendre du sous-domaine (bloqué tant que le joker DNS/TLS n'est pas réglé,
cf. plus bas). Ni export à télécharger, ni onglet séparé : une iframe
chargée depuis l'hôte où le thème est réellement déployé (`SHARED_DOMAIN`),
avec `?apercu=1`.

- **`themes/botanique/index.html` sert les deux publics avec le même code.**
  `remplirFaireArt(data, { modeApercu })` est le seul point qui écrit dans le
  DOM, que les données viennent de `GET /api/faire-part/<token>` (un invité)
  ou d'un `postMessage` (l'aperçu) — l'un ne peut pas dériver de l'autre sans
  que ça se voie. `modeApercu: true` coupe juste après le mariage et le
  messager : pas d'invité à afficher, pas de note « lien non reconnu ».
- **Les photos voyagent en objets `Blob`**, pas en URL : à ce stade, aucune
  n'a encore été envoyée à R2 (CLAUDE.md §4). Le clonage structuré de
  `postMessage` copie un `Blob` même entre origines différentes
  (`commande.*` → `SHARED_DOMAIN`) ; l'iframe fait ensuite
  `URL.createObjectURL()` sur sa propre origine.
- **Une poignée de main avant l'envoi** : l'iframe poste `{type:
  'apercu-pret'}` dès qu'elle est prête à recevoir ; `commande/index.html`
  attend ce message avant de poster les données. Sans ça, un envoi trop
  précoce se perdrait pendant que la page charge encore.
- **Un nouveau chargement d'iframe à chaque clic sur « Voir l'aperçu »**,
  jamais la même réutilisée : aucun état à nettoyer entre deux essais, donc
  aucun souci de cache même après plusieurs allers-retours par le bouton
  « Modifier mes informations » (fenêtre de 48 h ci-dessus).
- **Sur `localhost`**, `SHARED_DOMAIN` n'existe pas : `proxy-local.js` sert
  toujours le thème invité sur le port 8080, et le JS du tunnel s'y adapte
  directement (`APERCU_ORIGIN`) — aucune configuration à changer pour tester.

## Le programme et la FAQ

Révélés par l'aperçu encastré (§4 de CLAUDE.md, session du 25 septembre 2026) :
le thème affichait des horaires inventés et une FAQ écrite pour un couple
précis, jamais branchés sur de vraies données, pour aucun mariage — catalogue
ou sur-mesure.

- **Cérémonie et cocktail sont des lignes de `programme_items` comme le
  reste de la journée** (revu le 26 septembre 2026, `schema/011_programme_
  unifie.sql`). La première version les gardait à part (`ceremonie_nom` /
  `ceremonie_adresse` / `heure_ceremonie`, pareil pour le cocktail) parce
  qu'ils alimentaient aussi la section « Le lieu » du thème — mais avoir deux
  systèmes d'édition différents pour la même frise rendait le formulaire du
  tunnel incohérent (une info « facultative » séparée du programme, alors
  qu'elle en fait partie), et un champ facultatif pré-rempli par erreur a
  suffi à faire apparaître un cocktail fantôme sur un mariage qui n'en avait
  pas. La section « Le lieu » n'affiche plus qu'une photo (`cocktail_photo_
  key`, gérée à part depuis le tableau de bord) : le nom et l'adresse du lieu
  se lisent maintenant dans la frise, avec le reste.
- **Toute la journée est une vraie liste** (`programme_items`) : un couple ne
  suit pas tous le même déroulé, une liste s'ajoute et se retire,
  contrairement à des colonnes fixes. Même principe pour la FAQ
  (`faq_items`) — les questions par défaut couvrent la plupart des mariages,
  mais un couple doit pouvoir en retirer une qui ne s'applique pas ou en
  ajouter une qui lui est propre.
- **Les deux sont pré-remplies à la création** (`PROGRAMME_PAR_DEFAUT` /
  `FAQ_PAR_DEFAUT` dans `worker/src/db.ts`) : un couple qui ne touche à rien
  garde un programme et une FAQ raisonnables, jamais une page vide. Le
  contenu par défaut est écrit pour rester vrai quel que soit le mariage —
  aucun lieu, aucune date, aucun service (photographe, cagnotte...) n'y est
  promis comme un fait acquis.
- **Le formulaire renvoie l'état complet à chaque soumission**, jamais un
  diff (`remplacerProgramme`/`remplacerFaq` suppriment puis réinsèrent) —
  même principe que le reste du tunnel : plus simple et plus sûr qu'un
  rapprochement ligne à ligne pour une liste que le couple réordonne, ajoute
  et retire librement à chaque visite.
- **Un vrai lien d'invité voit exactement le même programme et la même FAQ**
  que l'aperçu : `contenuPublic()` (l'API publique du faire-part) et la
  réponse de `/api/commande/verifier` en mode correction lisent les deux
  mêmes tables. Rien n'est propre au tunnel.

## Ce qui n'est PAS automatisé (limite connue, à lire avant de publier la Fiche B)

**Trois pas manuels subsistent aujourd'hui**, tant que les lots 3 (Etsy API),
l'automatisation Access, et le joker DNS/TLS du sous-domaine partagé
n'existent pas :

1. **Créer la ligne `codes_activation`.** Il n'y a pas encore d'intégration
   Etsy Open API : quand une vente arrive, il faut ouvrir l'admin et
   enregistrer `{commande_etsy, email}` à la main
   (`POST /api/admin/codes`, ou depuis le formulaire de `admin/index.html`).
   Tant que cette ligne n'existe pas, l'acheteur qui suit son PDF
   immédiatement après l'achat tombe sur « Numéro de commande introuvable ».

2. **Ajouter le sous-domaine exact du site côté Cloudflare.** Cloudflare
   Pages ne sait pas servir un sous-domaine joker (`*.SHARED_DOMAIN`), et le
   certificat gratuit ne couvre pas un joker à ce niveau de profondeur — cf.
   la discussion d'architecture de septembre 2026, non résolue à ce jour.
   Tant que ça n'est pas réglé (ACM payant, ou délégation de zone), chaque
   site créé par le tunnel a besoin d'un **Custom Domain exact** (pas un
   joker) ajouté à la main sur le projet Pages du front invité, + un
   enregistrement DNS — exactement la même manip que pour `admin.` ou
   `tableau.` aujourd'hui, répétée une fois par vente. C'est pour ça que
   l'écran final du tunnel ne montre plus de lien cliquable : seulement un
   aperçu du nom du site, et « votre site sera activé sous peu ». Une fois
   fait, marque le mariage « activé » dans la carte admin
   (`POST /api/admin/mariages/<id>/activer`, bouton dans `admin/index.html`)
   — ça retire la ligne de la liste à traiter et le confirme au prochain
   acheteur qui rouvrirait le tunnel dans la fenêtre de correction de 48 h.
   C'est aussi le moment de lire `mariages.remarque_acheteur` (affichée dans
   la même carte) : un souhait sur le format ou le nom du site à discuter
   avant d'activer, plutôt qu'après.

3. **Ajouter l'email à la policy Allow de l'application Access du tableau
   de bord.** Le tunnel crée le mariage et renseigne `email_proprietaire`,
   mais Cloudflare Access ne laisse entrer que les emails explicitement
   ajoutés à la main dans Zero Trust (`docs/tableau-de-bord.md` : « il n'y a
   pas d'inscription libre »). Sans cet ajout, l'acheteur ne peut **jamais**
   se connecter à son tableau de bord, même une fois son site activé.

   Automatiser les pas 1 et 3 est prévu au lot 3 (Etsy Open API et jeton
   Zero Trust `Access: Edit`) quand le volume le justifiera. Le pas 2 dépend
   d'une décision d'architecture Cloudflare distincte, pas encore prise.

**Ce que ça veut dire pour toi, concrètement, à chaque vente Fiche B** :
1. Ouvre l'admin, enregistre le code dès que possible après la vente.
2. Une fois que l'acheteur a terminé le tunnel (visible dans
   `admin/index.html`, statut « à activer »), lis sa remarque éventuelle,
   ajoute son sous-domaine exact côté Cloudflare, puis marque-le « activé ».
3. Ajoute son email à la policy Allow de l'application Access du tableau de
   bord (Zero Trust > Access > Applications > l'application du tableau).
4. Préviens-le par un message Etsy que son site (et bientôt son tableau)
   sont prêts.

**Contrairement à la version précédente de ce document, le site n'est plus en
ligne instantanément** : les pas 2 et 3 bloquent chacun quelque chose de
différent (le site pour le premier, le tableau de bord pour le second), tous
deux avec le même ordre de grandeur d'attente (« comptez quelques heures »).

## Déploiement (à faire une fois, côté dev)

Contrairement au tableau de bord et à l'admin, **cet hôte n'a pas
d'application Access** — c'est volontaire, la route est publique par
conception. Cinq étapes :

1. **DNS** — enregistrement `commande.dev.faire-part` (proxifié, orange).
2. **Projet Pages** `commande-faire-part`, connecté au dépôt, branche `main`.
   Commande de build **vide**, **Build output directory = `commande`**.
3. **Domaine personnalisé** `commande.dev.faire-part.hasakistudio.fr` sur ce
   projet Pages.
4. **Route Worker** — `commande.dev.faire-part.hasakistudio.fr/api/*` vers
   `faire-part-worker`. **Jamais** `*.hasakistudio.fr/*`.
5. Vérifier `COMMANDE_HOSTNAME` dans `worker/wrangler.toml` (déjà réglé sur
   `commande.dev.faire-part.hasakistudio.fr` pour dev).

Aucune application Access, aucun AUD à relever — c'est ce qui rend ce
déploiement plus court que celui du tableau ou de l'admin.

Prod : mêmes étapes avec `commande.faire-part.hasakistudio.fr` et un projet
Pages `commande-faire-part-prod`.

## Tester en local

```bash
# Terminal 1 : le Worker
wrangler dev

# Terminal 2 : le tunnel, servi sur 8083
node proxy-local.js --commande
```

Créer un code de test dans la console D1 locale avant d'ouvrir la page :

```sql
INSERT INTO codes_activation (id, commande_etsy, email)
VALUES ('test-1', '1234567890', 'test@exemple.fr');
```

Sur `localhost`, aucune connexion simulée n'est nécessaire côté Access — le
tunnel n'en a jamais eu besoin. `wrangler dev --test-scheduled` n'est pas
utile ici non plus (pas de tâche planifiée dans ce lot).

## Ce qui reste à faire (lot 3, plus tard)

- **Etsy Open API** : webhook ou poll sur les nouvelles ventes de la Fiche B,
  écriture automatique dans `codes_activation` — remplace l'étape manuelle 1
  ci-dessus. Le tunnel côté acheteur ne change pas : seule la source de la
  ligne change.
- **Automatisation Access** : appel à l'API Cloudflare Zero Trust pour
  ajouter l'email à la policy Allow au moment de la création du mariage —
  remplace l'étape manuelle 2. Nécessite un nouveau secret Worker
  (`wrangler secret put ACCESS_API_TOKEN` ou équivalent) à portée
  `Access: Edit`, à créer dans le dashboard Cloudflare le jour venu.
