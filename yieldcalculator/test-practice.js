/* Tests for the Practice questions — run with `node test-practice.js`.
   Needs chemistry.js, generator.js and practice.js next to it. Exits non-zero on any failure.

   Every problem is checked against oracles written out again here (the generator's own yield table,
   and min(n ÷ coefficient) × coefficient), so "expected" is never only compared with itself. */
const Generator = require('./generator.js');
const Practice = require('./practice.js');
const { QUAL, molesOf, computeLimiting, solveProblem, solveYield, UNIT_LABEL } = require('./chemistry.js');

const PER_LEVEL = +process.env.PER_LEVEL || 2500;     // the knob is for quick local runs; the default is the bar
const LEVELS = ['moles', 'grams', 'mixed'];

let failed = 0, checks = 0;
function check(label, ok, detail) {
  checks++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ': ' + detail : ''}`);
}
const rules = {};
function expect(rule, ok, info) {
  const r = rules[rule] || (rules[rule] = { n: 0, bad: 0, first: null });
  r.n++;
  if (!ok) { r.bad++; if (!r.first) r.first = typeof info === 'function' ? info() : info; }
}
function reportRules(title) {
  const names = Object.keys(rules);
  const bad = names.filter(n => rules[n].bad);
  const total = names.reduce((s, n) => s + rules[n].n, 0);
  check(`${title}: ${names.length} rules, ${total} assertions`, bad.length === 0, bad.length ? bad.length + ' rule(s) broken' : 'all hold');
  bad.forEach(n => console.log(`     FAIL rule "${n}" broke ${rules[n].bad}× — first: ${rules[n].first}`));
  names.forEach(n => delete rules[n]);
}
const section = t => console.log('\n--- ' + t + ' ---');
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b), 1e-300);
const sigDigits = s => s.replace('.', '').replace(/^0+/, '').length;
const finiteDeep = o => typeof o === 'number' ? isFinite(o) : o && typeof o === 'object' && !o.q ? Object.keys(o).every(k => finiteDeep(o[k])) : true;

/* ---- reading and tolerance ------------------------------------------------------ */
section('reading what was typed');
[['26.7', 26.7], ['  26,7 g ', 26.7], ['62 %', 62], ['.5', 0.5], ['1e-3', 0.001], ['0.250 mol', 0.25], ['+3', 3]].forEach(([t, v]) =>
  check(`parse(${JSON.stringify(t)})`, Practice.parse(t) === v, Practice.parse(t)));
['', 'abc', '1.2.3', '--4', '12 13', 'g', '%'].forEach(t => check(`parse(${JSON.stringify(t)}) is not a number`, isNaN(Practice.parse(t))));
[['26.7', 3], ['27', 2], ['0.0500', 3], ['0.05', 1], ['500', 3], ['2.50e3', 3], ['0', 0], ['00.10', 2], ['62 %', 2]].forEach(([t, n]) =>
  check(`sigFigs(${JSON.stringify(t)}) = ${n}`, Practice.sigFigs(t) === n, Practice.sigFigs(t)));
[
  ['26.7', 26.6725, true], ['26.6', 26.6725, true], ['27', 26.6725, true],       // 1 %, and 27 is 26.67 to 2 s.f.
  ['26', 26.6725, false], ['28', 26.6725, false], ['26.0', 26.6725, false],
  ['62.2', 62.1727, true], ['62', 62.1727, true], ['63', 62.1727, false], ['6', 62.1727, false],
  ['0.0267', 0.026672, true], ['0.027', 0.026672, true], ['0.03', 0.026672, false],   // one figure never rounds in
  ['0.25', 0.2504, true], ['0.3', 0.2504, false], ['-26.7', 26.6725, false], ['', 26.6725, false]
].forEach(([t, want, ok]) => check(`matches(${JSON.stringify(t)}, ${want}) is ${ok}`, Practice.matches(t, want) === ok));

/* ---- many problems ------------------------------------------------------------------ */
const seen = {};          // coverage, per level
LEVELS.forEach((level, li) => {
  section(`${PER_LEVEL} ${level} problems`);
  const rng = Generator.rng(1000 + li);
  const recent = [];
  const cover = seen[level] = { target: {}, unit: {}, cond: {}, ties: 0, gasAsked: 0, slips: {}, waterAsked: 0, repeats: 0 };
  const tag = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (let i = 0; i < PER_LEVEL; i++) {
    const P = Practice.make({ level, rng, avoid: recent });
    const id = () => `#${i} ${P.q.eq} ${P.target}/${P.unit}`;
    const { q, scenario: sc } = P, prod = q.products[P.prodIdx];
    const ys = Generator.yields(sc), yEntry = ys.find(y => y.sp === prod.sp);
    recent.push(P.id); if (recent.length > 5) recent.shift();
    tag(cover.target, P.target); tag(cover.unit, P.unit); tag(cover.cond, P.cond);
    if (P.limiting === 'tie') cover.ties++;
    if (prod.sp === 'H2O') cover.waterAsked++;

    // shape
    expect('problem has every field', ['id', 'level', 'q', 'scenario', 'prodIdx', 'target', 'unit', 'cond', 'inA', 'inB', 'known', 'expected', 'unitLabel', 'limiting'].every(k => P[k] !== undefined), id);
    expect('nothing is NaN or Infinity', finiteDeep(P.expected) && finiteDeep(P.known) && P.expected > 0, id);
    expect('the reaction is a built-in one', QUAL[q.id] === q && Generator.isSafe(q), id);
    expect('level is the one asked for', P.level === level, id);
    expect('the product exists', !!prod && !!yEntry, id);
    expect('the condition text is the generator\'s own', typeof sc.cond === 'string' && sc.cond === Generator.condition(q), id);
    expect('a one-way reaction has its named reactant running out (or a tie)', (() => { const ow = Generator.oneWay(q); return !ow || P.limiting === 'tie' || P.limiting === (ow.side === 'A' ? 0 : 1); })(), id);
    // level rules
    if (level === 'moles') expect('moles: theoretical in mol', P.target === 'theoretical' && P.unit === 'mol' && sc.givens.every(g => g.kind === 'mol'), id);
    if (level === 'grams') expect('grams: theoretical or percent, in g', (P.target === 'theoretical' || P.target === 'percent') && P.unit === 'mass' && sc.givens.every(g => g.kind === 'mass'), id);
    // units legal for the product's phase
    expect('mass only from 0.1 g', P.unit !== 'mass' || yEntry.mass >= 0.1 - 1e-12, id);
    expect('a gas volume only for a true gas', P.unit !== 'gas' || (Generator.species(prod.sp).gas && yEntry.units.includes('dm3')), id);
    expect('the unit is one the generator listed', yEntry.units.includes({ mol: 'mol', mass: 'g', gas: 'dm3' }[P.unit]), id);
    expect('the condition is RTP or STP', P.cond === 'RTP' || P.cond === 'STP', id);
    const gasGiven = sc.givens.find(g => g.kind === 'gas');
    expect('a gas given and a gas yield share one condition', !gasGiven || P.cond === gasGiven.cond, id);
    expect('unit label matches', P.unitLabel === (P.target === 'percent' ? '%' : UNIT_LABEL[P.unit]), id);
    if (P.unit === 'gas') cover.gasAsked++;

    // theoretical yields are in range, from the generator's own yield table
    expect('theoretical moles ≥ 0.004', yEntry.n >= 0.004 * (1 - 1e-9), id);
    if (P.unit === 'gas') expect('gas volume 0.05–20 dm³', yEntry.gas[P.cond] >= 0.05 && yEntry.gas[P.cond] <= 20, id);

    // expected agrees with two independent routes
    const solved = solveProblem(P);
    const theoOracle = { mol: yEntry.n, mass: yEntry.mass, gas: P.unit === 'gas' ? yEntry.gas[P.cond] : 0 }[P.unit];
    const ownOracle = Math.min(sc.nA / q.A.coef, sc.nB / q.B.coef) * prod.coef;               // n(product) = min(n ÷ coef) × coef
    expect('theoretical moles: the generator and min(n ÷ coef) × coef agree', near(yEntry.n, ownOracle), id);
    const want = P.target === 'theoretical' ? theoOracle
      : P.target === 'percent' ? parseFloat(P.known.actual) / theoOracle * 100
      : theoOracle * parseFloat(P.known.percent) / 100;
    expect('expected = the independent oracle', near(P.expected, want, 1e-9), () => `${id}: ${P.expected} vs ${want}`);
    expect('expected = solveProblem()', P.expected === (P.target === 'percent' ? solved.y.percent : P.target === 'actual' ? solved.y.actual : solved.y.theoretical), id);
    expect('solveYield on the scenario says the same', near(P.expected, (({ percent, actual, theoretical }) => P.target === 'percent' ? percent : P.target === 'actual' ? actual : theoretical)(
      solveYield(sc.res, prod, P.target, P.unit, P.cond, { actual: parseFloat(P.known.actual), percent: parseFloat(P.known.percent) }))), id);

    // the stated figure
    if (P.target === 'percent') {
      const share = parseFloat(P.known.actual) / theoOracle;
      expect('percent: a stated actual yield below the theoretical', share < 1 && share >= 0.35, () => `${id}: share ${share}`);
      expect('percent: answer between 35 and 100', P.expected >= 35 && P.expected < 100, () => `${id}: ${P.expected}`);
      expect('percent: actual printed to 2 or 3 s.f. (3 for g)', sigDigits(P.known.actual) === 3 || (P.unit !== 'mass' && sigDigits(P.known.actual) === 2), () => `${id}: ${P.known.actual}`);
      expect('percent: no stated percentage', P.known.percent === '', id);
    } else if (P.target === 'actual') {
      const pc = Number(P.known.percent);
      expect('actual: a whole percentage, 45–95', Number.isInteger(pc) && pc >= 45 && pc <= 95 && P.known.actual === '', () => `${id}: ${P.known.percent}`);
    } else {
      expect('theoretical: nothing stated', P.known.actual === '' && P.known.percent === '', id);
    }

    // the amounts, as the wizard's fields hold them, give the very same moles
    expect('inA gives the generator\'s moles', near(molesOf(P.inA, q.A.sp), sc.nA, 1e-12), id);
    expect('inB gives the generator\'s moles', near(molesOf(P.inB, q.B.sp), sc.nB, 1e-12), id);
    const res2 = computeLimiting(q, molesOf(P.inA, q.A.sp), molesOf(P.inB, q.B.sp));
    expect('which one runs out first agrees', P.limiting === (res2.tie ? 'tie' : res2.limiting === q.A ? 0 : 1) && P.limiting === (sc.design.limiting === 'tie' ? 'tie' : sc.design.limiting === 'A' ? 0 : 1), id);

    // water only when nothing else could be asked
    if (prod.sp === 'H2O') expect('water only when nothing else is on offer', ys.every(y => y.sp === 'H2O' || !y.units.some(u => ({ moles: ['mol'], grams: ['g'], mixed: ['mol', 'g', 'dm3'] })[level].includes(u))), id);
    // variety
    expect('not one of the last five reactions', !recent.slice(0, -1).includes(P.id), () => { cover.repeats++; return id(); });

    // grading
    const g = Practice.grade(P, String(Number(P.expected.toPrecision(4))));
    expect('the exact answer is right', g.valid && g.ok && g.slip === '', () => `${id}: ${JSON.stringify(g)}`);
    expect('+0.5 % is right', Practice.grade(P, String(P.expected * 1.005)).ok, id);
    expect('−0.5 % is right', Practice.grade(P, String(P.expected * 0.995)).ok, id);
    expect('+8 % is wrong', !Practice.grade(P, String(P.expected * 1.08)).ok, id);
    expect('half is wrong', !Practice.grade(P, String(P.expected / 2)).ok, id);
    expect('words are not a number', Practice.grade(P, 'abc').valid === false, id);

    // slips: each one is recognised, with its own line, and only one line
    const list = Practice.slips(P);
    list.forEach(s => {
      const typed = String(Number(s.value.toPrecision(4)));
      const gs = Practice.grade(P, typed);
      const first = list.find(t => Practice.matches(typed, t.value));
      if (gs.ok) return;                                                    // a slip that lands on the answer is simply right
      expect(`slip "${s.say}" is recognised`, gs.slip === first.say, () => `${id}: typed ${typed}, got "${gs.slip}", wanted "${first.say}"`);
      tag(cover.slips, first.say);
    });
    expect('every slip is one line', list.every(s => typeof s.say === 'string' && s.say.length > 0 && s.say.length <= 40 && !/\n/.test(s.say)), id);
    expect('a value that is not a slip has no line', Practice.grade(P, String(P.expected * 1.37 + 0.123)).slip === '' || list.some(s => Practice.matches(String(P.expected * 1.37 + 0.123), s.value)), id);
  }
  reportRules(`${level}`);
  check(`${level}: nothing repeated within the last five`, cover.repeats === 0, cover.repeats);
});

