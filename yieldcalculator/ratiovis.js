/* ============================================================================
   ratiovis.js  —  the ratio-ball picture (shared module, identical in both apps)

   Under the equation, the STOICHIOMETRIC ratio (what the equation needs) is
   drawn against the ACTUAL ratio (what you have) as balls on one scale.
   Classic script, global `RatioVis`, also `module.exports` for Node.
   Needs ratiovis.css. Uses window.Motion (motion.js) for the entrance if present.
   DOM is touched only inside mount(); model(), describe() and html() are pure.

   ---- the idea ------------------------------------------------------------
   Reactant i has coefficient c_i and n_i mol, so it supplies b_i = n_i / c_i
   "batches". An ANCHOR reactant j fixes the scale:  k = n_j / c_j  mol per ball.
   Every reactant then shows n_i / k balls. The anchor shows exactly c_j balls;
   the other shows c_i * b_i / b_j balls, which can be fractional (half a ball).
   A reactant with fewer balls than its coefficient is SHORT, with more it has
   EXTRA, equal it MATCHES. Which one is limiting never depends on the anchor
   (smaller b_i; equal within a relative 1e-9, as computeLimiting, is a TIE).
   Default anchor = larger coefficient; equal coefficients -> larger moles;
   still equal -> reactant 0. Equation A + 2B:
     (0.3, 0.6)  -> anchor B, k = 0.3 mol/ball -> balls 1 : 2   both match (tie)
     (0.15, 0.6) -> anchor B, k = 0.3 mol/ball -> balls 0.5 : 2 A short, A limiting
     (0.15, 0.2) -> anchor B, k = 0.1 mol/ball -> balls 1.5 : 2 A extra, B limiting

   ---- RatioVis.model(spec) -> object  (pure; throws on invalid input) -------
   spec = {
     reactants: [ { html, coef, moles }, { html, coef, moles } ],
         exactly two, in equation order. html = the formula markup the app
         already builds (fmtFormula, e.g. 'O<sub>2</sub>'), WITHOUT the
         coefficient. coef and moles must be finite numbers > 0 (typeof 'number';
         numeric strings are rejected). Whole-number coefficients expected.
     products:  [ { html, coef } ]       optional; needed for view 'product'
     product:   0                         index into products (default 0)
     view:      'need' | 'have' | 'compare' | 'leftover' | 'product'
                                          (default 'compare')
     anchor:    'auto' | 0 | 1            (default 'auto'; any other value = 'auto')
                'leftover' and 'product' ignore it: they always fit the limiting
                reactant (on a tie the 'auto' rule picks the anchor; k is the same).
     fill:      undefined | number >= 0   'product' view: actual / theoretical yield.
                undefined or null = theoretical only. NaN / negative / non-number throws.
     mark:      undefined | { pick: 0 | 1 | 'tie' }   Practice: the learner's answer.
     scale:     true                      "1 ball = k mol" label (default true;
                never drawn in the 'need' view)
   }
   returns {
     view,                       // normalised view name
     anchor,                     // 0 | 1  the reactant that fixes the scale
     k,                          // mol per ball  (= moles[anchor] / coef[anchor])
     limiting,                   // 0 | 1 | 'tie'   (never depends on the anchor)
     tie,                        // boolean
     groups: [ {                 // one per reactant, equation order
       index, coef, moles,
       batches,                  // moles / coef
       balls,                    // moles / k   (anchor and matched: exactly coef)
       need,                     // = coef (balls the equation needs)
       status,                   // 'short' | 'extra' | 'match'  (balls vs coef)
       limiting,                 // true only for the limiting reactant (false on a tie)
       extraBalls, shortBalls,   // balls - coef when extra / coef - balls when short, else 0
       extraMoles, shortMoles    // the same in mol (extraMoles = leftover when anchored on the limiting reactant)
     }, … ],
     product,                    // only when spec.products is given
       // { index, coef, balls, moles, filled, fill, over }
       //   balls  = theoretical product balls (= coef when anchored on the limiting reactant)
       //   moles  = theoretical product moles
       //   fill   = spec.fill as given (null when omitted)
       //   filled = min(fill, 1) * balls solid balls (null when fill omitted); 62 % of 2 -> 1.24
       //   over   = fill > 1 (+1e-9): drawn full and tagged "> 100 %"
     mark                        // only when spec.mark is given
       // { pick, answer (= limiting), correct }
   }
   Numbers are exact (no rounding). Values within 1e-9 (relative) of a recipe
   figure are snapped to it, so a matched group has balls === coef exactly.

   ---- RatioVis.html(spec, opts) -> string ------------------------------------
   The picture as markup (inline SVG balls + HTML labels), ready for innerHTML.
   Returns '' for an invalid spec (it never throws on bad input) or unknown view.
   opts = {
     fitControl: false,   // 'Fit to' [A] [B] segmented control (views 'have', 'compare' only)
     onFit: (index, model) => {}, // mount() only: after the learner re-fits; index 0 | 1, model = RatioVis.model of the new picture
     animate: true,       // mount() only: play the entrance (needs window.Motion)
     delay: 0,            // mount() only: ms to wait before the entrance (mount inside Motion.swap's update, delay ~ 300)
     working: false,      // views 'have', 'compare': show how moles become balls (1 ball = n ÷ coefficient; balls = n ÷ 1 ball), updated by the fit control
     size: 'md' | 'sm',   // 'sm' = smaller balls and type (default 'md')
     sf: 3                // significant figures for every number in the picture, 1..8 (match the app's sig(x, n))
   }
   The fit control is wired by mount(); html() alone gives inert buttons.

   ---- RatioVis.mount(el, spec, opts) -> model | null ---------------------------
   Sets el.innerHTML = html(spec, opts), wires the fit control (a click re-draws
   the picture IN PLACE: no entrance replay, focus stays on the button, then
   opts.onFit(index, model) runs), then plays the entrance with window.Motion:
   Need row, then Have row, then product (reduced motion lands on the final
   state; no Motion = no animation, no error). Call mount() again on the same
   element to redraw with a new spec. Returns the initial model, or null (and
   empties el) for an invalid spec.

   ---- RatioVis.describe(spec, opts) -> string ----------------------------------
   The aria-label sentence html() puts on the picture (throws like model(); only opts.sf matters).

   ---- what is drawn -------------------------------------------------------------
   need      one row: c_i outlined (ghost) balls under each formula, ratio "1 : 2".
   have      Need row + Have row, neutral colours, no verdict marks. A fractional
             ball is filled from the left by exactly the fraction, the rest dashed.
   compare   Need + Have aligned per reactant. Short: the missing part is dashed
             + tag "short". More than the recipe: the extra balls are dashed + tag
             "extra". Matched: tag ✓. Limiting = --lim-* look, excess = --exc-* look.
   leftover  fitted to the limiting reactant: used balls solid, the excess's
             remaining balls dashed + tag "left over" and the amount in mol.
   product   reactants fitted to the limiting reactant -> product balls: coef
             outlined (theoretical); with fill, fill*coef solid + "62 %", tags
             "theoretical" / "actual"; fill > 1 is clamped and tagged "> 100 %".
   mark      the learner's pick gets a ✓ / ✗ badge (pick 'tie' = "Neither").
   At most 30 balls are drawn per group, at most 5 to a row (25 balls = 5 x 5); the
   rest is a "+N" chip, and every label still states the true number (opts.sf figures, default 3).
   The picture is one role="img" with a sentence in aria-label; the fit control
   sits outside it. Hooks for tests: .rv, .rv-col[data-rv-col], .rv-cell[data-rv-row],
   .rv-b (one per drawn ball), data-rv-view / -anchor / -limiting on the root.
   ========================================================================== */
