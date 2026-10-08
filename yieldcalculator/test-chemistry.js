/* Smoke test for the yield engine — run with `node test-chemistry.js`.
   Covers molar masses, the molar gas volume constants, and the atom-balance
   check that guards the custom-reaction builder. */
const C = require('./chemistry.js');
const { composition, molarMass, MOLAR_VOL } = C;

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

console.log(fail ? `\n${fail} failure(s)` : '\nall passed');
process.exit(fail ? 1 : 0);
