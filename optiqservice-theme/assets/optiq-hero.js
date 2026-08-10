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
   Product showcase (right column of the services splash)

   The splash section is fixed with body scroll locked, so there is no real
   page scroll to drive a scroll-linked animation off - instead this listens
   for wheel/touch gestures scoped to the showcase element itself and turns
   them into an eased horizontal "virtual scroll" position, giving the same
   scroll-driven feel the rest of the site would get from real page scroll,
   without unlocking scrolling on a screen that is deliberately a fixed
   full-viewport chooser.

   A single continuous position (0..count-1) drives every slide's transform/
   opacity/blur every animation frame - one interpolated value, not five
   separate per-product animations, so the transition between any two
   products always looks the same regardless of how far the gesture jumps.
   ========================================================================== */
function optiqShowcaseInit() {
  var root = document.querySelector('[data-opsh-showcase]');
  if (!root || root.dataset.showcaseReady === '1') return;
  root.dataset.showcaseReady = '1';

  var items = Array.prototype.slice.call(root.querySelectorAll('[data-showcase-item]'));
  var dots = Array.prototype.slice.call(root.querySelectorAll('[data-showcase-dot]'));
  var prevBtn = root.querySelector('[data-showcase-prev]');
  var nextBtn = root.querySelector('[data-showcase-next]');
  var count = items.length;
  if (!count) return;

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  var current = 0;  // eased position, updated every frame
  var target = 0;   // gesture/click destination
  var rafId = null;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function setActiveDot(index) {
    for (var i = 0; i < dots.length; i++) {
      var active = i === index;
      dots[i].classList.toggle('is-active', active);
      dots[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  /* Distance-based staging: the centred item is sharp, full size, full
     opacity; each step away shrinks, fades and softly blurs, so a product
     leaving frame reads as receding rather than sliding off unchanged. */
  function render() {
    var activeIndex = Math.round(current);
    for (var i = 0; i < count; i++) {
      var el = items[i];
      var delta = current - i;
      var abs = Math.abs(delta);
      var inFocus = abs < 0.5;
      el.style.transform = 'translate3d(' + (delta * 108) + '%, 0, 0) scale(' + clamp(1 - abs * 0.22, 0.72, 1) + ')';
      el.style.opacity = clamp(1 - abs * 0.85, 0, 1);
      var blur = clamp((abs - 0.12) * 7, 0, 9);
      el.style.filter = blur > 0.2 ? 'blur(' + blur + 'px)' : 'none';
      el.style.pointerEvents = inFocus ? 'auto' : 'none';
      el.tabIndex = i === activeIndex ? 0 : -1;
      el.setAttribute('aria-hidden', inFocus ? 'false' : 'true');
    }
    setActiveDot(activeIndex);
  }

  /* Reduced-motion path: a plain instant swap between exactly one visible
     slide at a time, no continuous transform/opacity animation. */
  function renderStatic() {
    var index = Math.round(target);
    for (var i = 0; i < count; i++) {
      var el = items[i];
      el.style.transform = '';
      el.style.filter = '';
      el.style.opacity = i === index ? '1' : '0';
      el.style.pointerEvents = i === index ? 'auto' : 'none';
      el.tabIndex = i === index ? 0 : -1;
      el.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    }
    setActiveDot(index);
  }

  function tick() {
    current += (target - current) * 0.14;
    if (Math.abs(target - current) < 0.001) {
      current = target;
      render();
      rafId = null;
      return;
    }
    render();
    rafId = requestAnimationFrame(tick);
  }

  function go(newTarget) {
    target = clamp(newTarget, 0, count - 1);
    if (reduced.matches) {
      current = target;
      renderStatic();
      return;
    }
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  if (reduced.matches) {
    renderStatic();
  } else {
    render();
  }

  /* ---- wheel: scroll-driven progress, scoped to this element only ---- */
  var WHEEL_SENSITIVITY = 0.0022;
  root.addEventListener('wheel', function (e) {
    if (reduced.matches) return;
    e.preventDefault();
    go(target + e.deltaY * WHEEL_SENSITIVITY);
  }, { passive: false });

  /* ---- touch drag ---- */
  var touchStartX = null;
  var touchStartTarget = 0;
  root.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    touchStartTarget = target;
  }, { passive: true });
  root.addEventListener('touchmove', function (e) {
    if (touchStartX === null) return;
    var dx = touchStartX - e.touches[0].clientX;
    var width = root.clientWidth || 1;
    go(touchStartTarget + (dx / width) * (count - 1) * 1.4);
  }, { passive: true });
  root.addEventListener('touchend', function () {
    if (touchStartX === null) return;
    touchStartX = null;
    go(Math.round(target)); // settle on the nearest product on release
  });

  /* ---- controls: arrows, dots, keyboard ---- */
  if (prevBtn) prevBtn.addEventListener('click', function () { go(Math.round(target) - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { go(Math.round(target) + 1); });
  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { go(i); });
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.round(target) + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); go(Math.round(target) - 1); }
  });
}

optiqShowcaseInit();
document.addEventListener('shopify:section:load', optiqShowcaseInit);