(function (root) {
  'use strict';

  /* ---- constants ---------------------------------------------------------- */
  const VIEWS = ['need', 'have', 'compare', 'leftover', 'product'];
  const CAP = 30;                 // balls drawn per group; the rest is a "+N" chip
  const EPS = 1e-9;               // relative tolerance, as computeLimiting
  const PITCH = 40;               // one ball slot, in viewBox units
  const RAD = 16.5;               // ball radius, in viewBox units
  const PART_MIN = 0.08;          // a partial ball is always drawn at least this full …
  const PART_MAX = 0.92;          // … and never fuller than this, so it reads as partial

  /* ---- errors ---- */
  function bad(msg) { const e = new Error('RatioVis: ' + msg); e.name = 'RatioVisError'; return e; }
  const isInputError = e => !!e && e.name === 'RatioVisError';
  const isNum = x => typeof x === 'number' && isFinite(x);
  const finite = o => typeof o === 'number' ? isFinite(o) : !!o && typeof o === 'object' ? Object.keys(o).every(k => finite(o[k])) : true;
  function show(v) { try { return typeof v === 'string' ? JSON.stringify(v) : String(v); } catch (e) { return typeof v; } }

  /* ---- number + text formatting ------------------------------------------- */
  // up to n significant figures, trailing zeros trimmed, never exponent notation
  function num(x, n) {
    n = n || 3;
    if (!isFinite(x)) return '—';
    if (x === 0) return '0';
    const v = Number(x.toPrecision(n)), a = Math.abs(v);
    if (a >= 1e-6 && a < 1e21) return String(v);
    return v.toFixed(Math.max(0, Math.min(100, n + Math.ceil(-Math.log10(a))))).replace(/\.0+$|(\.\d*?)0+$/, '$1');
  }
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const SCRIPT = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
                   '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
                   '⁺': '+', '⁻': '-', '₊': '+', '₋': '-', '−': '-' };
  // formula markup -> plain text for an aria-label: tags stripped, sub/superscripts as plain characters
  function plain(h) {
    return String(h == null ? '' : h)
      .replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&minus;/g, '-')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/[₀-₉⁰-⁹⁺⁻₊₋−¹²³]/g, ch => SCRIPT[ch] || ch)
      .replace(/\s+/g, ' ').trim();
  }

  /* ---- the model (pure) ------------------------------------------------------ */
  function normalise(spec) {
    if (!spec || typeof spec !== 'object') throw bad('spec must be an object');
    const rs = spec.reactants;
    if (!Array.isArray(rs) || rs.length !== 2) throw bad('reactants must be an array of exactly two');
    rs.forEach((r, i) => {
      if (!r || typeof r !== 'object') throw bad(`reactants[${i}] must be an object`);
      if (!isNum(r.coef) || r.coef <= 0) throw bad(`reactants[${i}].coef must be a positive finite number (got ${show(r.coef)})`);
      if (!isNum(r.moles) || r.moles <= 0) throw bad(`reactants[${i}].moles must be a positive finite number (got ${show(r.moles)})`);
    });
    const view = spec.view === undefined || spec.view === null ? 'compare' : spec.view;
    if (VIEWS.indexOf(view) < 0) throw bad(`unknown view ${show(view)}`);
    let products = null, product = 0;
    if (spec.products !== undefined && spec.products !== null) {
      if (!Array.isArray(spec.products) || !spec.products.length) throw bad('products must be a non-empty array');
      spec.products.forEach((p, i) => {
        if (!p || typeof p !== 'object') throw bad(`products[${i}] must be an object`);
        if (!isNum(p.coef) || p.coef <= 0) throw bad(`products[${i}].coef must be a positive finite number (got ${show(p.coef)})`);
      });
      product = spec.product === undefined || spec.product === null ? 0 : spec.product;
      if (!Number.isInteger(product) || product < 0 || product >= spec.products.length) throw bad(`product ${show(product)} is not an index into products`);
      products = spec.products;
    }
    if (view === 'product' && !products) throw bad("view 'product' needs products");
    let fill = null;
    if (spec.fill !== undefined && spec.fill !== null) {
      if (!isNum(spec.fill) || spec.fill < 0) throw bad(`fill must be a finite number >= 0 (got ${show(spec.fill)})`);
      fill = spec.fill;
    }
    let mark = null;
    if (spec.mark !== undefined && spec.mark !== null) {
      const pick = typeof spec.mark === 'object' ? spec.mark.pick : undefined;
      if (pick !== 0 && pick !== 1 && pick !== 'tie') throw bad(`mark.pick must be 0, 1 or 'tie' (got ${show(pick)})`);
      mark = { pick };
    }
    return { reactants: rs, products, product, view, fill, mark,
             anchor: spec.anchor === 0 || spec.anchor === 1 ? spec.anchor : 'auto',
             scale: spec.scale !== false };
  }

  function build(s) {
    const rs = s.reactants;
    const b = rs.map(r => r.moles / r.coef);
    if (!b.every(x => isNum(x) && x > 0)) throw bad('amounts are out of range (moles / coef is 0 or not finite)');
    const tol = EPS * Math.max(b[0], b[1], 1e-30);               // same test as computeLimiting
    const tie = Math.abs(b[0] - b[1]) <= tol;
    const limiting = tie ? 'tie' : (b[0] < b[1] ? 0 : 1);
    const auto = rs[0].coef !== rs[1].coef ? (rs[0].coef > rs[1].coef ? 0 : 1)
               : rs[0].moles !== rs[1].moles ? (rs[0].moles > rs[1].moles ? 0 : 1) : 0;
    const fitted = s.view === 'leftover' || s.view === 'product';
    const anchor = fitted ? (tie ? auto : limiting) : (s.anchor === 'auto' ? auto : s.anchor);
    const k = b[anchor];
    const groups = rs.map((r, i) => {
      let balls, status;
      if (i === anchor || Math.abs(b[i] - b[anchor]) <= tol) { balls = r.coef; status = 'match'; }
      else { balls = r.moles / k; status = b[i] < b[anchor] ? 'short' : 'extra'; }
      const extraBalls = status === 'extra' ? balls - r.coef : 0;
      const shortBalls = status === 'short' ? r.coef - balls : 0;
      return { index: i, coef: r.coef, moles: r.moles, batches: b[i], balls, need: r.coef, status,
               limiting: limiting === i, extraBalls, shortBalls,
               extraMoles: status === 'extra' ? r.moles - r.coef * k : 0, shortMoles: shortBalls * k };
    });
    const m = { view: s.view, anchor, k, limiting, tie, groups };
    if (s.products) {
      const p = s.products[s.product];
      const moles = p.coef * Math.min(b[0], b[1]);               // n(P) = n(L) * c(P) / c(L)
      const balls = anchor === limiting || tie ? p.coef : moles / k;
      const over = s.fill !== null && s.fill > 1 + EPS;
      m.product = { index: s.product, coef: p.coef, balls, moles, fill: s.fill,
                    filled: s.fill === null ? null : Math.min(s.fill, 1) * balls, over };
    }
    if (s.mark) m.mark = { pick: s.mark.pick, answer: limiting, correct: s.mark.pick === limiting };
    if (!finite(m) || !groups.every(g => g.balls > 0)) throw bad('amounts are out of range (a ball count is 0 or not finite)');
    return m;
  }

  function model(spec) { return build(normalise(spec)); }

  /* ---- the sentence for aria-label --------------------------------------------- */
  function sentence(m, s, withScale, num) {
    const f = s.reactants.map((r, i) => plain(formula(r, i ? 'B' : 'A'))), g = m.groups, pct = x => num(x * 100) + ' %';
    const needs = `Equation needs ${num(g[0].need)} ${f[0]} and ${num(g[1].need)} ${f[1]}.`;
    const has = ` You have ${num(g[0].balls)} ${f[0]} and ${num(g[1].balls)} ${f[1]}.`;
    const scale = withScale ? ` 1 ball = ${num(m.k)} mol.` : '';
    let out;
    if (m.view === 'need') out = needs;
    else if (m.view === 'have') out = needs + has + scale;
    else if (m.view === 'compare') {
      const parts = g.filter(x => x.status !== 'match').map(x => x.status === 'short' ? `${f[x.index]} is short.` : `${f[x.index]} has extra.`);
      out = needs + has + ' ' + (m.tie ? 'Both match.' : parts.join(' ')) + scale;
    } else {
      const L = m.tie ? -1 : m.limiting;
      out = m.tie ? 'Both reactants are used up.' : `${f[L]} runs out first.`;
      if (m.view === 'leftover') {
        const x = m.tie ? null : g[1 - L];
        out += m.tie ? ' Nothing is left.' : ` ${f[x.index]}: ${num(x.need)} used, ${num(x.extraBalls)} left over, ${num(x.extraMoles)} mol.`;
      } else {
        const p = m.product, name = plain(formula(s.products[p.index], 'P'));
        out += ` ${name}: ${num(p.balls)} ${p.balls === 1 ? 'ball' : 'balls'} possible`;
        out += p.fill === null ? '.' : p.over ? `, ${num(p.fill * 100)} % made, more than possible.` : `, ${num(p.filled)} made, ${pct(p.fill)}.`;
      }
      out += scale;
    }
    if (m.mark) {
      const who = m.mark.pick === 'tie' ? 'Neither' : f[m.mark.pick];
      out += ` You picked ${who}: ${m.mark.correct ? 'correct' : 'not quite'}.`;
    }
    return out;
  }

  function describe(spec, opts) {
    const s = normalise(spec), o = options(opts);
    return sentence(build(s), s, s.scale && s.view !== 'need', x => num(x, o.sf));
  }

  /* ---- ball slots -------------------------------------------------------------------
     A row of balls is a list of runs ({k, n}) so a huge group never allocates
     thousands of objects. k: ghost | solid | miss | extra | part | xpart. */
  function split(x) {
    let whole = Math.floor(x + EPS), frac = x - whole;
    if (frac < EPS && (whole > 0 || !(x > 0))) frac = 0;      // float noise beside a whole number; a tiny positive amount keeps its sliver
    return { whole, frac };
  }
  const run = (k, n) => ({ k, n });
  const partial = (k, f) => ({ k, n: 1, f });

  function needRuns(g) { return [run('ghost', Math.ceil(g.need - EPS))]; }
  function haveRunsNeutral(g) {
    const t = split(g.balls);
    return [run('solid', t.whole)].concat(t.frac ? [partial('part', t.frac)] : []);
  }
  function haveRunsVerdict(g) {
    const need = Math.ceil(g.need - EPS);
    if (g.status === 'match') return [run('solid', need)];
    if (g.status === 'short') {
      const t = split(g.balls);
      return [run('solid', t.whole)].concat(t.frac ? [partial('part', t.frac)] : [], [run('miss', need - t.whole - (t.frac ? 1 : 0))]);
    }
    const x = split(g.extraBalls);
    return [run('solid', need), run('extra', x.whole)].concat(x.frac ? [partial('xpart', x.frac)] : []);
  }
  function productRuns(p) {
    const need = Math.ceil(p.balls - EPS);
    if (p.filled === null) return [run('ghost', need)];
    const t = split(p.filled);
    return [run('solid', t.whole)].concat(t.frac ? [partial('part', t.frac)] : [], [run('ghost', need - t.whole - (t.frac ? 1 : 0))]);
  }

  // runs -> at most CAP slots, plus how many more there were
  function expand(runs) {
    const slots = [];
    let total = 0;
    runs.forEach(r => {
      if (!(r.n > 0)) return;
      total += r.n;
      for (let i = Math.min(r.n, CAP - slots.length); i > 0; i--) slots.push(r);
    });
    return { slots, more: total - slots.length };
  }
  const WIDE = 5;                  // most balls in one row of a group; more wrap into rows (25 = 5 x 5), so two columns fit a phone
  const colsFor = n => n <= WIDE ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / WIDE));

  /* ---- SVG --------------------------------------------------------------------------- */
  const r2 = x => Math.round(x * 100) / 100;
  // the part of a circle left of a vertical chord, f of the way across
  function segment(cx, cy, r, f) {
    const x0 = cx - r + 2 * r * f, dx = x0 - cx, h = Math.sqrt(Math.max(0, r * r - dx * dx));
    return `M${r2(x0)} ${r2(cy - h)}A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 0 ${r2(x0)} ${r2(cy + h)}Z`;
  }
  function ball(sl, cx, cy) {
    const circle = k => `<circle class="rv-b rv-b--${k}" cx="${cx}" cy="${cy}" r="${RAD}"/>`;
    if (sl.k !== 'part' && sl.k !== 'xpart') return circle(sl.k);
    const f = Math.min(PART_MAX, Math.max(PART_MIN, sl.f));
    return `<g class="rv-part">${circle('miss')}<path class="rv-b rv-b--${sl.k === 'part' ? 'solid' : 'extra'}" d="${segment(cx, cy, RAD, f)}"/></g>`;
  }
  function svg(slots, cols) {
    const w = Math.min(cols, slots.length), h = Math.ceil(slots.length / cols);
    const inner = slots.map((sl, i) => ball(sl, (i % cols) * PITCH + PITCH / 2, Math.floor(i / cols) * PITCH + PITCH / 2)).join('');
    return `<svg class="rv-svg" viewBox="0 0 ${w * PITCH} ${h * PITCH}" style="--c:${w}" aria-hidden="true" focusable="false">${inner}</svg>`;
  }

  /* ---- markup -------------------------------------------------------------------------- */
  const ICON = {
    check: '<svg class="rv-ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 8.6l3.2 3.1L13 4.6"/></svg>',
    cross: '<svg class="rv-ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8"/></svg>'
  };
  const nw = t => `<span class="rv-nw">${t}</span>`;
  const formula = (x, fallback) => x && x.html !== undefined && x.html !== null && String(x.html) !== '' ? String(x.html) : fallback;

  /* what each view draws, per column: tone, head, and one cell per row of balls
     (a cell = runs of balls + the number and tags that caption them) */
  function plan(m, s, num) {
    const view = m.view, rs = s.reactants;
    const verdict = view !== 'need' && view !== 'have';
    const single = view === 'leftover' || view === 'product';     // one row of balls per column
    const cols = [0, 1].map(i => {
      const g = m.groups[i], cells = [];
      const tone = !verdict || m.tie ? (i ? 'b' : 'a') : (g.limiting ? 'lim' : 'exc');
      if (!single) cells.push({ key: 'need', label: 'Need', runs: needRuns(g), num: g.need, tags: [] });
      if (view !== 'need') {
        let tag = null;
        if (view === 'compare') tag = g.status === 'match' ? { kind: 'match', text: ICON.check } : { kind: g.status, text: g.status };
        else if (single) tag = g.status === 'match' ? { kind: 'match', text: ICON.check }
          : { kind: 'used', text: 'used' };
        // fitted views: the excess reads "2 used" then "11.7 left over" (its balls, not the total next to a "left over" tag)
        const extra = single && g.status !== 'match'
          ? { num: g.extraBalls, tags: [{ kind: 'left', text: 'left over', amount: view === 'leftover' ? num(g.extraMoles) + ' mol' : '' }] } : null;
        cells.push({ key: 'have', label: single ? '' : 'Have', runs: verdict ? haveRunsVerdict(g) : haveRunsNeutral(g),
                     num: extra ? g.need : g.balls, tags: tag ? [tag] : [], extra });
      }
      return { index: i, tone, op: i ? '+' : '', html: formula(rs[i], i ? 'B' : 'A'), recipe: g.need, cells };
    });
    if (view === 'product') {
      const p = m.product;
      cols.push({ index: 2, tone: 'prod', op: '→', html: formula(s.products[p.index], 'P'), recipe: p.balls,
                  cells: [{ key: 'prod', label: '', runs: productRuns(p), num: p.balls, tags: [], product: p }] });
    }
    return cols;
  }

  const tagHtml = t => `<span class="rv-tag rv-tag--${t.kind}">${t.kind === 'match' ? t.text : nw(t.text)}</span>` +
    (t.amount ? `<span class="rv-amt">${nw(t.amount)}</span>` : '');

  function captionHtml(c, num) {
    const pct = x => num(x * 100) + ' %';
    if (c.product) {
      const p = c.product;
      let out = `<div class="rv-cap"><span class="rv-n">${num(p.balls)}</span><span class="rv-tag rv-tag--theo">theoretical</span></div>`;
      if (p.fill !== null) out += `<div class="rv-cap"><span class="rv-n">${nw(p.over ? '&gt; 100 %' : pct(p.fill))}</span><span class="rv-tag rv-tag--act">actual</span></div>`;
      return out;
    }
    return `<div class="rv-cap"><span class="rv-n">${num(c.num)}</span>${c.tags.map(tagHtml).join('')}</div>` +
      (c.extra ? `<div class="rv-cap"><span class="rv-n">${num(c.extra.num)}</span>${c.extra.tags.map(tagHtml).join('')}</div>` : '');
  }

  function colHtml(col, marks, num) {
    const mk = marks[col.index];
    const head = `<div class="rv-head">${col.op ? `<span class="rv-op" aria-hidden="true">${col.op}</span>` : ''}<span class="rv-f">${col.html}</span>` +
      (mk ? `<span class="rv-mark rv-mark--${mk}">${mk === 'ok' ? ICON.check : ICON.cross}</span>` : '') + `</div>`;
    const body = col.cells.map(c => {
      const chip = c.more > 0 ? `<span class="rv-more" aria-hidden="true">+${num(c.more)}</span>` : '';
      return `<div class="rv-cell" data-rv-row="${c.key}">${c.label ? `<span class="rv-rowlab">${c.label}</span>` : ''}` +
        `<div class="rv-balls">${svg(c.slots, col.lattice)}${chip}</div>${captionHtml(c, num)}</div>`;
    }).join('');
    return `<div class="rv-col rv-tone--${col.tone}" data-rv-col="${col.index}" style="--rv-rows:${1 + col.cells.length}">${head}${body}</div>`;
  }

  const scaleHtml = (m, num) => `<span class="rv-scale"><i class="rv-dot" aria-hidden="true"></i>${nw('1 ball = <b>' + num(m.k) + '</b> mol')}</span>`;
  function fitHtml(m, s) {
    const btn = i => `<button type="button" class="rv-seg__btn" data-rv-fit="${i}" aria-pressed="${m.anchor === i}">${formula(s.reactants[i], i ? 'B' : 'A')}</button>`;
    return `<div class="rv-fit" role="group" aria-label="Fit to"><span class="rv-fit__lab" aria-hidden="true">Fit to</span><span class="rv-seg">${btn(0)}${btn(1)}</span></div>`;
  }


  /* ---- ELI5: the "explain it like I'm 5" dialogue ------------------------------------
     eli5(m, s, fmt) -> { title, html }: plain-language steps for the view on screen, with the
     picture's own numbers filled in. html is built from static text and the app's formula
     markup only. The dialogue itself is made by openHelp() when the learner presses the "i". */
  const SYM = { ghost: '<span class="rv-key rv-key--ghost" aria-hidden="true"></span>', solid: '<span class="rv-key rv-key--solid" aria-hidden="true"></span>',
                dash: '<span class="rv-key rv-key--dash" aria-hidden="true"></span>' };
  function eli5(m, s, fmt) {
    const f = s.reactants.map((r, i) => nw(formula(r, i ? 'B' : 'A'))), g = m.groups;
    const li = m.tie ? -1 : m.limiting, ex = li === 0 ? 1 : 0;
    const P = t => '<p>' + t + '</p>';
    const L = items => '<ul>' + items.map(t => '<li>' + t + '</li>').join('') + '</ul>';
    const H = t => '<h4>' + t + '</h4>';
    const recipe = P(`Think of the equation as a <b>recipe</b>. It says: for every <b>${fmt(g[0].need)}</b> of ${f[0]} you need <b>${fmt(g[1].need)}</b> of ${f[1]}.`);
    const scale = P(`Moles are hard to compare, so we turn them into <b>balls</b> that all use the same size. Here <b>1 ball = ${nw(fmt(m.k) + ' mol')}</b>. We find it by dividing one reactant's moles by its coefficient (the amount in one batch of the recipe). Then <b>balls = moles ÷ size of 1 ball</b>.`);
    const sandwich = P(`<b>Sandwich idea:</b> 2 slices of bread + 1 slice of cheese make 1 sandwich. With 10 slices of bread but only 3 slices of cheese, the cheese runs out first, so the cheese <i>limits</i> how many sandwiches you can make. The bread that is left over just sits there.`);
    let title, body;
    if (m.view === 'need') {
      title = 'What the equation needs';
      body = recipe + L([`${SYM.ghost} An <b>empty (outlined) ball</b> is one serving the recipe asks for.`,
        `The ratio <b>${nw(g.map(x => fmt(x.need)).join(' : '))}</b> is the shopping list. Nothing has been used yet.`]) +
        P('<b>Remember:</b> the balanced equation tells you the <i>ratio</i>, not how much you actually have.');
    } else if (m.view === 'have') {
      title = 'What you really have';
      body = P(`Now count what is in your hands. You have <b>${nw(fmt(g[0].moles) + ' mol')}</b> of ${f[0]} and <b>${nw(fmt(g[1].moles) + ' mol')}</b> of ${f[1]}.`) + scale +
        L([`${SYM.solid} A <b>solid ball</b> is what you have. A part-filled ball is part of a serving.`,
           `${SYM.ghost} The empty balls are the recipe, for you to compare against.`]) +
        P(`You have <b>${nw(g.map(x => fmt(x.balls)).join(' : '))}</b> balls, and the recipe wants <b>${nw(g.map(x => fmt(x.need)).join(' : '))}</b>.`) +
        P('<b>Remember:</b> same-size balls let you compare two different substances fairly.');
    } else if (m.view === 'compare') {
      title = 'Which one runs out first?';
      const verdict = m.tie ? P(`Here both match the recipe exactly, so <b>neither</b> runs out first. Everything gets used up.`)
        : P(`Here ${f[li]} has <b>fewer balls than the recipe wants</b>, so it runs out first. That makes ${f[li]} the <b>limiting reactant</b>.`);
      body = P('Put what you <b>need</b> next to what you <b>have</b>, one reactant at a time.') + scale +
        L([`${SYM.dash} A <b>dashed ball</b> is missing (tag <i>short</i>) or not needed (tag <i>extra</i>).`,
           'A tick <b>✓</b> means exactly enough.',
           'The reactant that is <b>short</b> is the one that runs out first.']) + verdict + sandwich;
    } else if (m.view === 'leftover') {
      title = 'What is left over?';
      body = P('The limiting reactant gets <b>completely used up</b>. The other reactant only uses as many balls as the recipe allows.') +
        (m.tie ? P('Here both are used up, so there is <b>nothing left over</b>.')
          : P(`${f[li]} is all used. ${f[ex]} has <b>${fmt(g[ex].extraBalls)}</b> ball${g[ex].extraBalls === 1 ? '' : 's'} that never get used. That is <b>${nw(fmt(g[ex].extraMoles) + ' mol')}</b> left over.`)) +
        L([`${SYM.solid} <b>Solid balls</b> are used in the reaction.`, `${SYM.dash} <b>Dashed balls</b> tagged <i>left over</i> are what is still in the flask.`]) +
        P('<b>Remember:</b> the limiting reactant decides how much reacts; the other one is the leftover.');
    } else {
      const pr = m.product, pf = pr && pr.fill !== null;
      title = 'How much product do we get?';
      body = P(`When the limiting reactant is fully used, the recipe tells us how many product balls we <i>could</i> make. That is the <b>theoretical yield</b>: <b>${fmt(pr.balls)}</b> ball${pr.balls === 1 ? '' : 's'} (${nw(fmt(pr.moles) + ' mol')}).`) +
        L([`${SYM.ghost} <b>Outlined balls</b> = the most you could ever make (theoretical).`,
           `${SYM.solid} <b>Solid balls</b> = what you really got (actual).`]) +
        (pf ? P(`Here you got <b>${nw(pr.over ? 'more than 100 %' : fmt(pr.fill * 100) + ' %')}</b> of the possible product. That is the <b>percent yield</b>.`) : '') +
        P('<b>Percent yield = actual ÷ theoretical × 100.</b> Real life loses a little product (spills, side reactions), so the actual yield is usually less than 100 %.') +
        P('<b>Remember:</b> theoretical = the best case on paper; actual = what the flask really gave you.');
    }
    return { title, html: body };
  }

  const HELP_BTN = '<button type="button" class="rv-help" data-rv-help aria-haspopup="dialog">' +
    '<span class="rv-help__i" aria-hidden="true">i</span><span class="rv-help__t">ELI5</span><span class="rv-sr"> Explain this picture simply</span></button>';

  /* "How moles become balls", written out: why we divide by the coefficient, then each reactant's balls.
     Shown for views 'have' and 'compare' when opts.working is set. */
  function workHtml(m, s, fmt) {
    const a = m.anchor, ga = m.groups[a], fa = nw(formula(s.reactants[a], a ? 'B' : 'A'));
    const lines = m.groups.map(g => {
      const f = nw(formula(s.reactants[g.index], g.index ? 'B' : 'A'));
      return `<li>${f}: ${nw(fmt(g.moles) + ' mol')} ÷ ${nw(fmt(m.k) + ' mol')} = <b>${nw(fmt(g.balls) + (g.balls === 1 ? ' ball' : ' balls'))}</b></li>`;
    }).join('');
    return `<div class="rv-work"><p class="rv-work__h">How moles become balls</p>` +
      `<p class="rv-work__p"><b>Why divide?</b> The equation uses <b>${fmt(ga.coef)}</b> ${fa} in one batch of the reaction, so n ÷ ${fmt(ga.coef)} is the amount in <i>one</i> batch. We call that <b>1 ball</b>.</p>` +
      `<ol class="rv-work__l"><li><b>Size of 1 ball:</b> n(${fa}) ÷ ${fmt(ga.coef)} = ${nw(fmt(ga.moles) + ' mol')} ÷ ${fmt(ga.coef)} = <b>${nw(fmt(m.k) + ' mol')}</b></li>` +
      `<li><b>Balls you have:</b> moles ÷ size of 1 ball<ul>${lines}</ul></li></ol></div>`;
  }

  function render(s, m, o) {
    const fmt = x => num(x, o.sf);                                    // every number in the picture, to o.sf figures
    const cols = plan(m, s, fmt);
    cols.forEach(col => {
      col.cells.forEach(c => { const e = expand(c.runs); c.slots = e.slots; c.more = e.more; });
      // one lattice per column, so a reactant's Need and Have balls line up; a recipe of up to WIDE balls keeps a row to itself
      col.lattice = Math.max(colsFor(Math.max.apply(null, col.cells.map(c => c.slots.length))), col.recipe <= WIDE ? col.recipe : 0);
    });
    const maxCols = Math.max.apply(null, cols.map(col => col.lattice));
    const marks = {};
    let pick = '';
    if (m.mark) {
      const ok = m.mark.correct ? 'ok' : 'no';
      if (m.mark.pick === 'tie') pick = `<div class="rv-pick rv-pick--${ok}"><span>Neither</span><span class="rv-mark rv-mark--${ok}">${m.mark.correct ? ICON.check : ICON.cross}</span></div>`;
      else marks[m.mark.pick] = ok;
    }
    const ratio = (label, vals) => `<span class="rv-sum__i"><span class="rv-sum__l">${label}</span><span class="rv-sum__v">${nw(vals.map(v => fmt(v)).join(' : '))}</span></span>`;
    const sum = m.view === 'need' || m.view === 'have' || m.view === 'compare'
      ? `<div class="rv-sum">${ratio('Need', m.groups.map(g => g.need))}${m.view === 'need' ? '' : ratio('Have', m.groups.map(g => g.balls))}</div>` : '';
    const withScale = s.scale && m.view !== 'need';
    const withFit = o.fitControl && (m.view === 'have' || m.view === 'compare');
    const bar = withScale || withFit ? `<div class="rv-bar">${withScale ? scaleHtml(m, fmt) : ''}${withFit ? fitHtml(m, s) : ''}</div>` : '';
    const withWork = o.working && (m.view === 'have' || m.view === 'compare');
    const live = withFit ? '<span class="rv-live" aria-live="polite"></span>' : '';
    const pic = `<div class="rv-pic" role="img" aria-label="${esc(sentence(m, s, withScale, fmt))}" style="--rv-max:${maxCols}">` +
      pick + `<div class="rv-cols">${cols.map(col => colHtml(col, marks, fmt)).join('')}</div>` + sum + `</div>`;
    return `<div class="rv rv--${o.size} rv--${m.view}" data-rv-view="${m.view}" data-rv-anchor="${m.anchor}" data-rv-limiting="${m.limiting}"><div class="rv-top">${HELP_BTN}</div>${pic}${bar}${withWork ? workHtml(m, s, fmt) : ''}${live}</div>`;
  }

  function options(opts) {
    opts = opts || {};
    return { fitControl: !!opts.fitControl, working: !!opts.working, onFit: opts.onFit, animate: opts.animate !== false, size: opts.size === 'sm' ? 'sm' : 'md',
             sf: Number.isInteger(opts.sf) && opts.sf >= 1 && opts.sf <= 8 ? opts.sf : 3,
             delay: typeof opts.delay === 'number' && opts.delay > 0 && isFinite(opts.delay) ? opts.delay : 0 };
  }

  function html(spec, opts) {
    let s, m;
    try { s = normalise(spec); m = build(s); } catch (e) { if (isInputError(e)) return ''; throw e; }
    return render(s, m, options(opts));
  }

  /* ---- DOM: mount, fit control, entrance --------------------------------------------- */
  const wired = typeof WeakMap === 'function' ? new WeakMap() : null;

  function play(el, delay) {
    const M = root && root.Motion;
    if (!M || typeof M.stagger !== 'function' || typeof M.enter !== 'function') return;
    try {
      const rv = el.querySelector('.rv');
      if (!rv) return;
      const heads = rv.querySelectorAll('.rv-head');
      if (heads.length) M.stagger(heads, { y: 4, duration: 'base', gap: 60, delay });
      let t = delay + 140;
      ['need', 'have', 'prod'].forEach(key => {
        const cells = rv.querySelectorAll(`.rv-cell[data-rv-row="${key}"]`);
        if (!cells.length) return;
        let longest = 0;
        cells.forEach(c => {
          const balls = c.querySelectorAll('.rv-svg > *');
          const gap = Math.max(14, Math.min(70, Math.round(700 / Math.max(balls.length, 1))));
          longest = Math.max(longest, (balls.length - 1) * gap);
          M.stagger(balls, { y: 0, scale: 0.6, duration: 'base', gap, delay: t });
          const late = c.querySelectorAll('.rv-more, .rv-cap');
          M.stagger(late, { y: 4, duration: 'base', gap: 40, delay: t + (balls.length - 1) * gap + 80 });
        });
        t += longest + 420;
      });
      const tail = rv.querySelectorAll('.rv-sum, .rv-bar, .rv-pick');
      if (tail.length) M.stagger(tail, { y: 4, duration: 'base', gap: 60, delay: t });
    } catch (e) { /* the picture is already in place; motion is a nicety */ }
  }


  /* ---- the ELI5 dialogue: one <dialog> for the page, filled on demand ------------------ */
  let helpDlg = null;
  function openHelp(opener, s, anchor, o) {
    if (typeof document === 'undefined') return;
    let content;
    try { const s2 = {}; Object.keys(s).forEach(k => { s2[k] = s[k]; }); s2.anchor = anchor; content = eli5(build(s2), s2, x => num(x, o.sf)); } catch (e) { return; }
    if (!helpDlg) {
      helpDlg = document.createElement('dialog');
      helpDlg.className = 'rv-dialog';
      helpDlg.setAttribute('aria-labelledby', 'rv-dlg-title');
      helpDlg.innerHTML = '<div class="rv-dialog__card"><div class="rv-dialog__head"><div><span class="rv-dialog__eyebrow">Explain it like I\'m 5</span>' +
        '<h3 id="rv-dlg-title" class="rv-dialog__title"></h3></div>' +
        '<button type="button" class="rv-dialog__x" data-rv-close aria-label="Close">' + ICON.cross + '</button></div>' +
        '<div class="rv-dialog__body"></div>' +
        '<div class="rv-dialog__foot"><button type="button" class="btn btn--primary rv-dialog__ok" data-rv-close>Got it</button></div></div>';
      helpDlg.addEventListener('click', ev => {
        const t = ev.target;
        if (t === helpDlg || (t.closest && t.closest('[data-rv-close]'))) closeHelp();     // the backdrop or a close button
      });
      helpDlg.addEventListener('close', () => { const b = helpDlg._opener; helpDlg._opener = null; if (b && b.focus) try { b.focus(); } catch (e) { /* gone */ } });
      document.body.appendChild(helpDlg);
    }
    helpDlg.querySelector('.rv-dialog__title').textContent = content.title;
    helpDlg.querySelector('.rv-dialog__body').innerHTML = content.html;
    helpDlg._opener = opener;
    if (typeof helpDlg.showModal === 'function') { if (!helpDlg.open) helpDlg.showModal(); } else helpDlg.setAttribute('open', '');
    const ok = helpDlg.querySelector('.rv-dialog__ok'); if (ok && ok.focus) ok.focus();
  }
  function closeHelp() {
    if (!helpDlg) return;
    if (typeof helpDlg.close === 'function') helpDlg.close(); else { helpDlg.removeAttribute('open'); helpDlg.dispatchEvent(new Event('close')); }
  }

  function mount(el, spec, opts) {
    if (!el) return null;
    const o = options(opts);
    let s, m;
    try { s = normalise(spec); m = build(s); } catch (e) {
      if (isInputError(e)) { el.innerHTML = ''; return null; }
      throw e;
    }
    el.innerHTML = render(s, m, o);
    if (wired && wired.has(el)) { el.removeEventListener('click', wired.get(el)); wired.delete(el); }
    const canFit = o.fitControl && (m.view === 'have' || m.view === 'compare');
    let current = m.anchor;
    const onClick = ev => {
      const tg = ev.target && ev.target.closest ? ev.target : null;
      if (!tg) return;
      const h = tg.closest('[data-rv-help]');
      if (h && el.contains(h)) { openHelp(h, s, current, o); return; }
      const t = canFit ? tg.closest('[data-rv-fit]') : null;
      if (!t || !el.contains(t)) return;
      const i = Number(t.getAttribute('data-rv-fit'));
      if (i === current) return;
      current = i;
      const next = refit(el, s, i, o);
      if (typeof o.onFit === 'function') o.onFit(i, next);
    };
    el.addEventListener('click', onClick);
    if (wired) wired.set(el, onClick);
    if (o.animate) play(el, o.delay);
    return m;
  }

  // redraw the picture and the scale label for a new anchor; the control (and its focus) stays put
  function refit(el, s, anchor, o) {
    const s2 = {}; Object.keys(s).forEach(k => { s2[k] = s[k]; });
    s2.anchor = anchor;
    const m = build(s2);
    const tpl = document.createElement('div');
    tpl.innerHTML = render(s2, m, o);
    const fresh = tpl.firstElementChild, rv = el.querySelector('.rv');
    if (!fresh || !rv) return m;
    const pic = rv.querySelector('.rv-pic'), scale = rv.querySelector('.rv-scale');
    if (pic) pic.replaceWith(fresh.querySelector('.rv-pic'));
    const work = rv.querySelector('.rv-work');
    if (work && fresh.querySelector('.rv-work')) work.replaceWith(fresh.querySelector('.rv-work'));
    if (scale && fresh.querySelector('.rv-scale')) scale.replaceWith(fresh.querySelector('.rv-scale'));
    ['data-rv-anchor', 'data-rv-limiting'].forEach(a => rv.setAttribute(a, fresh.getAttribute(a)));
    rv.querySelectorAll('[data-rv-fit]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-rv-fit')) === m.anchor)));
    const live = rv.querySelector('.rv-live'), now = rv.querySelector('.rv-pic');
    if (live && now) live.textContent = now.getAttribute('aria-label');
    return m;
  }

  // the ELI5 text for a spec, pure like model(): { title, html } ('' title and html for an invalid spec)
  function explain(spec, opts) {
    let s, m;
    try { s = normalise(spec); m = build(s); } catch (e) { if (isInputError(e)) return { title: '', html: '' }; throw e; }
    const o = options(opts);
    return eli5(m, s, x => num(x, o.sf));
  }

  const api = { model, html, mount, describe, explain };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RatioVis = api;
})(typeof window !== 'undefined' ? window : null);
