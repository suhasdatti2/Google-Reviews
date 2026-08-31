/* OPTIQ - smooth inertia scroll (Lenis).

   Lenis loads from a CDN <script> tag in layout/theme.liquid, placed right
   before this file so `window.Lenis` is guaranteed to exist by the time
   init() runs (deferred scripts execute in document order). If that CDN
   request ever fails, window.Lenis stays undefined and initSmoothScroll()
   no-ops - the page keeps native scrolling with the CSS
   `scroll-behavior: smooth` fallback already in optiq-core.css. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* ------------------------------------------------------------------
     Smooth scroll (Lenis)
     ------------------------------------------------------------------ */
  function initSmoothScroll() {
    if (typeof window.Lenis !== 'function') return;
    // Respect the OS setting: native (instant) scroll is the correct
    // behaviour here, not a slower version of the same easing.
    if (reduce) return;

    // The dashboard and the sign-in screen are full-viewport app shells: the
    // window itself never scrolls there, an inner panel does. Running Lenis
    // on a page with nothing to scroll means it swallows every wheel event
    // and moves nothing, which is exactly why the wheel did nothing in the
    // dashboard while dragging the scrollbar still worked. Skip it entirely.
    if ($('.oqapp') || $('.oqauth')) return;

    // Anything with its own independent scroll area has to be exempted, or
    // Lenis intercepts the wheel and tries to smooth-scroll the page
    // underneath it instead. Lenis walks up from the event target looking
    // for this attribute, so marking the scrolling container is enough.
    //   .o-drawer__body  - cart drawer and mobile nav
    //   .oqa__log        - Optiq AI conversation
    //   .oqa__input      - the AI composer once the text outgrows it
    //   .oqapp__content  - dashboard body (belt and braces; we bail above)
    //   [data-lenis-prevent-target] - opt-in hook for anything added later
    $$('.o-drawer__body, .oqa__log, .oqa__input, .oqapp__content, [data-lenis-prevent-target]')
      .forEach(function (el) {
        el.setAttribute('data-lenis-prevent', '');
      });

    var lenis = new window.Lenis({
      // Driven by `duration` + a custom `easing` curve rather than `lerp` -
      // Lenis only honours one or the other, and lerp (a per-frame
      // exponential catch-up) reads as continuous rubber-banding, never
      // quite settling. duration+easing instead plays out ONE fixed,
      // weighted deceleration curve per scroll input - fast off the top,
      // easing gently into place - which is the actual "glide" a premium
      // site's scroll has, and where that curve ends is fixed the moment it
      // starts, not pulled toward anything as you scroll. That's still not
      // scroll-snap - nothing here jumps to or locks onto a section; it is
      // ordinary continuous scrolling, just eased. No scroll-snap/"magnetic"
      // section-snapping is used anywhere in this file.
      duration: 1.2,
      easing: function (t) { return Math.min(1, 1.001 - Math.pow(2, -10 * t)); },
      smoothWheel: true,
      // Mobile touch scroll stays native (default) rather than simulated -
      // it's already smooth on touch devices and cheaper to leave alone.
      syncTouch: false,
      wheelMultiplier: 1,
      touchMultiplier: 1
    });

    window.optiqLenis = lenis;

    // Driven off its own requestAnimationFrame loop, independent of any
    // other animation system. If GSAP + ScrollTrigger are added later,
    // replace this loop with:
    //   lenis.on('scroll', ScrollTrigger.update);
    //   gsap.ticker.add(function (time) { lenis.raf(time * 1000); });
    //   gsap.ticker.lagSmoothing(0);
    // so both stay on one driver instead of two competing rAF loops.
    function raf(time) {
      lenis.raf(time);
      window.requestAnimationFrame(raf);
    }
    window.requestAnimationFrame(raf);

    // Two separate things freeze the page, and Lenis has to be paused for
    // both:
    //   `.o-scroll-locked` - cart/menu drawers, set by lockScroll() in
    //     optiq-ui.js, which pins the body with `position: fixed`.
    //   `.optiq-loading`   - the entrance loader in layout/theme.liquid.
    // In both cases native scroll is already blocked, but Lenis keeps its
    // own virtual scroll position and would drift out of sync, jumping the
    // page once the lock lifts. Note the loader's `overflow: hidden` alone
    // does NOT stop Lenis - Lenis drives window.scrollTo() directly - so
    // without this a visitor could scroll the site behind the curtain.
    // Watching the classes from here means neither optiq-ui.js nor the
    // loader snippet needs to know Lenis exists.
    function isLocked() {
      return document.body.classList.contains('o-scroll-locked') ||
             document.body.classList.contains('optiq-loading');
    }

    // The loader's inline script runs while the document is still parsing,
    // so `.optiq-loading` is already on <body> before this deferred file
    // executes - check the current state, don't only listen for changes.
    var wasLocked = isLocked();
    if (wasLocked) { lenis.stop(); }

    if ('MutationObserver' in window) {
      new MutationObserver(function () {
        var locked = isLocked();
        if (locked === wasLocked) return;
        wasLocked = locked;
        if (locked) { lenis.stop(); } else { lenis.start(); }
      }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    // In-page anchor links (#how-it-works, #faq, ...) get the same inertia
    // easing, offset by the sticky header height so the target does not
    // land underneath it.
    document.addEventListener('click', function (e) {
      var link = e.target.closest('a[href^="#"]');
      if (!link) return;
      // Drawer triggers (cart/menu) sometimes use "#" hrefs for a11y - never
      // treat those as scroll targets.
      if (link.closest('[data-o-drawer-open], [data-o-drawer-close]')) return;

      var hash = link.getAttribute('href');
      if (!hash || hash === '#') return;

      var target;
      try { target = document.querySelector(hash); } catch (err) { return; }
      if (!target) return;

      e.preventDefault();
      var headerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--o-header-h'), 10) || 0;
      lenis.scrollTo(target, { offset: -(headerH + 16) });
    });
  }

  function init() {
    initSmoothScroll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
