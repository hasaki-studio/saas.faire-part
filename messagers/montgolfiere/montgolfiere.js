// Messager "montgolfière" : une courte animation plein écran jouée avant que le
// faire-part ne se révèle. Ne connaît rien du thème qui l'appelle (cf. CLAUDE.md
// §6, "ne jamais coder un messager en dur dans un thème") : un seul point
// d'entrée, window.jouerMessager(container, onTermine).
(function () {
  function creerNuage(top, duree, delai, taille) {
    const nuage = document.createElement('div');
    nuage.className = 'messager-nuage';
    nuage.style.top = top;
    nuage.style.animationDuration = duree;
    nuage.style.animationDelay = delai;
    nuage.innerHTML =
      '<svg width="' + taille + '" height="' + Math.round(taille * 0.4) + '" viewBox="0 0 100 40" fill="rgba(255,255,255,0.9)">' +
      '<ellipse cx="30" cy="25" rx="22" ry="13"/>' +
      '<ellipse cx="55" cy="18" rx="26" ry="16"/>' +
      '<ellipse cx="78" cy="26" rx="18" ry="11"/>' +
      '</svg>';
    return nuage;
  }

  function creerBallon() {
    const ballon = document.createElement('div');
    ballon.className = 'messager-montgolfiere';
    ballon.innerHTML =
      '<svg viewBox="0 0 100 140" fill="none">' +
      '<path d="M50 4C28 4 14 30 14 52c0 20 14 34 20 40h32c6-6 20-20 20-40C86 30 72 4 50 4z" fill="#c9a96e"/>' +
      '<path d="M50 4C38 4 30 30 30 52c0 20 8 34 12 40h16c4-6 12-20 12-40C70 30 62 4 50 4z" fill="#7d9b76" opacity="0.85"/>' +
      '<line x1="26" y1="92" x2="38" y2="112" stroke="#4f6b4a" stroke-width="1.5"/>' +
      '<line x1="74" y1="92" x2="62" y2="112" stroke="#4f6b4a" stroke-width="1.5"/>' +
      '<line x1="34" y1="92" x2="40" y2="112" stroke="#4f6b4a" stroke-width="1.5"/>' +
      '<line x1="66" y1="92" x2="60" y2="112" stroke="#4f6b4a" stroke-width="1.5"/>' +
      '<rect x="38" y="112" width="24" height="18" rx="2" fill="#4f6b4a"/>' +
      '</svg>';
    return ballon;
  }

  window.jouerMessager = function (container, onTermine) {
    // Rejoué une fois par session : un invité qui revient sur son lien pendant
    // la même visite n'a pas besoin de se retaper l'animation à chaque fois.
    const dejaJoue = sessionStorage.getItem('messager-joue') === 'montgolfiere';

    const overlay = document.createElement('div');
    overlay.className = 'messager-overlay';

    overlay.appendChild(creerNuage('20%', '18s', '0s', 90));
    overlay.appendChild(creerNuage('35%', '24s', '-6s', 60));
    overlay.appendChild(creerNuage('12%', '20s', '-12s', 70));
    overlay.appendChild(creerBallon());

    const passer = document.createElement('p');
    passer.className = 'messager-passer';
    passer.textContent = 'Toucher pour continuer';
    overlay.appendChild(passer);

    container.appendChild(overlay);

    function sortir() {
      if (overlay.dataset.parti) return;
      overlay.dataset.parti = '1';
      overlay.classList.add('messager-sortie');
      sessionStorage.setItem('messager-joue', 'montgolfiere');
      setTimeout(function () {
        overlay.remove();
        onTermine();
      }, 1000);
    }

    overlay.addEventListener('click', sortir);

    if (dejaJoue) {
      sortir();
    } else {
      setTimeout(sortir, 3600);
    }
  };
})();
