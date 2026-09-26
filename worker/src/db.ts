export interface Mariage {
  id: string;
  slug: string;
  domaine_personnalise: string | null;
  theme: string;
  messager: string;
  prenom_1: string;
  prenom_2: string;
  date_mariage: string;
  date_limite_rsvp: string;
  ceremonie_nom: string | null;
  ceremonie_adresse: string | null;
  cocktail_nom: string | null;
  cocktail_adresse: string | null;
  cocktail_photo_key: string | null;
  photo_couple_key: string | null;
  og_image_key: string | null;
  reponse_generique_oui: string;
  reponse_generique_non: string;
  contact_rgpd: string | null;
  supprimer_le: string;
  // Fiche B uniquement (cf. schema/009_activation_manuelle.sql) : NULL pour
  // tout mariage créé autrement (Fiche A, jeu d'essai).
  active_le: string | null;
  remarque_acheteur: string | null;
  // cf. schema/010_programme_faq.sql : juste l'heure, le nom/l'adresse sont
  // déjà ceremonie_nom/ceremonie_adresse et cocktail_nom/cocktail_adresse.
  heure_ceremonie: string | null;
  heure_cocktail: string | null;
}

export type Presence = "oui" | "non";

// 'hors_liste' : arrivé avec un token inconnu, ou annoncé par quelqu'un qui
// l'était. Renseigné à l'insertion — après, l'information n'existe plus.
export type Origine = "liste" | "hors_liste";

export interface Convive {
  id: string;
  mariage_id: string;
  token: string;
  accompagnant_de: string | null;
  prenom: string;
  nom: string;
  message_perso: string | null;
  photo_key: string | null;
  presence: Presence | null;
  regime_alimentaire: string | null;
  message_invite: string | null;
  repondu_le: string | null;
  origine: Origine;
  groupe: string | null;
}

export interface ReponseGroupe {
  mariage_id: string;
  groupe: string;
  message: string;
  photo_key: string | null;
}

/**
 * Résout le mariage à partir du Host de la requête. Deux schémas cohabitent
 * (cf. décision produit) : domaine dédié en priorité, puis sous-domaine du
 * domaine partagé. Ni l'un ni l'autre → null (mauvaise configuration DNS,
 * pas un problème d'invité — un 404 est légitime ici).
 */
export async function resolveMariageByHost(
  db: D1Database,
  host: string,
  sharedDomain: string,
): Promise<Mariage | null> {
  const hostname = host.split(":")[0]!.toLowerCase();

  const parDomaine = await db
    .prepare("SELECT * FROM mariages WHERE domaine_personnalise = ?1")
    .bind(hostname)
    .first<Mariage>();
  if (parDomaine) return parDomaine;

  const suffix = `.${sharedDomain.toLowerCase()}`;
  if (hostname.endsWith(suffix)) {
    const slug = hostname.slice(0, -suffix.length);
    return db.prepare("SELECT * FROM mariages WHERE slug = ?1").bind(slug).first<Mariage>();
  }

  return null;
}

// Un token, une ligne ou rien : aucun point d'entrée ne liste les invités (cf. CLAUDE.md §2).
export async function getConviveByToken(
  db: D1Database,
  mariageId: string,
  token: string,
): Promise<Convive | null> {
  return db
    .prepare("SELECT * FROM convives WHERE mariage_id = ?1 AND token = ?2")
    .bind(mariageId, token)
    .first<Convive>();
}

export async function getAccompagnants(db: D1Database, conviveId: string): Promise<Convive[]> {
  const { results } = await db
    .prepare("SELECT * FROM convives WHERE accompagnant_de = ?1")
    .bind(conviveId)
    .all<Convive>();
  return results;
}

// ── Tableau de bord du couple ─────────────────────────────────────
//
// La règle « aucun point d'entrée ne liste les invités » (CLAUDE.md §2) vise la
// surface publique : celle que n'importe qui atteint avec un token deviné. Le
// tableau de bord est l'autre surface — authentifiée par Cloudflare Access — et
// le couple a évidemment le droit de voir sa propre liste (§1 : liste d'invités,
// messages, réponses, export traiteur).
//
// Ce qui rend les deux compatibles tient en une phrase : le mariage est déduit
// de l'email authentifié, jamais d'un paramètre de requête. Une route qui
// accepterait ?mariage_id=… laisserait un couple lire la liste d'un autre.

export async function getMariageByEmail(db: D1Database, email: string): Promise<Mariage | null> {
  return db
    .prepare("SELECT * FROM mariages WHERE email_proprietaire = ?1")
    .bind(email.toLowerCase())
    .first<Mariage>();
}

/**
 * Tous les convives d'un mariage, invités principaux et accompagnants mêlés.
 * `mariageId` vient toujours de getMariageByEmail() : c'est le seul endroit où
 * la portée est décidée, et elle n'est jamais élargie ensuite.
 */
