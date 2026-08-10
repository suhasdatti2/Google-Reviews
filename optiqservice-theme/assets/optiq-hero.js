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

/* ==========================================================================
   Full-bleed background photo cycle

   The hero photo fills the whole screen and rotates through the theme's
   real product photography on a fixed interval, crossfading between
   slides via CSS opacity. Purely a background effect - it never blocks
   input to the row links or wordmark sitting on top of it. Under
   prefers-reduced-motion the crossfade transition collapses to 1ms (see
   optiq-hero.css), so slides still rotate but as instant cuts rather than
   an animated effect.
   ========================================================================== */
function optiqBgCycleInit() {
  var bg = document.querySelector('[data-opsh-bg]');
  if (!bg || bg.dataset.bgReady === '1') return;
  bg.dataset.bgReady = '1';

  var slides = Array.prototype.slice.call(bg.querySelectorAll('.opsh__bg-slide'));
  if (slides.length < 2) return;

  var index = 0; // the first slide already carries .is-active in the markup
  var timer = null;

  function show(next) {
    slides[index].classList.remove('is-active');
    index = next;
    slides[index].classList.add('is-active');
  }

  function start() {
    stop();
    timer = window.setInterval(function () {
      show((index + 1) % slides.length);
    }, 4800);
  }
  function stop() {
    if (timer) { window.clearInterval(timer); timer = null; }
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  start();
}

optiqBgCycleInit();
document.addEventListener('shopify:section:load', optiqBgCycleInit);
