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

   Autoplay drives the showcase on its own, advancing one product at a time
   on a fixed interval - wheel, touch drag, arrows, dots and keyboard all
   still work and simply take over the same position for a few seconds
   before autoplay quietly resumes. The splash section is fixed with body
   scroll locked, so there is no real page scroll for manual input to hook
   into either way; wheel/touch gestures are scoped to the showcase element
   itself rather than the page.

   A single continuous position drives every slide's transform/opacity/blur
   every animation frame - one interpolated value, not five separate
   per-product animations, so the transition between any two products always
   looks the same. The position is unbounded (not clamped to the slide
   count) and wrapped visually via circularDelta(), so autoplay can drift
   forward forever without ever snapping backwards at the loop point from
   the last product back to the first.
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

  /* Shortest signed distance between two positions on a looping n-item ring,
     so autoplay can drift forward forever - current/target just keep
     growing - without ever snapping backwards at the wrap from the last
     product back to the first. */
  function circularDelta(pos, index) {
    var raw = (pos - index) % count;
    if (raw > count / 2) raw -= count;
    if (raw < -count / 2) raw += count;
    return raw;
  }

  /* Nearest absolute target equivalent to a given slide index, so jumping to
     a dot always takes the shortest path around the ring instead of
     rewinding through every slide in between. */
  function nearestEquivalent(index) {
    return Math.round((target - index) / count) * count + index;
  }

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
    var activeIndex = ((Math.round(current) % count) + count) % count;
    for (var i = 0; i < count; i++) {
      var el = items[i];
      var delta = circularDelta(current, i);
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
    var index = ((Math.round(target) % count) + count) % count;
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

  /* current/target are unbounded (not clamped to 0..count-1) - the ring
     wraps visually via circularDelta() above, so target can just keep
     growing forever and autoplay never has to snap backwards at the loop
     point from the last product back to the first. */
  function go(newTarget) {
    target = newTarget;
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

  /* ---- autoplay: the showcase drives itself, no gesture required ----
     Advances one product at a time on a fixed interval and lets the same
     eased tick() loop glide to it, so autoplay motion looks identical to a
     manual advance. Pauses on any manual interaction and quietly resumes a
     few seconds later, and never runs at all under reduced motion. */
  var AUTOPLAY_MS = 4200;
  var AUTOPLAY_RESUME_MS = 5000;
  var autoplayTimer = null;
  var resumeTimer = null;

  function stopAutoplay() {
    if (autoplayTimer) { window.clearInterval(autoplayTimer); autoplayTimer = null; }
  }
  function startAutoplay() {
    if (reduced.matches || document.hidden) return;
    stopAutoplay();
    autoplayTimer = window.setInterval(function () { go(target + 1); }, AUTOPLAY_MS);
  }
  function pauseThenResumeAutoplay() {
    stopAutoplay();
    if (resumeTimer) window.clearTimeout(resumeTimer);
    resumeTimer = window.setTimeout(startAutoplay, AUTOPLAY_RESUME_MS);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopAutoplay();
    else startAutoplay();
  });
  root.addEventListener('mouseenter', stopAutoplay);
  root.addEventListener('mouseleave', startAutoplay);

  startAutoplay();

  /* ---- wheel: scroll-driven progress, scoped to this element only ---- */
  var WHEEL_SENSITIVITY = 0.0022;
  root.addEventListener('wheel', function (e) {
    if (reduced.matches) return;
    e.preventDefault();
    pauseThenResumeAutoplay();
    go(target + e.deltaY * WHEEL_SENSITIVITY);
  }, { passive: false });

  /* ---- touch drag ---- */
  var touchStartX = null;
  var touchStartTarget = 0;
  root.addEventListener('touchstart', function (e) {
    stopAutoplay();
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
    pauseThenResumeAutoplay();
  });

  /* ---- controls: arrows, dots, keyboard ---- */
  if (prevBtn) prevBtn.addEventListener('click', function () { pauseThenResumeAutoplay(); go(Math.round(target) - 1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { pauseThenResumeAutoplay(); go(Math.round(target) + 1); });
  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { pauseThenResumeAutoplay(); go(nearestEquivalent(i)); });
  });
  root.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight') { e.preventDefault(); pauseThenResumeAutoplay(); go(Math.round(target) + 1); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); pauseThenResumeAutoplay(); go(Math.round(target) - 1); }
  });
}

optiqShowcaseInit();
document.addEventListener('shopify:section:load', optiqShowcaseInit);
