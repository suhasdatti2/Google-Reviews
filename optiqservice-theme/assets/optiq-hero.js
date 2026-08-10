function optiqServicesHeroInit() {
  var root = document.querySelector('[data-optiq-services-hero]');
  if (!root || root.dataset.opshReady === '1') return;
  root.dataset.opshReady = '1';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  var confirmTitle = root.querySelector('[data-opsh-confirm-title]');

  /* Layout is entirely CSS: splash mode hides the header and pins the section
     to inset:0, so there is no header height to measure and nothing here can
     leave the page mis-sized if this script fails to run. */

  /* ---- choose a row: confirm, then navigate ---- */
  root.addEventListener('click', function (e) {
    var row = e.target.closest('[data-opsh-choose]');
    if (!row) return;
    /* Let modified clicks (new tab, etc.) behave natively. */
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

    var href = row.getAttribute('href');
    if (!href) return;

    e.preventDefault();
    if (confirmTitle) confirmTitle.textContent = row.getAttribute('data-opsh-name') || '';
    root.setAttribute('data-chosen', row.getAttribute('data-opsh-choose'));
    window.setTimeout(function () { window.location.href = href; }, reduced.matches ? 120 : 820);
  });
}

optiqServicesHeroInit();
/* Re-init when the theme editor re-renders the section. */
document.addEventListener('shopify:section:load', optiqServicesHeroInit);
