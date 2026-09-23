# RGPD — ce qui est fait, ce qui reste

Rappel du cadre (CLAUDE.md §5) : **le couple est responsable de traitement, nous
sommes sous-traitant** (art. 28). C'est l'inverse de l'intuition — on héberge la
page, mais les invités sont *ses* invités — et ça détermine qui informe, qui
répond aux demandes, et qui doit signer quoi.

## 1. La mention d'information (art. 13)

Elle est dans `themes/botanique/index.html`, sous le bouton d'envoi du
formulaire RSVP. Un résumé d'une phrase toujours visible, le détail dans un
`<details>` replié.

Elle répond aux quatre questions obligatoires :

| Question | Où |
|---|---|
| Qui ? | les prénoms du couple, responsables ; le prestataire nommé comme hébergeur |
| Pourquoi ? | plan de table, nombre de couverts, menus — et rien d'autre |
| Combien de temps ? | la date exacte d'effacement, calculée, pas « 90 jours » en l'air |
| Comment faire effacer ? | `mariages.contact_rgpd`, ou à défaut le message qui portait le lien |

Deux choix qui ne sont pas des détails :

- **Les textes par défaut sont écrits dans le HTML**, pas construits en
  JavaScript. Sans réseau, sans token, ou avant que l'API réponde, la page
  reste conforme. Le JavaScript ne fait qu'ajouter les prénoms et la date
  exacte — il rend la mention vérifiable, il ne la crée pas.
- **`contact_rgpd` est nullable et c'est voulu.** Les liens partent par
  WhatsApp : l'invité a déjà un canal vers les mariés, et renvoyer vers ce
  canal n'expose aucune adresse de plus sur une page que tous les invités
  ouvrent. Le couple qui préfère une adresse explicite la renseigne, en
  sachant qu'elle devient publique.

La mention dit aussi que le champ « régime alimentaire » est facultatif et
n'accueille que des choix de menu. C'est le pendant de la règle produit : une
allergie est une donnée de santé (art. 9), on ne la collecte pas.

## 2. L'effacement automatique à J+90

`worker/src/index.ts`, fonction `purgeJ90`, déclenchée par le Cron Trigger de
`wrangler.toml` — `17 3 * * *`, chaque nuit, **en dev comme en prod** (un cron
ne s'attache qu'à l'environnement déployé : les deux blocs doivent le déclarer).

Ce qui part : les lignes `convives`, les réponses de groupe, et les objets R2
correspondants. Ce qui reste : la ligne `mariages`. Le couple est notre client,
pas un tiers ; ses données s'effacent à la fin du contrat, pas au calendrier de
ses invités. Mélanger les deux effacerait un dossier client au bout de trois
mois.

Trois propriétés à ne pas casser en retouchant cette tâche :

1. **La sélection croise deux dates.** `supprimer_le` porte la requête (il est
   indexé, calculé à l'insertion), mais il ne se recalcule pas si la date du
   mariage bouge. Un mariage repoussé de six mois garderait une date
   d'effacement ancienne — et effacer les réponses avant la fête est le pire
   échec possible ici. D'où la seconde condition sur `date_mariage + 90 jours`.
2. **La base d'abord, R2 ensuite.** Les deux n'ont pas de transaction commune.
   Dans cet ordre, un échec à mi-chemin laisse des photos que plus aucune ligne
   ne désigne ; dans l'autre, une ligne pointerait vers une photo disparue et
   casserait une page.
3. **Le journal ne nomme personne.** Un fichier de logs n'est pas l'endroit où
   faire survivre ce qu'on vient d'effacer : le slug du mariage et des
   compteurs, jamais un prénom ni un token.

La tâche est idempotente : `mariagesAPurger` ne retourne que les mariages qui
ont encore des convives, donc une nuit sans rien à faire ne fait rien.

### La tester

```bash
wrangler dev --test-scheduled       # expose /__scheduled
curl http://localhost:8787/__scheduled
```

Le jeu d'essai utile contient trois mariages : un passé depuis plus de 90 jours
(doit être purgé), un **repoussé** — `supprimer_le` ancien, `date_mariage` dans
le futur — qui ne doit pas l'être, et un à venir. Données fictives uniquement,
base `--local` uniquement.

## 3. Ce qui reste à faire

- **Le contrat de sous-traitance écrit avec chaque couple.** Obligatoire même à
  titre gratuit, donc y compris pour le mariage de l'auteur en pilote. Ce n'est
  pas du code ; c'est la seule pièce manquante avant de facturer un client.
- **Hébergement UE** : à vérifier explicitement côté Cloudflare (D1 et R2)
  plutôt qu'à supposer.
- Le couple dépose sa liste lui-même dans le tableau de bord — déjà construit.
  Ne jamais la recevoir par mail ou WhatsApp, ça ferait une copie non maîtrisée.
