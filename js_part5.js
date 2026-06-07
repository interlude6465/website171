(function injectScrollSpacers() {
  var selectors = [
    '.home-scroll',
    '#screenVehicles .app-screen-scroll',
    '#screenPayments .app-screen-scroll'
  ];
  function inject() {
    selectors.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      if (el.querySelector(':scope > .scroll-spacer')) return;
      var spacer = document.createElement('div');
      spacer.className = 'scroll-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      el.appendChild(spacer);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
