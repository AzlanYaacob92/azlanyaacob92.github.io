/* Tests for the ratio-ball model and markup — run with `node test-ratiovis.js`.
   The oracle for the limiting-reactant verdict and the leftover amount is
   computeLimiting() in chemistry.js (next to this file, or RV_CHEMISTRY=path).
   Without chemistry.js an equivalent built-in oracle is used. */
const RatioVis = require('./ratiovis.js');

let chem = null;
try { chem = require(process.env.RV_CHEMISTRY || './chemistry.js'); } catch (e) { /* standalone */ }
const haveOracle = !!(chem && chem.computeLimiting);

let fail = 0, total = 0;
const near = (g, w, tol) => Math.abs(g - w) <= tol + 1e-12 * Math.abs(w);
function check(label, got, want, tol = 0) {
  total++;
  const ok = typeof want === 'number' && typeof got === 'number' ? near(got, want, tol)
    : tol && Array.isArray(want) && Array.isArray(got) ? got.length === want.length && want.every((w, i) => near(got[i], w, tol))
    : JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}: ${JSON.stringify(got)} (expected ${JSON.stringify(want)})`); }
  else if (!label.startsWith('.')) console.log(`ok   ${label}: ${JSON.stringify(got)}`);
  return ok;
}
const truthy = (label, v) => check(label, !!v, true);
function throwsRV(label, fn) {
  total++;
  try { fn(); fail++; console.log(`FAIL ${label}: did not throw`); }
  catch (e) { if (e.name === 'RatioVisError' && /^RatioVis: /.test(e.message)) console.log(`ok   ${label}: ${e.message}`); else { fail++; console.log(`FAIL ${label}: wrong error ${e && e.name}: ${e && e.message}`); } }
}

/* ---- helpers ------------------------------------------------------------- */
const R = (html, coef, moles) => ({ html, coef, moles });
const spec = (c0, n0, c1, n1, extra) => Object.assign({ reactants: [R('Al', c0, n0), R('O<sub>2</sub>', c1, n1)] }, extra);
const A2B = (a, b, extra) => ({ reactants: [R('A', 1, a), R('B', 2, b)], view: 'compare' , ...(extra || {}) });
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// the same maths as computeLimiting (chemistry.js), for when it is not available
function builtinOracle(a, b, nA, nB) {
  const ratioA = nA / a, ratioB = nB / b, tol = 1e-9 * Math.max(ratioA, ratioB, 1e-30);
  if (Math.abs(ratioA - ratioB) <= tol) return { limiting: 'tie', leftMol: 0 };
  return ratioA < ratioB ? { limiting: 0, leftMol: nB - nA * (b / a) } : { limiting: 1, leftMol: nA - nB * (a / b) };
}
function oracle(a, b, nA, nB) {
  if (!haveOracle) return builtinOracle(a, b, nA, nB);
  const q = { A: { coef: a, sp: 'H2' }, B: { coef: b, sp: 'O2' } };
  const r = chem.computeLimiting(q, nA, nB);
  return { limiting: r.tie ? 'tie' : (r.limiting === q.A ? 0 : 1), leftMol: r.leftMol };
}
const count = (s, re) => (s.match(re) || []).length;
const elements = h => count(h, /<circle|<path/g);
const label = h => { const m = /aria-label="([^"]*)"/.exec(h); return m ? m[1] : null; };
// the html of column i (0, 1 or 2)
function column(h, i) { const parts = h.split('<div class="rv-col ').slice(1); return parts[i] ? '<div class="rv-col ' + parts[i] : ''; }
const rows = (colHtml, key) => { const m = new RegExp(`data-rv-row="${key}">([\\s\\S]*?)(?=<div class="rv-cell"|$)`).exec(colHtml); return m ? m[1] : ''; };
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.keys(o).forEach(k => deepFreeze(o[k])); } return o; }
function allFinite(o, path = '') {
  if (typeof o === 'number') return Number.isFinite(o) ? [] : [path];
  if (o && typeof o === 'object') return Object.keys(o).reduce((acc, k) => acc.concat(allFinite(o[k], path + '.' + k)), []);
  return [];
}

console.log(`oracle: ${haveOracle ? 'computeLimiting from chemistry.js' : 'built-in (chemistry.js not found)'}`);

/* ---- the user's examples: equation A + 2B ----------------------------------- */
console.log('\n--- the user’s examples (A + 2B) ---');
{
  const m = RatioVis.model(A2B(0.3, 0.6));
  check('0.3 : 0.6 anchors on B (larger coefficient)', m.anchor, 1);
  check('0.3 : 0.6 scale k', m.k, 0.3, 1e-15);
  check('0.3 : 0.6 balls', m.groups.map(g => g.balls), [1, 2]);
  check('0.3 : 0.6 status', m.groups.map(g => g.status), ['match', 'match']);
  check('0.3 : 0.6 is a tie', [m.tie, m.limiting], [true, 'tie']);
  check('0.3 : 0.6 nobody is flagged limiting', m.groups.map(g => g.limiting), [false, false]);
}
{
  const m = RatioVis.model(A2B(0.15, 0.6));
  check('0.15 : 0.6 balls', m.groups.map(g => g.balls), [0.5, 2]);
  check('0.15 : 0.6 k = 0.30 mol/ball', m.k, 0.3, 1e-15);
  check('0.15 : 0.6 anchor', m.anchor, 1);
  check('0.15 : 0.6 A is short, B matches', m.groups.map(g => g.status), ['short', 'match']);
  check('0.15 : 0.6 A is limiting', [m.limiting, m.tie, m.groups.map(g => g.limiting)], [0, false, [true, false]]);
  check('0.15 : 0.6 A is short by half a ball (0.15 mol)', [m.groups[0].shortBalls, m.groups[0].shortMoles], [0.5, 0.15], 1e-15);
  check('0.15 : 0.6 need row', m.groups.map(g => g.need), [1, 2]);
  check('0.15 : 0.6 batches', m.groups.map(g => g.batches), [0.15, 0.3]);
}
{
  const m = RatioVis.model(A2B(0.15, 0.2));
  check('0.15 : 0.2 balls (the "extra" case)', m.groups.map(g => Math.round(g.balls * 1e9) / 1e9), [1.5, 2]);
  check('0.15 : 0.2 A has extra, B matches', m.groups.map(g => g.status), ['extra', 'match']);
  check('0.15 : 0.2 B limits', m.limiting, 1);
  check('0.15 : 0.2 extra half ball = 0.05 mol', [m.groups[0].extraBalls, m.groups[0].extraMoles], [0.5, 0.05], 1e-12);
}
{
  const h = RatioVis.html(spec(1, 0.15, 2, 0.6, { view: 'compare', scale: false }));
  check('aria-label is the sentence from the brief', label(h), 'Equation needs 1 Al and 2 O2. You have 0.5 Al and 2 O2. Al is short.');
  check('aria-label with the scale label', RatioVis.describe(spec(1, 0.15, 2, 0.6, { view: 'compare' })),
    'Equation needs 1 Al and 2 O2. You have 0.5 Al and 2 O2. Al is short. 1 ball = 0.3 mol.');
  check('aria-label, extra case', RatioVis.describe(spec(1, 0.15, 2, 0.2, { view: 'compare', scale: false })), 'Equation needs 1 Al and 2 O2. You have 1.5 Al and 2 O2. Al has extra.');
  check('aria-label, tie', RatioVis.describe(spec(1, 0.3, 2, 0.6, { view: 'compare', scale: false })), 'Equation needs 1 Al and 2 O2. You have 1 Al and 2 O2. Both match.');
  check('aria-label, need view', RatioVis.describe(spec(1, 0.15, 2, 0.6, { view: 'need' })), 'Equation needs 1 Al and 2 O2.');
  check('aria-label, have view has no verdict', RatioVis.describe(spec(1, 0.15, 2, 0.6, { view: 'have', scale: false })), 'Equation needs 1 Al and 2 O2. You have 0.5 Al and 2 O2.');
  truthy('exactly one role="img"', count(h, /role="img"/g) === 1);
  truthy('the ratio is written 1 : 2 and 0.5 : 2', /1 : 2/.test(h) && /0\.5 : 2/.test(h));
}

/* ---- anchor rule ----------------------------------------------------------------- */
console.log('\n--- anchor ---');
{
  const a = (c0, n0, c1, n1, extra) => RatioVis.model(spec(c0, n0, c1, n1, extra)).anchor;
  check('larger coefficient anchors (1, 2)', a(1, 1, 2, 1), 1);
  check('larger coefficient anchors (4, 3)', a(4, 1, 3, 1), 0);
  check('equal coefficients: the larger moles anchors', a(1, 0.2, 1, 0.5), 1);
  check('equal coefficients: the larger moles anchors (other way)', a(1, 0.5, 1, 0.2), 0);
  check('everything equal: reactant 0', a(2, 1, 2, 1), 0);
  check('explicit anchor 0 (have)', a(1, 1, 2, 1, { anchor: 0, view: 'have' }), 0);
  check('explicit anchor 1 (compare)', a(2, 1, 1, 1, { anchor: 1, view: 'compare' }), 1);
  check("anchor: 'auto' = the rule", a(1, 1, 2, 1, { anchor: 'auto' }), 1);
  check('a junk anchor falls back to auto', a(1, 1, 2, 1, { anchor: 7 }), 1);
  const lim0 = spec(1, 0.15, 2, 0.6), lim1 = spec(1, 0.5, 2, 0.2);
  check('leftover ignores the anchor and fits the limiting reactant (0)', RatioVis.model(Object.assign({}, lim0, { view: 'leftover', anchor: 1 })).anchor, 0);
  check('leftover fits the limiting reactant (1)', RatioVis.model(Object.assign({}, lim1, { view: 'leftover', anchor: 0 })).anchor, 1);
  check('product ignores the anchor too', RatioVis.model(Object.assign({}, lim0, { view: 'product', products: [{ html: 'P', coef: 1 }], anchor: 1 })).anchor, 0);
  const m = RatioVis.model(Object.assign({}, lim0, { view: 'compare', anchor: 0 }));
  check('fit to the limiting reactant: it matches, the other has extra', m.groups.map(g => g.status), ['match', 'extra']);
  check('fit to the limiting reactant: the leftover is the extra balls', [m.groups[1].extraBalls, m.groups[1].extraMoles], [2, 0.3], 1e-12);
}

/* ---- property test: 5 000 random specs, every anchor ---------------------------------- */
console.log('\n--- property test ---');
{
  const rng = mulberry32(20260101);
  const pickCoef = () => rng() < 0.7 ? 1 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 25);
  const logU = (lo, hi) => Math.exp(Math.log(lo) + rng() * (Math.log(hi) - Math.log(lo)));
  const bad = [];
  const note = (i, what) => { if (bad.length < 8) bad.push(`#${i} ${what}`); };
  let ties = 0, shorts = 0, extras = 0;
  const N = 5000;
  for (let i = 0; i < N; i++) {
    const c0 = pickCoef(), c1 = pickCoef();
    let n0 = logU(0.001, 50), n1 = logU(0.001, 50);
    const r = rng();
    if (r < 0.10) n1 = n0 * c1 / c0;                              // exact stoichiometric
    else if (r < 0.15) n1 = n0 * c1 / c0 * (1 + 1e-12);           // float noise: still a tie
    else if (r < 0.20) n1 = n0 * c1 / c0 * (1 + 1e-6);            // close, but not a tie
    const want = oracle(c0, c1, n0, n1);
    const runs = [];
    ['auto', 0, 1].forEach(anchor => {
      const sp = spec(c0, n0, c1, n1, { view: 'compare', anchor });
      const m = RatioVis.model(sp), g = m.groups;
      runs.push(m);
      if (allFinite(m).length) note(i, `non-finite ${allFinite(m)}`);
      if (m.limiting !== want.limiting) note(i, `limiting ${m.limiting} vs oracle ${want.limiting} (${c0},${n0},${c1},${n1}) anchor ${anchor}`);
      if (m.tie !== (want.limiting === 'tie')) note(i, 'tie mismatch');
      const a = m.anchor, o = 1 - a;
      if (anchor !== 'auto' && a !== anchor) note(i, 'anchor not honoured');
      const cs = [c0, c1], ns = [n0, n1], bs = [n0 / c0, n1 / c1];
      if (Math.abs(m.k - ns[a] / cs[a]) > 1e-12 * m.k) note(i, 'k');
      if (g[a].balls !== cs[a] || g[a].status !== 'match') note(i, 'anchor must show exactly its coefficient');
      if (m.tie) { if (g[o].balls !== cs[o] || g[o].status !== 'match') note(i, 'tie: both must match'); ties++; }
      else {
        const expect = cs[o] * bs[o] / bs[a];
        if (Math.abs(g[o].balls - expect) > 1e-12 * expect) note(i, `balls ${g[o].balls} vs ${expect}`);
        const st = g[o].balls < cs[o] ? 'short' : 'extra';
        if (g[o].status !== st) note(i, `status ${g[o].status} vs ${st}`);
        if ((m.limiting === o) !== (g[o].status === 'short')) note(i, 'the non-anchor is short exactly when it is limiting');
        if (m.limiting === a && g[a].status !== 'match') note(i, 'limiting anchor must match');
        if (g[o].status === 'short') { shorts++; if (Math.abs(g[o].shortBalls - (cs[o] - g[o].balls)) > 1e-12 * cs[o] || g[o].extraBalls !== 0) note(i, 'shortBalls'); }
        else { extras++; if (Math.abs(g[o].extraBalls - (g[o].balls - cs[o])) > 1e-12 * g[o].balls || g[o].shortBalls !== 0) note(i, 'extraBalls'); }
        if (Math.abs(g[o].extraMoles - g[o].extraBalls * m.k) > 1e-9 * ns[o] || Math.abs(g[o].shortMoles - g[o].shortBalls * m.k) > 1e-9 * ns[o]) note(i, 'moles of extra/short');
      }
      if (g.filter(x => x.limiting).length !== (m.tie ? 0 : 1)) note(i, 'exactly one limiting group (none on a tie)');
    });
    if (runs.some(m => m.limiting !== runs[0].limiting || m.tie !== runs[0].tie)) note(i, 'anchors disagree about the verdict');
    // leftover: fitted to the limiting reactant, extra moles = computeLimiting().leftMol
    const lo = RatioVis.model(spec(c0, n0, c1, n1, { view: 'leftover' })), g = lo.groups;
    if (want.limiting === 'tie') { if (g.some(x => x.status !== 'match' || x.extraMoles !== 0)) note(i, 'leftover tie'); }
    else {
      const o = 1 - want.limiting;
      if (lo.anchor !== want.limiting) note(i, 'leftover anchor');
      if (g[want.limiting].status !== 'match' || g[o].status !== 'extra') note(i, 'leftover statuses');
      if (Math.abs(g[o].extraMoles - want.leftMol) > 1e-9 * Math.max(want.leftMol, 1e-9) + 1e-12) note(i, `leftover ${g[o].extraMoles} vs ${want.leftMol}`);
    }
    // product: theoretical balls = the product's coefficient; moles = c_P * b_limiting
    const cp = 1 + Math.floor(rng() * 8), fill = rng() < 0.2 ? undefined : rng() * 1.6;
    const pm = RatioVis.model(spec(c0, n0, c1, n1, { view: 'product', products: [{ html: 'P', coef: cp }], fill }));
    const bl = Math.min(n0 / c0, n1 / c1);
    if (pm.product.balls !== cp) note(i, 'product balls');
    if (Math.abs(pm.product.moles - cp * bl) > 1e-12 * cp * bl) note(i, 'product moles');
    if (chem && chem.theoreticalMoles) {                          // App B's chemistry.js: the yield maths the apps already trust
      const q = { A: { coef: c0, sp: 'H2' }, B: { coef: c1, sp: 'O2' } };
      const th = chem.theoreticalMoles(chem.computeLimiting(q, n0, n1), { coef: cp, sp: 'H2O' });
      if (Math.abs(pm.product.moles - th) > 1e-12 * th) note(i, `theoreticalMoles ${th} vs ${pm.product.moles}`);
    }
    if (fill === undefined) { if (pm.product.fill !== null || pm.product.filled !== null || pm.product.over) note(i, 'no fill'); }
    else {
      const f = Math.min(fill, 1) * cp;
      if (Math.abs(pm.product.filled - f) > 1e-12 * cp || pm.product.over !== (fill > 1 + 1e-9)) note(i, 'fill maths');
    }
    if (RatioVis.html(spec(c0, n0, c1, n1, { view: 'compare' })) === '') note(i, 'html() empty for a valid spec');
  }
  check(`${N} random specs x 3 anchors agree with ${haveOracle ? 'computeLimiting' : 'the oracle'} and the model rules`, bad.length ? bad : 'all consistent', 'all consistent');
  console.log(`     (covered ${ties} ties, ${shorts} short, ${extras} extra)`);
  truthy('the property run saw ties, shorts and extras', ties > 100 && shorts > 1000 && extras > 1000);
}

