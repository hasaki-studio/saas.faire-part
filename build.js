// Assemble un thème + tous les messagers dans dist/, pour le déploiement
// Cloudflare Pages. themes/ et messagers/ restent deux dossiers indépendants
// dans le dépôt (cf. CLAUDE.md §6) ; Pages a besoin d'un seul dossier à servir.
//
// Usage : node build.js [nom-du-theme]   (par défaut : botanique)
// Sur Cloudflare Pages : Build command = "node build.js", Build output = "dist"
const fs = require('fs');
const path = require('path');

const theme = process.argv[2] || 'botanique';
const themeDir = path.join(__dirname, 'themes', theme);
const messagersDir = path.join(__dirname, 'messagers');
const distDir = path.join(__dirname, 'dist');

if (!fs.existsSync(themeDir)) {
  console.error(`Thème introuvable : ${themeDir}`);
  process.exit(1);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

function copierDossier(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entree of fs.readdirSync(source, { withFileTypes: true })) {
    // Les fichiers *.exemple ne sont que des références visuelles pour le
    // thème (cf. photo-du-couple.png.exemple), jamais servies en production.
    if (entree.name.endsWith('.exemple')) continue;
    const src = path.join(source, entree.name);
    const dest = path.join(destination, entree.name);
    if (entree.isDirectory()) {
      copierDossier(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

copierDossier(themeDir, distDir);
copierDossier(messagersDir, path.join(distDir, 'messagers'));

console.log(`Thème "${theme}" + messagers assemblés dans dist/`);
