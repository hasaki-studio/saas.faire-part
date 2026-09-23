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
  reponse_generique_oui: string;
  reponse_generique_non: string;
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
