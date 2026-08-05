/* OPTIQ - smooth inertia scroll (Lenis) + magnetic hover.

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
      // `lerp` takes priority over `duration`/`easing` in Lenis - it is the
      // value actually driving the feel below. `duration` is left set as
      // the documented target/fallback if `lerp` is ever removed in favour
      // of duration-based easing instead.
      lerp: 0.1,
      duration: 1.2,
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

  /* ------------------------------------------------------------------
     Magnetic hover
     GSAP is not a dependency of this theme, so this is a small custom
     lerp loop rather than gsap.quickTo(). If GSAP is added later, swap
     the per-frame lerp below for quickTo and drop this rAF loop.

     Tuning per element:
       data-magnetic-radius   px the cursor has to be within to engage (default 55)
       data-magnetic-strength multiplier on the pull, bigger = more travel (default 0.35)
     ------------------------------------------------------------------ */
  function initMagnetic() {
    var els = $$('.magnetic');
    if (!els.length || reduce) return;
    // No persistent hover on touch - the mousemove this depends on simply
    // will not fire there, but skip attaching the listener at all.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    var items = els.map(function (el) {
      return { el: el, rect: el.getBoundingClientRect(), curX: 0, curY: 0, tgtX: 0, tgtY: 0 };
    });

    function refreshRects() {
      items.forEach(function (item) { item.rect = item.el.getBoundingClientRect(); });
    }
    window.addEventListener('resize', refreshRects, { passive: true });
    window.addEventListener('scroll', refreshRects, { passive: true });

    document.addEventListener('mousemove', function (e) {
      items.forEach(function (item) {
        var radius = parseFloat(item.el.getAttribute('data-magnetic-radius')) || 55;
        var strength = parseFloat(item.el.getAttribute('data-magnetic-strength')) || 0.35;
        var r = item.rect;
        var cx = r.left + r.width / 2;
        var cy = r.top + r.height / 2;
        var dx = e.clientX - cx;
        var dy = e.clientY - cy;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < radius) {
          // Falls off toward both the centre (nothing to pull toward) and
          // the radius edge (barely engaged) - naturally self-limits to a
          // few px without an explicit clamp. Peak travel is roughly
          // (radius / 4) * strength, at dist == radius / 2.
          var pull = 1 - dist / radius;
          item.tgtX = dx * pull * strength;
          item.tgtY = dy * pull * strength;
        } else {
          item.tgtX = 0;
          item.tgtY = 0;
        }
      });
    }, { passive: true });

    document.addEventListener('mouseleave', function () {
      items.forEach(function (item) { item.tgtX = 0; item.tgtY = 0; });
    });

    var LERP = 0.18;
    function tick() {
      items.forEach(function (item) {
        item.curX += (item.tgtX - item.curX) * LERP;
        item.curY += (item.tgtY - item.curY) * LERP;
        item.el.style.transform = 'translate3d(' + item.curX.toFixed(2) + 'px, ' + item.curY.toFixed(2) + 'px, 0)';
      });
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  function init() {
    initSmoothScroll();
    initMagnetic();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
