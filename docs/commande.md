# Tunnel self-service — mode d'emploi

Le chemin de la Fiche B Etsy (CLAUDE.md §8) : un acheteur crée lui-même son
faire-part, sans qu'on y touche. Front `commande/index.html`, API sous
`/api/commande/*`, table `codes_activation` (`schema/008_codes_activation.sql`).

## Le principe

Trois étapes côté acheteur :

1. **Vérification** — il saisit son numéro de commande Etsy et l'email de sa
   commande. `POST /api/commande/verifier` compare aux lignes de
   `codes_activation`, sans rien modifier.
2. **Formulaire** — prénoms, dates, lieu, deux réponses génériques
   obligatoires (§4), une animation, une photo du couple (obligatoire) et une
   photo du lieu (facultative), redimensionnées dans le navigateur avant
   l'envoi — même pipeline que le tableau de bord (§4 : jamais l'original).
3. **Terminé** — `POST /api/commande/creer` crée la ligne `mariages`, écrit
   les photos dans R2, consomme le code, et retourne les deux liens (site et
   tableau de bord).

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
- **Consommation atomique du code** : `creerMariageSelfService` réécrit
  `consomme_le` avec une clause `WHERE consomme_le IS NULL`. Un double clic ou
  deux onglets ouverts sur la même commande ne créent jamais deux mariages —
  le second appel échoue et le mariage qu'il venait d'insérer est retiré.
- **Un slug jamais réutilisé** : `genererSlugMariage` vérifie l'unicité et
  ajoute un suffixe numérique en cas de collision (deux couples "Léa & Tom"
  un jour donné ne sont pas un cas si rare qu'on puisse l'ignorer).
- **`supprimer_le` calculé en SQL** (`date(?, '+90 days')`), pas en JS — même
  expression que celle utilisée par la purge automatique (`mariagesAPurger`),
  une seule source de vérité.

## Ce qui n'est PAS automatisé (limite connue, à lire avant de publier la Fiche B)

**Deux pas manuels subsistent aujourd'hui**, tant que les lots 3 (Etsy API) et
l'automatisation Access n'existent pas :

1. **Créer la ligne `codes_activation`.** Il n'y a pas encore d'intégration
   Etsy Open API : quand une vente arrive, il faut ouvrir l'admin et
   enregistrer `{commande_etsy, email}` à la main
   (`POST /api/admin/codes`, ou depuis le formulaire de `admin/index.html`
   une fois ajouté). Tant que cette ligne n'existe pas, l'acheteur qui suit
   son PDF immédiatement après l'achat tombe sur « Numéro de commande
   introuvable » — **ce n'est donc pas un vrai instantané tant que ce pas
   n'est pas automatisé**. En pratique, ça veut dire vérifier les
   notifications Etsy plusieurs fois par jour, au minimum.

2. **Ajouter l'email à la policy Allow de l'application Access du tableau
   de bord.** Le tunnel crée le mariage et renseigne `email_proprietaire`,
   mais Cloudflare Access ne laisse entrer que les emails explicitement
   ajoutés à la main dans Zero Trust (`docs/tableau-de-bord.md` : « il n'y a
   pas d'inscription libre »). Sans cet ajout, l'acheteur ne peut **jamais**
   se connecter à son tableau de bord, même si son site est déjà en ligne.
   C'est pour ça que l'écran de fin dit « comptez quelques heures » plutôt
   que de prétendre à un accès immédiat.

   Automatiser ce point demanderait un jeton API Cloudflare à portée
   `Access: Edit`, différent des bindings D1/R2 que le Worker détient
   aujourd'hui — volontairement pas construit dans ce lot : c'est un
   nouveau secret à créer et un appel qu'on ne peut pas tester sans lui.
   À faire quand le volume de ventes le justifiera (même seuil que le
   lot 3 : Etsy Open API).

**Ce que ça veut dire pour toi, concrètement, à chaque vente Fiche B** :
1. Ouvre l'admin, enregistre le code dès que possible après la vente.
2. Une fois que l'acheteur a terminé le tunnel (tu peux le voir apparaître
   dans `admin/index.html`, ou vérifier `codes_activation.consomme_le`),
   ajoute son email à la policy Allow de l'application Access du tableau de
   bord (Zero Trust > Access > Applications > l'application du tableau).
3. Préviens-le par un message Etsy que son tableau est prêt.

Ni l'un ni l'autre pas n'empêchent le site d'être en ligne tout de suite —
c'est uniquement le tableau de bord (gestion de la liste d'invités, suivi des
réponses) qui attend.

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
