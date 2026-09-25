// Messager "voiture" : une voiture décorée traverse l'écran avant que le
// faire-part ne se révèle. Repris et nettoyé à partir d'un exemple fourni.
// Même contrat que les autres messagers (cf. montgolfiere/montgolfiere.js) :
// un seul point d'entrée, window.jouerMessager(container, onTermine).
(function () {
  function creerFleur(cote) {
    const fleur = document.createElement('div');
    fleur.className = 'voiture-fleur ' + cote;
    return fleur;
  }

  function creerVoiture() {
    const voiture = document.createElement('div');
    voiture.className = 'voiture';
    voiture.innerHTML =
      '<div class="voiture-poussiere"></div>' +
      '<div class="voiture-carrosserie"></div>' +
      '<div class="voiture-toit"></div>' +
      '<div class="voiture-vitre"></div>' +
      '<div class="voiture-vitre arriere"></div>' +
      '<div class="voiture-chrome"></div>' +
      '<div class="voiture-phare"></div>' +
      '<div class="voiture-pare-choc"></div>' +
      '<div class="voiture-coeur">&#9829;</div>' +
      '<div class="voiture-fleur-deco">&#10047;</div>' +
      '<div class="voiture-roue arriere"></div>' +
      '<div class="voiture-roue avant"></div>';
    return voiture;
  }

  window.jouerMessager = function (container, onTermine, options) {
    // `forcer` (aperçu du tunnel self-service) ignore la mémoire de session :
    // cf. le commentaire de demarrerMessager() dans themes/botanique/index.html.
    const dejaJoue = !(options && options.forcer) && sessionStorage.getItem('messager-joue') === 'voiture';

    const overlay = document.createElement('div');
    overlay.className = 'messager-overlay';

    const route = document.createElement('div');
    route.className = 'voiture-route';
    overlay.appendChild(route);

    overlay.appendChild(creerFleur('gauche'));
    overlay.appendChild(creerFleur('droite'));
    overlay.appendChild(creerVoiture());

    const passer = document.createElement('p');
    passer.className = 'messager-passer';
    passer.textContent = 'Toucher pour continuer';
    overlay.appendChild(passer);

    container.appendChild(overlay);

    function sortir() {
      if (overlay.dataset.parti) return;
      overlay.dataset.parti = '1';
      overlay.classList.add('messager-sortie');
      sessionStorage.setItem('messager-joue', 'voiture');
      setTimeout(function () {
        overlay.remove();
        onTermine();
      }, 1000);
    }

    overlay.addEventListener('click', sortir);

    if (dejaJoue) {
      sortir();
    } else {
      setTimeout(sortir, 4000);
    }
  };
})();
