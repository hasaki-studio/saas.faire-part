# Vendre sur Etsy — les deux premières fiches

Décision produit du 24 septembre 2026, adossée à CLAUDE.md §8. Deux annonces
en parallèle sur le même compte Etsy, sous la marque **Un Oui, Une Histoire**.

## Contexte marché (rappel court)

Sur Etsy France, la médiane des « faire-part digital wedding » tourne autour
de **15-25 €** pour un template PDF ou vidéo. Nos deux fiches se positionnent
**au-dessus** — c'est explicite dans §8 : « prix supérieur à la médiane pour
filtrer les acheteurs pressés ». On accepte moins de volume au profit d'un
client qui a mesuré ce qu'il achetait.

## Boutique

- **Nom Etsy** : `UnOuiUneHistoire` (Etsy interdit espaces et accents dans le
  nom de boutique — la baseline se met dans la bio, pas dans le nom).
- **Baseline (bio Etsy)** : *« L'invitation qui répond personnellement à chacun
  de vos invités. »* — c'est le différenciateur de §1, il vaut la peine d'être
  affiché au-dessus de tout.
- **Localisation** : France (obligatoire pour la TVA acheteur).
- **Devises** : € (les acheteurs voient leur devise, on est payé en €).

---

## Fiche A · Faire-part digital sur commande

Une **personnalisation complète infos + photo + un mot d'accueil**, livrée à la
main sous 24-48 h. Pas de messages personnalisés par invité (ça, c'est le
sur-mesure hors Etsy à 250-400 €). C'est un produit **entre** l'Etsy générique
et le sur-mesure vrai.

### Titre Etsy (140 caractères, mots-clés en tête)

> **Faire-part mariage digital personnalisé — site web animé avec RSVP en ligne — livraison sous 24h**

*130 caractères. Les mots-clés forts sont dans les 10 premiers mots : « Faire-part mariage digital personnalisé ».*

### Sous-titre (premiers 160 caractères de description — apparaît en aperçu Google)

> Recevez un vrai site web à votre nom, animé, avec RSVP intégré. Vos invités répondent en ligne, vous suivez tout dans un tableau de bord privé.

### Description longue

```
✧ CE QUE VOUS RECEVEZ

• Un site web animé à votre nom, prêt à être partagé sur WhatsApp
• Formulaire RSVP intégré : vos invités répondent en un clic
• Tableau de bord privé : suivez qui a répondu, ce qu'ils ont dit,
  et exportez la liste finale pour votre traiteur
• Personnalisation : vos prénoms, votre date, votre lieu, vos photos
  du couple et du lieu de réception, un mot d'accueil de votre choix
• Aperçu WhatsApp soigné (image + titre) quand vous partagez le lien

Site hébergé jusqu'à 90 jours après la date du mariage.

✧ CE QUI EST DIFFÉRENT DE CE QUE VOUS VOYEZ AILLEURS

• Ce n'est pas une vidéo à envoyer par WhatsApp. C'est un vrai site,
  qui répond, qui garde vos réponses, qui vous montre en direct
  qui a lu, qui vient, qui décline.
• Pas de compte à créer pour vos invités. Chacun reçoit son propre lien,
  ouvre, répond.
• Aucune publicité, aucune marque sur votre site.

✧ COMMENT ÇA MARCHE

1. Vous achetez et me laissez un mot avec vos infos :
   — Vos prénoms et la date
   — Le lieu (cérémonie + réception)
   — 2 à 3 photos (couple, lieu si vous en avez)
   — Un mot d'accueil de votre choix (facultatif)
2. Je vous envoie votre site sous 24 à 48 h ouvrées, à l'adresse mail
   liée à votre commande Etsy.
3. Vous le partagez à vos invités. Ils répondent. Vous suivez.

✧ CE QUI EST INCLUS DANS LE PRIX

• La création du site à votre nom
• L'hébergement jusqu'à 90 jours après votre mariage
• Le tableau de bord des réponses
• Une correction si vous voulez modifier une info après réception

✧ CE QUI N'EST PAS INCLUS

• Les messages personnalisés à chaque invité individuellement
  (pour ça, écrivez-moi en direct, c'est une prestation à part)
• L'envoi des liens à vos invités (vous restez propriétaire du lien
  et le partagez comme vous voulez, WhatsApp, SMS, email…)

✧ CONFIDENTIALITÉ

Vos données et celles de vos invités sont hébergées en Europe et
effacées automatiquement 90 jours après la date de votre mariage.
Aucune revente, aucune publicité.

Une question avant d'acheter ? Écrivez-moi ici sur Etsy.
```

