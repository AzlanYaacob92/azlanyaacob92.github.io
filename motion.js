/* =============================================================
   motion.js — the one place JS-driven animation goes through.

   Reads its timing from the design-system tokens (--dur-fast, --dur,
   --dur-slow, --stagger, --ease, --ease-move), so CSS and JS move to
   the same clock. Under prefers-reduced-motion every call lands on
   its final state at once and every wait is skipped.

   Classic script (works over file://); exposes window.Motion.
   This file is copied into each repo. Edit the canonical copy in
   azlanyaacob92.github.io and run design-system/sync.js.
   ============================================================= */
(function (global) {
  'use strict';

  var FALLBACK = {
    '--dur-fast': 120, '--dur': 220, '--dur-slow': 420, '--stagger': 90,
    '--ease': 'cubic-bezier(0.16, 1, 0.3, 1)', '--ease-move': 'cubic-bezier(0.4, 0, 0.2, 1)'
  };
  var NAMED = { fast: '--dur-fast', base: '--dur', slow: '--dur-slow' };
  var cache = {};
  var mq = null;
  try { mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null; } catch (e) { /* treat as full motion */ }

  /* true while the user asks for reduced motion (checked live, not once) */
  function reduced() { return !!(mq && mq.matches); }

  function token(name) {
    if (!(name in cache)) {
      var v = '';
      try { v = global.getComputedStyle(global.document.documentElement).getPropertyValue(name).trim(); } catch (e) { /* no layout */ }
      cache[name] = v || String(FALLBACK[name]);
    }
    return cache[name];
  }

  /* 'fast' | 'base' | 'slow' | a number of ms  ->  ms */
  function dur(d) {
    if (typeof d === 'number') return d;
    var v = token(NAMED[d] || NAMED.base);
    var n = parseFloat(v);
    return /[^m]s$/.test(v) ? n * 1000 : n;
  }
  function ease() { return token('--ease'); }          /* UI arriving or leaving */
  function easeMove() { return token('--ease-move'); } /* an object travelling inside a simulation */
  function gap() { return dur(parseFloat(token('--stagger'))); }

  /* Run one Web Animation and resolve with it when it ends. Resolves at once
     (with null) when motion is reduced or the API is missing. A timer backs
     up the `finished` promise, because a hidden tab stops ticking animations. */
  function run(el, keyframes, opts) {
    opts = opts || {};
    if (!el || reduced() || typeof el.animate !== 'function') return Promise.resolve(null);
    var duration = dur(opts.duration === undefined ? 'slow' : opts.duration);
    var delay = opts.delay || 0;
    var a;
    try {
      a = el.animate(keyframes, { duration: duration, delay: delay, easing: opts.easing || ease(), fill: opts.fill || 'backwards' });
    } catch (e) { return Promise.resolve(null); }
    return new Promise(function (resolve) {
      var done = false;
      function finish() { if (done) return; done = true; clearTimeout(timer); resolve(a); }
      var timer = setTimeout(function () { try { a.finish(); } catch (e) { /* already gone */ } finish(); }, delay + duration + 120);
      if (a.finished) a.finished.then(finish, finish); else a.onfinish = finish;
    });
  }

  /* Animate FROM the given keyframes TO the element's own resting style.
     opts: { duration, delay, easing } */
  function animate(el, keyframes, opts) { return run(el, keyframes, opts).then(function () {}); }

  /* Bring an element in: fade, with an optional rise (y, px) or grow (scale). */
  function enter(el, opts) {
    opts = opts || {};
    var y = opts.y === undefined ? 8 : opts.y;
    var from = { opacity: 0, transform: (y ? 'translateY(' + y + 'px) ' : '') + (opts.scale ? 'scale(' + opts.scale + ')' : '') || 'none' };
    return animate(el, [from, { opacity: 1, transform: 'none' }], opts);
  }

  /* Fade an element out, then hide it (pass hide:false to leave it in place).
     Leaving is quicker than arriving: the default duration is 'base'. */
  function exit(el, opts) {
    opts = opts || {};
    if (!el) return Promise.resolve();
    return run(el, [{ opacity: 1 }, { opacity: 0 }], { duration: opts.duration || 'base', delay: opts.delay, fill: 'forwards' })
      .then(function (a) {
        if (opts.hide !== false) el.hidden = true;
        /* drop the held end state after the caller's own .then() has run */
        if (a) setTimeout(function () { try { a.cancel(); } catch (e) { /* already gone */ } }, 0);
      });
  }

  /* Step change: `from` leaves quickly, `update` runs, then `to` arrives,
     growing or shrinking from the height of the card it replaces so the page
     below does not jump. from and to may be the same element refreshed in
     place; from may be null. */
  function swap(from, to, update, opts) {
    var h0 = from && !reduced() ? from.offsetHeight : 0;
    return exit(from, { duration: 'fast' }).then(function () {
      if (update) update();
      if (!to) return;
      to.hidden = false;
      var h1 = h0 ? to.offsetHeight : 0;
      if (h1 && Math.abs(h1 - h0) > 1) {
        run(to, [{ height: h0 + 'px', overflow: 'hidden' }, { height: h1 + 'px', overflow: 'hidden' }], { duration: 'slow' });
      }
      return enter(to, opts && opts.enter);
    });
  }

  /* Bring a list in one after another, --stagger apart.
     opts: enter() options plus { delay } before the first one. */
  function stagger(els, opts) {
    opts = opts || {};
    var start = opts.delay || 0, step = opts.gap === undefined ? gap() : opts.gap;
    return Promise.all(Array.prototype.map.call(els, function (el, i) {
      var o = {}; for (var k in opts) o[k] = opts[k];
      o.delay = start + i * step;
      return enter(el, o);
    }));
  }

  /* Move an element to new values and keep them: Motion.to(dot, { cy: '40px' }). */
  function to(el, props, opts) {
    if (!el) return Promise.resolve();
    var from = {}, cs = null;
    try { cs = global.getComputedStyle(el); } catch (e) { /* no layout */ }
    Object.keys(props).forEach(function (k) {
      if (cs) from[k] = cs[k];
      el.style[k] = props[k];
    });
    if (!cs) return Promise.resolve();
    opts = opts || {};
    return animate(el, [from, props], { duration: opts.duration, delay: opts.delay, easing: opts.easing || easeMove() });
  }

  /* Draw an SVG stroke in from its start, as if it were travelling. */
  function draw(path, opts) {
    var length = 0;
    try { if (path && typeof path.getTotalLength === 'function') length = path.getTotalLength(); } catch (e) { length = 0; }
    if (!length || !isFinite(length) || reduced()) return Promise.resolve();
    opts = opts || {};
    path.style.strokeDasharray = String(length);
    return animate(path, [{ strokeDashoffset: length }, { strokeDashoffset: 0 }],
      { duration: opts.duration, delay: opts.delay, easing: opts.easing || easeMove() })
      .then(function () { path.style.strokeDasharray = ''; });
  }

  /* The token curves as functions, for values CSS cannot reach (a WebGL camera, a canvas). */
  function curve(str) {
    var m = /cubic-bezier\(([^)]+)\)/.exec(str), n = m ? m[1].split(',').map(Number) : [0.4, 0, 0.2, 1];
    function at(a, b, t) { var u = 1 - t; return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t; }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var lo = 0, hi = 1, t = x;
      for (var i = 0; i < 24; i++) {
        var xt = at(n[0], n[2], t);
        if (Math.abs(xt - x) < 1e-4) break;
        if (xt < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return at(n[1], n[3], t);
    };
  }

  /* Drive your own values from 0 to 1 along a token curve:
       Motion.tween({ duration: 'slow', easing: 'move', update: p => ..., done: () => ... })
     easing is 'move' (the default) or 'ui'. Returns { cancel }. With reduced
     motion, update(1) and done() run at once. */
  function tween(opts) {
    var stopped = false, id = 0, t0 = null;
    var raf = global.requestAnimationFrame;
    if (reduced() || typeof raf !== 'function') {
      opts.update(1);
      if (opts.done) opts.done();
      return { cancel: function () {} };
    }
    var length = dur(opts.duration === undefined ? 'slow' : opts.duration);
    var shape = curve(opts.easing === 'ui' ? ease() : easeMove());
    function step(now) {
      if (stopped) return;
      if (t0 === null) t0 = now;
      var x = Math.min(1, (now - t0) / length);
      opts.update(shape(x));
      if (x < 1) id = raf(step); else if (opts.done) opts.done();
    }
    id = raf(step);
    return { cancel: function () { stopped = true; if (global.cancelAnimationFrame) global.cancelAnimationFrame(id); } };
  }

  /* A cancellable run of timed steps: Motion.timeline().at(650, fn).at(1100, fn).
     With reduced motion every step runs straight away, in order. */
  function timeline() {
    var ids = [], dead = false;
    return {
      at: function (ms, fn) {
        if (dead) return this;
        ids.push(setTimeout(function () { if (!dead) fn(); }, reduced() ? 0 : ms));
        return this;
      },
      cancel: function () { dead = true; ids.forEach(clearTimeout); ids = []; }
    };
  }

  /* Scrolling that glides, or jumps when motion is reduced. */
  function behavior() { return reduced() ? 'auto' : 'smooth'; }
  function scrollIntoView(el, block) {
    try { if (el && el.scrollIntoView) el.scrollIntoView({ behavior: behavior(), block: block || 'nearest' }); } catch (e) { /* old browser */ }
  }
  function scrollTop() {
    try { global.scrollTo({ top: 0, behavior: behavior() }); } catch (e) { global.scrollTo(0, 0); }
  }

  global.Motion = {
    reduced: reduced, dur: dur, ease: ease, easeMove: easeMove,
    animate: animate, enter: enter, exit: exit, swap: swap, stagger: stagger,
    to: to, draw: draw, tween: tween, timeline: timeline,
    scrollIntoView: scrollIntoView, scrollTop: scrollTop
  };
})(window);
