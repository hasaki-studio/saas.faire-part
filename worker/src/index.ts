import { emailAuthentifie } from "./acces";
import {
  type Origine,
  getAccompagnants,
  getConviveByToken,
  getMariageByEmail,
  getReponseGroupe,
  listerConvives,
  listerGroupes,
  resolveMariageByHost,
  type Mariage,
} from "./db";
import { token as genToken } from "./token";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  SHARED_DOMAIN: string;
  PHOTOS_PUBLIC_URL: string;
  // Hôte du tableau de bord. Les routes /api/tableau/* n'existent que là :
  // sur le domaine des invités, elles répondent 404 comme n'importe quelle
  // autre URL inconnue. Une route authentifiée qui n'est pas joignable est
  // une route qu'on ne peut pas mal protéger.
  DASHBOARD_HOSTNAME: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  // Confort de développement local uniquement (cf. emailTableau).
  DEV_EMAIL?: string;
}

const REGIMES_VALIDES = new Set(["vegetarien", "vegan", "halal", "casher", "sans_gluten"]);

// Plafond d'accompagnants annonçables par un invité. Ce n'est pas une limite
// technique : c'est le couple qui décide qui vient, et une liste ouverte laisse
// un invité amener une tablée entière sans prévenir — le traiteur est confirmé
// en avril, pas la veille. Au-delà, la conversation passe par les mariés.
const MAX_ACCOMPAGNANTS = 4;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function photoUrl(env: Env, key: string | null): string | null {
  return key ? `${env.PHOTOS_PUBLIC_URL}/${key}` : null;
}

// Contenu public du faire-part : identique pour tout le monde, reconnu ou non.
function contenuPublic(env: Env, mariage: Mariage) {
  return {
    theme: mariage.theme,
    messager: mariage.messager,
    prenom_1: mariage.prenom_1,
    prenom_2: mariage.prenom_2,
    date_mariage: mariage.date_mariage,
    date_limite_rsvp: mariage.date_limite_rsvp,
    ceremonie_nom: mariage.ceremonie_nom,
    ceremonie_adresse: mariage.ceremonie_adresse,
    cocktail_nom: mariage.cocktail_nom,
    cocktail_adresse: mariage.cocktail_adresse,
    cocktail_photo_url: photoUrl(env, mariage.cocktail_photo_key),
    photo_couple_url: photoUrl(env, mariage.photo_couple_key),
  };
}

async function handleFaireArt(request: Request, env: Env, mariageToken: string): Promise<Response> {
  const mariage = await resolveMariageByHost(env.DB, request.headers.get("host") ?? "", env.SHARED_DOMAIN);
  if (!mariage) return new Response("Domaine non configuré", { status: 404 });

  const convive = await getConviveByToken(env.DB, mariage.id, mariageToken);

  if (!convive) {
    // Règle absolue : un token inconnu ne donne jamais un 404 (cf. CLAUDE.md §3, règle #4).
    return json({
      reconnu: false,
      mariage: contenuPublic(env, mariage),
      message: "Nous n'avons pas reconnu votre lien, vous pouvez répondre ci-dessous.",
    });
  }

  const accompagnants = await getAccompagnants(env.DB, convive.id);

  return json({
    reconnu: true,
    mariage: contenuPublic(env, mariage),
    invite: {
      prenom: convive.prenom,
      nom: convive.nom,
      presence: convive.presence,
      regime_alimentaire: convive.regime_alimentaire,
      accompagnants: accompagnants.map((a) => ({ id: a.id, prenom: a.prenom, nom: a.nom })),
      // Le message personnalisé n'est jamais renvoyé ici : il n'apparaît qu'après
      // une réponse "oui", sur l'écran de confirmation (cf. CLAUDE.md §4).
    },
  });
}

interface AccompagnantPayload {
  prenom: string;
  nom: string;
}

interface RsvpPayload {
  presence: "oui" | "non";
  regime_alimentaire?: string | null;
  message?: string | null;
  accompagnants?: AccompagnantPayload[];
  // Uniquement utilisés quand le token n'est pas reconnu (cf. plus bas) : on ne
  // connaît pas déjà cette personne, il faut qu'elle se présente elle-même.
  prenom?: string;
  nom?: string;
}

function validerPayload(payload: unknown): payload is RsvpPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as Record<string, unknown>;
  if (p.presence !== "oui" && p.presence !== "non") return false;
  if (p.regime_alimentaire != null && !REGIMES_VALIDES.has(String(p.regime_alimentaire))) return false;
  if (p.message != null && typeof p.message !== "string") return false;
  if (p.prenom != null && typeof p.prenom !== "string") return false;
  if (p.nom != null && typeof p.nom !== "string") return false;
  if (p.accompagnants != null) {
    if (!Array.isArray(p.accompagnants)) return false;
    for (const a of p.accompagnants) {
      if (typeof a?.prenom !== "string" || typeof a?.nom !== "string") return false;
      if (!a.prenom.trim() || !a.nom.trim()) return false;
    }
  }
  return true;
}