### Tags (13, 20 caractères max chacun)

```
faire part digital
faire part mariage
invitation mariage
faire part animé
mariage rsvp en ligne
site mariage
faire part moderne
save the date digital
mariage 2027
mariage boheme
faire part personnalisé
faire part sur mesure
invitation digitale
```

*Attention : Etsy compte les caractères, pas les mots. Chaque tag ≤ 20
caractères. Vérifie à la saisie.*

### Attributes Etsy

- Catégorie : **Fournitures créatives > Papeterie et pochettes cadeaux > Faire-part et invitations**
- Type : Numérique
- Occasion : Mariage
- Couleur principale : Vert (thème `botanique`)
- Style : Bohème, Botanique, Élégant

### Prix

**89 €** TTC. Justification :

- Coût de mon temps : ~30-45 min par commande (créer l'entrée admin,
  saisir les infos, téléverser les photos, envoyer le lien) → un tarif horaire
  décent implique ≥ 60 €.
- Commissions Etsy (Etsy annonce : ~6,5% commission transaction + 4% payment
  processing + 0,20 $ frais fixes) : ~13 € de retenue → **net ~76 €**.
- Comparable au sur-mesure vrai (250-400 €) : produit différent, sans messages
  personnalisés par invité, sans photos par invité. Le sur-mesure reste
  hors Etsy.

### Livraison

- Mode Etsy : **Made to Order** (fait sur commande).
- Délai affiché : **1-2 jours ouvrés**.

### Workflow post-vente (manuel au démarrage)

1. Notif Etsy → j'ouvre le tableau admin.
2. Je récupère les infos que le client m'a laissées dans « Notes to seller ».
3. J'ajoute une ligne dans la base D1 (`INSERT INTO mariages …`) via la
   console D1, ou plus tard via un formulaire dédié.
4. Je téléverse les photos qu'il m'a envoyées (Etsy permet de joindre
   images).
5. Je réponds au message Etsy avec le lien de son site + le lien vers son
   tableau de bord + les instructions.
6. **Réponse mail** : voir modèle plus bas.

Objectif : passer chaque commande en **≤ 30 min**. Au-delà de 5 ventes/mois,
c'est le signal d'automatiser (Etsy Open API + Brevo).

---

## Fiche B · Faire-part digital instantané (self-service)

Le même faire-part que la Fiche A, mais **le client le fabrique lui-même** :
il achète, télécharge un PDF avec un code d'activation, va sur notre site,
saisit le code, remplit un formulaire, obtient son site en 5 minutes.

**Prérequis technique** : le tunnel self-service `commande.faire-part.hasakistudio.fr`
doit être en ligne. C'est le lot 1, à construire ensuite.

### Titre Etsy

> **Faire-part mariage digital instantané — créez votre site RSVP en 5 minutes — activation immédiate**

*128 caractères.*

### Sous-titre

> Achetez, recevez un code, créez votre site web animé de mariage à votre nom en cinq minutes. RSVP intégré, tableau de bord des réponses.

### Description longue

```
✧ INSTANTANÉ, VRAIMENT

Cinq minutes après votre achat, votre site est en ligne à votre nom.
Vous saisissez vos infos, vous choisissez vos photos, c'est prêt.

✧ CE QUE VOUS RECEVEZ

• Un site web animé à votre nom, prêt à être partagé sur WhatsApp
• Formulaire RSVP intégré : vos invités répondent en un clic
• Tableau de bord privé : suivez qui a répondu, ce qu'ils ont dit,
  et exportez la liste finale pour votre traiteur
• Aperçu WhatsApp soigné (image + titre) quand vous partagez le lien
• Site hébergé jusqu'à 90 jours après la date du mariage

✧ COMMENT ÇA MARCHE

1. Vous achetez → Etsy vous livre immédiatement un PDF avec un code
   d'activation à usage unique.
2. Vous allez sur unouiunehistoire.fr/commande et vous saisissez le code.
3. Vous remplissez le formulaire : prénoms, date, lieu, 1 à 3 photos,
   un mot d'accueil facultatif.
4. Vous cliquez « Terminer ». Votre site est prêt.
5. Vous le partagez à vos invités.

✧ DIFFÉRENCE AVEC LA FICHE « SUR COMMANDE »

L'autre annonce de la boutique (« Faire-part mariage digital personnalisé,
livraison sous 24 h ») est le même produit final, mais je vous le prépare
à votre place. Ici, c'est vous qui remplissez, en 5 minutes.

✧ CE QUI EST INCLUS

• Site à votre nom, animé, avec RSVP intégré
• Tableau de bord des réponses
• Hébergement jusqu'à 90 jours après votre mariage
• Aucune publicité, aucune marque sur votre site

✧ CONFIDENTIALITÉ

Vos données et celles de vos invités sont hébergées en Europe et
effacées automatiquement 90 jours après la date de votre mariage.
Aucune revente, aucune publicité.

Question ? Écrivez-moi ici sur Etsy, je réponds sous 24 h.
```