/* ---- coverage: every branch is reached ------------------------------------------------------ */
section('coverage');
const m = seen.mixed, g = seen.grams, mo = seen.moles;
check('moles: only theoretical, only mol', Object.keys(mo.target).join() === 'theoretical' && Object.keys(mo.unit).join() === 'mol', JSON.stringify([mo.target, mo.unit]));
check('grams: theoretical and percent, only grams', Object.keys(g.target).sort().join() === 'percent,theoretical' && Object.keys(g.unit).join() === 'mass', JSON.stringify([g.target, g.unit]));
check('mixed: all three targets', ['theoretical', 'percent', 'actual'].every(t => m.target[t] > PER_LEVEL * 0.2), JSON.stringify(m.target));
check('mixed: mol, grams and gas dm³ all asked', ['mol', 'mass', 'gas'].every(u => m.unit[u] > PER_LEVEL * 0.1), JSON.stringify(m.unit));
check('mixed: gas yields at both RTP and STP', m.cond.RTP > 0 && m.cond.STP > 0 && m.gasAsked > 0, JSON.stringify(m.cond));
check('ties come up (about 8 %)', [mo, g, m].every(c => c.ties > PER_LEVEL * 0.03 && c.ties < PER_LEVEL * 0.15), [mo.ties, g.ties, m.ties].join(' / '));
check('water is rarely the product asked about', [mo, g, m].every(c => c.waterAsked < PER_LEVEL * 0.12), [mo.waterAsked, g.waterAsked, m.waterAsked].join(' / '));
const slipNames = ["That's what the other one gives.", 'The mole ratio was skipped.', "That's in mol.", "That's in g.", "That's in dm³.", 'Upside down.'];
slipNames.forEach(s => check(`slip line "${s}" is reached`, [mo, g, m].some(c => (c.slips[s] || 0) > 0), [mo, g, m].map(c => c.slips[s] || 0).join(' / ')));