async function handleRsvp(request: Request, env: Env, mariageToken: string): Promise<Response> {
  const mariage = await resolveMariageByHost(env.DB, request.headers.get("host") ?? "", env.SHARED_DOMAIN);
  if (!mariage) return new Response("Domaine non configuré", { status: 404 });

  const convive = await getConviveByToken(env.DB, mariage.id, mariageToken);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }
  if (!validerPayload(payload)) {
    return json({ erreur: "Réponse invalide" }, 400);
  }

  const accompagnants = payload.accompagnants ?? [];
  if (accompagnants.length > MAX_ACCOMPAGNANTS) {
    return json(
      {
        erreur: `Vous pouvez annoncer au maximum ${MAX_ACCOMPAGNANTS} accompagnants. Au-delà, écrivez directement aux mariés.`,
      },
      400,
    );
  }

  const now = new Date().toISOString();

  // L'hôte de la réponse : la ligne existante, ou celle qu'on vient de créer
  // pour un token inconnu. Les accompagnants se rattachent à elle dans les deux
  // cas — avant, le chemin « hors liste » les jetait en silence, et le couple
  // confirmait au traiteur un effectif amputé de ces couverts-là.
  let hote: { id: string; origine: Origine };
  let reconnu: boolean;

  if (!convive) {
    // Lien mal recopié ou personne non prévue sur la liste : on la laisse quand même
    // répondre, sous un token fraîchement généré (jamais le token saisi, qui pourrait
    // être un doublon devinable par un autre visiteur). Règle absolue : jamais de 404
    // face à un token inconnu (cf. CLAUDE.md §3, règle #4).
    const prenom = payload.prenom?.trim();
    const nom = payload.nom?.trim();
    if (!prenom || !nom) {
      return json({ erreur: "Merci d'indiquer votre prénom et votre nom." }, 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO convives (id, mariage_id, token, prenom, nom, presence, regime_alimentaire, message_invite, repondu_le, origine) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'hors_liste')",
    )
      .bind(id, mariage.id, genToken(), prenom, nom, payload.presence, payload.regime_alimentaire ?? null, payload.message ?? null, now)
      .run();

    hote = { id, origine: "hors_liste" };
    reconnu = false;
  } else {
    await env.DB.prepare(
      "UPDATE convives SET presence = ?1, regime_alimentaire = ?2, message_invite = ?3, repondu_le = ?4 WHERE id = ?5",
    )
      .bind(payload.presence, payload.regime_alimentaire ?? null, payload.message ?? null, now, convive.id)
      .run();

    hote = { id: convive.id, origine: convive.origine };
    reconnu = true;
  }

  // La liste d'accompagnants remplace la précédente à chaque envoi (un RSVP est modifiable,
  // cf. FAQ). Chaque accompagnant reste sa propre ligne, jamais un compteur (cf. CLAUDE.md §4).
  await env.DB.prepare("DELETE FROM convives WHERE accompagnant_de = ?1").bind(hote.id).run();
  for (const a of accompagnants) {
    await env.DB.prepare(
      // Le +1 d'un inconnu n'est pas davantage sur la liste que lui.
      "INSERT INTO convives (id, mariage_id, token, accompagnant_de, prenom, nom, presence, repondu_le, origine) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
      .bind(crypto.randomUUID(), mariage.id, genToken(), hote.id, a.prenom.trim(), a.nom.trim(), payload.presence, now, hote.origine)
      .run();
  }

  const oui = payload.presence === "oui";

  // Résolution en cascade : message_perso → réponse du groupe → générique.
  // Le groupe est un filet SOUS l'individuel (cf. schema/005_groupes.sql), il ne
  // le remplace jamais. Rien de tout ça sur un « non » : toujours la réponse
  // générique, un mot écrit pour quelqu'un devient cruel quand il décline (§4).
  const groupe =
    convive && oui && !convive.message_perso && convive.groupe
      ? await getReponseGroupe(env.DB, mariage.id, convive.groupe)
      : null;

  // message_perso et photo_key sont deux champs indépendants (cf. CLAUDE.md §1) :
  // une photo sans texte accompagne la réponse générique plutôt que de disparaître.
  // Les coupler, c'est perdre sans erreur une photo que le couple a pris la peine
  // de choisir.
  const retour = {
    message: oui
      ? convive?.message_perso || groupe?.message || mariage.reponse_generique_oui
      : mariage.reponse_generique_non,
    photo_url: oui ? photoUrl(env, convive?.photo_key ?? groupe?.photo_key ?? null) : null,
  };

  return json({ reconnu, enregistre: true, retour });
}


// ── Tableau de bord ───────────────────────────────────────────────

/**
 * Email du couple connecté, ou null. En local (`wrangler dev`) il n'y a pas
 * d'Access devant le Worker, donc DEV_EMAIL sert de connexion simulée — mais
 * uniquement sur localhost, et la variable est absente de [env.prod.vars].
 * Deux verrous plutôt qu'un : une variable oubliée en prod ne suffirait pas à
 * ouvrir le tableau de bord.
 */
