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

Trois étapes côté acheteur :

1. **Vérification** — il saisit son numéro de commande Etsy et l'email de sa
   commande. `POST /api/commande/verifier` compare aux lignes de
   `codes_activation`, sans rien modifier.
2. **Formulaire** — prénoms, dates, lieu, deux réponses génériques
   obligatoires (§4), une animation, une photo du couple (obligatoire) et une
   photo du lieu (facultative), redimensionnées dans le navigateur avant
   l'envoi — même pipeline que le tableau de bord (§4 : jamais l'original).
   Un champ libre et facultatif, « une remarque avant l'activation », permet
   de signaler un souhait (format du faire-part, nom du site…) — stocké dans
   `mariages.remarque_acheteur`, lu par l'admin avant d'activer.
3. **Terminé** — `POST /api/commande/creer` crée la ligne `mariages`, écrit
   les photos dans R2, consomme le code, et renvoie un aperçu du nom du site
   (pas encore actif) — jamais un lien à cliquer tout de suite, jamais l'accès
   au tableau de bord (qui suit de toute façon un délai distinct, cf. plus
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
  exactement ce qu'on lui donne, un champ facultatif non retouché
  (`ceremonie_nom`, par exemple) doit repartir avec sa valeur actuelle, jamais
  avec un champ vide.
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
