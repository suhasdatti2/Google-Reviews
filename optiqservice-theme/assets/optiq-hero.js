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
   real product photography on a fixed interval, crossfading (plus a slow
   Ken Burns zoom, see optiq-hero.css) between slides via CSS opacity and
   transform. The prev/next arrows step through the same rotation on
   demand and wrap at both ends - clicking "next" on the last photo simply
   loops back to the first, and "prev" on the first loops back to the
   last - so there is never a dead end. A manual click pauses autoplay
   briefly and it quietly resumes, the same pattern used elsewhere in this
   theme for interactive carousels. Under prefers-reduced-motion the
   crossfade and zoom collapse to 1ms (see optiq-hero.css), so slides still
   rotate but as instant cuts rather than an animated effect.
   ========================================================================== */
function optiqBgCycleInit() {
  var bg = document.querySelector('[data-opsh-bg]');
  if (!bg || bg.dataset.bgReady === '1') return;
  bg.dataset.bgReady = '1';

  var slides = Array.prototype.slice.call(bg.querySelectorAll('.opsh__bg-slide'));
  if (slides.length < 2) return;

  var prevBtn = document.querySelector('[data-opsh-bg-prev]');
  var nextBtn = document.querySelector('[data-opsh-bg-next]');

  var index = 0; // the first slide already carries .is-active in the markup
  var timer = null;
  var resumeTimer = null;

  var AUTOPLAY_MS = 6000;
  var RESUME_MS = 6500;

  function show(next) {
    slides[index].classList.remove('is-active');
    index = next;
    slides[index].classList.add('is-active');
  }
  function goNext() { show((index + 1) % slides.length); }
  function goPrev() { show((index - 1 + slides.length) % slides.length); }

  function start() {
    stop();
    timer = window.setInterval(goNext, AUTOPLAY_MS);
  }
  function stop() {
    if (timer) { window.clearInterval(timer); timer = null; }
  }
  function pauseThenResume() {
    stop();
    if (resumeTimer) window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(start, RESUME_MS);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop(); else start();
  });

  if (nextBtn) nextBtn.addEventListener('click', function () { goNext(); pauseThenResume(); });
  if (prevBtn) prevBtn.addEventListener('click', function () { goPrev(); pauseThenResume(); });

  start();
}

optiqBgCycleInit();
document.addEventListener('shopify:section:load', optiqBgCycleInit);
