/* OPTIQ - scroll reveals, sticky header state, announcement rotation.
   Everything here is progressive enhancement: with JS off or reduced motion
   on, content is fully visible and the page still reads correctly. */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  /* --- Scroll reveals ---------------------------------------------------
     One shared observer for the whole page. Elements unobserve after they
     reveal, so nothing keeps running once it has played. */
  function initReveals() {
    var items = $$('[data-o-reveal], .o-mask');
    if (!items.length) return;

    if (reduce || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-revealed'); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;

        // Stagger children of a group without needing per-element markup.
        var group = el.getAttribute('data-o-reveal-group');
        if (group) {
          $$('[data-o-reveal], .o-mask', el).forEach(function (child, i) {
            child.style.setProperty('--o-reveal-delay', (i * 70) + 'ms');
            child.classList.add('is-revealed');
          });
        }
        el.classList.add('is-revealed');
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.1 });

    items.forEach(function (el) { io.observe(el); });
  }

  /* --- Fixed header + announcement bar -----------------------------------
     Both are `position: fixed` (optiq-components.css) so they stay pinned
     to the viewport at every scroll position - no scroll-linked toggling
     needed any more. All this does now is publish their REAL rendered
     heights as CSS vars, so #main-content's compensating top padding
     (optiq-core.css) and any :target scroll offset track the actual
     header, not a guessed number - correct even as the announcement bar's
     message text wraps differently across viewport widths. */
  function initHeader() {
    var header = $('[data-o-header]');
    var announce = $('[data-o-announce]');
    if (!header && !announce) return;

    function setHeights() {
      document.documentElement.style.setProperty('--o-header-h', (header ? header.offsetHeight : 0) + 'px');
      document.documentElement.style.setProperty('--o-announce-h', (announce ? announce.offsetHeight : 0) + 'px');
    }
    setHeights();

    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(setHeights);
      if (header) ro.observe(header);
      if (announce) ro.observe(announce);
    }
  }

  /* --- Announcement rotation -------------------------------------------
     Pauses on hover and on keyboard focus, and never runs for a single
     message or under reduced motion. */
  function initAnnouncement() {
    var bar = $('[data-o-announce]');
    if (!bar) return;

    var messages = $$('[data-o-announce-msg]', bar);
    if (messages.length < 2) return;

    var interval = parseInt(bar.getAttribute('data-o-announce-interval'), 10) || 5000;
    var index = 0;
    var timer = null;

    function show(next) {
      messages[index].classList.remove('is-active');
      messages[index].setAttribute('aria-hidden', 'true');
      index = (next + messages.length) % messages.length;
      messages[index].classList.add('is-active');
      messages[index].setAttribute('aria-hidden', 'false');
    }

    function start() {
      if (reduce || timer) return;
      timer = window.setInterval(function () { show(index + 1); }, interval);
    }
    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    bar.addEventListener('mouseenter', stop);
    bar.addEventListener('mouseleave', start);
    bar.addEventListener('focusin', stop);
    bar.addEventListener('focusout', start);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stop(); } else { start(); }
    });

    var prev = $('[data-o-announce-prev]', bar);
    var next = $('[data-o-announce-next]', bar);
    if (prev) prev.addEventListener('click', function () { stop(); show(index - 1); start(); });
    if (next) next.addEventListener('click', function () { stop(); show(index + 1); start(); });

    start();
  }

  function init() {
    initReveals();
    initHeader();
    initAnnouncement();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme Editor re-renders sections without a page load.
  document.addEventListener('shopify:section:load', init);
})();
