import { getAccompagnants, getConviveByToken, resolveMariageByHost, type Mariage } from "./db";
import { token as genToken } from "./token";

export interface Env {
  DB: D1Database;
  PHOTOS: R2Bucket;
  SHARED_DOMAIN: string;
  PHOTOS_PUBLIC_URL: string;
}

const REGIMES_VALIDES = new Set(["vegetarien", "vegan", "halal", "casher", "sans_gluten"]);

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

  const now = new Date().toISOString();

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

    await env.DB.prepare(
      "INSERT INTO convives (id, mariage_id, token, prenom, nom, presence, regime_alimentaire, message_invite, repondu_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
    )
      .bind(crypto.randomUUID(), mariage.id, genToken(), prenom, nom, payload.presence, payload.regime_alimentaire ?? null, payload.message ?? null, now)
      .run();

    const retourInconnu =
      payload.presence === "oui" ? mariage.reponse_generique_oui : mariage.reponse_generique_non;
    return json({ reconnu: false, enregistre: true, retour: { message: retourInconnu, photo_url: null } });
  }

  await env.DB.prepare(
    "UPDATE convives SET presence = ?1, regime_alimentaire = ?2, message_invite = ?3, repondu_le = ?4 WHERE id = ?5",
  )
    .bind(payload.presence, payload.regime_alimentaire ?? null, payload.message ?? null, now, convive.id)
    .run();

  // La liste d'accompagnants remplace la précédente à chaque envoi (un RSVP est modifiable,
  // cf. FAQ). Chaque accompagnant reste sa propre ligne, jamais un compteur (cf. CLAUDE.md §4).
  await env.DB.prepare("DELETE FROM convives WHERE accompagnant_de = ?1").bind(convive.id).run();
  for (const a of payload.accompagnants ?? []) {
    await env.DB.prepare(
      "INSERT INTO convives (id, mariage_id, token, accompagnant_de, prenom, nom, presence, repondu_le) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )
      .bind(crypto.randomUUID(), mariage.id, genToken(), convive.id, a.prenom.trim(), a.nom.trim(), payload.presence, now)
      .run();
  }

  const retour =
    payload.presence === "oui" && convive.message_perso
      ? { message: convive.message_perso, photo_url: photoUrl(env, convive.photo_key) }
      : {
          message: payload.presence === "oui" ? mariage.reponse_generique_oui : mariage.reponse_generique_non,
          photo_url: null,
        };

  return json({ reconnu: true, retour });
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

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
