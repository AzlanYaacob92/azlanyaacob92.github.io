/* ============================================================================
   practice.js  —  Practice questions for the yield trainer (no DOM, pure)
   Turns a Generator scenario into one yield question and grades the answer.
   Loaded after chemistry.js and generator.js (classic script, works over
   file://); exposes the global `Practice`. Under Node:
     const Practice = require('./practice.js');

   API
     Practice.make({ level, rng, avoid }) → problem
       level  'moles' | 'grams' | 'mixed'    default 'mixed'
       rng    () => number in [0, 1)         default Math.random; Generator.rng(seed) is deterministic
       avoid  [q.id, …]                      reactions to skip, e.g. the last five shown
       problem = {
         id, level, q, scenario,             // q: the QUAL entry · scenario: what Generator.make() returned
         limiting,                           // the answer to "which one runs out first?": 0 (q.A) | 1 (q.B) | 'tie'
         prodIdx, target, unit, cond,        // the yield question: target 'theoretical' | 'percent' | 'actual',
                                             //   unit 'mol' | 'mass' | 'gas' (cond 'RTP' | 'STP' matters for gas)
         inA, inB,                           // the two amounts as the wizard's input objects (Generator.toInput)
         known: { actual, percent },         // the stated figure as printed ('16.6', '75'); the other one is ''
         expected,                           // the answer, in unitLabel
         unitLabel                           // 'mol' | 'g' | 'dm³' | '%'
       }
       A problem has the shape solveProblem() (chemistry.js) takes, so Learn shows the very same numbers.
       Every expected value comes from solveYield(); nothing is worked out a second way.
     Practice.grade(problem, text) → { valid, value, ok, slip }
       valid  false when text is not a number · ok  the answer is right · slip  one short line, or ''
       A number is right when it is within 1 % of expected, or when expected rounded to the learner's own
       number of significant figures (two or more) is what they typed.
     Practice.slips(problem) → [{ say, value }]   the wrong answers a classic slip gives, in the order they are tried
     Practice.parse(text) · Practice.sigFigs(text) · Practice.matches(text, expected) · Practice.fixed(x, sf)
     Practice.question(scenario, level, rng) → problem | null   one scenario, one question (null: nothing sensible to ask)
   ========================================================================== */

