// Vérification du jeton émis par Cloudflare Access.
//
// Pourquoi vérifier la signature plutôt que lire l'en-tête
// Cf-Access-Authenticated-User-Email : un en-tête se forge. Tant que la
// requête traverse Access, il est fiable ; mais le jour où une route du
// tableau de bord devient joignable autrement (mauvaise règle, route Worker
// trop large, test oublié), croire cet en-tête revient à laisser n'importe qui
// se déclarer propriétaire de n'importe quel mariage. La signature, elle, ne
// se forge pas.

interface JWK {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

interface Claims {
  email?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
}

// Les clés publiques d'Access changent rarement ; les retélécharger à chaque
// requête coûterait un aller-retour réseau par appel.
let cacheCles: { cles: JWK[]; expire: number } | null = null;

async function clesPubliques(equipeDomaine: string): Promise<JWK[]> {
  if (cacheCles && cacheCles.expire > Date.now()) return cacheCles.cles;

  const res = await fetch(`https://${equipeDomaine}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`certs Access injoignables : ${res.status}`);

  const { keys } = (await res.json()) as { keys: JWK[] };
  cacheCles = { cles: keys, expire: Date.now() + 60 * 60 * 1000 };
  return keys;
}

function base64UrlVersOctets(valeur: string): Uint8Array {
  const base64 = valeur.replace(/-/g, "+").replace(/_/g, "/");
  const binaire = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  return Uint8Array.from(binaire, (c) => c.charCodeAt(0));
}

/**
 * Retourne l'email authentifié, ou null si le jeton est absent, expiré, mal
 * signé, ou destiné à une autre application. Ne lève jamais : un appelant qui
 * reçoit null répond 403, point.
 */
export async function emailAuthentifie(
  request: Request,
  equipeDomaine: string,
  audience: string,
): Promise<string | null> {
  const jeton =
    request.headers.get("cf-access-jwt-assertion") ??
    /CF_Authorization=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  if (!jeton) return null;

  const [entete, charge, signature] = jeton.split(".");
  if (!entete || !charge || !signature) return null;

  try {
    const { kid } = JSON.parse(new TextDecoder().decode(base64UrlVersOctets(entete))) as {
      kid?: string;
    };
    const jwk = (await clesPubliques(equipeDomaine)).find((k) => k.kid === kid);
    if (!jwk) return null;

    const cle = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const valide = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cle,
      base64UrlVersOctets(signature),
      new TextEncoder().encode(`${entete}.${charge}`),
    );
    if (!valide) return null;

    const claims = JSON.parse(new TextDecoder().decode(base64UrlVersOctets(charge))) as Claims;

    // Un jeton signé par Access reste un jeton d'Access : sans ces trois
    // contrôles, celui d'une autre application du même compte passerait.
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.includes(audience)) return null;
    if (claims.iss !== `https://${equipeDomaine}`) return null;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;

    return claims.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}
