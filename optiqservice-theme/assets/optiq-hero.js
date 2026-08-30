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
