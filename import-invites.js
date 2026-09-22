// Génère, à partir d'un CSV de liste d'invités, le SQL d'insertion en D1 et la
// liste des liens personnels à envoyer.
//
//   node import-invites.js liste.csv <mariage_id> <domaine>
//   node import-invites.js liste.csv m1 dev.faire-part.hasakistudio.fr
//
// Colonnes attendues : prénom, nom, message_perso, groupe.
// message_perso peut être vide — c'est ce qui distingue l'offre catalogue du
// sur-mesure (cf. CLAUDE.md §1). groupe est facultatif : un invité sans message
// à lui reçoit la réponse écrite pour son groupe, à défaut la générique
// (cf. schema/005_groupes.sql).
//
// Les deux fichiers produits vont dans prive/, ignoré par git : ils contiennent
// des données d'invités réelles, qui ne doivent jamais entrer dans le dépôt
// (CLAUDE.md §5). Le CSV d'entrée non plus.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

// Même génération que le Worker (cf. worker/src/token.ts) : aléatoire
// cryptographique, jamais Math.random(), et rejet du biais de modulo.
function token(n = 8) {
  const out = [];
  while (out.length < n) {
    for (const b of crypto.randomBytes(n)) {
      if (b < 240 && out.length < n) out.push(ALPHABET[b % 30]);
    }
  }
  return out.join('');
}

// Analyse un CSV en gérant les champs entre guillemets (les messages contiennent
// des virgules), les guillemets échappés, et les fins de ligne Windows.
function lireCSV(texte) {
  if (texte.charCodeAt(0) === 0xfeff) texte = texte.slice(1); // BOM ajouté par Excel
  const lignes = [];
  let champ = '';
  let ligne = [];
  let dansGuillemets = false;

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++; }
        else dansGuillemets = false;
      } else champ += c;
      continue;
    }
    if (c === '"') dansGuillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n') { ligne.push(champ); lignes.push(ligne); ligne = []; champ = ''; }
    else if (c !== '\r') champ += c; // les \r de Windows cassent tout (CLAUDE.md §7)
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  return lignes.filter((l) => l.some((c) => c.trim() !== ''));
}

// Partie décorative du lien : le prénom, sans accent ni espace. Toute la
// sécurité repose sur le token qui suit (CLAUDE.md §3).
function slug(prenom) {
  return prenom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const sql = (v) => (v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const [fichier, mariageId, domaine] = process.argv.slice(2);
if (!fichier || !mariageId || !domaine) {
  console.error('Usage : node import-invites.js <liste.csv> <mariage_id> <domaine>');
  process.exit(1);
}

const lignes = lireCSV(fs.readFileSync(fichier, 'utf8'));
const entete = lignes.shift();
console.log(`En-tête ignoré : ${entete.join(' | ')}`);

const invites = [];
const alertes = [];

lignes.forEach((ligne, i) => {
  const prenom = (ligne[0] || '').trim();
  const nom = (ligne[1] || '').trim();
  const message = (ligne[2] || '').trim();
  const groupe = (ligne[3] || '').trim();
  const numero = i + 2; // +2 : l'en-tête et l'indexation à partir de 1

  if (!prenom) { alertes.push(`ligne ${numero} : prénom vide, ignorée`); return; }
  if (!nom) alertes.push(`ligne ${numero} : ${prenom} n'a pas de nom`);
  if (!message && !groupe) alertes.push(`ligne ${numero} : ${prenom} n'a ni message ni groupe (réponse générique)`);

  invites.push({ prenom, nom, message: message || null, groupe: groupe || null, token: token(), id: crypto.randomUUID() });
});

const groupes = [...new Set(invites.map((i) => i.groupe).filter(Boolean))];
const normalise = (g) => g.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const collisions = groupes.filter((g, i) => groupes.findIndex((h) => normalise(h) === normalise(g)) !== i);
if (collisions.length) {
  // Deux étiquettes voisines font deux groupes, donc deux messages à écrire et
  // un invité qui reçoit la mauvaise réponse.
  alertes.push(`étiquettes de groupe presque identiques : ${[...new Set(collisions)].join(', ')}`);
}

const doublons = invites
  .map((i) => `${i.prenom} ${i.nom}`.toLowerCase())
  .filter((n, i, t) => t.indexOf(n) !== i);
if (doublons.length) alertes.push(`doublons de nom : ${[...new Set(doublons)].join(', ')}`);

const dossier = path.join(__dirname, 'prive');
fs.mkdirSync(dossier, { recursive: true });

// INSERT ... WHERE NOT EXISTS : relancer l'import n'insère pas de doublons.
// C'est la protection qui compte ici, car un token est immuable une fois le
// lien envoyé (CLAUDE.md §3) — deux lignes pour la même personne, ce sont deux
// liens en circulation et un plan de table faux.
const insertions = invites.map((inv) =>
  `INSERT INTO convives (id, mariage_id, token, prenom, nom, message_perso, groupe, origine)\n` +
  `SELECT ${sql(inv.id)}, ${sql(mariageId)}, ${sql(inv.token)}, ${sql(inv.prenom)}, ${sql(inv.nom)}, ${sql(inv.message)}, ${sql(inv.groupe)}, 'liste'\n` +
  `WHERE NOT EXISTS (SELECT 1 FROM convives WHERE mariage_id = ${sql(mariageId)} AND prenom = ${sql(inv.prenom)} AND nom = ${sql(inv.nom)});`
);

const cheminSql = path.join(dossier, `import-${mariageId}.sql`);
const cheminLiens = path.join(dossier, `liens-${mariageId}.csv`);

fs.writeFileSync(cheminSql, insertions.join('\n\n') + '\n', 'utf8');
fs.writeFileSync(
  cheminLiens,
  'prenom,nom,lien\n' +
    invites.map((i) => `${sql(i.prenom).slice(1, -1)},${sql(i.nom).slice(1, -1)},https://${domaine}/${slug(i.prenom)}-${i.token}`).join('\n') +
    '\n',
  'utf8'
);

console.log(`\n${invites.length} invités préparés.`);
if (groupes.length) console.log(`Groupes rencontrés : ${groupes.join(', ')}`);
if (alertes.length) console.log('\nÀ vérifier :\n' + alertes.map((a) => `  - ${a}`).join('\n'));
console.log(`\nÉcrit :\n  ${cheminSql}\n  ${cheminLiens}`);
console.log(`\nPour appliquer (depuis worker/) :\n  npx wrangler d1 execute DB --remote --file=../prive/import-${mariageId}.sql`);
