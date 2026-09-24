# SaaS Faire-part

Moteur de faire-part de mariage digital avec RSVP personnalisé, vendu à des couples.
Dépôt **privé**. Dernière mise à jour du contexte : 23 septembre 2026.

---

## 1. Le produit

Parcours de l'invité, en une ligne :

```
lien personnel → animation "messager" → faire-part → RSVP → retour personnalisé
```

Côté couple : un tableau de bord (liste d'invités, messages, réponses, export traiteur).

**Le différenciateur commercial n'est pas l'animation** — elle attire l'attention sur
TikTok, rien de plus. Ce qui se vend, c'est le **retour personnalisé** après la réponse
(message écrit par les mariés + photo) et le tableau de bord. Les concurrents (Canva,
Etsy, mariages.net) livrent une invitation animée avec un RSVP générique.

### Deux offres, un seul moteur

| | Catalogue | Sur-mesure |
|---|---|---|
| Prix | 50 € sur Etsy | 250–400 € en direct |
| Messages par invité | non | oui, jusqu'à 30 |
| Photos par invité | non | oui |
| Temps passé par client | zéro | 3–5 h |

**Ce sont les mêmes fichiers.** La différence est dans les données :
`message_perso` vide → réponse générique, `photo_key` vide → pas de photo.
Ne jamais dupliquer la base de code pour séparer les deux offres.

---

## 2. Stack — décidée, ne pas rediscuter sans raison

| Rôle | Technologie |
|---|---|
| Front | Cloudflare Pages |
| API | Cloudflare Workers (TypeScript) |
| Base | Cloudflare D1 (SQLite) |
| Photos | Cloudflare R2 |
| Auth tableau de bord | Cloudflare Access (code OTP) |
| Email | Brevo gratuit — **notification au couple uniquement** |

Coût récurrent : **0 €**, hors nom de domaine.

### Pourquoi pas les alternatives évidentes

- **Vercel** : le plan Hobby interdit explicitement l'usage commercial. Premier client
  payant = 20 $/mois. Cloudflare n'a pas cette restriction.
- **Supabase** : le plan gratuit met le projet en pause après 7 jours d'inactivité
  (réveil manuel) et n'offre aucune sauvegarde. Le Pro à 25 $/mois réglerait les deux,
  mais D1 + R2 les règlent à 0 €. R2 n'a pas de frais d'egress, or les photos sont
  justement ce qui en consomme.
- **Le NAS** (UGREEN DXP2800, n8n, nginx) : **hors du chemin critique**. Il garde deux
  rôles, l'orchestration interne et la copie de sauvegarde nocturne — une sauvegarde ne
  doit pas vivre chez le même hébergeur que la base. Une coupure de box ne doit jamais
  couper le RSVP d'un client un samedi de juin.

### Multi-tenant

**Un seul projet de production contient tous les clients**, isolés par `mariage_id`.
Jamais un projet par client. Les deux environnements sont `dev` et `prod`, rien d'autre.

D1 n'a pas de RLS : **l'autorisation vit dans le code du Worker**. Conséquence non
négociable — aucun point d'entrée ne liste les invités. Le lookup prend un token et
retourne cette ligne, ou rien.

---

## 3. Les liens à token

Un lien par invité. L'invité ne s'identifie jamais : le lien le désigne.

```
mariage-valentine-achraf.fr/heloise-k7f2x9pq
```

Le prénom rend le lien chaleureux dans la conversation WhatsApp ; la partie aléatoire
porte toute la sécurité.

```ts
// ni 0/O ni 1/I/L, pas de voyelles → aucun mot accidentel
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function token(n = 8): string {
  const out: string[] = [];
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n))) {
      if (b < 240 && out.length < n) out.push(ALPHABET[b % 30]); // 240 = 8 × 30, écarte le biais de modulo
    }
  }
  return out.join("");
}
```

**Règles absolues :**

1. `crypto.getRandomValues`, **jamais** `Math.random()` — prédictible.
2. Rien de dérivé de l'invité (pas de hash d'email, pas d'id incrémenté).
3. Le token est **immuable** une fois généré. Des liens sont envoyés, parfois imprimés
   sur des cartons. Index unique en base, régénération interdite.
4. Token inconnu → **faire-part générique** avec une ligne sobre (« nous n'avons pas
   reconnu votre lien, vous pouvez répondre ci-dessous »), jamais un 404. Un 404
   confirme le format à un attaquant et bloque un invité qui a mal recopié.
   La ligne créée porte `origine = 'hors_liste'` (et ses accompagnants en
   héritent) : c'est le seul moment où l'information existe, après elle est
   indistinguable d'un invité importé.
   Corollaire à dire au couple : **le lien est un droit au porteur**. Un invité
   qui fait suivre son lien donne son identité avec — le destinataire répond à
   sa place et lit le message écrit pour lui. Aucune parade technique sans
   demander à l'invité de s'identifier, ce que le produit refuse. Un lien par
   personne, et le tableau de bord montre qui a déjà répondu.
5. **Limitation de débit sur la route de lookup** : 10 req/min/IP via le
   binding `LOOKUP_RATE` (Workers Rate Limiting), déclaré dans `wrangler.toml`
   avec un `namespace_id` distinct dev/prod pour ne pas que dev partage un
   compteur avec prod. La clé est l'IP lue dans `cf-connecting-ip` — l'unique
   en-tête que Cloudflare pose lui-même ; `x-forwarded-for` s'écrit et donnerait
   un compteur neuf à chaque requête. Sans cet en-tête, on refuse plutôt que de
   laisser passer sans compter.

---

## 4. Règles produit

Elles viennent d'arbitrages déjà faits. Les changer change le produit.

- **`message_perso` ne s'affiche que si `presence = 'oui'`.** Un message du type « on
  compte sur toi pour le discours » affiché à quelqu'un qui décline est cruel.
  Sur un « non », toujours la réponse générique.
- **Deux réponses génériques obligatoires** par mariage : une « oui », une « non ».
- **Trois niveaux de retour, dans cet ordre : message individuel → réponse du
  groupe → réponse générique du mariage.** Le groupe (`convives.groupe`, libre :
  « témoins », « collègues ») est un filet *sous* l'individuel, jamais un
  remplacement — six groupes couvrent trente invités pour une fraction des 3–5 h,
  mais si le groupe devient le mode par défaut, on revend du Canva avec plus
  d'étapes. Pas de variante « non » pour un groupe : sur un refus, toujours la
  générique. Étiquettes voisines (`Témoins` / `temoins`) = deux groupes, donc
  deux messages à écrire et un invité qui reçoit le mauvais ; l'import alerte.
- **Le quota de 30 messages n'existe nulle part dans le code**, et ne doit pas y
  entrer. C'est une promesse commerciale adossée au temps passé, pas une
  contrainte technique. Refuser le 31ᵉ message à un client qui a payé 350 € se
  paie en litige, pas en temps gagné : un compteur dans le tableau de bord suffit.
- **`photo_key` et `message_perso` sont indépendants.** Une photo sans message
  accompagne la réponse générique. Les coupler faisait disparaître sans erreur
  une photo que le couple avait pris la peine de choisir — corrigé, mais l'erreur
  est facile à réintroduire en réécrivant la construction du retour. Sur un
  « non », ni photo ni message perso : même raison que ci-dessus.
- **Régime alimentaire = liste fermée.** Jamais de champ libre. Une allergie est une
  donnée de santé (RGPD art. 9), régime juridique renforcé. « Halal » ou « casher »
  formulés comme choix de menu, jamais comme question sur la religion.
- **Un accompagnant est une ligne `convives`, pas un compteur.** On demande son prénom
  et son nom — c'est ce qui permet le plan de table et les marque-places sans
  relancer tout le monde en avril. **Quatre au maximum** par invité
  (`MAX_ACCOMPAGNANTS`, refusé par le Worker et masqué dans le formulaire) : le
  couple décide qui vient, et une liste ouverte laisse un invité amener une
  tablée sans prévenir, alors que le traiteur est confirmé en avril. Un invité
  hors liste peut en annoncer aussi — ses accompagnants héritent de son origine
  et apparaissent comme lui dans le tableau de bord.
- **Les photos vivent dans R2**, jamais en base64 dans la page. Nom de fichier dérivé
  du token, jamais séquentiel (`1.jpg`, `2.jpg` s'énumèrent).
- **Les photos sont redimensionnées dans le navigateur (API Canvas) avant l'envoi**,
  jamais côté serveur. Un couple téléverse depuis son téléphone une photo de 4 Mo en
  4032 × 3024 : servie telle quelle, elle tue la promesse « se charge sur la 4G
  d'une invitée dans le métro ».

  **Ce n'est pas une question de prix** — l'erreur a été faite une fois ici. Les
  transformations Cloudflare Images offrent 5 000 transformations uniques par mois,
  puis 0,50 $ les 1 000 ; à raison d'environ 100 par mariage, ce serait gratuit à
  notre échelle. Ce qui tranche, c'est **de ne jamais détenir l'original** : 4 Mo
  porteurs des EXIF, donc des coordonnées GPS du domicile d'un tiers. Nous sommes
  sous-traitant (§5) et la donnée qu'on n'a pas est la seule qu'on ne puisse ni
  perdre ni devoir effacer. S'y ajoute le poids de l'envoi : trente photos de 4 Mo
  depuis un téléphone, c'est la séance de saisie abandonnée en cours. Redimensionner
  d'abord règle les deux, et comme Workers n'a pas de bibliothèque d'image viable,
  le navigateur est alors le seul endroit possible.

  Effet de bord précieux : le réencodage **efface les EXIF** et impose le JPEG quelle
  que soit la source. **Attention, le HEIC n'est réglé qu'à moitié** : le canvas ne
  peut réencoder que ce que le navigateur sait décoder. Safari décode le HEIC, Chrome
  et Firefox sur ordinateur non — une photo d'iPhone déposée depuis un PC échoue donc
  silencieusement si on ne détecte pas le cas. Détecter l'échec de décodage et le dire
  (« exportez-la en JPEG »), jamais un bouton qui ne réagit pas. Si ce cas se révèle
  fréquent chez de vrais couples, le repli serait une transformation Cloudflare Images
  pour ces fichiers-là seulement, l'original supprimé dans la foulée.

  Dimensions cibles : cf. §7.
- **`mariages.messager` est toujours renseigné explicitement à la création**, et
  `''` signifie « pas d'animation » (choix valide, pas un oubli). La valeur par
  défaut `'pigeon'` du schéma est historique et pointe vers un messager qui
  n'existe pas : elle ne doit jamais s'appliquer. Un messager introuvable ne
  casse pas la page — le thème retire le voile et affiche le faire-part — mais
  ça reste un piège silencieux, rencontré deux fois.
- **Le tableau de bord sauvegarde au fil de l'eau** et affiche l'avancement
  (« 12 invités sur 30 ont leur message »). Sans cet indicateur, le couple abandonne
  en cours de saisie.

---

## 5. RGPD

Le **couple est responsable de traitement**, nous sommes **sous-traitant** (art. 28).
C'est l'inverse de l'intuition et ça détermine les obligations.

- Contrat de sous-traitance écrit avec chaque couple — obligatoire, même gratuit.
- Hébergement UE.
- **Suppression automatique à J+90** après la date du mariage (Cron Trigger Cloudflare).
  Obligation *et* argument commercial. Ce qui part : les lignes `convives`, les
  réponses de groupe et les photos R2 associées. Ce qui reste : la ligne
  `mariages` — le couple est notre client, pas un tiers, et ses données vivent
  sous le contrat, pas au calendrier de ses invités. La sélection croise
  `supprimer_le` (indexé, calculé à l'insertion) **et** `date_mariage + 90 j` :
  un mariage repoussé garde un `supprimer_le` ancien, et effacer avant la fête
  serait le pire échec possible de cette tâche.
- Mention d'information sur le formulaire RSVP : qui, pourquoi, combien de temps,
  comment demander l'effacement. Elle vit dans le thème, pas dans une page à
  part que personne n'ouvre, et ses textes par défaut sont dans le HTML : sans
  réseau, sans token ou avant la réponse de l'API, la page reste conforme — le
  JavaScript ne fait qu'y ajouter les prénoms et la date d'effacement. Le
  contact se lit dans `mariages.contact_rgpd` ; vide, la mention renvoie au
  message qui portait le lien, ce qui n'expose aucune adresse de plus.
- Le couple dépose sa liste lui-même dans le tableau de bord. Ne jamais la recevoir
  par mail ou WhatsApp — ça éviterait d'en détenir une copie non maîtrisée.

**Jamais de données d'invité réelles dans le dépôt.** Ni fixtures, ni captures, ni
exports de test. Utiliser des données fictives.

---

## 6. Arborescence

```
saas-faire-part/
├─ CLAUDE.md
├─ worker/              API Cloudflare Workers
│  ├─ src/
│  └─ wrangler.toml
├─ schema/              migrations D1 (numérotées, jamais modifiées après application)
├─ themes/              un dossier par univers visuel
│  └─ botanique/
├─ messagers/           un dossier par animation (SVG + CSS)
│  ├─ pigeon/
│  └─ ...
├─ dashboard/           back-office couple + admin
└─ docs/
```

`themes/` et `messagers/` sont **deux axes indépendants** : 3 × 3 donne 9 combinaisons
pour 6 choses à construire. Ne jamais coder un messager en dur dans un thème.

### Conventions

- Front en HTML / CSS / JS natif. Pas de framework — les pages doivent s'ouvrir seules
  dans dix ans et se charger sur la 4G d'une invitée dans le métro.
- **Aucune couleur de texte sous 4,5:1**, mesurée sur le fond réel. Le tableau de
  bord a quatre niveaux, un par rôle, et c'est la saisie du couple qui reçoit le
  plus fort contraste — c'est le contenu, il doit dominer l'interface :

  | Jeton | Rôle | Contraste sur crème |
  |---|---|---|
  | `--ink` | ce que le couple a saisi | 12,9:1 |
  | `--ink-2` | infos du mariage, valeurs, dates | 7,3:1 |
  | `--aide` | consignes et explications | 5,3:1 |
  | `--sage` | libellés en petites majuscules | 4,6:1 |

  L'or et le rose ne sont **jamais** une couleur de texte : ils restent aux aplats
  et aux marques, et ont chacun leur variante lisible (`--gold-texte`,
  `--rose-texte`). Le corps est en graisse 400, pas 300 : en petit corps une
  graisse fine grise le texte autant qu'une couleur trop claire. Les titres, eux,
  gardent leur légèreté parce qu'ils sont grands.
- Worker en TypeScript.
- Secrets : `.dev.vars` dans le `.gitignore`, `wrangler secret put` en production.
  Un token commité reste dans l'historique git pour toujours, même en dépôt privé.

### Commandes

```bash
wrangler dev                                    # local
wrangler deploy                                 # prod
wrangler d1 execute DB --local  --file=schema/00X.sql
wrangler d1 execute DB --remote --file=schema/00X.sql
```

---

## 7. Pièges déjà rencontrés

Repris du projet `Mon-Mariage`. Ils ont tous coûté du temps une première fois.

**WhatsApp**
- Sans balises Open Graph, le lien arrive en texte brut. Sur un faire-part, ça fait
  « lien suspect ». **Le robot de WhatsApp n'exécute pas de JavaScript** : des
  balises écrites par le thème après le chargement n'existent pas pour lui. Elles
  sont donc injectées côté serveur par `functions/_middleware.js`, qui appelle
  `/api/og`. Ne jamais les déplacer dans le JS du thème. Mode d'emploi complet :
  `docs/whatsapp.md`.
- `og:image` doit être un **vrai fichier à une URL absolue** — le base64 ne marche pas.
  Maximum 600 Ko, idéal 1200×630, en JPG/PNG/WebP (ni SVG ni GIF).
- WhatsApp **cache l'aperçu plusieurs semaines et n'offre aucun outil de purge**.
  Tester avec `?v=1`, `?v=2`, ne diffuser l'URL propre qu'une fois l'aperçu validé.
- Le lien s'ouvre dans le navigateur intégré de WhatsApp. Les téléchargements y sont
  bloqués : utiliser `data:text/calendar` pour les `.ics`, jamais `blob:`.
- Le Bot Fight Mode de Cloudflare bloque le robot de WhatsApp → aucun aperçu, sans
  message d'erreur. Le laisser désactivé sur les domaines de faire-part.

**QR code sur carton papier**
- Un QR imprimé est **définitif**. Il pointe vers une URL courte et permanente qu'on
  contrôle, qui redirige — jamais directement vers la page.
- Vectoriel, 2 cm minimum au format imprimé, marge blanche, **sombre sur clair**
  (l'inverse fait échouer une partie des scanners).

**Images**
- Pipeline : crop sur le sujet → redimensionner à 2× la taille d'affichage CSS →
  JPEG qualité 82.
- Tester les images via HTTP, jamais en `file://` — le navigateur bloque les grosses
  URI locales.
- Formats attendus par emplacement, dictés par le CSS du thème `botanique` (le
  cadrage `object-position` dit où doit se trouver le sujet) :

  | Emplacement | Affichage | Fichier | Cadrage |
  |---|---|---|---|
  | Photo du couple | 320 × 420 | 640 × 840 | `center 15 %` — visages en haut |
  | Photo du lieu | 560 × 260 | 1120 × 520 | `center 40 %` |
  | Photo par invité (médaillon rond) | 180 × 180 | 400 × 400 | `center 25 %` |
  | `og:image` WhatsApp | — | 1200 × 630, < 600 Ko | — |

- **HEIC** : format par défaut des iPhone, illisible par Chrome sur Android. Une
  photo déposée telle quelle casse l'affichage pour une partie des invités — et le
  canvas ne sait pas la convertir non plus, puisqu'il ne réencode que ce que le
  navigateur a su décoder (cf. §4).
- **Orientation EXIF** : une photo de téléphone redessinée dans un canvas sans
  tenir compte de son orientation ressort pivotée.

**Listes d'invités** (import)
- Ne jamais ouvrir un CSV de production dans un tableur : Excel, Numbers et Sheets
  réécrivent silencieusement le fichier (virgules fantômes, retours à la ligne perdus).
- Les `\r` de Windows cassent la correspondance des emails : `sed -i 's/\r//'`.
- **Excel français exporte en point-virgule et en Windows-1252**, pas en virgule ni
  en UTF-8. « Héloïse » revient en « HÃ©loÃ¯se ». Le séparateur se détecte, et une
  lecture UTF-8 qui produit des caractères de remplacement se relit en 1252.
- **Le collage vaut mieux que le fichier** : sélectionner des cellules et les coller
  donne du texte tabulé, sans export, sans encodage et sans séparateur à deviner.
  « Exportez en CSV » est l'étape où les couples décrochent.
- Les listes de couples contiennent presque toujours une colonne **email** et une
  colonne **téléphone**. Le produit n'en a pas besoin — les liens partent par
  WhatsApp — mais il faut **dire** qu'elles ont été reconnues et écartées, sinon on
  croit à une perte de données.
- Sans ligne d'en-tête, **ne jamais proposer la même colonne par défaut pour tous les
  champs** : l'erreur est alors offerte en premier. On profile chaque colonne (emails,
  téléphones, longueur moyenne, taux de répétition) et on propose ce qu'on a deviné.
- **Réimporter ne doit jamais régénérer un token** : un couple qui ajoute dix
  personnes en mars redépose sa liste entière, et recréer les lignes existantes
  invaliderait autant de liens déjà envoyés (§3, règle 3).

---

## 8. Où en est le projet

Phase actuelle : **fondations**. Construit : schéma D1, Worker (lookup token +
RSVP), premier thème (`botanique`) branché dessus, deux messagers (`montgolfiere`,
`voiture`), import d'une liste d'invités, déploiement dev réel sur
`dev.faire-part.hasakistudio.fr`, tableau de bord couple **en lecture seule**
(liste, réponses, avancement des messages, export traiteur), écriture des
messages au fil de l'eau depuis le tableau de bord, réponses de groupe, aperçu
WhatsApp (Open Graph rendu côté serveur), photo par invité téléversée vers R2
après redimensionnement dans le navigateur, déploiement du Worker depuis GitHub
Actions, import de la liste par le couple lui-même depuis le tableau de bord
(collage depuis un tableur ou fichier CSV), tableau de bord déployé sur
`tableau.dev.faire-part.hasakistudio.fr` derrière Cloudflare Access, mention
d'information RGPD sur le formulaire RSVP, effacement automatique des données
d'invités à J+90 (Cron Trigger), limitation de débit sur le lookup public
(10 req/min/IP), photos du couple, du lieu et aperçu WhatsApp téléversées
depuis le tableau de bord après redimensionnement navigateur aux formats de
§7. Pas encore construit : contrat de sous-traitance écrit.

**Attention à ne pas confondre deux tableaux de bord.** Celui qui est en ligne
aujourd'hui vient du projet `Mon-Mariage` (n8n + NAS) et ne sert qu'au suivi du
mariage de l'auteur : il ne fait pas partie du produit, ne connaît pas
`mariage_id`, et n'a pas vocation à être livré à un client. Celui de cette
solution est `dashboard/`, défini et construit ici — lecture, écriture des
messages, réponses de groupe — et vit depuis le 23 septembre 2026 sur
`tableau.dev.faire-part.hasakistudio.fr`, derrière Cloudflare Access
(cf. `docs/tableau-de-bord.md`). Ne pas prendre l'un pour l'autre en lisant une
capture d'écran.

| Phase | Période | État |
|---|---|---|
| 0 · Fondations | sept → oct 2026 | en cours |
| 1 · Pilote sur le mariage Valentine & Achraf (5 juin 2027) | nov → déc 2026 | à venir |
| 2 · Premier client sur-mesure | janv → fév 2027 | à venir |
| 3 · Catalogue Etsy | fév → avril 2027 | **conditionnel** |

Le mariage de l'auteur est le **locataire n° 1** : ses ~100 invités testent la chaîne
complète en décembre, avant qu'un client payant n'y touche.

### Questions non tranchées

- ~~Nom de marque et domaine d'envoi — à fixer avant la première vidéo TikTok.~~
  **Tranché** : marque publique **Un Oui, Une Histoire**. Domaine technique
  provisoire sur `hasakistudio.fr` (`dev.faire-part.hasakistudio.fr` /
  `faire-part.hasakistudio.fr`, déjà possédé, coût 0) ; migration vers un
  domaine dédié à la marque prévue au 1er ou 2e client sur-mesure.
- ~~Faut-il renommer le *team domain* Cloudflare Access ?~~ **Tranché : non.**
  `small-bird-358e.cloudflareaccess.com` est tiré au sort par Cloudflare et ne
  se devine pas (l'avoir supposé a coûté une soirée de 403 silencieux). Le
  renommer réécrit le champ `iss` de tous les jetons déjà émis, coupe les
  sessions en cours, oblige à reconfigurer les fournisseurs d'identité et les
  clients WARP, et le compte porte d'autres applications. En face : les invités
  ne le voient **jamais** — seuls les mariés, le temps de saisir leur code. Le
  levier pour cette gêne-là est l'apparence de la page de connexion (Zero Trust
  > Settings > Custom Pages), pas son nom. Si renommage un jour, groupé avec la
  migration vers le domaine de marque, jamais pendant une saison de RSVP.
- La phase 3 peut ne jamais avoir lieu : 6 clients à 300 € et 36 à 50 € font le même
  chiffre, mais le second multiplie par six le support, les litiges et les données de
  tiers hébergées. Arbitrage prévu en février.
- Deuxième thème : construit quand un client le demande et le paie, pas avant.

---

## 9. Ce qu'il ne faut pas faire

- Construire le self-service avant d'avoir **refusé un client faute de temps**.
- Construire une bibliothèque de thèmes avant la première vente.
- Remettre le NAS dans le chemin critique d'un client.
- Utiliser `Math.random()` pour quoi que ce soit de sensible.
- Créer un projet Cloudflare ou une base par client.
- Embarquer des photos en base64 dans une page livrée.
- Exposer un point d'entrée qui liste les invités.