export async function listerConvives(db: D1Database, mariageId: string): Promise<Convive[]> {
  const { results } = await db
    .prepare(
      // Les accompagnants suivent immédiatement la personne qui les a annoncés :
      // c'est comme ça qu'on lit une liste pour un plan de table.
      `SELECT * FROM convives
       WHERE mariage_id = ?1
       ORDER BY COALESCE(accompagnant_de, id), accompagnant_de IS NOT NULL, nom, prenom`,
    )
    .bind(mariageId)
    .all<Convive>();
  return results;
}

/**
 * Réponse écrite pour un groupe, ou null. Appelée seulement quand l'invité n'a
 * pas de message à lui : le groupe est un filet sous l'individuel, cf.
 * schema/005_groupes.sql.
 */
export async function getReponseGroupe(
  db: D1Database,
  mariageId: string,
  groupe: string,
): Promise<ReponseGroupe | null> {
  return db
    .prepare("SELECT * FROM reponses_groupe WHERE mariage_id = ?1 AND groupe = ?2")
    .bind(mariageId, groupe)
    .first<ReponseGroupe>();
}

export async function listerGroupes(db: D1Database, mariageId: string): Promise<ReponseGroupe[]> {
  const { results } = await db
    .prepare("SELECT * FROM reponses_groupe WHERE mariage_id = ?1 ORDER BY groupe")
    .bind(mariageId)
    .all<ReponseGroupe>();
  return results;
}

/**
 * Écrit le message personnel d'un invité. Le `mariageId` vient toujours de
 * l'identité authentifiée : la clause le répète pour que l'id d'un convive
 * envoyé par le navigateur ne suffise jamais à écrire chez un autre couple.
 *
 * Refuse un accompagnant : il n'a pas de lien, donc pas d'écran de retour où
 * un message s'afficherait. Lui en écrire un serait un texte que personne ne
 * lira jamais.
 */
export async function ecrireMessagePerso(
  db: D1Database,
  mariageId: string,
  conviveId: string,
  message: string | null,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      "UPDATE convives SET message_perso = ?1 WHERE id = ?2 AND mariage_id = ?3 AND accompagnant_de IS NULL",
    )
    .bind(message, conviveId, mariageId)
    .run();
  return (meta.changes ?? 0) > 0;
}

/**
 * Assigne un groupe à un invité, ou le retire. Le mariage vient toujours de
 * l'identité authentifiée : la clause le répète pour que l'id d'un convive
 * envoyé par le navigateur ne suffise jamais à écrire chez un autre couple.
 *
 * Refuse un accompagnant : ses groupes suivent la personne qui l'a annoncé.
 *
 * Effet de bord voulu : réattribuer le dernier invité d'un groupe fait
 * disparaître ce groupe de la liste (« un groupe existe s'il y a au moins
 * un invité qui y est rattaché », cf. handleTableauConvives), et son
 * éventuelle réponse écrite reste orpheline sans nuire — elle réapparaîtra
 * si un invité rejoint ce nom plus tard, ce qui est le comportement le
 * moins surprenant pour le couple.
 */
export async function ecrireGroupeConvive(
  db: D1Database,
  mariageId: string,
  conviveId: string,
  groupe: string | null,
): Promise<boolean> {
  const { meta } = await db
    .prepare(
      "UPDATE convives SET groupe = ?1 WHERE id = ?2 AND mariage_id = ?3 AND accompagnant_de IS NULL",
    )
    .bind(groupe, conviveId, mariageId)
    .run();
  return (meta.changes ?? 0) > 0;
}

/**
 * Crée ou remplace la réponse d'un groupe. Le groupe doit déjà exister, au sens
 * où au moins un invité de ce mariage y est rattaché : sans ce contrôle, la
 * route permettrait de remplir la table de groupes fantômes.
 */
export async function ecrireReponseGroupe(
  db: D1Database,
  mariageId: string,
  groupe: string,
  message: string,
): Promise<boolean> {
  const existe = await db
    .prepare("SELECT 1 FROM convives WHERE mariage_id = ?1 AND groupe = ?2 LIMIT 1")
    .bind(mariageId, groupe)
    .first();
  if (!existe) return false;

  await db
    .prepare(
      `INSERT INTO reponses_groupe (mariage_id, groupe, message) VALUES (?1, ?2, ?3)
       ON CONFLICT (mariage_id, groupe) DO UPDATE SET message = excluded.message`,
    )
    .bind(mariageId, groupe, message)
    .run();
  return true;
}

export async function supprimerReponseGroupe(
  db: D1Database,
  mariageId: string,
  groupe: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM reponses_groupe WHERE mariage_id = ?1 AND groupe = ?2")
    .bind(mariageId, groupe)
    .run();
}

export async function getConviveParId(
  db: D1Database,
  mariageId: string,
  conviveId: string,
): Promise<Convive | null> {
  // mariage_id répété dans la clause : connaître l'id d'un convive ne doit
  // jamais suffire à l'atteindre depuis le compte d'un autre couple.
  return db
    .prepare("SELECT * FROM convives WHERE id = ?1 AND mariage_id = ?2")
    .bind(conviveId, mariageId)
    .first<Convive>();
}

export async function ecrirePhotoKey(
  db: D1Database,
  mariageId: string,
  conviveId: string,
  photoKey: string | null,
): Promise<void> {
  await db
    .prepare("UPDATE convives SET photo_key = ?1 WHERE id = ?2 AND mariage_id = ?3")
    .bind(photoKey, conviveId, mariageId)
    .run();
}

