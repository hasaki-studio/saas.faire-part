// Sert le front en local et relaie /api/* vers `wrangler dev` (port 8787), pour
// tester une page et le Worker ensemble sans dépendre du routage Cloudflare
// Pages + Worker Route qui les réunira en production sur le même hostname.
//
//   node proxy-local.js              → thème invité, http://localhost:8080/<prenom>-<token>
//   node proxy-local.js --tableau    → tableau de bord, http://localhost:8081/
//
// Les deux modes écoutent sur des ports différents et peuvent tourner ensemble.
// Le Host relayé au Worker est « localhost » : c'est ce que déclare le jeu
// d'essai (domaine_personnalise) et ce qui active la connexion simulée par
// DEV_EMAIL en mode --tableau (cf. worker/src/index.ts, emailTableau).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TABLEAU = process.argv.includes('--tableau');
const ROOT = TABLEAU ? path.join(__dirname, 'dashboard') : path.join(__dirname, 'themes', 'botanique');
const MESSAGERS_ROOT = path.join(__dirname, 'messagers');
// Le Host est transmis tel quel, donc « localhost ». C'est ce que le jeu
// d'essai déclare en domaine_personnalise : un seul hôte local pour le
// faire-part comme pour le tableau de bord, quel que soit le port.
const HOST_API = 'localhost';
const PORT = TABLEAU ? 8081 : 8080;

http.createServer((req, res) => {
  if (req.url.startsWith('/messagers/')) {
    // En production, un petit script d'assemblage copiera themes/<theme>/* et
    // messagers/ côte à côte dans un même dossier avant déploiement Cloudflare
    // Pages ; ici on simule ce même agencement à la volée.
    const filePath = path.join(MESSAGERS_ROOT, decodeURIComponent(req.url.slice('/messagers/'.length)));
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const types = { '.js': 'application/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  if (req.url.startsWith('/api/')) {
    const proxyReq = http.request(
      { hostname: 'localhost', port: 8787, path: req.url, method: req.method, headers: { ...req.headers, host: HOST_API } },
      (proxyRes) => { res.writeHead(proxyRes.statusCode, proxyRes.headers); proxyRes.pipe(res); }
    );
    proxyReq.on('error', (err) => {
      console.error('Impossible de contacter le Worker sur le port 8787 :', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ erreur: 'Le Worker (npm run dev) ne repond pas sur le port 8787. Verifie qu il tourne bien.' }));
    });
    req.pipe(proxyReq);
    return;
  }
  let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(ROOT, 'index.html');
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => console.log(`Pret sur http://localhost:${PORT}` + (TABLEAU ? ' (tableau de bord)' : '')));
