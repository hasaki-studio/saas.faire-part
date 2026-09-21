// ni 0/O ni 1/I/L, pas de voyelles → aucun mot accidentel
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

// crypto.getRandomValues, jamais Math.random() — prédictible (cf. CLAUDE.md §3, règle absolue #1).
export function token(n = 8): string {
  const out: string[] = [];
  while (out.length < n) {
    for (const b of crypto.getRandomValues(new Uint8Array(n))) {
      if (b < 240 && out.length < n) out.push(ALPHABET[b % 30]!); // 240 = 8 × 30, écarte le biais de modulo
    }
  }
  return out.join("");
}