/**
 * Les trois emplacements photo du mariage sont dans la même table, sur la
 * même ligne : une fonction unique paramétrée évite trois `UPDATE` presque
 * identiques et empêche qu'un nouvel emplacement soit ajouté sans passer par
 * ce garde-fou. Le nom de colonne est fermé par le type ; l'id du mariage
 * vient de l'identité authentifiée, pas d'un paramètre du navigateur.
 */
export type PhotoMariage = "photo_couple_key" | "cocktail_photo_key" | "og_image_key";

export async function ecrirePhotoMariage(
  db: D1Database,
  mariageId: string,
  colonne: PhotoMariage,
  photoKey: string | null,
): Promise<void> {
  // Interpolation contrôlée : `colonne` ne peut valoir que les trois chaînes
  // du type, et D1 ne sait pas paramétrer un nom de colonne.
  await db
    .prepare(`UPDATE mariages SET ${colonne} = ?1 WHERE id = ?2`)
    .bind(photoKey, mariageId)
    .run();
}

export interface InviteImporte {
  prenom: string;
  nom: string;
  message: string | null;
  groupe: string | null;
}

/**
 * Ajoute des invités sans jamais toucher à ceux qui existent déjà.
 *
 * C'est le contrôle qui compte : un couple qui ajoute dix personnes en mars
 * redépose souvent sa liste entière. Si l'import recréait les lignes
 * existantes, ce sont autant de tokens neufs — donc de liens déjà envoyés,
 * parfois imprimés sur des cartons, qui cesseraient de fonctionner
 * (CLAUDE.md §3, règle 3). La comparaison se fait sur prénom + nom, sans
 * accent ni casse, et vaut aussi à l'intérieur du fichier déposé.
 */
export async function importerConvives(
  db: D1Database,
  mariageId: string,
  invites: InviteImporte[],
  genToken: () => string,
): Promise<{ ajoutes: number; existants: number }> {
  const cle = (prenom: string, nom: string) =>
    `${prenom}|${nom}`
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim();

  const { results } = await db
    .prepare("SELECT prenom, nom FROM convives WHERE mariage_id = ?1")
    .bind(mariageId)
    .all<{ prenom: string; nom: string }>();
  const connus = new Set(results.map((r) => cle(r.prenom, r.nom)));

  const nouveaux: InviteImporte[] = [];
  for (const invite of invites) {
    const k = cle(invite.prenom, invite.nom);
    if (connus.has(k)) continue;
    connus.add(k);
    nouveaux.push(invite);
  }

  if (nouveaux.length) {
    await db.batch(
      nouveaux.map((i) =>
        db
          .prepare(
            "INSERT INTO convives (id, mariage_id, token, prenom, nom, message_perso, groupe, origine) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'liste')",
          )
          .bind(crypto.randomUUID(), mariageId, genToken(), i.prenom, i.nom, i.message, i.groupe),
      ),
    );
  }

  return { ajoutes: nouveaux.length, existants: invites.length - nouveaux.length };
}

// ── Effacement à J+90 ─────────────────────────────────────────────
//
// Obligation (CLAUDE.md §5) autant qu'argument commercial : les invités sont
// des tiers dont le couple nous a confié les données, et rien ne justifie de
// les garder trois mois après la fête.
//
// Le compte se fait sur `date_mariage`, jamais sur la date de réponse : un
// invité qui répond en janvier pour un mariage de juin n'a pas à être effacé
// en avril.

export interface MariageAPurger {
  id: string;
  slug: string;
  date_mariage: string;
}

/**
 * Mariages à purger : `supprimer_le` est dépassé et il reste des convives.
 *
 * Deux conditions sur la date plutôt qu'une. `supprimer_le` est calculé à
 * l'insertion et indexé (schema/001_init.sql), c'est donc lui qui porte la
 * requête ; mais il ne se recalcule pas tout seul si la date du mariage bouge.
 * Un mariage repoussé de six mois garderait un `supprimer_le` ancien, et
 * l'effacement tomberait avant la fête — le pire échec possible pour cette
 * tâche. La seconde condition rend ce cas impossible, au prix d'un calcul sur
 * les seules lignes déjà retenues par l'index.
 *
 * L'existence de convives rend la tâche idempotente : une fois purgé, un
 * mariage ne remonte plus, donc le cron quotidien ne rejoue pas indéfiniment
 * des suppressions vides.
 */
