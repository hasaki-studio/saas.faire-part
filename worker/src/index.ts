import { emailAuthentifie } from "./acces";
import {
  type Origine,
  getAccompagnants,
  getConviveByToken,
  creerCodeActivation,
  creerOuMettreAJourMariageSelfService,
  getMariageParId,
  type NouveauMariage,
  ecrireGroupeConvive,
  ecrireMessagePerso,
  ecrirePhotoKey,
  ecrirePhotoMariage,
  type PhotoMariage,
  ecrireReponseGroupe,
  getConviveParId,
  importerConvives,
  type InviteImporte,
  getMariageByEmail,
  getReponseGroupe,
  listerCodesActivation,
  listerConvives,
  listerFaq,
  listerGroupes,
  listerMariagesPourAdmin,
  listerProgramme,
  marquerMariageActive,
  mariagesAPurger,
  purgerConvives,
  remplacerFaq,
  remplacerProgramme,
  resolveMariageByHost,
  supprimerReponseGroupe,
  verifierCodeActivation,
  FAQ_PAR_DEFAUT,
  PROGRAMME_PAR_DEFAUT,
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
  // Vue de suivi admin (CLAUDE.md §2). Hôte, AUD Access et allowlist séparés
  // du tableau de bord des couples : un jeton du tableau ne doit pas ouvrir
  // les portes admin, un couple non admin ne doit pas y entrer même si
  // l'application Access était mal configurée.
  ADMIN_HOSTNAME: string;
  ADMIN_ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  // Idem DEV_EMAIL pour l'hôte admin en local. Absent en prod.
  DEV_ADMIN_EMAIL?: string;
  // Tunnel self-service (Fiche B Etsy, CLAUDE.md §8). Pas d'Access ici : la
  // légitimité vient de la connaissance {numéro de commande, email}, pas
  // d'une session — cf. docs/commande.md.
  COMMANDE_HOSTNAME: string;
  // Limitation de débit du lookup public (CLAUDE.md §3, règle 5). Le binding
  // est déclaré dans wrangler.toml — voir aussi les commentaires y afférents.
  LOOKUP_RATE: RateLimit;
  // Même principe que LOOKUP_RATE, namespace séparé : une rafale sur l'un ne
  // doit jamais entamer le crédit de l'autre.
  COMMANDE_RATE: RateLimit;
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
async function contenuPublic(env: Env, mariage: Mariage) {
  const [programme, faq] = await Promise.all([listerProgramme(env.DB, mariage.id), listerFaq(env.DB, mariage.id)]);
  return {
    theme: mariage.theme,
    messager: mariage.messager,
    prenom_1: mariage.prenom_1,
    prenom_2: mariage.prenom_2,
    date_mariage: mariage.date_mariage,
    date_limite_rsvp: mariage.date_limite_rsvp,
    ceremonie_nom: mariage.ceremonie_nom,
    ceremonie_adresse: mariage.ceremonie_adresse,
    heure_ceremonie: mariage.heure_ceremonie,
    cocktail_nom: mariage.cocktail_nom,
    cocktail_adresse: mariage.cocktail_adresse,
    heure_cocktail: mariage.heure_cocktail,
    cocktail_photo_url: photoUrl(env, mariage.cocktail_photo_key),
    photo_couple_url: photoUrl(env, mariage.photo_couple_key),
    // Mention d'information du formulaire RSVP (CLAUDE.md §5) : le responsable
    // de traitement, c'est le couple, et l'article 13 veut de quoi le joindre.
    // Null accepté — le thème dit alors de répondre au message qui portait le
    // lien, ce qui est vrai puisqu'ils partent par WhatsApp.
    contact_rgpd: mariage.contact_rgpd,
    programme: programme.map((p) => ({ heure: p.heure, titre: p.titre, lieu: p.lieu })),
    faq: faq.map((f) => ({ question: f.question, reponse: f.reponse })),
  };
}

/**
 * Bloque un appel qui dépasse la limite de débit d'un binding donné.
 *
 * Retourne `null` si l'appel passe, une `Response` 429 sinon — pour que
 * l'appelant écrive `if (const bloque = await limiterAvec(...); bloque)
 * return bloque;`.
 *
 * L'IP vient de `cf-connecting-ip`, seul en-tête que Cloudflare pose lui-même
 * sur la requête ; `x-forwarded-for` est écrit par n'importe qui et un
 * attaquant qui l'utiliserait comme clé aurait un compteur neuf à chaque
 * requête. Absent, on refuse plutôt que de laisser passer sans compter : sur
 * un Worker Cloudflare c'est une anomalie, pas un cas normal.
 *
 * En `wrangler dev` local, la seule chose qu'on peut faire est de simuler
 * l'en-tête ; la limitation elle-même est appliquée par le binding, qui
 * fonctionne aussi en local.
 */
async function limiterAvec(request: Request, binding: RateLimit): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return json({ erreur: "Origine non identifiable" }, 400);

  const { success } = await binding.limit({ key: ip });
  if (success) return null;

  // Retry-After en secondes : la fenêtre du binding, pas moins — sinon le
  // client réessaie trop tôt et se reprend un 429.
  return new Response(
    JSON.stringify({
      erreur: "Trop de requêtes en peu de temps. Attendez une minute avant de réessayer.",
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": "60",
      },
    },
  );
}

function limiterLookup(request: Request, env: Env): Promise<Response | null> {
  return limiterAvec(request, env.LOOKUP_RATE);
}

function limiterCommande(request: Request, env: Env): Promise<Response | null> {
  return limiterAvec(request, env.COMMANDE_RATE);
}

