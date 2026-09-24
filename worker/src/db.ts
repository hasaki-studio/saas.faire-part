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