export async function mariagesAPurger(db: D1Database): Promise<MariageAPurger[]> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.slug, m.date_mariage
         FROM mariages m
        WHERE m.supprimer_le <= date('now')
          AND date(m.date_mariage, '+90 days') <= date('now')
          AND EXISTS (SELECT 1 FROM convives c WHERE c.mariage_id = m.id)`,
    )
    .all<MariageAPurger>();
  return results;
}

/**
 * Efface les données d'invités d'un mariage et rend les clés R2 à supprimer.
 *
 * Ce qui part : les lignes `convives` (nom, prénom, présence, régime
 * alimentaire, message, et le message que le couple avait écrit pour chacun)
 * et les réponses de groupe, qui sont elles aussi des textes écrits pour des
 * invités.
 *
 * Ce qui reste : la ligne `mariages`. Le couple est notre client, pas un tiers ;
 * ses données vivent sous le contrat de sous-traitance et s'effacent à la fin
 * de celui-ci, pas au calendrier des invités. Mélanger les deux effacerait un
 * dossier client au bout de trois mois.
 *
 * Les clés R2 sont retournées plutôt que supprimées ici : la base et le bucket
 * sont deux systèmes sans transaction commune, et l'appelant supprime les
 * objets *après* que les lignes sont parties. Dans l'autre sens, un échec à
 * mi-chemin laisserait des lignes pointant vers des photos disparues.
 */
export async function purgerConvives(
  db: D1Database,
  mariageId: string,
): Promise<{ convives: number; groupes: number; clesPhotos: string[] }> {
  const { results: photos } = await db
    .prepare(
      `SELECT photo_key FROM convives WHERE mariage_id = ?1 AND photo_key IS NOT NULL
       UNION
       SELECT photo_key FROM reponses_groupe WHERE mariage_id = ?1 AND photo_key IS NOT NULL`,
    )
    .bind(mariageId)
    .all<{ photo_key: string }>();

  const [convives, groupes] = await db.batch([
    db.prepare("DELETE FROM convives WHERE mariage_id = ?1").bind(mariageId),
    db.prepare("DELETE FROM reponses_groupe WHERE mariage_id = ?1").bind(mariageId),
  ]);

  return {
    convives: convives?.meta.changes ?? 0,
    groupes: groupes?.meta.changes ?? 0,
    clesPhotos: photos.map((p) => p.photo_key),
  };
}


// ── Vue de suivi opérationnel (super admin) ───────────────────────
//
// Un ligne par mariage, des agrégats plutôt que des lignes de convives : la
// vue admin n'a jamais besoin de nommer un invité, et si elle en avait besoin,
// c'est cette absence qui empêcherait le glissement (cf. CLAUDE.md §2 :
// aucun point d'entrée ne liste les invités). Une seule requête, un JOIN
// agrégé côté SQL — on évite N+1 même à 200 mariages.

export interface AdminMariage {
  id: string;
  slug: string;
  prenom_1: string;
  prenom_2: string;
  date_mariage: string;
  date_limite_rsvp: string;
  email_proprietaire: string | null;
  a_photo_couple: number;   // 0 ou 1 côté SQLite
  a_photo_lieu: number;
  a_photo_og: number;
  a_contact_rgpd: number;
  purge_le: string;         // date_mariage + 90 jours
  n_invites: number;        // invités principaux seulement, cohérent avec §4
  n_accompagnants: number;
  n_oui: number;
  n_non: number;
  n_sans_reponse: number;
  n_messages_perso: number;
  n_photos_perso: number;
  n_reponses_groupe: number;
}

export async function listerMariagesPourAdmin(db: D1Database): Promise<AdminMariage[]> {
  const { results } = await db
    .prepare(
      `SELECT
         m.id, m.slug, m.prenom_1, m.prenom_2,
         m.date_mariage, m.date_limite_rsvp, m.email_proprietaire,
         (m.photo_couple_key IS NOT NULL) AS a_photo_couple,
         (m.cocktail_photo_key IS NOT NULL) AS a_photo_lieu,
         (m.og_image_key IS NOT NULL) AS a_photo_og,
         (m.contact_rgpd IS NOT NULL) AS a_contact_rgpd,
         date(m.date_mariage, '+90 days') AS purge_le,
         COALESCE(SUM(CASE WHEN c.accompagnant_de IS NULL THEN 1 ELSE 0 END), 0) AS n_invites,
         COALESCE(SUM(CASE WHEN c.accompagnant_de IS NOT NULL THEN 1 ELSE 0 END), 0) AS n_accompagnants,
         COALESCE(SUM(CASE WHEN c.accompagnant_de IS NULL AND c.presence = 'oui' THEN 1 ELSE 0 END), 0) AS n_oui,
         COALESCE(SUM(CASE WHEN c.accompagnant_de IS NULL AND c.presence = 'non' THEN 1 ELSE 0 END), 0) AS n_non,
         COALESCE(SUM(CASE WHEN c.accompagnant_de IS NULL AND c.presence IS NULL THEN 1 ELSE 0 END), 0) AS n_sans_reponse,
         COALESCE(SUM(CASE WHEN c.accompagnant_de IS NULL AND c.message_perso IS NOT NULL THEN 1 ELSE 0 END), 0) AS n_messages_perso,
         COALESCE(SUM(CASE WHEN c.photo_key IS NOT NULL THEN 1 ELSE 0 END), 0) AS n_photos_perso,
         (SELECT COUNT(*) FROM reponses_groupe WHERE mariage_id = m.id) AS n_reponses_groupe
       FROM mariages m
       LEFT JOIN convives c ON c.mariage_id = m.id
       GROUP BY m.id
       ORDER BY m.date_mariage ASC`,
    )
    .all<AdminMariage>();
  return results;
}

// ── Tunnel self-service (Fiche B Etsy) ────────────────────────────
//
// Un acheteur crée son propre mariage à partir d'un code d'activation
// (cf. schema/008_codes_activation.sql). Ce n'est pas le tableau de bord :
// il n'y a pas de session Cloudflare Access ici, la preuve de légitimité est
// la connaissance du couple {numéro de commande, email}, dans le même esprit
// que le lien à token des invités (§3) — un secret partagé, pas une identité.

export interface CodeActivation {
  id: string;
  commande_etsy: string;
  email: string;
  cree_le: string;
  consomme_le: string | null;
  mariage_id: string | null;
}

/**
 * Enregistre une vente après lecture manuelle de la commande Etsy réelle
 * (cf. docs/etsy.md, workflow post-vente). Refuse un numéro de commande déjà
 * connu plutôt que de l'écraser silencieusement — une seconde vente avec le
 * même numéro serait une erreur de saisie de l'admin, jamais un cas légitime.
 */
export async function creerCodeActivation(
  db: D1Database,
  commandeEtsy: string,
  email: string,
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const existant = await db
    .prepare("SELECT 1 FROM codes_activation WHERE commande_etsy = ?1")
    .bind(commandeEtsy)
    .first();
  if (existant) return { ok: false, erreur: "Ce numéro de commande est déjà enregistré." };

  await db
    .prepare("INSERT INTO codes_activation (id, commande_etsy, email) VALUES (?1, ?2, ?3)")
    .bind(crypto.randomUUID(), commandeEtsy, email.toLowerCase())
    .run();
  return { ok: true };
}

// Vue admin d'un code : les infos du mariage qu'il a créé, quand il en a créé
// un, pour que la carte "Codes d'activation" affiche directement qui c'est,
// sa remarque éventuelle, et s'il reste à activer — sans aller les chercher
// mariage par mariage.
export interface CodeActivationAdmin extends CodeActivation {
  prenom_1: string | null;
  prenom_2: string | null;
  slug: string | null;
  remarque_acheteur: string | null;
  active_le: string | null;
}

export async function listerCodesActivation(db: D1Database): Promise<CodeActivationAdmin[]> {
  const { results } = await db
    .prepare(
      `SELECT ca.*, m.prenom_1, m.prenom_2, m.slug, m.remarque_acheteur, m.active_le
       FROM codes_activation ca
       LEFT JOIN mariages m ON m.id = ca.mariage_id
       ORDER BY ca.cree_le DESC`,
    )
    .all<CodeActivationAdmin>();
  return results;
}

// Durée pendant laquelle un code déjà consommé reste modifiable : l'acheteur
// qui se trompe de date ou veut changer une photo n'a pas à nous écrire sur
// Etsy pour ça. Passé ce délai, le code se comporte comme définitivement
// utilisé — une correction tardive passe par le tableau de bord une fois
// l'accès Access ouvert (cf. docs/commande.md).
const FENETRE_MODIFICATION_HEURES = 48;

/**
 * Vérifie un couple {numéro de commande, email} sans rien modifier. Utilisée
 * pour l'étape 1 du tunnel, avant de montrer le formulaire — un acheteur qui
 * se trompe de numéro doit le savoir avant d'avoir rempli quoi que ce soit.
 *
 * La comparaison d'email est insensible à la casse (l'admin comme l'acheteur
 * peuvent capitaliser différemment), jamais au numéro de commande (Etsy ne
 * mélange pas la casse dans ses numéros, un espace mal recopié doit rester
 * une erreur signalée plutôt que silencieusement tolérée).
 *
 * Un code déjà consommé n'est pas forcément une erreur : dans les
 * `FENETRE_MODIFICATION_HEURES` qui suivent la création, il désigne une
 * correction légitime du même mariage — `modification: true` le signale à
 * l'appelant, qui pré-remplit le formulaire au lieu d'un en repartir à vide.
 */
export async function verifierCodeActivation(
  db: D1Database,
  commandeEtsy: string,
  email: string,
): Promise<
  | { valide: true; id: string; modification: false }
  | { valide: true; id: string; modification: true; mariageId: string }
  | { valide: false; erreur: string }
> {
  const code = await db
    .prepare("SELECT * FROM codes_activation WHERE commande_etsy = ?1")
    .bind(commandeEtsy)
    .first<CodeActivation>();

  if (!code) return { valide: false, erreur: "Numéro de commande introuvable." };
  if (code.email !== email.toLowerCase()) {
    return { valide: false, erreur: "Cet email ne correspond pas à cette commande." };
  }
  if (!code.consomme_le) return { valide: true, id: code.id, modification: false };

  const dansLaFenetre = await estDansLaFenetreDeModification(db, code.consomme_le);
  if (!dansLaFenetre) {
    return {
      valide: false,
      erreur: `Cette commande a déjà été utilisée pour créer un site, et le délai de correction de ${FENETRE_MODIFICATION_HEURES} h est dépassé.`,
    };
  }
  // mariage_id est forcément renseigné dès qu'un code est consommé (les deux
  // s'écrivent dans la même opération, cf. creerOuMettreAJourMariageSelfService) ;
  // le "!" documente cette invariante plutôt que de la re-tester en silence.
  return { valide: true, id: code.id, modification: true, mariageId: code.mariage_id! };
}

/**
 * Calcule côté SQL plutôt qu'en JS, pour la même raison que `supprimer_le` :
 * une seule expression de référence pour "combien de temps s'est écoulé",
 * reprise à l'identique dans `creerOuMettreAJourMariageSelfService` — cette
 * dernière ne doit jamais faire confiance à un contrôle déjà fait par un
 * appel précédent pour une action qui, elle, écrit.
 */
async function estDansLaFenetreDeModification(db: D1Database, consommeLe: string): Promise<boolean> {
  const ligne = await db
    .prepare("SELECT (julianday('now') - julianday(?1)) * 24 <= ?2 AS dans_fenetre")
    .bind(consommeLe, FENETRE_MODIFICATION_HEURES)
    .first<{ dans_fenetre: number }>();
  return Boolean(ligne?.dans_fenetre);
}

export async function getMariageParId(db: D1Database, id: string): Promise<Mariage | null> {
  return db.prepare("SELECT * FROM mariages WHERE id = ?1").bind(id).first<Mariage>();
}

export interface NouveauMariage {
  prenom_1: string;
  prenom_2: string;
  date_mariage: string;
  date_limite_rsvp: string;
  ceremonie_nom: string | null;
  ceremonie_adresse: string | null;
  heure_ceremonie: string | null;
  cocktail_nom: string | null;
  cocktail_adresse: string | null;
  heure_cocktail: string | null;
  reponse_generique_oui: string;
  reponse_generique_non: string;
  theme: string;
  messager: string;
  remarque_acheteur: string | null;
}

/**
 * Dérive un slug à partir des deux prénoms — même idée que `slugPrenom` pour
 * les liens d'invités, appliquée deux fois et jointe. Vérifie l'unicité et
 * ajoute un suffixe numérique en cas de collision : deux couples "Marie &
 * Paul" un jour donné ne sont pas un cas si rare qu'on puisse l'ignorer.
 */
async function genererSlugMariage(db: D1Database, prenom1: string, prenom2: string): Promise<string> {
  const nettoie = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const base = `${nettoie(prenom1)}-${nettoie(prenom2)}` || "mariage";
  let slug = base;
  let suffixe = 1;
  while (await db.prepare("SELECT 1 FROM mariages WHERE slug = ?1").bind(slug).first()) {
    suffixe += 1;
    slug = `${base}-${suffixe}`;
  }
  return slug;
}

/**
 * Crée un mariage depuis le tunnel self-service, ou met à jour celui déjà créé
 * par ce même code si on est dans `FENETRE_MODIFICATION_HEURES` — c'est ce qui
 * permet à l'acheteur de corriger une date ou une photo sans nous écrire sur
 * Etsy. `codeId` vient d'un appel à `verifierCodeActivation` réussi juste
 * avant, mais **jamais fait confiance** ici : la fenêtre et la consommation
 * sont revérifiées dans la même transaction logique que l'écriture, pour
 * qu'un appel concurrent (double clic, deux onglets, ou l'expiration de la
 * fenêtre pile entre les deux appels) ne puisse jamais écrire n'importe quoi.
 *
 * Le slug d'un mariage existant n'est **jamais** régénéré à la modification :
 * le lien a pu être déjà partagé aux invités, même reçu quelques minutes plus
 * tôt (même principe que l'immutabilité du token, §3 règle 3).
 *
 * `supprimer_le` est recalculé à chaque modification (la date du mariage a pu
 * changer) avec la même expression SQL que la purge (`mariagesAPurger`), une
 * seule source de vérité pour "90 jours après le mariage".
 */
export async function creerOuMettreAJourMariageSelfService(
  db: D1Database,
  codeId: string,
  email: string,
  data: NouveauMariage,
): Promise<{ ok: true; id: string; slug: string; modification: boolean } | { ok: false; erreur: string }> {
  const code = await db.prepare("SELECT * FROM codes_activation WHERE id = ?1").bind(codeId).first<CodeActivation>();
  if (!code) return { ok: false, erreur: "Commande introuvable, rechargez la page." };

  if (code.consomme_le) {
    // Chemin modification.
    if (!(await estDansLaFenetreDeModification(db, code.consomme_le))) {
      return { ok: false, erreur: `Le délai de correction de ${FENETRE_MODIFICATION_HEURES} h est dépassé.` };
    }
    const mariage = code.mariage_id ? await getMariageParId(db, code.mariage_id) : null;
    if (!mariage) return { ok: false, erreur: "Le site associé à cette commande est introuvable." };

    await db
      .prepare(
        `UPDATE mariages SET
           theme = ?1, messager = ?2, prenom_1 = ?3, prenom_2 = ?4,
           date_mariage = ?5, date_limite_rsvp = ?6,
           ceremonie_nom = ?7, ceremonie_adresse = ?8, heure_ceremonie = ?9,
           cocktail_nom = ?10, cocktail_adresse = ?11, heure_cocktail = ?12,
           reponse_generique_oui = ?13, reponse_generique_non = ?14,
           remarque_acheteur = ?15,
           supprimer_le = date(?5, '+90 days')
         WHERE id = ?16`,
      )
      .bind(
        data.theme,
        data.messager,
        data.prenom_1,
        data.prenom_2,
        data.date_mariage,
        data.date_limite_rsvp,
        data.ceremonie_nom,
        data.ceremonie_adresse,
        data.heure_ceremonie,
        data.cocktail_nom,
        data.cocktail_adresse,
        data.heure_cocktail,
        data.reponse_generique_oui,
        data.reponse_generique_non,
        data.remarque_acheteur,
        mariage.id,
      )
      .run();

    return { ok: true, id: mariage.id, slug: mariage.slug, modification: true };
  }

  // Chemin création.
  const id = crypto.randomUUID();
  const slug = await genererSlugMariage(db, data.prenom_1, data.prenom_2);

  await db
    .prepare(
      `INSERT INTO mariages (
         id, slug, theme, messager, prenom_1, prenom_2, date_mariage, date_limite_rsvp,
         ceremonie_nom, ceremonie_adresse, heure_ceremonie,
         cocktail_nom, cocktail_adresse, heure_cocktail,
         reponse_generique_oui, reponse_generique_non, remarque_acheteur,
         email_proprietaire, supprimer_le
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, date(?7, '+90 days'))`,
    )
    .bind(
      id,
      slug,
      data.theme,
      data.messager,
      data.prenom_1,
      data.prenom_2,
      data.date_mariage,
      data.date_limite_rsvp,
      data.ceremonie_nom,
      data.ceremonie_adresse,
      data.heure_ceremonie,
      data.cocktail_nom,
      data.cocktail_adresse,
      data.heure_cocktail,
      data.reponse_generique_oui,
      data.reponse_generique_non,
      data.remarque_acheteur,
      email.toLowerCase(),
    )
    .run();

  // Consommation atomique du code : le WHERE refait la vérification pour
  // qu'un appel concurrent (double clic, deux onglets) ne passe qu'une fois.
  const { meta } = await db
    .prepare(
      "UPDATE codes_activation SET consomme_le = datetime('now'), mariage_id = ?1 WHERE id = ?2 AND consomme_le IS NULL",
    )
    .bind(id, codeId)
    .run();

  if ((meta.changes ?? 0) === 0) {
    // Le code a été consommé entre la vérification et cet appel (concurrence) :
    // on retire le mariage qu'on vient d'insérer plutôt que de laisser un
    // second mariage orphelin pour la même vente.
    await db.prepare("DELETE FROM mariages WHERE id = ?1").bind(id).run();
    return { ok: false, erreur: "Cette commande vient d'être utilisée. Rafraîchissez la page." };
  }

  return { ok: true, id, slug, modification: false };
}

/**
 * Marque comme fait le pas manuel "sous-domaine ajouté côté Cloudflare"
 * (cf. docs/commande.md) : c'est ce qui rend `<slug>.SHARED_DOMAIN`
 * réellement joignable, tant que le joker DNS/TLS n'existe pas. Idempotent —
 * cliquer deux fois n'est pas une erreur, `COALESCE` garde la première date.
 */
export async function marquerMariageActive(
  db: D1Database,
  id: string,
): Promise<{ ok: true } | { ok: false; erreur: string }> {
  const { meta } = await db
    .prepare("UPDATE mariages SET active_le = COALESCE(active_le, datetime('now')) WHERE id = ?1")
    .bind(id)
    .run();
  if ((meta.changes ?? 0) === 0) return { ok: false, erreur: "Mariage introuvable." };
  return { ok: true };
}

// ── Programme de la journée et FAQ (cf. schema/010_programme_faq.sql) ──────
//
// Cérémonie et cocktail n'y figurent pas : ce sont des champs du mariage
// (heure_ceremonie/heure_cocktail + ceremonie_nom/cocktail_nom), utilisés
// aussi par la section "Le lieu" du thème. Ces deux listes couvrent tout le
// reste — dîner, soirée, ou n'importe quelle étape propre à un mariage — et
// la FAQ dans son ensemble.

export interface ProgrammeItem {
  id: string;
  mariage_id: string;
  heure: string | null;
  titre: string;
  lieu: string | null;
  ordre: number;
}

export interface FaqItem {
  id: string;
  mariage_id: string;
  question: string;
  reponse: string;
  ordre: number;
}

// Contenu proposé à la création : un couple qui ne touche à rien garde un
// programme et une FAQ raisonnables plutôt qu'une page vide.
export const PROGRAMME_PAR_DEFAUT: Array<{ heure: string | null; titre: string; lieu: string | null }> = [
  { heure: "22:30", titre: "Dîner", lieu: "Grande salle" },
  { heure: "00:00", titre: "Soirée dansante", lieu: null },
];

export const FAQ_PAR_DEFAUT: Array<{ question: string; reponse: string }> = [
  {
    question: "Comment se rendre au lieu du mariage ?",
    reponse: "En train, la gare la plus proche est celle de Pau. Vous pouvez nous contacter si vous n'avez pas de solution de transport de la gare jusqu'au lieu de la cérémonie.",
  },
  {
    question: "Y a-t-il des hébergements à proximité ?",
    reponse: "Plusieurs hôtels et chambres d'hôtes se trouvent à quelques minutes du domaine. Nous vous recommandons de réserver rapidement, notamment si vous venez de loin.",
  },
  {
    question: "Y a-t-il une navette prévue entre les différents lieux ?",
    reponse: "Une navette sera organisée entre la Mairie de Pau et le domaine pour ceux qui ne sont pas véhiculés. Les détails pratiques (horaires, points de départ) vous seront communiqués dans les semaines précédant la cérémonie, n'hésitez pas à vous signaler si vous n'avez pas de voiture.",
  },
  {
    question: "Y a-t-il un dress code pour la journée ?",
    reponse: "La tenue de soirée est souhaitée. Nous vous invitons à vous habiller élégamment pour cette belle occasion. Merci d'éviter le blanc et ses nuances, qui sont réservés à la mariée.",
  },
  {
    question: "Les enfants sont-ils les bienvenus ?",
    reponse: "Les enfants sont les bienvenus avec grande joie. Si vous venez accompagnés de vos petits, merci de l'indiquer dans votre RSVP afin que nous puissions nous organiser au mieux et prévoir des dispositions adaptées pour leur confort.",
  },
  {
    question: "La cérémonie se déroule-t-elle en intérieur ou en extérieur ?",
    reponse: "La cérémonie civile aura lieu à l'intérieur. Le cocktail se tiendra dans les jardins du domaine (en extérieur, sous réserve de beau temps). Le dîner et la soirée dansante se dérouleront à l'intérieur, dans la Grande Salle.",
  },
  {
    question: "Avez-vous une liste de mariage ou une cagnotte ?",
    reponse: "Votre présence à nos côtés est le plus beau des cadeaux. Si vous souhaitez tout de même nous gâter, une cagnotte sera disponible le jour du mariage. Merci de tout cœur pour votre générosité.",
  },
  {
    question: "Puis-je modifier mon RSVP après l'avoir envoyé ?",
    reponse: "Si votre situation venait à changer après l'envoi de votre réponse, n'hésitez pas à nous contacter directement par email ou par téléphone. Nous ferons notre possible pour prendre en compte votre nouvelle situation jusqu'au 15 avril 2027. Au-delà de cette date, les effectifs sont transmis définitivement au château et nous ne pourrons malheureusement plus ajouter de convive.",
  },
  {
    question: "Peut-on prendre des photos et les partager ?",
    reponse: "Oui, avec grand plaisir ! Nous serons ravis que vous immortalisiez ce moment à votre façon. Un photographe professionnel sera présent tout au long de la journée, et n'hésitez pas à faire vos propres souvenirs et à nous les partager suite à la soirée !",
  },
  {
    question: "Qui contacter en cas de question ?",
    reponse: "Pour toute question, vous pouvez nous contacter directement par email ou par téléphone. Nous ferons de notre mieux pour vous répondre dans les plus brefs délais. N'hésitez pas !",
  },
];

export async function listerProgramme(db: D1Database, mariageId: string): Promise<ProgrammeItem[]> {
  const { results } = await db
    .prepare("SELECT * FROM programme_items WHERE mariage_id = ?1 ORDER BY ordre ASC")
    .bind(mariageId)
    .all<ProgrammeItem>();
  return results;
}

export async function listerFaq(db: D1Database, mariageId: string): Promise<FaqItem[]> {
  const { results } = await db
    .prepare("SELECT * FROM faq_items WHERE mariage_id = ?1 ORDER BY ordre ASC")
    .bind(mariageId)
    .all<FaqItem>();
  return results;
}

/**
 * Remplace tout le programme (hors cérémonie/cocktail) d'un mariage : supprime
 * les lignes existantes et réinsère la liste donnée, dans l'ordre reçu. Même
 * principe que le reste du tunnel self-service (le formulaire renvoie l'état
 * complet voulu, jamais un diff) — plus simple et plus sûr qu'un rapprochement
 * ligne à ligne pour une liste que le couple réordonne, ajoute et retire
 * librement.
 */
export async function remplacerProgramme(
  db: D1Database,
  mariageId: string,
  items: Array<{ heure: string | null; titre: string; lieu: string | null }>,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM programme_items WHERE mariage_id = ?1").bind(mariageId),
    ...items.map((item, i) =>
      db
        .prepare(
          "INSERT INTO programme_items (id, mariage_id, heure, titre, lieu, ordre) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(crypto.randomUUID(), mariageId, item.heure, item.titre, item.lieu, i),
    ),
  ]);
}

/** Même principe que remplacerProgramme, pour la FAQ. */
export async function remplacerFaq(
  db: D1Database,
  mariageId: string,
  items: Array<{ question: string; reponse: string }>,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM faq_items WHERE mariage_id = ?1").bind(mariageId),
    ...items.map((item, i) =>
      db
        .prepare("INSERT INTO faq_items (id, mariage_id, question, reponse, ordre) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(crypto.randomUUID(), mariageId, item.question, item.reponse, i),
    ),
  ]);
}