/* ---- ties --------------------------------------------------------------------------------- */
console.log('\n--- ties ---');
{
  const t = (n0, n1, c0 = 1, c1 = 1) => RatioVis.model(spec(c0, n0, c1, n1)).tie;
  check('1 : 1, equal moles', t(0.2, 0.2), true);
  check('0.1 + 0.2 against 0.3 (float noise)', t(0.1 + 0.2, 0.3), true);
  check('4 : 3 exactly stoichiometric', t(0.4, 0.3, 4, 3), true);
  check('relative difference 1e-6 is not a tie', t(0.2, 0.2 * (1 + 1e-6)), false);
  check('relative difference 1e-10 is a tie (as computeLimiting)', t(0.2, 0.2 * (1 + 1e-10)), true);
  const m = RatioVis.model(spec(1, 0.3, 2, 0.6));
  check('a tie is drawn as both matched, tags are checks', count(RatioVis.html(spec(1, 0.3, 2, 0.6, { view: 'compare' })), /rv-tag--match/g), 2);
  check('tie, leftover view: no leftover tag', count(RatioVis.html(spec(1, 0.3, 2, 0.6, { view: 'leftover' })), /rv-tag--left/g), 0);
  check('tie sentence for leftover', RatioVis.describe(spec(1, 0.3, 2, 0.6, { view: 'leftover', scale: false })), 'Both reactants are used up. Nothing is left.');
  check('tie leaves limiting as the string tie', m.limiting, 'tie');
}