const Practice = (() => {
  'use strict';

  /* ---- Engine ---------------------------------------------------------------
     Node: chemistry.js and generator.js are required. Browser: both are loaded
     first and their top-level names are already global. Everything is read
     through E, so no local name shadows a global the browser branch needs. */
  const E = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? Object.assign({ Generator: require('./generator.js') }, require('./chemistry.js'))
    : { Generator, molesToAmount, solveYield, solveProblem, UNIT_LABEL };
  const G = E.Generator;

  /* ---- What each level asks ------------------------------------------------- */
  const UNITS = { moles: ['mol'], grams: ['g'], mixed: ['mol', 'g', 'dm3'] };            // Generator.yields() names
  const TARGETS = { moles: ['theoretical'], grams: ['theoretical', 'percent'], mixed: ['theoretical', 'percent', 'actual'] };
  const UNIT_OF = { mol: 'mol', g: 'mass', dm3: 'gas' };                                  // → the wizard's unit names
  const UNIT_WEIGHT = { g: 3, mol: 2, dm3: 3 };                                           // Mixed: grams and gases most often
  const PERCENTS = [45, 50, 55, 60, 62, 65, 68, 70, 72, 75, 78, 80, 82, 85, 88, 90, 92, 95];   // "actual" problems state one of these
  const SHARE = { min: 0.35, max: 0.995 };                                                 // a stated actual yield is this share of the theoretical

  /* ---- small helpers ---------------------------------------------------------- */
  const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
  function pickW(items, weight, r) {
    const ws = items.map(weight);
    let t = r() * ws.reduce((s, w) => s + w, 0);
    for (let i = 0; i < items.length; i++) { t -= ws[i]; if (t < 0) return items[i]; }
    return items[items.length - 1];
  }
  const roundSf = (x, n) => Number(x.toPrecision(n));
  // n significant figures in fixed notation, trailing zeros kept: 12.0  0.250  480  0.0500
  function fixed(x, n) {
    const r = roundSf(x, n), e = Math.floor(Math.log10(Math.abs(r)) + 1e-9);
    return r.toFixed(Math.max(0, n - 1 - e));
  }
  const answerOf = (target, y) => (target === 'percent' ? y.percent : target === 'actual' ? y.actual : y.theoretical);

  /* ---- reading what the learner typed ------------------------------------------ */
  // A plain number, a decimal comma and a trailing unit are fine: '26.7', '26,7 g', '62 %'.
  function clean(text) {
    return String(text == null ? '' : text).trim().replace(/\s*(%|g|mol|dm\^?3|dm³)$/i, '').replace(/,/g, '.');
  }
  function parse(text) {
    const t = clean(text);
    return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
  }
  // Significant figures as typed: leading zeros never count, trailing zeros do ('0.500' → 3, '27' → 2, '500' → 3).
  function sigFigs(text) {
    const m = /^[+-]?(\d*\.?\d*)(?:e[+-]?\d+)?$/i.exec(clean(text));
    return m ? m[1].replace('.', '').replace(/^0+/, '').length : 0;
  }
  function matches(text, expected) {
    const x = parse(text);
    if (!isFinite(x) || !isFinite(expected) || expected === 0) return false;
    if (Math.abs(x - expected) <= 0.01 * Math.abs(expected)) return true;
    const sf = sigFigs(text);
    return sf >= 2 && roundSf(expected, Math.min(sf, 21)) === x;
  }

  /* ---- the question ------------------------------------------------------------ */
  function question(sc, level, r) {
    level = UNITS[level] ? level : 'mixed';
    const q = sc.q, res = sc.res;
    // What can be asked: a product with at least one unit this level uses. Water is dull, so it is only
    // asked about when nothing else is on offer.
    let pool = G.yields(sc).filter(y => y.units.some(u => UNITS[level].includes(u)));
    const dry = pool.filter(y => y.sp !== 'H2O');
    if (dry.length) pool = dry;
    if (!pool.length) return null;
    const y0 = pickW(pool, y => (level === 'mixed' && y.units.includes('dm3') ? 2.5 : 1), r);    // a gas volume is worth asking now and then
    const prodIdx = q.products.findIndex(p => p.sp === y0.sp);
    if (prodIdx < 0) return null;
    const prod = q.products[prodIdx];

    const units = y0.units.filter(u => UNITS[level].includes(u) && (u !== 'dm3' || G.species(prod.sp).gas));
    if (!units.length) return null;
    const unit = UNIT_OF[pickW(units, u => UNIT_WEIGHT[u], r)];
    // a gas volume is worked at the problem's own condition when it has one, else either
    const gasGiven = sc.givens.find(g => g.kind === 'gas');
    const cond = gasGiven ? gasGiven.cond : (unit === 'gas' && r() < 0.5 ? 'STP' : 'RTP');
    const target = pick(TARGETS[level], r);

    const theo = E.solveYield(res, prod, 'theoretical', unit, cond, {}).theoretical;
    if (!(isFinite(theo) && theo > 0)) return null;
    const known = { actual: '', percent: '' };
    if (target === 'percent') {
      // An actual yield a student could really have collected, printed to the precision a textbook would use.
      const sf0 = unit === 'mass' || r() < 0.65 ? 3 : 2;
      for (let i = 0; i < 24 && !known.actual; i++) {
        const text = fixed(theo * (40 + Math.floor(r() * 59)) / 100, i < 12 ? sf0 : 3), share = parseFloat(text) / theo;
        if (share >= SHARE.min && share <= SHARE.max) known.actual = text;
      }
      if (!known.actual) return null;
    } else if (target === 'actual') {
      known.percent = String(pick(PERCENTS, r));
    }

    const y = E.solveYield(res, prod, target, unit, cond, { actual: parseFloat(known.actual), percent: parseFloat(known.percent) });
    const expected = answerOf(target, y);
    if (!(isFinite(expected) && expected > 0)) return null;
    return {
      id: q.id, level, q, scenario: sc,
      limiting: res.tie ? 'tie' : (res.limiting === q.A ? 0 : 1),
      prodIdx, target, unit, cond,
      inA: G.toInput(sc.givens[0]), inB: G.toInput(sc.givens[1]),
      known, expected, unitLabel: target === 'percent' ? '%' : E.UNIT_LABEL[unit]
    };
  }

  function make(opts) {
    opts = opts || {};
    const level = G.levels.includes(opts.level) ? opts.level : 'mixed';
    const r = typeof opts.rng === 'function' ? opts.rng : Math.random;
    for (let i = 0; i < 40; i++) {
      const P = question(G.make({ level, rng: r, avoid: opts.avoid }), level, r);
      if (P) return P;
    }
    return question(G.fallback('moles', 'A'), 'moles', r);        // moles always asks something: this cannot be null
  }

  /* ---- slips ------------------------------------------------------------------- */
  // The answers a classic mistake gives, each with its line. Worked through solveYield like the real answer.
  function slips(P) {
    const { res, prod, y } = E.solveProblem(P);
    const known = { actual: parseFloat(P.known.actual), percent: parseFloat(P.known.percent) };
    const ask = (r, pr) => answerOf(P.target, E.solveYield(r, pr, P.target, P.unit, P.cond, known));
    const out = [];
    // the other reactant fixed the yield
    if (!res.tie) out.push({ say: "That's what the other one gives.", value: ask(Object.assign({}, res, { limiting: res.excess, excess: res.limiting }), prod) });
    // n(product) taken as n(limiting): the product behaves as if its coefficient were the limiting reactant's
    const lCoef = (res.limiting || res.A) === res.A ? res.a : res.b;
    if (lCoef !== prod.coef) out.push({ say: 'The mole ratio was skipped.', value: ask(res, { sp: prod.sp, coef: lCoef }) });
    if (P.target === 'percent') {
      out.push({ say: 'Upside down.', value: y.theoretical / y.actual * 100 });
    } else {
      // the right number in another unit
      const n = P.target === 'actual' ? y.nActual : y.nTheo;
      ['mol', 'mass', 'gas'].forEach(u => {
        if (u === P.unit || (u === 'gas' && !G.species(prod.sp).gas)) return;
        out.push({ say: `That's in ${E.UNIT_LABEL[u]}.`, value: E.molesToAmount(n, prod.sp, u, P.cond) });
      });
    }
    return out.filter(s => isFinite(s.value) && s.value > 0);
  }

  function grade(P, text) {
    const value = parse(text);
    if (!isFinite(value)) return { valid: false, value: NaN, ok: false, slip: '' };
    const ok = matches(text, P.expected);
    const hit = ok ? null : slips(P).find(s => matches(text, s.value));
    return { valid: true, value, ok, slip: hit ? hit.say : '' };
  }

  return { make, question, grade, slips, parse, sigFigs, matches, fixed, levels: G.levels.slice() };
})();

/* In the browser Practice is a global (also window.Practice), loaded after chemistry.js and generator.js.
   The module block exists only so test-practice.js can require it under Node. */
if (typeof window !== 'undefined') window.Practice = Practice;
if (typeof module !== 'undefined' && module.exports) module.exports = Practice;
