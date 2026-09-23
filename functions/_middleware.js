// Écrit les balises Open Graph dans le <head> avant que la page ne quitte le
// serveur.
//
// Pourquoi ici et pas dans le thème : le robot de WhatsApp n'exécute pas de
// JavaScript. Le thème charge tout son contenu après coup, via
// /api/faire-part/<token> ; le robot, lui, ne voit que la coquille. Des balises
// écrites par le JS n'existent pas pour lui, et le lien arrive en texte brut —
// sur un faire-part, ça fait « lien suspect » (CLAUDE.md §7).
//
// Pourquoi un middleware Pages et pas le Worker : le Worker ne répond que sur
// /api/*, et l'élargir à /* lui ferait servir tout le front. Ici on ne fait que
// réécrire l'en-tête d'une page déjà servie par Pages, en flux, sans la mettre
// en mémoire.
//
// L'accès à la base reste dans le Worker (CLAUDE.md §2) : ce fichier ne connaît
// que l'API, il n'a pas de binding D1.

const echapper = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export async function onRequest(context) {
  const { request, next, env } = context;
  const reponse = await next();

  // Seules les pages HTML ont un <head> à réécrire ; on ne touche ni aux
  // feuilles de style, ni aux images, ni aux messagers.
  const type = reponse.headers.get('content-type') || '';
  if (!type.includes('text/html')) return reponse;

  const base = env.API_BASE || new URL(request.url).origin;

  let apercu;
  try {
    const res = await fetch(`${base}/api/og`, { headers: { host: new URL(request.url).host } });
    if (!res.ok) return reponse;
    apercu = await res.json();
  } catch {
    // L'API injoignable ne doit jamais empêcher le faire-part de s'afficher :
    // l'invité qui ouvre le lien compte plus que l'aperçu de celui qui l'envoie.
    return reponse;
  }

  const url = new URL(request.url);
  const balises = [
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="fr_FR">`,
    `<meta property="og:site_name" content="${echapper(apercu.titre)}">`,
    `<meta property="og:title" content="${echapper(apercu.titre)}">`,
    `<meta property="og:description" content="${echapper(apercu.description)}">`,
    // og:url doit rester l'URL demandée, token compris : c'est la cible du clic
    // dans l'aperçu. La remplacer par la racine ferait perdre son lien à l'invité.
    `<meta property="og:url" content="${echapper(url.href)}">`,
    `<meta name="twitter:card" content="${apercu.image_url ? 'summary_large_image' : 'summary'}">`,
  ];
  if (apercu.image_url) {
    // WhatsApp veut un vrai fichier à une URL absolue ; le base64 ne marche pas.
    balises.push(`<meta property="og:image" content="${echapper(apercu.image_url)}">`);
    balises.push(`<meta property="og:image:width" content="1200">`);
    balises.push(`<meta property="og:image:height" content="630">`);
    balises.push(`<meta property="og:image:alt" content="${echapper(apercu.titre)}">`);
  }

  return new HTMLRewriter()
    // Les balises du thème sont des valeurs de repli ; celles-ci les remplacent.
    .on('meta[property^="og:"], meta[name^="twitter:"]', { element: (e) => e.remove() })
    .on('head', {
      element(e) {
        e.append(balises.join('\n'), { html: true });
      },
    })
    .transform(reponse);
}