### Tags

```
faire part digital
faire part instant
faire part mariage
invitation mariage
mariage rsvp
site mariage
faire part animé
faire part moderne
save the date digital
mariage 2027
téléchargement instantané
mariage boheme
faire part diy
```

### Attributes Etsy

Identiques à la Fiche A, sauf :

- Type : Numérique — **Instant Download** (case à cocher dédiée)
- Occasion : Mariage
- Style : Bohème, Botanique, Élégant

### Prix

**29 €** TTC. Justification :

- Zéro temps humain par vente (self-service intégral).
- Commissions Etsy identiques : ~5 € de retenue → **net ~24 €**.
- Au-dessus de la médiane concurrentielle (15-25 €), en dessous du seuil
  psychologique 30 €. Ce prix se défend par le fait que le client obtient un
  **site live** et pas juste un PDF.

### Livraison

- Mode Etsy : **Instant Download** (Etsy livre le fichier immédiatement).
- Fichier livré : `code-activation.pdf` — le même PDF pour tous les acheteurs,
  qui pointe vers `unouiunehistoire.fr/commande` où l'acheteur saisit son
  **numéro de commande Etsy** (à défaut d'un code unique dans le PDF).
- Contenu détaillé du PDF : voir `docs/etsy/pdf-fiche-b.md`.

### Workflow post-vente

Aucun. Le tunnel self-service fait tout, et le mail post-achat automatique
d'Etsy suffit. Si un client bloque au moment de saisir son code, il écrit sur
Etsy et je débloque à la main.

---

## Mail de confirmation Fiche A (modèle)

À copier-coller depuis le tableau admin, avec les prénoms remplacés. À
envoyer via la messagerie Etsy (pas par mail direct : c'est la trace Etsy qui
protège en cas de litige).

```
Bonjour {prenom_acheteur},

Merci pour votre commande ! Votre faire-part est prêt.

✧ Votre site : https://{prenoms}.faire-part.hasakistudio.fr

Partagez ce lien tel quel avec vos invités, sur WhatsApp ou par
message. Chacun a le sien, personnalisé à son nom.

✧ Votre tableau de bord : https://tableau.faire-part.hasakistudio.fr

C'est ici que vous verrez les réponses arriver, en direct. Vous vous
connecterez avec l'adresse mail de votre commande Etsy : {email}.
Un code à six chiffres vous sera envoyé par mail à chaque connexion,
ça ne demande pas de mot de passe.

✧ Votre liste d'invités

Vous n'avez pas encore d'invités enregistrés — c'est à vous d'en ajouter
depuis votre tableau de bord (« Ajouter des invités »). Vous pouvez
coller votre liste depuis Excel ou taper les invités un par un.

✧ Une modification à faire ?

Répondez à ce message. Une correction (date, lieu, photo, orthographe)
est incluse dans votre commande.

Votre site restera en ligne jusqu'au {date_purge}, soit 90 jours après
votre mariage. Après cette date, tout est effacé automatiquement — c'est
le règlement européen sur les données qui l'exige, et c'est aussi ce
qui protège la vie privée de vos invités.

Belle organisation à vous,
{signature}
Un Oui, Une Histoire
```

---

## PDF Fiche B

Le contenu à faire imprimer en PDF (via Google Docs ou Word) est dans
[`docs/etsy/pdf-fiche-b.md`](etsy/pdf-fiche-b.md). Une seule page A4, à
déposer sur l'annonce en fichier téléchargeable.

**Attention** : ne pas oublier de **mettre à jour le PDF** dans l'annonce
Etsy à chaque changement (Etsy garde l'ancien tant que tu ne remplaces pas
manuellement).

---

## Photos et mock-ups pour les annonces (10 photos max par fiche)

Etsy accorde énormément aux visuels — c'est ce qui décide du clic. Prépare :

1. **Photo principale** (celle qu'on voit dans les résultats de recherche) :
   téléphone tenu à la main, écran affichant le faire-part terminé, très
   propre, fond neutre. **Cette photo doit vendre à elle seule.**
2. **Aperçu WhatsApp** : capture d'une conversation WhatsApp qui reçoit le
   lien du faire-part, avec le carré d'aperçu bien visible.
3. **L'animation messager** : GIF ou photo qui montre le pigeon/la
   montgolfière en train de traverser l'écran.
4. **Le faire-part complet** : capture longue de tout le site déroulé.
5. **Le RSVP côté invité** : formulaire visible, doigt qui coche « Oui ».
6. **Le retour personnalisé** : ce qu'un invité voit après avoir répondu.
7. **Le tableau de bord** : capture des KPIs et de la liste (données
   fictives, jamais réelles §5).
8. **Comparaison** : « Ce que reçoivent vos invités ailleurs » (une image
   PDF statique) vs « Ce qu'ils reçoivent avec nous » (le lien live).
9. **Format** : « inclus dans votre commande » avec 4-5 pictos.
10. **Photo finale émotionnelle** : le couple qui regarde le téléphone
    avec vos noms dessus (photo de stock ou générée, jamais une vraie
    photo d'un couple sans autorisation §5).

**Format** : 2000 × 2000 px, JPG, ≤ 5 Mo par photo.

---

## Mentions légales Etsy

Une boutique Etsy en France doit afficher :

- **Nom légal du vendeur** (personne physique ou entreprise)
- **Numéro SIRET** si tu es auto-entrepreneur ou société
- **Numéro de TVA** si applicable (auto-entrepreneur en franchise : « TVA non
  applicable, article 293 B du CGI »)
- **Adresse postale** (au moins ville + pays)
- **CGV** : Etsy propose un module dédié dans les paramètres de la boutique
  (« Politiques »).
- **Politique de confidentialité** : renvoie vers `unouiunehistoire.fr/rgpd`
  qu'il faudra créer.
- **Droit de rétractation** : ⚠️ produit numérique = **pas de rétractation**
  si le contenu a été téléchargé (Fiche B) ou personnalisé sur mesure
  (Fiche A). Le préciser explicitement dans la description **et** dans les
  CGV Etsy.

---

## Ce qu'il ne faut pas mettre dans les annonces

Testé à mes dépens ailleurs :

- **Aucun logo Cloudflare, Hasaki Studio ou autre stack** — le client achète
  « Un Oui, Une Histoire », pas « un projet sur Cloudflare Workers ».
- **Aucune mention du prix de sur-mesure hors Etsy** dans la description
  Etsy — c'est une concurrence à toi-même qui déclenche la comparaison au
  mauvais moment. Le sur-mesure se vend en direct sur ton site marque, plus
  tard.
- **Aucune vraie photo de couple**, même « de test ». §5 : jamais de
  données réelles de tiers dans le dépôt ou dans une annonce publique.
- **Aucun mot du champ lexical « app » ou « application »** — les couples
  français cherchent « site », « faire-part », « invitation », pas
  « application ».

---

## À faire côté toi avant publication

1. Ouvrir la boutique Etsy `UnOuiUneHistoire` (5 min).
2. Préparer les 10 photos par fiche (soirée entière — c'est le plus long).
3. Copier-coller le contenu de la Fiche A dans Etsy — publier en **brouillon**.
4. Idem Fiche B — publier en **brouillon**.
5. Attendre le lot 1 (tunnel self-service en ligne) avant de publier la
   Fiche B pour de vrai. La Fiche A peut se publier immédiatement.

## À faire côté code après cette PR (rappel)

- **Lot 1** : tunnel `commande.faire-part.hasakistudio.fr` (création de
  mariage self-service à partir d'un code d'activation).
- **Lot 3** : intégration Etsy Open API — plus tard, à partir de 5 ventes/mois.
- Optionnel : `unouiunehistoire.fr/rgpd` — page publique de politique de
  confidentialité que l'annonce Etsy peut linker.