async function emailTableau(request: Request, env: Env): Promise<string | null> {
  const hostname = new URL(request.url).hostname;
  if (env.DEV_EMAIL && (hostname === "localhost" || hostname === "127.0.0.1")) {
    return env.DEV_EMAIL.toLowerCase();
  }
  return emailAuthentifie(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
}

/**
 * Résout le mariage du couple connecté. Le `mariage_id` est déduit de
 * l'identité authentifiée, jamais d'un paramètre envoyé par le navigateur :
 * c'est tout ce qui sépare le tableau de bord d'un point d'entrée qui listerait
 * les invités de n'importe qui (D1 n'a pas de RLS, cf. CLAUDE.md §2).
 */
async function mariageDuCouple(request: Request, env: Env): Promise<Mariage | Response> {
  const email = await emailTableau(request, env);
  if (!email) return json({ erreur: "Non authentifié" }, 403);

  const mariage = await getMariageByEmail(env.DB, email);
  // Compte valide chez Access mais rattaché à aucun mariage : même réponse
  // qu'une absence d'authentification, pour ne pas confirmer quels emails
  // existent en base.
  if (!mariage) return json({ erreur: "Non authentifié" }, 403);

  return mariage;
}

async function handleTableauMariage(request: Request, env: Env): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;

  return json({
    mariage: {
      prenom_1: mariage.prenom_1,
      prenom_2: mariage.prenom_2,
      date_mariage: mariage.date_mariage,
      date_limite_rsvp: mariage.date_limite_rsvp,
      slug: mariage.slug,
      domaine: mariage.domaine_personnalise ?? `${mariage.slug}.${env.SHARED_DOMAIN}`,
    },
  });
}

async function handleTableauConvives(request: Request, env: Env): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;

  const [convives, groupes] = await Promise.all([
    listerConvives(env.DB, mariage.id),
    listerGroupes(env.DB, mariage.id),
  ]);
  const domaine = mariage.domaine_personnalise ?? `${mariage.slug}.${env.SHARED_DOMAIN}`;

  // Un groupe existe dès qu'un invité y est rattaché, même sans réponse écrite :
  // c'est précisément ce que le couple doit voir pour savoir ce qui lui reste
  // à faire.
  const nomsGroupes = [...new Set(convives.map((c) => c.groupe).filter((g): g is string => !!g))];

  return json({
    groupes: nomsGroupes.sort((a, b) => a.localeCompare(b, "fr")).map((nom) => {
      const reponse = groupes.find((g) => g.groupe === nom);
      return {
        nom,
        a_message: Boolean(reponse),
        a_photo: Boolean(reponse?.photo_key),
        invites: convives.filter((c) => c.groupe === nom && !c.accompagnant_de).length,
      };
    }),
    convives: convives.map((c) => ({
      id: c.id,
      prenom: c.prenom,
      nom: c.nom,
      accompagnant_de: c.accompagnant_de,
      // Le lien personnel : le couple en a besoin pour l'envoyer lui-même.
      // Un accompagnant est annoncé par quelqu'un d'autre, il ne reçoit pas de
      // lien — sa ligne existe pour le plan de table (cf. CLAUDE.md §4).
      lien: c.accompagnant_de ? null : `https://${domaine}/${slugPrenom(c.prenom)}-${c.token}`,
      a_message: Boolean(c.message_perso),
      a_photo: Boolean(c.photo_key),
      hors_liste: c.origine === "hors_liste",
      groupe: c.groupe,
      presence: c.presence,
      regime_alimentaire: c.regime_alimentaire,
      message_invite: c.message_invite,
      repondu_le: c.repondu_le,
    })),
  });
}

/**
 * Le tableau de bord n'est servi que sur son propre hôte. `wrangler dev` sert
 * tout sur localhost, d'où la seconde branche — conditionnée à DEV_EMAIL, qui
 * n'existe pas en production.
 */
function estHoteTableau(url: URL, env: Env): boolean {
  if (url.hostname === env.DASHBOARD_HOSTNAME) return true;
  return Boolean(env.DEV_EMAIL) && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

// Partie décorative du lien (cf. import-invites.js) : toute la sécurité est
// dans le token qui suit.
function slugPrenom(prenom: string): string {
  return prenom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const faireArt = url.pathname.match(/^\/api\/faire-part\/([^/]+)$/);
    if (faireArt && request.method === "GET") {
      return handleFaireArt(request, env, faireArt[1]!);
    }

    const rsvp = url.pathname.match(/^\/api\/rsvp\/([^/]+)$/);
    if (rsvp && request.method === "POST") {
      return handleRsvp(request, env, rsvp[1]!);
    }

    // Les routes du tableau de bord ne sont servies que sur son propre hôte.
    if (url.pathname.startsWith("/api/tableau/") && estHoteTableau(url, env)) {
      if (url.pathname === "/api/tableau/mariage" && request.method === "GET") {
        return handleTableauMariage(request, env);
      }
      if (url.pathname === "/api/tableau/convives" && request.method === "GET") {
        return handleTableauConvives(request, env);
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
