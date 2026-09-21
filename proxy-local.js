// Sert themes/botanique/ en local et relaie /api/* vers `wrangler dev` (port 8787),
// pour tester un thème et le Worker ensemble sans dépendre du routage Cloudflare
// Pages + Worker Route qui les réunira en production sur le même hostname.
// Usage : node proxy-local.js, puis http://localhost:8080/<prenom>-<token>
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'themes', 'botanique');
const MESSAGERS_ROOT = path.join(__dirname, 'messagers');

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
      { hostname: 'localhost', port: 8787, path: req.url, method: req.method, headers: { ...req.headers, host: 'justine-raphael.faire-part.exemple' } },
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
}).listen(8080, () => console.log('Pret sur http://localhost:8080'));