/* ---- determinism and robustness ---------------------------------------------------------------- */
section('determinism and robustness');
const sum = P => JSON.stringify([P.q.eq, P.prodIdx, P.target, P.unit, P.cond, P.inA, P.inB, P.known, P.expected, P.limiting]);
check('the same seed gives the same problems', [0, 1, 2].every(k => LEVELS.every(lv => sum(Practice.make({ level: lv, rng: Generator.rng(77 + k) })) === sum(Practice.make({ level: lv, rng: Generator.rng(77 + k) })))));
check('an unknown level is mixed', Practice.make({ level: 'bogus', rng: Generator.rng(1) }).level === 'mixed');
check('no options at all still works', !!Practice.make().q);
check('question() says null when nothing can be asked, and the moles level still can', (() => {
  // 0.50 mmol of H2 and O2 make 0.018 g of water: under 0.1 g, so grams has nothing to ask; moles always has
  const q = QUAL.find(x => x.eq === '2H2 + O2 -> 2H2O');
  const res = computeLimiting(q, 0.0005, 0.0005);
  const sc = { q, level: 'grams', givens: [{ kind: 'mol', value: 0.0005 }, { kind: 'mol', value: 0.0005 }], nA: 0.0005, nB: 0.0005, res, design: {} };
  return Practice.question(sc, 'grams', Generator.rng(3)) === null && Practice.question(sc, 'moles', Generator.rng(3)).unit === 'mol';
})());
check('Math.random is only the default rng', (() => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'practice.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return (src.match(/Math\.random/g) || []).length === 1 && /opts\.rng : Math\.random/.test(src);
})());
check('QUAL was not modified', QUAL.every((q, i) => q.id === i && q.A && q.B && Array.isArray(q.products)));

console.log(failed ? `\n${failed} of ${checks} checks FAILED.` : `\n${checks} checks, all passed.`);
process.exit(failed ? 1 : 0);
