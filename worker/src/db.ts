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