async function handleFaireArt(request: Request, env: Env, mariageToken: string): Promise<Response> {
  // Avant la moindre requête D1 : un attaquant qui teste des tokens ne doit
  // consommer ni notre CPU ni notre quota base.
  const bloque = await limiterLookup(request, env);
  if (bloque) return bloque;

  const mariage = await resolveMariageByHost(env.DB, request.headers.get("host") ?? "", env.SHARED_DOMAIN);
  if (!mariage) return new Response("Domaine non configuré", { status: 404 });

  const convive = await getConviveByToken(env.DB, mariage.id, mariageToken);

  if (!convive) {
    // Règle absolue : un token inconnu ne donne jamais un 404 (cf. CLAUDE.md §3, règle #4).
    return json({
      reconnu: false,
      mariage: await contenuPublic(env, mariage),
      message: "Nous n'avons pas reconnu votre lien, vous pouvez répondre ci-dessous.",
    });
  }

  const accompagnants = await getAccompagnants(env.DB, convive.id);

  return json({
    reconnu: true,
    mariage: await contenuPublic(env, mariage),
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


// Longueur d'un message. Ce n'est pas une limite de stockage — c'est qu'au-delà,
// ce n'est plus un mot glissé dans un faire-part, et l'écran de retour devient
// illisible sur un téléphone.
const MAX_MESSAGE = 1500;

/**
 * Une écriture doit venir du tableau de bord lui-même. Le jeton d'Access vit
 * dans un cookie : sans ce contrôle, une page malveillante ouverte dans le même
 * navigateur pourrait déclencher une écriture avec ce cookie à l'insu du couple.
 */
function origineLegitime(request: Request, env: Env): boolean {
  return origineAttendue(request, env.DASHBOARD_HOSTNAME);
}

/**
 * Généralisation d'origineLegitime pour un hôte donné. Le tunnel commande
 * n'a pas de cookie de session à protéger contre le CSRF — sa légitimité
 * tient au corps de la requête, pas à une identité ambiante — mais vérifier
 * l'Origin reste un filtre bon marché contre un site tiers qui imiterait
 * notre formulaire.
 */
function origineAttendue(request: Request, hoteAttendu: string): boolean {
  const origine = request.headers.get("origin");
  if (!origine) return false;
  try {
    const hote = new URL(origine).hostname;
    return hote === hoteAttendu || hote === "localhost" || hote === "127.0.0.1";
  } catch {
    return false;
  }
}

async function handleEcrireMessage(request: Request, env: Env, conviveId: string): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;
  if (!origineLegitime(request, env)) return json({ erreur: "Origine refusée" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }
  const brut = (payload as { message?: unknown }).message;
  if (brut != null && typeof brut !== "string") return json({ erreur: "Message invalide" }, 400);

  const message = typeof brut === "string" ? brut.trim() : "";
  if (message.length > MAX_MESSAGE) {
    return json({ erreur: `Message trop long (${MAX_MESSAGE} caractères maximum).` }, 400);
  }

  // Vider le champ est une action légitime : le couple revient à la réponse
  // générique. '' et NULL doivent donc dire la même chose en base.
  const ok = await ecrireMessagePerso(env.DB, mariage.id, conviveId, message || null);
  if (!ok) return json({ erreur: "Invité introuvable" }, 404);

  return json({ enregistre: true, a_message: Boolean(message) });
}

async function handleAssignerGroupe(request: Request, env: Env, conviveId: string): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;
  if (!origineLegitime(request, env)) return json({ erreur: "Origine refusée" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }
  const brut = (payload as { groupe?: unknown }).groupe;
  if (brut != null && typeof brut !== "string") return json({ erreur: "Groupe invalide" }, 400);

  // Vider = retirer du groupe : '' et NULL disent la même chose en base, comme
  // pour le message perso (cf. handleEcrireMessage). Un nom trop long est
  // refusé, c'est le même plafond que celui appliqué à l'import (60 caractères).
  const nom = typeof brut === "string" ? brut.trim() : "";
  if (nom.length > 60) {
    return json({ erreur: "Nom de groupe trop long (60 caractères maximum)." }, 400);
  }

  const ok = await ecrireGroupeConvive(env.DB, mariage.id, conviveId, nom || null);
  if (!ok) return json({ erreur: "Invité introuvable" }, 404);

  return json({ enregistre: true, groupe: nom || null });
}

async function handleEcrireGroupe(request: Request, env: Env, groupe: string): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;
  if (!origineLegitime(request, env)) return json({ erreur: "Origine refusée" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }
  const brut = (payload as { message?: unknown }).message;
  if (brut != null && typeof brut !== "string") return json({ erreur: "Message invalide" }, 400);

  const message = typeof brut === "string" ? brut.trim() : "";
  if (message.length > MAX_MESSAGE) {
    return json({ erreur: `Message trop long (${MAX_MESSAGE} caractères maximum).` }, 400);
  }

  if (!message) {
    // Groupe vidé : la ligne disparaît plutôt que de garder un message vide,
    // sans quoi le tableau de bord afficherait « message écrit » pour rien.
    await supprimerReponseGroupe(env.DB, mariage.id, groupe);
    return json({ enregistre: true, a_message: false });
  }

  const ok = await ecrireReponseGroupe(env.DB, mariage.id, groupe, message);
  if (!ok) return json({ erreur: "Groupe introuvable" }, 404);

  return json({ enregistre: true, a_message: true });
}

// Poids maximal accepté. Le navigateur envoie un médaillon 400 × 400 en JPEG 82,
// soit ~40 Ko : ce plafond n'est pas une cible, c'est un garde-fou contre un
// envoi qui ne viendrait pas de notre page.
const MAX_PHOTO_OCTETS = 2 * 1024 * 1024;

// Les trois emplacements photo d'un mariage. Ce n'est pas une paramétrisation
// libre : chaque emplacement a son plafond de poids (l'og:image de WhatsApp est
// nettement plus contraint, cf. CLAUDE.md §7), son préfixe de clé, et sa colonne
// dans mariages. Une table ici évite trois handlers copiés-collés, et un kind
// inconnu ne trouve pas d'entrée — donc échoue proprement.
const PHOTOS_MARIAGE = {
  couple: { colonne: "photo_couple_key", prefixe: "couple", plafond: 2 * 1024 * 1024 },
  lieu:   { colonne: "cocktail_photo_key", prefixe: "lieu",   plafond: 2 * 1024 * 1024 },
  // 700 Ko : WhatsApp coupe l'aperçu au-delà de 600 Ko (§7), le navigateur vise
  // sous ce seuil ; la marge sert de garde-fou contre un envoi qui ne viendrait
  // pas de notre page, elle ne récupère pas un mauvais réglage.
  og:     { colonne: "og_image_key",       prefixe: "og",     plafond: 700 * 1024  },
} as const satisfies Record<string, { colonne: PhotoMariage; prefixe: string; plafond: number }>;
type KindPhoto = keyof typeof PHOTOS_MARIAGE;

/**
 * Téléverse ou supprime une des trois photos du mariage. Même conception que
 * handlePhoto : le kind vient de la route (fermé par le type), la clé R2 est
 * calculée côté serveur — le navigateur ne choisit jamais où écrire, sans quoi
 * il pourrait écraser la photo d'un autre —, et l'objet R2 est effacé après
 * l'écriture DB pour ne pas laisser une ligne pointer vers un objet disparu.
 */
async function handlePhotoMariage(request: Request, env: Env, kind: KindPhoto): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;
  if (!origineLegitime(request, env)) return json({ erreur: "Origine refusée" }, 403);

  const emplacement = PHOTOS_MARIAGE[kind];
  const ancienne = mariage[emplacement.colonne];

  if (request.method === "DELETE") {
    await ecrirePhotoMariage(env.DB, mariage.id, emplacement.colonne, null);
    if (ancienne) await env.PHOTOS.delete(ancienne);
    return json({ enregistre: true, photo_url: null });
  }

  if (request.headers.get("content-type") !== "image/jpeg") {
    return json({ erreur: "Seul le JPEG est accepté." }, 400);
  }

  const octets = await request.arrayBuffer();
  if (octets.byteLength === 0) return json({ erreur: "Image vide" }, 400);
  if (octets.byteLength > emplacement.plafond) {
    return json({ erreur: "Image trop lourde." }, 400);
  }

  // Un suffixe aléatoire à chaque remplacement : sinon les caches — WhatsApp
  // pour l'og:image en particulier — servent la précédente indéfiniment.
  const cle = `mariage/${mariage.slug}/${emplacement.prefixe}-${genToken(6)}.jpg`;

  await env.PHOTOS.put(cle, octets, {
    httpMetadata: {
      contentType: "image/jpeg",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  await ecrirePhotoMariage(env.DB, mariage.id, emplacement.colonne, cle);

  // Après la base : un échec ici laisse un objet orphelin, moins grave qu'une
  // ligne pointant vers un objet supprimé (même arbitrage qu'ailleurs).
  if (ancienne && ancienne !== cle) await env.PHOTOS.delete(ancienne);

  return json({ enregistre: true, photo_url: photoUrl(env, cle) });
}

async function handlePhoto(request: Request, env: Env, conviveId: string): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;
  if (!origineLegitime(request, env)) return json({ erreur: "Origine refusée" }, 403);

  const convive = await getConviveParId(env.DB, mariage.id, conviveId);
  if (!convive) return json({ erreur: "Invité introuvable" }, 404);
  // Même raison que pour le message : un accompagnant n'a pas de lien, donc pas
  // d'écran de retour où la photo s'afficherait.
  if (convive.accompagnant_de) return json({ erreur: "Invité introuvable" }, 404);

  const ancienne = convive.photo_key;

  if (request.method === "DELETE") {
    await ecrirePhotoKey(env.DB, mariage.id, conviveId, null);
    if (ancienne) await env.PHOTOS.delete(ancienne);
    return json({ enregistre: true, photo_url: null });
  }

  if (request.headers.get("content-type") !== "image/jpeg") {
    return json({ erreur: "Seul le JPEG est accepté." }, 400);
  }

  const octets = await request.arrayBuffer();
  if (octets.byteLength === 0) return json({ erreur: "Image vide" }, 400);
  if (octets.byteLength > MAX_PHOTO_OCTETS) {
    return json({ erreur: "Image trop lourde." }, 400);
  }

  // La clé est calculée ici, jamais envoyée par le navigateur : lui laisser
  // choisir où écrire, c'est lui laisser écraser la photo d'un autre. Dérivée du
  // token et non séquentielle (cf. CLAUDE.md §4) ; le suffixe aléatoire fait une
  // URL neuve à chaque remplacement, sinon les caches serviraient l'ancienne.
  const cle = `invite/${convive.token}-${genToken(6)}.jpg`;

  await env.PHOTOS.put(cle, octets, {
    httpMetadata: {
      contentType: "image/jpeg",
      // Immuable : l'URL change quand la photo change, donc rien n'a besoin
      // d'être revalidé.
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  await ecrirePhotoKey(env.DB, mariage.id, conviveId, cle);

  // Après l'enregistrement : un échec ici laisse un objet orphelin, ce qui est
  // moins grave qu'une ligne pointant vers un objet supprimé.
  if (ancienne && ancienne !== cle) await env.PHOTOS.delete(ancienne);

  return json({ enregistre: true, photo_url: photoUrl(env, cle) });
}

// Un import reste une opération humaine : au-delà, c'est une erreur de
// manipulation ou autre chose qu'une liste de mariage.
const MAX_IMPORT = 500;

async function handleImport(request: Request, env: Env): Promise<Response> {
  const mariage = await mariageDuCouple(request, env);
  if (mariage instanceof Response) return mariage;
  if (!origineLegitime(request, env)) return json({ erreur: "Origine refusée" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }

  const brut = (payload as { invites?: unknown }).invites;
  if (!Array.isArray(brut) || !brut.length) return json({ erreur: "Aucun invité à ajouter." }, 400);
  if (brut.length > MAX_IMPORT) {
    return json({ erreur: `${MAX_IMPORT} invités au maximum par import.` }, 400);
  }

  const invites: InviteImporte[] = [];
  for (const ligne of brut) {
    const l = ligne as Record<string, unknown>;
    const prenom = typeof l.prenom === "string" ? l.prenom.trim() : "";
    const nom = typeof l.nom === "string" ? l.nom.trim() : "";
    // Le prénom seul suffit : c'est lui qui porte le lien et l'adresse au
    // destinataire. Un nom manquant se complète plus tard.
    if (!prenom) continue;
    const message = typeof l.message === "string" ? l.message.trim() : "";
    const groupe = typeof l.groupe === "string" ? l.groupe.trim() : "";
    invites.push({
      prenom: prenom.slice(0, 80),
      nom: nom.slice(0, 80),
      message: message ? message.slice(0, MAX_MESSAGE) : null,
      groupe: groupe ? groupe.slice(0, 60) : null,
    });
  }
  if (!invites.length) return json({ erreur: "Aucune ligne exploitable : il faut au moins un prénom." }, 400);

  // Le token est fabriqué ici, jamais reçu du navigateur (CLAUDE.md §3).
  const bilan = await importerConvives(env.DB, mariage.id, invites, () => genToken());
  return json({ enregistre: true, ...bilan });
}

// ── Aperçu WhatsApp ───────────────────────────────────────────────
//
// Le robot de WhatsApp n'exécute pas de JavaScript : il ne voit que le HTML
// tel qu'il sort du serveur. Les balises Open Graph doivent donc être écrites
// dans le <head> avant que la page ne s'anime, d'où cette route, que le
// middleware Pages appelle pour fabriquer ces balises (cf. functions/_middleware.js).
//
// Aucun token ici, et rien d'un invité : l'aperçu se voit dans une conversation
// de groupe dès qu'un lien est transféré. Il ne dit que le mariage.
function formatDateFr(iso: string): string {
  const [a, m, j] = iso.slice(0, 10).split("-");
  const mois = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  return `${Number(j)} ${mois[Number(m) - 1]} ${a}`;
}

async function handleOg(request: Request, env: Env): Promise<Response> {
  const mariage = await resolveMariageByHost(env.DB, request.headers.get("host") ?? "", env.SHARED_DOMAIN);
  if (!mariage) return new Response("Domaine non configuré", { status: 404 });

  // À défaut d'image dédiée, la photo du couple : mal cadrée pour un aperçu
  // 1200 × 630, mais un lien sans image arrive en texte brut, ce qui sur un
  // faire-part fait « lien suspect » (CLAUDE.md §7).
  const image = photoUrl(env, mariage.og_image_key ?? mariage.photo_couple_key);

  return json(
    {
      titre: `${mariage.prenom_1} & ${mariage.prenom_2}`,
      description: `Nous nous marions le ${formatDateFr(mariage.date_mariage)}. Merci de répondre avant le ${formatDateFr(mariage.date_limite_rsvp)}.`,
      image_url: image,
      // Sert à la fois d'indication au middleware et de garde-fou visible
      // depuis l'extérieur : un aperçu sans image se diagnostique d'un coup d'œil.
      image_dediee: Boolean(mariage.og_image_key),
    },
    200,
  );
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
      photos: {
        couple: photoUrl(env, mariage.photo_couple_key),
        lieu:   photoUrl(env, mariage.cocktail_photo_key),
        og:     photoUrl(env, mariage.og_image_key),
      },
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
        message: reponse?.message ?? null,
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
      // Le texte lui-même, pour pouvoir le relire et le corriger. C'est la
      // donnée du couple, sur une surface authentifiée et bornée à son mariage.
      message_perso: c.message_perso,
      a_photo: Boolean(c.photo_key),
      photo_url: photoUrl(env, c.photo_key),
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

// ── Vue de suivi admin ────────────────────────────────────────────
//
// Trois portes, dans cet ordre, avant qu'une requête arrive au handler :
//   1. l'hôte doit être ADMIN_HOSTNAME (ou localhost avec DEV_ADMIN_EMAIL) ;
//   2. le jeton Access doit être signé pour ADMIN_ACCESS_AUD, distinct de
//      celui du tableau de bord des couples — le jeton d'un couple valide
//      chez Access ne doit jamais ouvrir /api/admin/* ;
//   3. l'email vérifié doit figurer dans ADMIN_EMAILS.
//
// La vue ne renvoie que des agrégats (cf. listerMariagesPourAdmin) : même si
// une bévue future modifiait le SELECT, elle ne pourrait pas exposer un nom
// d'invité ou un message sans passer d'abord par le type, la revue et cette
// note. C'est ce qui rend l'admin compatible avec §2 : les invités qu'on
// compte ne sont pas listés.

function estHoteAdmin(url: URL, env: Env): boolean {
  if (url.hostname === env.ADMIN_HOSTNAME) return true;
  return Boolean(env.DEV_ADMIN_EMAIL) && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

async function emailAdmin(request: Request, env: Env): Promise<string | null> {
  const hostname = new URL(request.url).hostname;
  const email =
    env.DEV_ADMIN_EMAIL && (hostname === "localhost" || hostname === "127.0.0.1")
      ? env.DEV_ADMIN_EMAIL.toLowerCase()
      : await emailAuthentifie(request, env.ACCESS_TEAM_DOMAIN, env.ADMIN_ACCESS_AUD);
  if (!email) return null;

  // Allowlist inline plutôt qu'une table : un seul admin aujourd'hui, et une
  // UI pour gérer ceux qui ne changent jamais est un vecteur de bug sans
  // valeur. Comparaison insensible à la casse et aux espaces autour.
  const autorises = new Set(
    env.ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return autorises.has(email) ? email : null;
}

async function handleAdminMariages(request: Request, env: Env): Promise<Response> {
  const email = await emailAdmin(request, env);
  if (!email) return json({ erreur: "Non authentifié" }, 403);

  const mariages = await listerMariagesPourAdmin(env.DB);
  return json({ mariages });
}

/**
 * Enregistre une vente Etsy (Fiche B) après lecture manuelle de la commande
 * réelle. C'est le pas manuel qui remplace, pour l'instant, une intégration
 * Etsy API (lot 3, cf. CLAUDE.md §8) : le tunnel côté acheteur ne changera
 * pas le jour où cette écriture deviendra automatique.
 */
async function handleAdminListerCodes(request: Request, env: Env): Promise<Response> {
  const email = await emailAdmin(request, env);
  if (!email) return json({ erreur: "Non authentifié" }, 403);

  const codes = await listerCodesActivation(env.DB);
  return json({ codes });
}

async function handleAdminCreerCode(request: Request, env: Env): Promise<Response> {
  const email = await emailAdmin(request, env);
  if (!email) return json({ erreur: "Non authentifié" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }
  const p = payload as { commande_etsy?: unknown; email?: unknown };
  const commandeEtsy = typeof p.commande_etsy === "string" ? p.commande_etsy.trim() : "";
  const emailClient = typeof p.email === "string" ? p.email.trim() : "";
  if (!commandeEtsy || !emailClient) {
    return json({ erreur: "Numéro de commande et email requis." }, 400);
  }

  const resultat = await creerCodeActivation(env.DB, commandeEtsy, emailClient);
  if (!resultat.ok) return json({ erreur: resultat.erreur }, 409);
  return json({ enregistre: true });
}

/**
 * Marque un mariage Fiche B comme activé : le sous-domaine a été ajouté à la
 * main côté Cloudflare (cf. docs/commande.md) et `<slug>.SHARED_DOMAIN`
 * répond vraiment. Ne crée ni ne modifie rien d'autre — c'est un aiguillage
 * pour la carte admin, pas une validation du contenu du mariage.
 */
async function handleAdminActiverMariage(request: Request, env: Env, id: string): Promise<Response> {
  const email = await emailAdmin(request, env);
  if (!email) return json({ erreur: "Non authentifié" }, 403);

  const resultat = await marquerMariageActive(env.DB, id);
  if (!resultat.ok) return json({ erreur: resultat.erreur }, 404);
  return json({ ok: true });
}

// ── Tunnel self-service (Fiche B Etsy) ────────────────────────────
//
// Pas de Cloudflare Access ici : au moment où l'acheteur arrive, il n'a pas
// encore de tableau de bord — c'est justement ce que cette route lui crée.
// La légitimité tient au corps de la requête ({commande_etsy, email}), sur
// le même principe que le lien à token des invités (§3). Cf. docs/commande.md
// pour le déploiement (aucune application Access sur cet hôte) et la limite
// connue (l'accès au tableau de bord suit sous quelques heures, le temps
// d'ajouter l'email à la policy Allow — pas encore automatisé).

function estHoteCommande(url: URL, env: Env): boolean {
  if (url.hostname === env.COMMANDE_HOSTNAME) return true;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

const MESSAGERS_VALIDES = new Set(["", "montgolfiere", "voiture"]);

// Limites larges mais réelles : un couple qui construit son programme ou sa
// FAQ à la main ne s'approche jamais de 15/20 lignes, mais un client — ou un
// script — qui enverrait un tableau sans fin ne doit pas pouvoir gonfler la
// base indéfiniment (§4, même esprit que MAX_ACCOMPAGNANTS).
const MAX_PROGRAMME_ITEMS = 15;
const MAX_FAQ_ITEMS = 20;
const MAX_TITRE = 120;
const MAX_LIEU = 200;
const MAX_QUESTION = 200;

type Parsed<T> = { ok: true; items: T[] } | { ok: false; erreur: string };

/**
 * Le programme et la FAQ voyagent en JSON dans un champ texte du formulaire
 * multipart (les autres champs sont scalaires) : ce sont des listes de
 * longueur variable que le couple réordonne, ajoute et retire librement
 * (cf. schema/010_programme_faq.sql). Jamais fait confiance à la forme reçue
 * — un JSON.parse réussi ne garantit ni le type ni les bornes des champs.
 */
function parseProgramme(brut: string): Parsed<{ heure: string | null; titre: string; lieu: string | null }> {
  let valeur: unknown;
  try {
    valeur = brut ? JSON.parse(brut) : [];
  } catch {
    return { ok: false, erreur: "Programme illisible." };
  }
  if (!Array.isArray(valeur) || valeur.length > MAX_PROGRAMME_ITEMS) {
    return { ok: false, erreur: "Programme invalide." };
  }
  const HEURE_RE = /^\d{2}:\d{2}$/;
  const items: Array<{ heure: string | null; titre: string; lieu: string | null }> = [];
  for (const brutItem of valeur) {
    const item = brutItem as { heure?: unknown; titre?: unknown; lieu?: unknown };
    const titre = typeof item.titre === "string" ? item.titre.trim().slice(0, MAX_TITRE) : "";
    if (!titre) return { ok: false, erreur: "Chaque étape du programme doit avoir un titre." };
    const heure = typeof item.heure === "string" ? item.heure.trim() : "";
    if (heure && !HEURE_RE.test(heure)) return { ok: false, erreur: "Heure invalide dans le programme." };
    const lieu = typeof item.lieu === "string" ? item.lieu.trim().slice(0, MAX_LIEU) : "";
    items.push({ heure: heure || null, titre, lieu: lieu || null });
  }
  return { ok: true, items };
}

function parseFaq(brut: string): Parsed<{ question: string; reponse: string }> {
  let valeur: unknown;
  try {
    valeur = brut ? JSON.parse(brut) : [];
  } catch {
    return { ok: false, erreur: "FAQ illisible." };
  }
  if (!Array.isArray(valeur) || valeur.length > MAX_FAQ_ITEMS) {
    return { ok: false, erreur: "FAQ invalide." };
  }
  const items: Array<{ question: string; reponse: string }> = [];
  for (const brutItem of valeur) {
    const item = brutItem as { question?: unknown; reponse?: unknown };
    const question = typeof item.question === "string" ? item.question.trim().slice(0, MAX_QUESTION) : "";
    const reponse = typeof item.reponse === "string" ? item.reponse.trim().slice(0, MAX_MESSAGE) : "";
    if (!question || !reponse) return { ok: false, erreur: "Chaque question de la FAQ doit avoir une réponse." };
    items.push({ question, reponse });
  }
  return { ok: true, items };
}

/**
 * `@cloudflare/workers-types` (version installée) type `FormData.get()` en
 * `string | null`, sans `File` — décalage connu entre les définitions et le
 * runtime réel, qui renvoie bien un `File` pour un champ fichier d'un
 * multipart. Un seul point de conversion plutôt que des casts dispersés.
 */
function formDataFile(form: FormData, nom: string): File | null {
  const v = form.get(nom) as unknown;
  return v instanceof File ? v : null;
}

async function handleCommandeVerifier(request: Request, env: Env): Promise<Response> {
  const bloque = await limiterCommande(request, env);
  if (bloque) return bloque;
  if (!origineAttendue(request, env.COMMANDE_HOSTNAME)) return json({ erreur: "Origine refusée" }, 403);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ erreur: "JSON invalide" }, 400);
  }
  const p = payload as { commande_etsy?: unknown; email?: unknown };
  const commandeEtsy = typeof p.commande_etsy === "string" ? p.commande_etsy.trim() : "";
  const email = typeof p.email === "string" ? p.email.trim() : "";
  if (!commandeEtsy || !email) {
    return json({ valide: false, erreur: "Numéro de commande et email requis." }, 400);
  }

  const resultat = await verifierCodeActivation(env.DB, commandeEtsy, email);
  if (!resultat.valide) return json({ valide: false, erreur: resultat.erreur }, 404);
  if (!resultat.modification) {
    // Première création : le tunnel n'a encore aucune donnée à pré-remplir,
    // mais le programme et la FAQ partent avec un contenu proposé plutôt
    // qu'une page vide (cf. PROGRAMME_PAR_DEFAUT / FAQ_PAR_DEFAUT) — le
    // couple les modifie ou les vide ensuite comme n'importe quel champ.
    return json({
      valide: true,
      modification: false,
      programme_defaut: PROGRAMME_PAR_DEFAUT,
      faq_defaut: FAQ_PAR_DEFAUT,
    });
  }

  // Mode correction : on renvoie ce qui existe déjà pour que le tunnel
  // pré-remplisse le formulaire plutôt que de faire tout retaper — sans quoi
  // laisser un champ facultatif vide à la deuxième saisie l'effacerait pour
  // de vrai (l'UPDATE de creerOuMettreAJourMariageSelfService écrit ce qu'on
  // lui envoie, il ne fusionne pas avec l'existant).
  const mariage = await getMariageParId(env.DB, resultat.mariageId);
  if (!mariage) return json({ valide: false, erreur: "Le site associé à cette commande est introuvable." }, 404);

  const [programme, faq] = await Promise.all([
    listerProgramme(env.DB, mariage.id),
    listerFaq(env.DB, mariage.id),
  ]);

  return json({
    valide: true,
    modification: true,
    mariage: {
      prenom_1: mariage.prenom_1,
      prenom_2: mariage.prenom_2,
      date_mariage: mariage.date_mariage,
      date_limite_rsvp: mariage.date_limite_rsvp,
      ceremonie_nom: mariage.ceremonie_nom,
      ceremonie_adresse: mariage.ceremonie_adresse,
      heure_ceremonie: mariage.heure_ceremonie,
      cocktail_nom: mariage.cocktail_nom,
      cocktail_adresse: mariage.cocktail_adresse,
      heure_cocktail: mariage.heure_cocktail,
      reponse_generique_oui: mariage.reponse_generique_oui,
      reponse_generique_non: mariage.reponse_generique_non,
      messager: mariage.messager,
      remarque_acheteur: mariage.remarque_acheteur,
      photo_couple_url: photoUrl(env, mariage.photo_couple_key),
      photo_lieu_url: photoUrl(env, mariage.cocktail_photo_key),
      programme: programme.map((p) => ({ heure: p.heure, titre: p.titre, lieu: p.lieu })),
      faq: faq.map((f) => ({ question: f.question, reponse: f.reponse })),
    },
  });
}

/**
 * Crée le mariage complet à partir du formulaire, ou met à jour celui déjà
 * créé par ce code si on est dans la fenêtre de correction (cf.
 * `creerOuMettreAJourMariageSelfService`) : texte + photo du couple + photo
 * du lieu, en une seule requête multipart — il n'y a pas de session à
 * réutiliser entre deux appels, comme il y en aurait une avec Access, donc
 * autant que "Terminer" fasse tout d'un coup plutôt que d'inventer un état
 * intermédiaire à protéger autrement.
 *
 * La photo du couple n'est obligatoire qu'à la création : en modification,
 * ne pas en renvoyer une nouvelle veut dire "garder l'actuelle", jamais
 * "l'effacer" — sans cette distinction, rouvrir le formulaire pour corriger
 * une date effacerait la photo à chaque fois.
 *
 * Revérifie le code (au lieu de faire confiance à l'étape précédente) :
 * `verifierCodeActivation` ne fait que lire, la seule vérité sur "déjà
 * utilisé, dans la fenêtre, ou non" est celle recalculée dans
 * `creerOuMettreAJourMariageSelfService`.
 */
async function handleCommandeCreer(request: Request, env: Env): Promise<Response> {
  const bloque = await limiterCommande(request, env);
  if (bloque) return bloque;
  if (!origineAttendue(request, env.COMMANDE_HOSTNAME)) return json({ erreur: "Origine refusée" }, 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ erreur: "Formulaire illisible." }, 400);
  }

  const texte = (cle: string): string => {
    const v = form.get(cle);
    return typeof v === "string" ? v.trim() : "";
  };
  const texteOuNul = (cle: string): string | null => texte(cle) || null;

  const commandeEtsy = texte("commande_etsy");
  const email = texte("email");
  if (!commandeEtsy || !email) return json({ erreur: "Commande introuvable, rechargez la page." }, 400);

  const verif = await verifierCodeActivation(env.DB, commandeEtsy, email);
  if (!verif.valide) return json({ erreur: verif.erreur }, 409);

  const prenom1 = texte("prenom_1").slice(0, 80);
  const prenom2 = texte("prenom_2").slice(0, 80);
  const dateMariage = texte("date_mariage");
  const dateLimiteRsvp = texte("date_limite_rsvp");
  const reponseOui = texte("reponse_generique_oui").slice(0, MAX_MESSAGE);
  const reponseNon = texte("reponse_generique_non").slice(0, MAX_MESSAGE);
  const messager = texte("messager");

  if (!prenom1 || !prenom2) return json({ erreur: "Les deux prénoms sont requis." }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateMariage) || !/^\d{4}-\d{2}-\d{2}$/.test(dateLimiteRsvp)) {
    return json({ erreur: "Dates invalides." }, 400);
  }
  if (dateLimiteRsvp >= dateMariage) {
    return json({ erreur: "La date limite de RSVP doit précéder la date du mariage." }, 400);
  }
  if (!reponseOui || !reponseNon) {
    return json({ erreur: "Les deux réponses génériques (oui et non) sont requises." }, 400);
  }
  // Fermé par une liste plutôt que laissé libre : un messager qui n'existe
  // pas est un piège silencieux déjà rencontré deux fois (cf. CLAUDE.md §4).
  if (!MESSAGERS_VALIDES.has(messager)) return json({ erreur: "Animation invalide." }, 400);

  const heureCeremonie = texteOuNul("heure_ceremonie");
  const heureCocktail = texteOuNul("heure_cocktail");
  const HEURE_RE = /^\d{2}:\d{2}$/;
  if (heureCeremonie && !HEURE_RE.test(heureCeremonie)) return json({ erreur: "Heure de cérémonie invalide." }, 400);
  if (heureCocktail && !HEURE_RE.test(heureCocktail)) return json({ erreur: "Heure de cocktail invalide." }, 400);

  const programme = parseProgramme(texte("programme"));
  if (!programme.ok) return json({ erreur: programme.erreur }, 400);
  const faq = parseFaq(texte("faq"));
  if (!faq.ok) return json({ erreur: faq.erreur }, 400);

  const brut = formDataFile(form, "photo_couple");
  const photoCouple = brut && brut.size > 0 ? brut : null;
  // Obligatoire seulement à la création : cf. le commentaire de la fonction.
  if (!photoCouple && !verif.modification) {
    return json({ erreur: "La photo du couple est requise." }, 400);
  }
  if (photoCouple) {
    if (photoCouple.type !== "image/jpeg") return json({ erreur: "Seul le JPEG est accepté." }, 400);
    if (photoCouple.size > MAX_PHOTO_OCTETS) return json({ erreur: "Photo du couple trop lourde." }, 400);
  }

  const photoLieuBrut = formDataFile(form, "photo_lieu");
  const photoLieu = photoLieuBrut && photoLieuBrut.size > 0 ? photoLieuBrut : null;
  if (photoLieu) {
    if (photoLieu.type !== "image/jpeg") {
      return json({ erreur: "Seul le JPEG est accepté pour la photo du lieu." }, 400);
    }
    if (photoLieu.size > MAX_PHOTO_OCTETS) {
      return json({ erreur: "Photo du lieu trop lourde." }, 400);
    }
  }

  const nouveau: NouveauMariage = {
    prenom_1: prenom1,
    prenom_2: prenom2,
    date_mariage: dateMariage,
    date_limite_rsvp: dateLimiteRsvp,
    ceremonie_nom: texteOuNul("ceremonie_nom"),
    ceremonie_adresse: texteOuNul("ceremonie_adresse"),
    heure_ceremonie: heureCeremonie,
    cocktail_nom: texteOuNul("cocktail_nom"),
    cocktail_adresse: texteOuNul("cocktail_adresse"),
    heure_cocktail: heureCocktail,
    reponse_generique_oui: reponseOui,
    reponse_generique_non: reponseNon,
    theme: "botanique", // seul thème construit à ce jour (CLAUDE.md §8) — jamais pris du formulaire
    messager,
    remarque_acheteur: texteOuNul("remarque")?.slice(0, MAX_MESSAGE) ?? null,
  };

  // Capturées avant l'écriture : en modification, c'est ce qui permet de
  // supprimer l'ancienne photo après avoir posé la nouvelle, jamais avant —
  // même arbitrage que handlePhotoMariage (un objet orphelin est moins grave
  // qu'une ligne qui pointerait un instant vers un objet déjà supprimé).
  const ancien = verif.modification ? await getMariageParId(env.DB, verif.mariageId) : null;

  const cree = await creerOuMettreAJourMariageSelfService(env.DB, (verif as { id: string }).id, email, nouveau);
  if (!cree.ok) return json({ erreur: cree.erreur }, 409);

  // Toujours l'état complet envoyé par le formulaire, jamais un diff — même
  // principe que le reste du tunnel (cf. remplacerProgramme/remplacerFaq).
  await Promise.all([remplacerProgramme(env.DB, cree.id, programme.items), remplacerFaq(env.DB, cree.id, faq.items)]);

  if (photoCouple) {
    const cleCouple = `mariage/${cree.slug}/couple-${genToken(6)}.jpg`;
    await env.PHOTOS.put(cleCouple, await photoCouple.arrayBuffer(), {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });
    await ecrirePhotoMariage(env.DB, cree.id, "photo_couple_key", cleCouple);
    if (ancien?.photo_couple_key) await env.PHOTOS.delete(ancien.photo_couple_key);
  }

  if (photoLieu) {
    const cleLieu = `mariage/${cree.slug}/lieu-${genToken(6)}.jpg`;
    await env.PHOTOS.put(cleLieu, await photoLieu.arrayBuffer(), {
      httpMetadata: { contentType: "image/jpeg", cacheControl: "public, max-age=31536000, immutable" },
    });
    await ecrirePhotoMariage(env.DB, cree.id, "cocktail_photo_key", cleLieu);
    if (ancien?.cocktail_photo_key) await env.PHOTOS.delete(ancien.cocktail_photo_key);
  }

  const domaine = `${cree.slug}.${env.SHARED_DOMAIN}`;
  return json({
    enregistre: true,
    modification: cree.modification,
    // Le sous-domaine n'est réellement joignable qu'une fois le pas manuel
    // d'activation fait côté Cloudflare (cf. docs/commande.md) — `ancien`
    // reflète l'état d'avant cette écriture, qui ne touche jamais active_le.
    actif: Boolean(ancien?.active_le),
    site_url: `https://${domaine}`,
    tableau_url: `https://${env.DASHBOARD_HOSTNAME}`,
  });
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

// ── Effacement automatique à J+90 ─────────────────────────────────

// Un journal se relit : « 1 réponses de groupe » fait douter du reste de la ligne.
function pluriel(n: number, singulier: string, plur = `${singulier}s`): string {
  return `${n} ${n > 1 ? plur : singulier}`;
}

// R2 accepte au plus 1000 clés par appel de suppression.
const MAX_SUPPRESSIONS_R2 = 1000;

/**
 * Efface les données d'invités des mariages passés depuis plus de 90 jours.
 *
 * Déclenché par le Cron Trigger de wrangler.toml, une fois par nuit. La tâche
 * est idempotente : `mariagesAPurger` ne retourne que les mariages qui ont
 * encore des convives, donc une nuit sans rien à faire ne fait rien.
 *
 * Chaque mariage est traité séparément et les erreurs ne se propagent pas : un
 * mariage dont la purge échoue ne doit pas empêcher celle des autres, et il
 * repassera de toute façon dans la sélection la nuit suivante.
 */
async function purgeJ90(env: Env): Promise<void> {
  const mariages = await mariagesAPurger(env.DB);
  if (!mariages.length) return;

  for (const mariage of mariages) {
    try {
      const { convives, groupes, clesPhotos } = await purgerConvives(env.DB, mariage.id);

      // Après la base, jamais avant : un échec ici laisse des objets orphelins
      // dans R2, que la nuit suivante ne rattrapera pas — mais des photos sans
      // ligne pour les désigner ne sont plus reliées à personne, alors qu'une
      // ligne sans photo casserait une page.
      for (let i = 0; i < clesPhotos.length; i += MAX_SUPPRESSIONS_R2) {
        await env.PHOTOS.delete(clesPhotos.slice(i, i + MAX_SUPPRESSIONS_R2));
      }

      // Volontairement sans aucun nom ni token : un journal d'exécution n'est
      // pas l'endroit où faire survivre ce qu'on vient d'effacer.
      console.log(
        `purge J+90 · ${mariage.slug} (${mariage.date_mariage}) · ${pluriel(convives, "convive")}, ${pluriel(groupes, "réponse de groupe", "réponses de groupe")}, ${pluriel(clesPhotos.length, "photo")}`,
      );
    } catch (e) {
      console.error(`purge J+90 · échec sur ${mariage.slug} :`, e);
    }
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(purgeJ90(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const faireArt = url.pathname.match(/^\/api\/faire-part\/([^/]+)$/);
    if (faireArt && request.method === "GET") {
      return handleFaireArt(request, env, faireArt[1]!);
    }

    if (url.pathname === "/api/og" && request.method === "GET") {
      return handleOg(request, env);
    }

    const rsvp = url.pathname.match(/^\/api\/rsvp\/([^/]+)$/);
    if (rsvp && request.method === "POST") {
      return handleRsvp(request, env, rsvp[1]!);
    }

    // Vue de suivi admin, sur son propre hôte. Cf. estHoteAdmin.
    if (url.pathname.startsWith("/api/admin/") && estHoteAdmin(url, env)) {
      if (url.pathname === "/api/admin/mariages" && request.method === "GET") {
        return handleAdminMariages(request, env);
      }
      if (url.pathname === "/api/admin/codes" && request.method === "GET") {
        return handleAdminListerCodes(request, env);
      }
      if (url.pathname === "/api/admin/codes" && request.method === "POST") {
        return handleAdminCreerCode(request, env);
      }
      const activerMariage = url.pathname.match(/^\/api\/admin\/mariages\/([^/]+)\/activer$/);
      if (activerMariage && request.method === "POST") {
        return handleAdminActiverMariage(request, env, decodeURIComponent(activerMariage[1]!));
      }
    }

    // Tunnel self-service (Fiche B Etsy), sur son propre hôte. Pas d'Access :
    // la légitimité vient du corps de la requête, cf. docs/commande.md.
    if (url.pathname.startsWith("/api/commande/") && estHoteCommande(url, env)) {
      if (url.pathname === "/api/commande/verifier" && request.method === "POST") {
        return handleCommandeVerifier(request, env);
      }
      if (url.pathname === "/api/commande/creer" && request.method === "POST") {
        return handleCommandeCreer(request, env);
      }
    }

    // Les routes du tableau de bord ne sont servies que sur son propre hôte.
    if (url.pathname.startsWith("/api/tableau/") && estHoteTableau(url, env)) {
      if (url.pathname === "/api/tableau/mariage" && request.method === "GET") {
        return handleTableauMariage(request, env);
      }
      if (url.pathname === "/api/tableau/convives" && request.method === "GET") {
        return handleTableauConvives(request, env);
      }

      const message = url.pathname.match(/^\/api\/tableau\/convives\/([^/]+)\/message$/);
      if (message && request.method === "PUT") {
        return handleEcrireMessage(request, env, decodeURIComponent(message[1]!));
      }

      const groupeConvive = url.pathname.match(/^\/api\/tableau\/convives\/([^/]+)\/groupe$/);
      if (groupeConvive && request.method === "PUT") {
        return handleAssignerGroupe(request, env, decodeURIComponent(groupeConvive[1]!));
      }

      if (url.pathname === "/api/tableau/convives/import" && request.method === "POST") {
        return handleImport(request, env);
      }

      const photo = url.pathname.match(/^\/api\/tableau\/convives\/([^/]+)\/photo$/);
      if (photo && (request.method === "PUT" || request.method === "DELETE")) {
        return handlePhoto(request, env, decodeURIComponent(photo[1]!));
      }

      const groupe = url.pathname.match(/^\/api\/tableau\/groupes\/([^/]+)\/message$/);
      if (groupe && request.method === "PUT") {
        return handleEcrireGroupe(request, env, decodeURIComponent(groupe[1]!));
      }

      // Trois emplacements photo du mariage. Le kind vient de l'URL et est
      // vérifié contre PHOTOS_MARIAGE : autre chose que couple/lieu/og tombe
      // en 404 comme n'importe quelle URL inconnue.
      const photoMariage = url.pathname.match(/^\/api\/tableau\/mariage\/photo\/([^/]+)$/);
      if (photoMariage && (request.method === "PUT" || request.method === "DELETE")) {
        const kind = decodeURIComponent(photoMariage[1]!);
        if (kind in PHOTOS_MARIAGE) {
          return handlePhotoMariage(request, env, kind as KindPhoto);
        }
      }
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