/* ---- big coefficients, extreme excess ------------------------------------------------------- */
console.log('\n--- legibility limits ---');
{
  const oct = (a, b, extra) => ({ reactants: [R('C<sub>8</sub>H<sub>18</sub>', 2, a), R('O<sub>2</sub>', 25, b)], products: [{ html: 'CO<sub>2</sub>', coef: 16 }], ...(extra || {}) });
  const h = RatioVis.html(oct(0.5, 5, { view: 'need' }));
  check('coefficient 25: 25 ghost balls in the O2 column', count(column(h, 1), /rv-b--ghost/g), 25);
  check('coefficient 25: 2 ghost balls in the octane column', count(column(h, 0), /rv-b--ghost/g), 2);
  check('coefficient 25: nothing hidden', count(h, /rv-more/g), 0);
  check('coefficient 25: ratio line reads 2 : 25', /2 : 25/.test(h), true);
  const c = RatioVis.html(oct(0.5, 5, { view: 'compare' }));
  check('coefficient 25, compare: 25 + 25 balls in the O2 column', count(column(c, 1), /class="rv-b /g), 50);
  const x = RatioVis.html({ reactants: [R('HCl', 1, 0.001), R('NaOH', 1, 5)], view: 'compare', anchor: 0 });
  const mx = RatioVis.model({ reactants: [R('HCl', 1, 0.001), R('NaOH', 1, 5)], view: 'compare', anchor: 0 });
  check('extreme excess: NaOH shows 5000 balls (fit to HCl)', Math.round(mx.groups[1].balls), 5000);
  check('extreme excess: 30 balls drawn in the have row', count(rows(column(x, 1), 'have'), /class="rv-b /g), 30);
  check('extreme excess: the chip says +4970', /rv-more"[^>]*>\+4970</.test(x), true);
  check('extreme excess: the label keeps the true number', /5000 NaOH/.test(label(x)), true);
  check('extreme excess: the caption keeps the true number', />5000</.test(x), true);
  const d = RatioVis.html({ reactants: [R('HCl', 1, 0.001), R('NaOH', 1, 5)], view: 'compare' });
  check('extreme excess, default anchor: HCl is a sliver of a ball', /0\.0002/.test(d), true);
  check('a sliver is still drawn (partial ball present)', count(column(d, 0), /rv-part/g), 1);
  // a tiny but positive amount always shows a sliver, never an empty row
  const tiny = RatioVis.html({ reactants: [R('A', 1, 1e-12), R('B', 1, 5)], view: 'compare' });
  check('1e-12 mol against 5 mol: the sliver is drawn', [count(column(tiny, 0), /rv-part/g), count(rows(column(tiny, 0), 'have'), /class="rv-b /g) >= 1], [1, true]);
  check('...and the label states the number', /0\.0000000000002/.test(label(tiny)), true);
  check('a sliver also shows in the have view', count(RatioVis.html({ reactants: [R('A', 1, 1e-12), R('B', 1, 5)], view: 'have' }), /rv-part/g), 1);
  // huge, absurd numbers
  const big = RatioVis.html({ reactants: [R('A', 1, 1e-9), R('B', 1, 1e9)], view: 'compare', anchor: 0 });
  truthy('1e-9 against 1e9 still renders', big.length > 0 && !/\bNaN\b|Infinity|undefined/.test(big));
  truthy('...and states +N', /rv-more/.test(big));
  // the picture budget: at most ~150 SVG shapes whatever is asked
  let worst = 0;
  const pr = [{ html: 'P', coef: 40 }];
  [{ c: [25, 25], n: [0.001, 5] }, { c: [40, 40], n: [0.01, 50] }, { c: [40, 40], n: [1, 1.0123] }, { c: [60, 60], n: [3.3, 3.31] }, { c: [1, 1], n: [0.001, 5] }, { c: [25, 2], n: [0.37, 2.9] }].forEach(t => {
    ['need', 'have', 'compare', 'leftover', 'product'].forEach(view => [undefined, 0, 1].forEach(anchor => [undefined, 0.5].forEach(fill => {
      const e = elements(RatioVis.html({ reactants: [R('A', t.c[0], t.n[0]), R('B', t.c[1], t.n[1])], products: pr, view, anchor, fill }));
      if (e > worst) worst = e;
    })));
  });
  truthy(`worst-case picture has ${worst} SVG shapes (<= 150)`, worst <= 150);
}

/* ---- leftover --------------------------------------------------------------------------------- */
console.log('\n--- leftover ---');
{
  const m = RatioVis.model(spec(1, 0.15, 2, 0.6, { view: 'leftover' }));
  check('Mg + 2HCl style: 0.15 vs 0.6 -> the excess has 0.30 mol left', m.groups[1].extraMoles, 0.3, 1e-12);
  check('...which is 2 balls at 1 ball = 0.15 mol', [m.k, m.groups[1].extraBalls], [0.15, 2], 1e-12);
  const h = RatioVis.html(spec(1, 0.15, 2, 0.6, { view: 'leftover' }));
  check('leftover tag with the amount', /rv-tag--left[^>]*>.*?left over.*?<\/span><span class="rv-amt"><span class="rv-nw">0\.3 mol</.test(h), true);
  check('leftover has only the Have row (no Need row)', count(h, /data-rv-row="need"/g), 0);
  check('leftover: the excess has 2 solid + 2 dashed balls', [count(column(h, 1), /rv-b--solid/g), count(column(h, 1), /rv-b--extra/g)], [2, 2]);
  const real = oracle(1, 2, 0.15, 0.6);
  check('leftover vs computeLimiting().leftMol', m.groups[1].extraMoles, real.leftMol, 1e-12);
  // the toy reaction from test-chemistry.js: 2H2 + O2, 2 mol H2 with 4 mol O2
  const t = RatioVis.model({ reactants: [R('H2', 2, 2), R('O2', 1, 4)], view: 'leftover' });
  check('2 mol H2 + 4 mol O2: H2 limiting, 3 mol O2 left', [t.limiting, t.groups[1].extraMoles], [0, 3], 1e-12);
}

/* ---- product + fill ------------------------------------------------------------------------------ */
console.log('\n--- product row ---');
{
  const base = (fill, extra) => Object.assign({ reactants: [R('Al', 4, 0.2), R('O<sub>2</sub>', 3, 0.6)], products: [{ html: 'Al<sub>2</sub>O<sub>3</sub>', coef: 2 }], view: 'product', fill }, extra);
  const m = RatioVis.model(base(0.62));
  check('Al limits (0.05 vs 0.2 batches)', m.limiting, 0);
  check('theoretical product = coefficient balls', m.product.balls, 2);
  check('theoretical product moles = 2 x 0.05', m.product.moles, 0.1, 1e-15);
  check('62 % of 2 balls = 1.24 filled', m.product.filled, 1.24, 1e-12);
  check('62 % is not over', m.product.over, false);
  const o = RatioVis.model(base(1.3));
  check('130 % is clamped to 2 balls', o.product.filled, 2);
  check('130 % is flagged over and keeps the raw fill', [o.product.over, o.product.fill], [true, 1.3]);
  check('exactly 100 % is not over', RatioVis.model(base(1)).product.over, false);
  check('100 % + float noise is not over', RatioVis.model(base(1 + 1e-12)).product.over, false);
  const z = RatioVis.model(base(0));
  check('0 % fills nothing', [z.product.filled, z.product.over], [0, false]);
  const n = RatioVis.model(base(undefined));
  check('no fill: theoretical only', [n.product.fill, n.product.filled, n.product.over], [null, null, false]);
  check('a second product is addressable', RatioVis.model(base(0.5, { products: [{ html: 'a', coef: 2 }, { html: 'b', coef: 3 }], product: 1 })).product, { index: 1, coef: 3, balls: 3, moles: 0.15000000000000002, fill: 0.5, filled: 1.5, over: false });
  const h = RatioVis.html(base(0.62));
  // 1.24 of 2 balls: one whole solid ball, one partial ball (its fill is a solid path), no plain outlined ball left
  check('product html: 1 whole + 1 partial solid shape, 1 partial ball', [count(column(h, 2), /rv-b--solid/g), count(column(h, 2), /rv-b--ghost/g), count(column(h, 2), /rv-part/g)], [2, 0, 1]);
  truthy('product html: label 62 %, tags theoretical + actual', /62 %/.test(h) && /rv-tag--theo/.test(h) && /rv-tag--act/.test(h));
  truthy('product html: "> 100 %" when over', /&gt; 100 %/.test(RatioVis.html(base(1.3))));
  check('product html: over draws every ball solid', count(column(RatioVis.html(base(1.3)), 2), /rv-b--solid/g), 2);
  check('theoretical only: no actual tag', count(RatioVis.html(base(undefined)), /rv-tag--act/g), 0);
  check('theoretical only: two outlined balls', count(column(RatioVis.html(base(undefined)), 2), /rv-b--ghost/g), 2);
  check('product sentence', RatioVis.describe(base(0.62)), 'Al runs out first. Al2O3: 2 balls possible, 1.24 made, 62 %. 1 ball = 0.05 mol.');
  check('product sentence, over', RatioVis.describe(base(1.3)), 'Al runs out first. Al2O3: 2 balls possible, 130 % made, more than possible. 1 ball = 0.05 mol.');
  // a non-limiting anchor in another view: theoretical balls are measured on that scale
  const c = RatioVis.model(base(undefined, { view: 'compare', anchor: 1 }));
  check('compare, fitted to O2: product balls = 2 x 0.05 / 0.2', c.product.balls, 0.5, 1e-12);
}

/* ---- marks (Practice) ------------------------------------------------------------------------------- */
console.log('\n--- marks ---');
{
  const mk = (pick, a = 0.15, b = 0.6) => RatioVis.model(A2B(a, b, { mark: { pick } })).mark;
  check('pick the limiting reactant', mk(0), { pick: 0, answer: 0, correct: true });
  check('pick the other one', mk(1), { pick: 1, answer: 0, correct: false });
  check('pick Neither when it is not a tie', mk('tie'), { pick: 'tie', answer: 0, correct: false });
  check('pick Neither on a tie', mk('tie', 0.3, 0.6), { pick: 'tie', answer: 'tie', correct: true });
  check('pick a reactant on a tie', mk(0, 0.3, 0.6).correct, false);
  const h = RatioVis.html(A2B(0.15, 0.6, { mark: { pick: 1 } }));
  truthy('wrong pick shows a cross on the picked column', /rv-mark rv-mark--no/.test(column(h, 1)) && !/rv-mark/.test(column(h, 0)));
  truthy('right pick shows a check', /rv-mark rv-mark--ok/.test(RatioVis.html(A2B(0.15, 0.6, { mark: { pick: 0 } }))));
  truthy('Neither gets its own badge', /rv-pick rv-pick--ok/.test(RatioVis.html(A2B(0.3, 0.6, { mark: { pick: 'tie' } }))));
  check('the label says what was picked', / You picked B: not quite\.$/.test(RatioVis.describe(A2B(0.15, 0.6, { mark: { pick: 1 }, scale: false }))), true);
  check('the label for Neither', / You picked Neither: correct\.$/.test(RatioVis.describe(A2B(0.3, 0.6, { mark: { pick: 'tie' }, scale: false }))), true);
  throwsRV('mark.pick must be 0, 1 or tie', () => RatioVis.model(A2B(1, 1, { mark: { pick: 2 } })));
}

/* ---- invalid input ---------------------------------------------------------------------------------------- */
console.log('\n--- invalid input ---');
{
  const ok = () => ({ reactants: [R('A', 1, 1), R('B', 2, 1)], view: 'compare' });
  const withR = (i, key, val) => { const s = ok(); s.reactants[i] = Object.assign({}, s.reactants[i], { [key]: val }); return s; };
  const bad = {
    'no spec': undefined, 'null spec': null, 'string spec': 'x', 'empty spec': {}, 'one reactant': { reactants: [R('A', 1, 1)] },
    'three reactants': { reactants: [R('A', 1, 1), R('B', 1, 1), R('C', 1, 1)] }, 'reactants not an array': { reactants: 'AB' },
    'null reactant': { reactants: [R('A', 1, 1), null] },
    'zero moles': withR(0, 'moles', 0), 'negative moles': withR(1, 'moles', -0.1), 'NaN moles': withR(0, 'moles', NaN),
    'Infinity moles': withR(1, 'moles', Infinity), 'string moles': withR(0, 'moles', '0.5'), 'missing moles': withR(0, 'moles', undefined),
    'zero coef': withR(0, 'coef', 0), 'negative coef': withR(1, 'coef', -2), 'NaN coef': withR(1, 'coef', NaN), 'missing coef': withR(0, 'coef', undefined),
    'unknown view': Object.assign(ok(), { view: 'wat' }), 'product view without products': Object.assign(ok(), { view: 'product' }),
    'empty products': Object.assign(ok(), { products: [] }), 'product without coef': Object.assign(ok(), { products: [{ html: 'P' }] }),
    'product index out of range': Object.assign(ok(), { products: [{ html: 'P', coef: 1 }], product: 3 }),
    'negative fill': Object.assign(ok(), { fill: -0.1 }), 'NaN fill': Object.assign(ok(), { fill: NaN }), 'string fill': Object.assign(ok(), { fill: '0.5' }),
    'Infinity fill': Object.assign(ok(), { fill: Infinity }),
    'moles / coef underflows to 0': { reactants: [R('A', 1e10, 1e-320), R('B', 1, 1)] },
    'ball count underflows to 0': { reactants: [R('A', 1, 1e-300), R('B', 1, 1e300)], view: 'have' },
    'ball count overflows': { reactants: [R('A', 1, 1e300), R('B', 1, 1e-300)], view: 'have', anchor: 1 },
    'moles / coef overflows': { reactants: [R('A', 1e-300, 1e300), R('B', 1, 1)] }
  };
  Object.keys(bad).forEach(k => {
    throwsRV(`model() throws: ${k}`, () => RatioVis.model(bad[k]));
    check(`.html() is '' : ${k}`, RatioVis.html(bad[k]), '');
  });
  const host = { innerHTML: 'old', addEventListener() {}, removeEventListener() {}, contains: () => false };
  check('mount() empties the host and returns null', [RatioVis.mount(host, bad['zero moles']), host.innerHTML], [null, '']);
  check('mount(null) is harmless', RatioVis.mount(null, ok()), null);
  throwsRV('describe() throws like model()', () => RatioVis.describe(bad['zero coef']));
  check('a valid spec still works after all that', RatioVis.html(ok()).length > 100, true);
}

/* ---- purity, determinism, markup ---------------------------------------------------------------------- */
console.log('\n--- purity and markup ---');
{
  const frozen = deepFreeze({ reactants: [R('Al', 4, 0.2), R('O<sub>2</sub>', 3, 0.12)], products: [{ html: 'Al<sub>2</sub>O<sub>3</sub>', coef: 2 }], view: 'compare', fill: 0.62, mark: { pick: 1 } });
  ['need', 'have', 'compare', 'leftover', 'product'].forEach(v => {
    const s = Object.assign({}, frozen, { view: v });
    const a = RatioVis.html(s, { fitControl: true }), b = RatioVis.html(s, { fitControl: true });
    check(`.html(${v}) is deterministic and does not touch its input`, a === b && a.length > 100, true);
    check(`.model(${v}) is deterministic`, RatioVis.model(s), RatioVis.model(s));
    truthy(`${v}: no NaN, undefined or Infinity in the markup`, !/\bNaN\b|undefined|Infinity|\[object/.test(a));
  });
  const h = RatioVis.html(frozen, { fitControl: true });
  check('fit control: two buttons, the anchor is pressed', [count(h, /data-rv-fit=/g), /data-rv-fit="0" aria-pressed="true"/.test(h) || /data-rv-fit="1" aria-pressed="true"/.test(h)], [2, true]);
  check('fit control: sits outside the role=img element', /<\/div><div class="rv-bar">/.test(h) && h.indexOf('data-rv-fit') > h.indexOf('class="rv-bar"'), true);
  check('fit control: group labelled "Fit to", no other words', /role="group" aria-label="Fit to"/.test(h), true);
  check('fit control is off by default', RatioVis.html(frozen).includes('data-rv-fit'), false);
  check('fit control only for have/compare', ['need', 'leftover', 'product'].map(v => RatioVis.html(Object.assign({}, frozen, { view: v }), { fitControl: true }).includes('data-rv-fit')), [false, false, false]);
  check('scale label shown', /1 ball = <b>0\.2<\/b> mol/.test(RatioVis.html(frozen, {})) || /1 ball = <b>[\d.]+<\/b> mol/.test(RatioVis.html(frozen, {})), true);
  check('scale: false hides it', /1 ball =/.test(RatioVis.html(Object.assign({}, frozen, { scale: false }))), false);
  check('never a scale label on need', /1 ball =/.test(RatioVis.html(Object.assign({}, frozen, { view: 'need' }))), false);
  check('size sm', /class="rv rv--sm /.test(RatioVis.html(frozen, { size: 'sm' })), true);
  check('size md by default', /class="rv rv--md /.test(RatioVis.html(frozen)), true);
  check('the formula markup is kept in the head', /<span class="rv-f">Al<\/span>/.test(h) && /<span class="rv-f">O<sub>2<\/sub><\/span>/.test(h), true);
  const esc = RatioVis.html({ reactants: [R('"><img src=x onerror=1>', 1, 1), R('B&C', 1, 1)], view: 'need' });
  check('aria-label cannot be broken out of (quotes, angle brackets, ampersands escaped)', label(esc), 'Equation needs 1 &quot;&gt; and 1 B&amp;C.');
  check('subscript formulas read plainly in the label', /2 O2/.test(label(RatioVis.html({ reactants: [R('Al', 1, 1), R('O<sub>2</sub>', 2, 1)], view: 'need' }))), true);
  check('Unicode subscripts too', label(RatioVis.html({ reactants: [R('Al', 1, 1), R('O₂', 2, 1)], view: 'need' })), 'Equation needs 1 Al and 2 O2.');
  check('charges read plainly', label(RatioVis.html({ reactants: [R('Fe<sup>3+</sup>', 1, 1), R('OH<sup>-</sup>', 3, 1)], view: 'need' })), 'Equation needs 1 Fe3+ and 3 OH-.');
  check('missing formulas fall back to A and B', RatioVis.describe({ reactants: [{ coef: 1, moles: 1 }, { coef: 1, moles: 1 }], view: 'need' }), 'Equation needs 1 A and 1 B.');
  check('numbers: 3 significant figures at most', RatioVis.describe(spec(1, 1, 1, 1.23456, { view: 'have', scale: false })), 'Equation needs 1 Al and 1 O2. You have 0.81 Al and 1 O2.');
  const odd = { reactants: [R('Al', 4, 0.15 / 27), R('O<sub>2</sub>', 3, 0.0123)], view: 'compare', scale: true };
  check('opts.sf = 4 matches the apps\u2019 sig(x, 4)', RatioVis.describe(odd, { sf: 4 }).includes('1 ball = 0.001389 mol') && RatioVis.describe(odd).includes('1 ball = 0.00139 mol'), true);
  check('opts.sf reaches the visible labels too', RatioVis.html(odd, { sf: 4 }).includes('<b>0.001389</b> mol') && RatioVis.html(odd).includes('<b>0.00139</b> mol'), true);
  check('opts.sf: junk falls back to 3', RatioVis.describe(odd, { sf: 99 }), RatioVis.describe(odd));
  check('numbers never use an exponent, trailing zeros are trimmed', [1e-7, 0.5, 120, 1234.5, 0.000123456, 2.0, 1e-30].map(x => RatioVis.describe({ reactants: [R('A', 1, x), R('B', 1, x)], view: 'have', scale: false }).replace(/^.*You have (\S+) .*$/, '$1')), ['1', '1', '1', '1', '1', '1', '1']);
  check('numbers: tiny values are written out, no exponent', /1e-|e-/.test(RatioVis.describe(spec(1, 1e-7, 1, 1, { view: 'have' }))), false);
}

/* ---- mount() against a stub element ------------------------------------------------------------------------- */
console.log('\n--- mount (stub element, no DOM) ---');
{
  const listeners = [];
  const el = { innerHTML: '', addEventListener(t, f) { listeners.push([t, f]); }, removeEventListener(t, f) { const i = listeners.findIndex(x => x[1] === f); if (i >= 0) listeners.splice(i, 1); }, contains: () => true, querySelector: () => null };
  const m = RatioVis.mount(el, A2B(0.15, 0.6), { fitControl: true, onFit() {} });
  check('mount returns the model', m.limiting, 0);
  truthy('mount sets innerHTML', /role="img"/.test(el.innerHTML));
  check('mount wires one click listener', listeners.length, 1);
  RatioVis.mount(el, A2B(0.15, 0.6), { fitControl: true });
  check('mounting again does not stack listeners', listeners.length, 1);
  RatioVis.mount(el, A2B(0.15, 0.6), {});
  check('mounting without a fit control removes the listener', listeners.length, 0);
  check('no Motion, no problem (animate defaults to true)', (() => { try { RatioVis.mount(el, A2B(0.15, 0.6)); return true; } catch (e) { return e.message; } })(), true);
}

console.log(`\n${total} checks, ${fail ? fail + ' failure(s)' : 'all passed'}`);
process.exit(fail ? 1 : 0);
