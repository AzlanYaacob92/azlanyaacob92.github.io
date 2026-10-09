/* Smoke test for the yield engine — run with `node test-chemistry.js`.
   Covers molar masses, the molar gas volume constants, amounts → moles (every
   method), the yield maths, and the atom-balance check that guards the
   custom-reaction builder. */
const C = require('./chemistry.js');
const { composition, molarMass, MOLAR_VOL, QUAL, molesOf, computeLimiting, solveYield, solveProblem } = C;

let fail = 0;
function check(label, got, want, tol = 0.05) {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= tol : got === want;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${got}${ok ? '' : ` (expected ${want})`}`);
  if (!ok) fail++;
}

console.log('--- molar masses ---');
check('H2O', molarMass('H2O'), 18.0);
check('NaCl', molarMass('NaCl'), 58.5);
check('CuSO4', molarMass('CuSO4'), 159.6);   // Cu 63.5 + S 32.1 + 4×O 16.0
check('Ca(OH)2', molarMass('Ca(OH)2'), 74.1); // Ca 40.1 + 2×(16.0 + 1.0)
check('C6H12O6', molarMass('C6H12O6'), 180.0);

console.log('\n--- molar gas volume (data-booklet values) ---');
check('RTP', MOLAR_VOL.RTP, 24.0, 0);
check('STP', MOLAR_VOL.STP, 22.4, 0);

console.log('\n--- atom balance (mirrors balanceError in app.js) ---');
function balanced(A, B, prods) {
  const tally = side => side.reduce((acc, t) => {
    const c = composition(t.sp);
    for (const el in c) acc[el] = (acc[el] || 0) + t.coef * c[el];
    return acc;
  }, {});
  const l = tally([A, B]), r = tally(prods);
  const els = [...new Set([...Object.keys(l), ...Object.keys(r)])];
  return els.every(e => (l[e] || 0) === (r[e] || 0));
}
// 2H2 + O2 -> 2H2O  balances; 1:1:1 does not.
check('2H2 + O2 -> 2H2O',
  balanced({ coef: 2, sp: 'H2' }, { coef: 1, sp: 'O2' }, [{ coef: 2, sp: 'H2O' }]), true);
check('H2 + O2 -> H2O (rejected)',
  balanced({ coef: 1, sp: 'H2' }, { coef: 1, sp: 'O2' }, [{ coef: 1, sp: 'H2O' }]), false);
check('N2 + 3H2 -> 2NH3',
  balanced({ coef: 1, sp: 'N2' }, { coef: 3, sp: 'H2' }, [{ coef: 2, sp: 'NH3' }]), true);
check('CaCO3 split across two products',
  balanced({ coef: 1, sp: 'CaCO3' }, { coef: 2, sp: 'HCl' },
    [{ coef: 1, sp: 'CaCl2' }, { coef: 1, sp: 'H2O' }, { coef: 1, sp: 'CO2' }]), true);

console.log('\n--- amounts → moles ---');
const near = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(Math.abs(a), Math.abs(b), 1e-300);
check('mass: 3.65 g HCl', near(molesOf({ method: 'mass', mass: '3.65' }, 'HCl'), 0.1), true);
check('moles: 0.250 mol', molesOf({ method: 'mol', mol: '0.250' }, 'HCl'), 0.25, 0);
check('moles: no molar mass needed (unknown formula is fine)', molesOf({ method: 'mol', mol: '2' }, 'Xx2'), 2, 0);
check('solution: 25.0 cm³ of 0.200 mol dm⁻³', near(molesOf({ method: 'conc', conc: '0.200', cvol: '25.0', cvolUnit: 'cm3' }, 'HCl'), 0.005), true);
check('solution: 0.025 dm³ of 0.200 mol dm⁻³', near(molesOf({ method: 'conc', conc: '0.200', cvol: '0.025', cvolUnit: 'dm3' }, 'HCl'), 0.005), true);
check('gas: 480 cm³ at RTP', near(molesOf({ method: 'gas', gvol: '480', gvolUnit: 'cm3', cond: 'RTP' }, 'H2'), 0.02), true);
check('gas: 2.24 dm³ at STP', near(molesOf({ method: 'gas', gvol: '2.24', gvolUnit: 'dm3', cond: 'STP' }, 'H2'), 0.1), true);
check('an empty amount is NaN', isNaN(molesOf({ method: 'mol', mol: '' }, 'H2')), true);
check('zero moles is NaN', isNaN(molesOf({ method: 'mol', mol: '0' }, 'H2')), true);
check('negative mass is NaN', isNaN(molesOf({ method: 'mass', mass: '-2' }, 'H2')), true);
check('a solution with no volume is NaN', isNaN(molesOf({ method: 'conc', conc: '0.2', cvol: '', cvolUnit: 'cm3' }, 'HCl')), true);
check('an unknown method is NaN', isNaN(molesOf({ method: 'dozens', mass: '3' }, 'H2')), true);

console.log('\n--- yield maths (N2 + 3H2 <=> 2NH3) ---');
const haber = QUAL.find(q => q.eq === 'N2 + 3H2 <=> 2NH3');
const inMol = n => ({ method: 'mol', mol: String(n) });
const run = (target, unit, known, amounts) => solveProblem({ q: haber, prodIdx: 0, target, unit, cond: 'RTP',
  inA: amounts ? inMol(amounts[0]) : { method: 'mass', mass: '28.0' }, inB: amounts ? inMol(amounts[1]) : { method: 'mass', mass: '10.0' },
  known: known || { actual: '', percent: '' } });
const t1 = run('theoretical', 'mass');
check('28.0 g N2 + 10.0 g H2: N2 runs out first', t1.res.limiting === haber.A, true);
check('theoretical NH3 = 2 mol', near(t1.y.nTheo, 2), true);
check('theoretical NH3 = 34.0 g', near(t1.y.theoretical, 34.0), true);
check('the same in dm³ at RTP', near(run('theoretical', 'gas').y.theoretical, 48.0), true);
check('the same in mol', near(run('theoretical', 'mol').y.theoretical, 2), true);
check('percentage yield: 25.5 g of 34.0 g = 75 %', near(run('percent', 'mass', { actual: '25.5', percent: '' }).y.percent, 75), true);
check('percentage yield in mol: 1.5 of 2 = 75 %', near(run('percent', 'mol', { actual: '1.5', percent: '' }).y.percent, 75), true);
check('actual yield: 75 % of 34.0 g = 25.5 g', near(run('actual', 'mass', { actual: '', percent: '75' }).y.actual, 25.5), true);
check('percentages above 100 are kept, not clamped', near(run('percent', 'mass', { actual: '40.8', percent: '' }).y.percent, 120), true);
const tie = run('theoretical', 'mol', null, [1, 3]);
check('1 mol N2 + 3 mol H2 is a tie', tie.res.tie, true);
check('a tie still gives the yield (2 mol)', near(tie.y.nTheo, 2), true);
const hLim = run('theoretical', 'mol', null, [2, 3]);
check('2 mol N2 + 3 mol H2: H2 runs out first', hLim.res.limiting === haber.B, true);
check('… and makes 2 mol NH3', near(hLim.y.nTheo, 2), true);
check('prodIdx past the end falls back to the last product', solveProblem({ q: haber, prodIdx: 9, target: 'theoretical', unit: 'mol', cond: 'RTP', inA: inMol(1), inB: inMol(3), known: {} }).idx, 0, 0);
const water = QUAL.find(q => q.eq === '2H2 + O2 -> 2H2O');
const w = solveProblem({ q: water, prodIdx: 0, target: 'theoretical', unit: 'mass', cond: 'RTP', inA: inMol(0.5), inB: inMol(0.5), known: {} });
check('2H2 + O2: 0.5 mol each, H2 runs out, 0.5 mol = 9.0 g water', w.res.limiting === water.A && near(w.y.theoretical, 9.0), true);

console.log('\n--- the pivot views are gone ---');
check('pivotView is not exported', C.pivotView, undefined, 0);
check('ratioCompareView is not exported', C.ratioCompareView, undefined, 0);

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
