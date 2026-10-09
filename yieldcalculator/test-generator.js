/* Tests for the practice-problem generator — run with `node test-generator.js`.
   Needs chemistry.js and generator.js next to it. Exits non-zero on any failure.

   The generator's chemistry decisions (phases, solubility, which reactions are
   usable) are checked here against independent rules written out again from the
   spec — a second opinion, not the generator's own table. Every scenario is then
   re-derived from the *displayed* givens using the apps' exact formulas. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Generator = require('./generator.js');
const { QUAL, molarMass, computeLimiting, MOLAR_VOL, parseReaction, composition } = require('./chemistry.js');

const PER_LEVEL = +process.env.PER_LEVEL || 3000;     // the knob is for quick local runs; the default is the bar
const LEVELS = ['moles', 'grams', 'mixed'];

let failed = 0, checks = 0;
function check(label, ok, detail) {
  checks++;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ': ' + detail : ''}`);
}
// Per-scenario rules are tallied, not printed one by one.
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
const sp3 = x => Number(x.toPrecision(3));
const sigDigits = s => s.replace('.', '').replace(/^0+/, '').length;

/* ---- Independent oracles (written from the spec, not from generator.js) ------ */
const TRUE_GASES = new Set(['H2', 'O2', 'N2', 'Cl2', 'CO2', 'CO', 'NO', 'SO2', 'NH3', 'CH4', 'C2H6', 'C3H8', 'C4H10', 'C2H4', 'C2H2', 'C3H6']);
const GAS_NO_VOLUME = new Set(['NO2']);                         // N2O4 dimerises
const LIQUIDS = new Set(['H2O', 'Br2', 'C2H5OH', 'CH3OH', 'C3H7OH', 'C4H9OH', 'C5H12', 'C6H14', 'C7H16', 'C8H18', 'CS2', 'SO3', 'SiCl4']);
const MOLECULAR_SOLUTES = new Set(['HCl', 'HBr', 'HI', 'HNO3', 'H2SO4', 'H3PO4', 'CH3COOH', 'NH3', 'H3C6H5O7']);
const ANIONS = [
  [/CH3COO/, 'acetate'], [/S2O3$/, 'thiosulfate'], [/C6H5O7$/, 'citrate'], [/\(?NO3\)?\d*$/, 'nitrate'],
  [/\(?SO4\)?\d*$/, 'sulfate'], [/HCO3$/, 'hydrogencarbonate'], [/\(?CO3\)?\d*$/, 'carbonate'], [/\(?PO4\)?\d*$/, 'phosphate'],
  [/\(?OH\)?\d*$/, 'hydroxide'], [/Cl\d*$/, 'chloride'], [/Br\d*$/, 'bromide'], [/I\d*$/, 'iodide'], [/S\d*$/, 'sulfide'], [/O\d*$/, 'oxide']
];
// School solubility rules: "can this be a normal laboratory solution?"
function oracleSoluble(sp) {
  if (LIQUIDS.has(sp) || GAS_NO_VOLUME.has(sp)) return false;
  if (MOLECULAR_SOLUTES.has(sp)) return true;
  if (Object.keys(composition(sp)).length === 1) return false;          // an element
  const anion = (ANIONS.find(a => a[0].test(sp)) || [null, null])[1];
  if (!anion) return false;
  const cation = anion === 'acetate' ? sp.replace(/CH3COO/g, '').replace(/[()\d]/g, '') : (/^\(?NH4/.test(sp) ? 'NH4' : sp.match(/^\(?([A-Z][a-z]?)/)[1]);
  if (['Na', 'K', 'Li', 'NH4'].includes(cation)) return true;
  if (anion === 'nitrate' || anion === 'acetate') return true;
  if (['chloride', 'bromide', 'iodide'].includes(anion)) return !['Ag', 'Pb'].includes(cation);
  if (anion === 'sulfate') return !['Ba', 'Pb', 'Ca', 'Ag'].includes(cation);
  if (anion === 'hydroxide') return cation === 'Ba';                    // Ca(OH)2, Mg(OH)2 … sparingly or not at all
  return false;                                                          // carbonate, phosphate, sulfide, oxide …
}
function oraclePhase(sp) {
  if (TRUE_GASES.has(sp) || GAS_NO_VOLUME.has(sp)) return 'gas';
  if (LIQUIDS.has(sp)) return 'liquid';
  return oracleSoluble(sp) ? 'aq' : 'solid';
}
// Nothing burns in solution: no concentration × volume in a combustion.
const oracleKinds = (sp, q) => ['mol', 'mass'].concat(oracleSoluble(sp) && q.cat !== 'comb' ? ['conc'] : [], TRUE_GASES.has(sp) ? ['gas'] : []);
// Violent or corrosive: a piece, not a block.
const SMALL = { Na: 0.1, K: 0.1, Br2: 0.1 };
// What must never be in a reaction a student is asked about.
const HAZARD_ELEMENTS = ['F', 'Xe', 'Se', 'Cs', 'Ge', 'Sc', 'Bi', 'Ti'];
const HAZARD_SPECIES = new Set(['HCN', 'H2S', 'COCl2', 'KO2', 'Na2O2', 'K2O2', 'NaCN', 'Na2S', 'PCl5', 'PCl3', 'PBr3', 'H2CO3', 'H2SO3']);

// What dissolves at room temperature (20 °C, the apps' RTP), mol dm⁻³, data-book figures rounded down: a solution given
// may be at most 80 % of it. Written out here, from the solubility tables, so the caps in generator.js are checked against
// something else. Ba(NO3)2 is the one salt whose solubility drops fast in a cool lab (0.34 at 20 °C, 0.25 at 10 °C): its figure is the cool one.
const SATURATION = {
  NaOH: 20, KOH: 15, LiOH: 5, 'Ba(OH)2': 0.2, HCl: 12, HBr: 8.8, HI: 7.6, HNO3: 15.8, H2SO4: 18, CH3COOH: 17, NH3: 15, H3C6H5O7: 3.1,
  NaCl: 6, KBr: 5, NaBr: 8, KI: 8, NaI: 10, Na2CO3: 1.9, K2CO3: 8, NaHCO3: 1.1, KHCO3: 3.3, Na2SO4: 1.3, K2SO4: 0.64, K3PO4: 4.2,
  MgSO4: 2.9, ZnSO4: 3.3, CuSO4: 1.3, FeSO4: 1.7, AgNO3: 12, 'Pb(NO3)2': 1.6, 'Cu(NO3)2': 7, 'Ni(NO3)2': 4, 'Ba(NO3)2': 0.25,
  BaCl2: 1.7, CaCl2: 6.7, MgCl2: 5.7, CuCl2: 4.3, FeCl2: 5.3, FeCl3: 5.3, NiCl2: 4.8, CoCl2: 4.4
};
// Reactions that are the reaction only while one reactant is short: the contract, spelled out
// (equation → the reactant that must run out). generator.js has to say exactly this.
const EXPECT_ONE_WAY = {
  'Na2CO3 + 2HCl -> 2NaCl + H2O + CO2': 'Na2CO3', 'Na2CO3 + H2SO4 -> Na2SO4 + H2O + CO2': 'Na2CO3', 'Na2CO3 + 2HNO3 -> 2NaNO3 + H2O + CO2': 'Na2CO3',
  'K2CO3 + 2HCl -> 2KCl + H2O + CO2': 'K2CO3', 'K2CO3 + H2SO4 -> K2SO4 + H2O + CO2': 'K2CO3', 'K2CO3 + 2HNO3 -> 2KNO3 + H2O + CO2': 'K2CO3',
  '3NaHCO3 + H3C6H5O7 -> 3CO2 + 3H2O + Na3C6H5O7': 'H3C6H5O7',
  'Fe2O3 + 3CO -> 2Fe + 3CO2': 'Fe2O3', 'Fe2O3 + 3H2 -> 2Fe + 3H2O': 'Fe2O3', 'WO3 + 3H2 -> W + 3H2O': 'WO3', 'ZnO + C -> Zn + CO': 'ZnO', 'SnO2 + 2C -> Sn + 2CO': 'SnO2',
  '2Cu + O2 -> 2CuO': 'Cu', '4NH3 + 3O2 -> 2N2 + 6H2O': 'O2', '2Na + 2H2O -> 2NaOH + H2': 'Na', '2K + 2H2O -> 2KOH + H2': 'K'
};
// Solutions that must be a particular strength for this reaction (mol dm⁻³, inclusive).
const EXPECT_WINDOW = {
  '3Cu + 8HNO3 -> 3Cu(NO3)2 + 4H2O + 2NO': { HNO3: [1.0, 2.0] },
  'Sn + 2HCl -> SnCl2 + H2': { HCl: [1.0, 2.0] }, 'Ni + 2HCl -> NiCl2 + H2': { HCl: [1.0, 2.0] },
  'Co + 2HCl -> CoCl2 + H2': { HCl: [1.0, 2.0] }, 'Ni + H2SO4 -> NiSO4 + H2': { H2SO4: [1.0, 2.0] }
};

// The apps' molesOf(), transcribed from app.js (the inputs are strings, as typed).
function appMoles(g, sp) {
  const inp = Generator.toInput(g);                            // exactly the strings the apps' fields would hold
  if (inp.method === 'mol') return g.value;
  if (inp.method === 'mass') { const m = parseFloat(inp.mass), M = molarMass(sp); return (m > 0) ? m / M : NaN; }
  if (inp.method === 'conc') { const c = parseFloat(inp.conc); let V = parseFloat(inp.cvol); if (!(c > 0) || !(V > 0)) return NaN; if (inp.cvolUnit === 'cm3') V /= 1000; return c * V; }
  if (inp.method === 'gas') { let V = parseFloat(inp.gvol); if (!(V > 0)) return NaN; if (inp.gvolUnit === 'cm3') V /= 1000; return V / MOLAR_VOL[inp.cond]; }
  return NaN;
}
// Moles worked out from the PRINTED text alone (what a student reads), by the apps' formulas.
function printedMoles(g, sp) {
  const d = Generator.describe(g, sp), nums = (d.match(/[0-9.]+/g) || []).map(parseFloat);
  if (g.kind === 'mol') return nums[0];
  if (g.kind === 'mass') return nums[0] / molarMass(sp);
  if (g.kind === 'conc') return nums[1] * (nums[0] / 1000);
  const V = /cm³/.test(d) ? nums[0] / 1000 : nums[0];
  return V / MOLAR_VOL[/STP/.test(d) ? 'STP' : 'RTP'];
}
const VOLS = [10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250];
// Which side ('A' | 'B') must run out for a one-way reaction, by the table above; null for the rest.
const mustSide = q => (EXPECT_ONE_WAY[q.eq] ? (q.A.sp === EXPECT_ONE_WAY[q.eq] ? 'A' : 'B') : null);
const speciesOf = q => parseReaction(q.eq).reactants.concat(parseReaction(q.eq).products).map(t => t.sp);
const show = sc => `${sc.q.eq} | ${sc.q.A.sp}: ${Generator.describe(sc.givens[0], sc.q.A.sp)} | ${sc.q.B.sp}: ${Generator.describe(sc.givens[1], sc.q.B.sp)} | ${sc.design.limiting} ×${sc.design.margin.toFixed(2)}`;

/* ---- One scenario against every rule ---------------------------------------------- */
function validate(sc, level, avoid) {
  const E = (rule, ok, info) => expect(rule, ok, () => show(sc) + (info ? '  :: ' + info : ''));
  const q = sc.q, sps = [q.A.sp, q.B.sp];
  E('q is the built-in QUAL entry', QUAL[q.id] === q);
  E('reaction is safe', Generator.isSafe(q));
  E('no ions in the equation', !/\^/.test(q.eq) && !q.hadSpect);
  E('no equilibrium', !q.equil && !/<=>/.test(q.eq));
  E('level echoed', sc.level === level);
  E('cond travels: q.cond untouched, scenario.cond = Generator.condition(q) and starts with it', q.cond === QUAL[q.id].cond && sc.cond === Generator.condition(q) && sc.cond.indexOf(q.cond) === 0, `${q.cond} | ${sc.cond}`);
  E('avoid respected', !avoid || !avoid.includes(q.id));
  E('two givens in A, B order', Array.isArray(sc.givens) && sc.givens.length === 2);
  const n = sc.givens.map((g, i) => appMoles(g, sps[i]));
  E('moles computed from the displayed givens (apps\' formulas)', n[0] === sc.nA && n[1] === sc.nB, `${n} vs ${sc.nA}, ${sc.nB}`);
  E('moles computed from the PRINTED text equal nA, nB', printedMoles(sc.givens[0], q.A.sp) === sc.nA && printedMoles(sc.givens[1], q.B.sp) === sc.nB,
    `${printedMoles(sc.givens[0], q.A.sp)}, ${printedMoles(sc.givens[1], q.B.sp)} vs ${sc.nA}, ${sc.nB}`);
  E('no NaN / Infinity / 0', [sc.nA, sc.nB, sc.design.margin].every(x => Number.isFinite(x) && x > 0));
  sc.givens.forEach((g, i) => {
    const sp = sps[i], M = molarMass(sp);
    E('given kind is one of four', ['mol', 'mass', 'conc', 'gas'].includes(g.kind), g.kind);
    E('given kind legal for the species and reaction (oracle)', oracleKinds(sp, q).includes(g.kind), `${sp} ${g.kind}`);
    E('no solution in a combustion', q.cat !== 'comb' || g.kind !== 'conc');
    E('Na, K and Br2 stay small (≤ 0.1 mol)', !(sp in SMALL) || n[i] <= SMALL[sp] * (1 + 1e-9), `${sp} ${n[i]} mol`);
    if (level === 'moles') E('level moles: mol only', g.kind === 'mol');
    if (level === 'grams') E('level grams: mass only', g.kind === 'mass');
    E('reactant between 0.005 and 1.5 mol', n[i] >= 0.005 * (1 - 1e-9) && n[i] <= 1.5 * (1 + 1e-9), `n=${n[i]}`);
    E('no reactant over 60 g whatever the given', n[i] * M <= 60 * (1 + 1e-9), `${n[i] * M} g`);
    if (g.kind === 'mol') E('mol: value has ≤ 3 s.f.', sp3(g.value) === g.value, g.value);
    if (g.kind === 'mass') {
      E('mass: unit g', g.unit === 'g');
      E('mass: 0.1 to 60 g', g.value >= 0.1 && g.value <= 60, g.value);
      E('mass: value has ≤ 3 s.f.', sp3(g.value) === g.value, g.value);
    }
    if (g.kind === 'conc') {
      const cap = Math.min(2.0, Generator.species(sp).concMax), win = (EXPECT_WINDOW[q.eq] || {})[sp];
      E('conc: at most 80 % of what dissolves (independent table)', SATURATION[sp] !== undefined && g.conc <= 0.8 * SATURATION[sp] * (1 + 1e-9), `${sp} ${g.conc} vs ${SATURATION[sp]}`);
      E('conc: the strength this reaction needs (dilute HNO3 for NO, acid a slow metal will dissolve in)', !win || (g.conc >= win[0] * (1 - 1e-9) && g.conc <= win[1] * (1 + 1e-9)), `${sp} ${g.conc}`);
      E('conc: only for a soluble species (oracle)', oracleSoluble(sp), sp);
      E('conc: 0.05 to 2.0 mol dm⁻³ and under the species cap', g.conc >= 0.05 && g.conc <= cap * (1 + 1e-9), `${g.conc} cap ${cap}`);
      E('conc: Ba(OH)2 never above 0.10', sp !== 'Ba(OH)2' || g.conc <= 0.1 + 1e-12);
      E('conc: solutions are in cm³', g.volUnit === 'cm3');
      E('conc: volume from the nice list', VOLS.includes(g.vol), g.vol);
      E('conc: value has ≤ 3 s.f.', sp3(g.conc) === g.conc, g.conc);
      E('conc: never Ca(OH)2 / Mg(OH)2 / a solid / a liquid', !['Ca(OH)2', 'Mg(OH)2'].includes(sp) && !LIQUIDS.has(sp));
    }
    if (g.kind === 'gas') {
      const dm3 = g.volUnit === 'cm3' ? g.vol / 1000 : g.vol;
      E('gas: only a true gas (oracle)', TRUE_GASES.has(sp), sp);
      E('gas: never NO2 / SO3', sp !== 'NO2' && sp !== 'SO3');
      E('gas: 0.05 to 10 dm³', dm3 >= 0.05 * (1 - 1e-9) && dm3 <= 10 * (1 + 1e-9), `${dm3} dm³`);
      E('gas: dm³ from 1 dm³ up, cm³ below', g.volUnit === 'dm3' ? g.vol >= 1 : (g.volUnit === 'cm3' && g.vol < 1000), `${g.vol} ${g.volUnit}`);
      E('gas: condition RTP or STP', g.cond === 'RTP' || g.cond === 'STP');
      E('gas: value has ≤ 3 s.f.', sp3(g.vol) === g.vol, g.vol);
    }
    // describe() reads the way a student would
    const d = Generator.describe(g, sp);
    const re = { mol: /^[0-9.]+ mol$/, mass: /^[0-9.]+ g$/, conc: /^[0-9.]+ cm³ of [0-9.]+ mol dm⁻³$/, gas: /^[0-9.]+ (cm³|dm³) gas at (RTP|STP)$/ }[g.kind];
    E('describe(): matches the student format', typeof d === 'string' && re.test(d), d);
    E('describe(): every number shows 3 s.f.', (d.match(/[0-9.]+/g) || []).filter(x => !/^3$/.test(x)).every(x => sigDigits(x) === 3), d);
    const t = Generator.toInput(g);
    E('toInput(): the apps\' input shape', g.kind === 'mol' ? parseFloat(t.mol) === g.value : (t.method === g.kind && Object.keys(t).length === 8), JSON.stringify(t));
    E('toInput(): the strings are the printed numbers and parse back to the given', g.kind === 'mol' ? t.mol === d.split(' ')[0]
      : g.kind === 'mass' ? t.mass === d.split(' ')[0] && parseFloat(t.mass) === g.value
      : g.kind === 'conc' ? d === `${t.cvol} cm³ of ${t.conc} mol dm⁻³` && parseFloat(t.conc) === g.conc && parseFloat(t.cvol) === g.vol && t.cvolUnit === 'cm3'
      : d === `${t.gvol} ${t.gvolUnit === 'cm3' ? 'cm³' : 'dm³'} gas at ${t.cond}` && parseFloat(t.gvol) === g.vol, JSON.stringify(t) + ' vs ' + d);
    E('molesOf() equals the apps\' formula', Generator.molesOf(g, sp) === n[i]);
  });
  if (sc.givens[0].kind === 'gas' && sc.givens[1].kind === 'gas') E('two gases share one condition', sc.givens[0].cond === sc.givens[1].cond);
  // yields(): theoretical amounts and the units worth asking them in
  const prods = parseReaction(q.eq).products, ys = Generator.yields(sc), batchL = Math.min(n[0] / q.A.coef, n[1] / q.B.coef);
  E('yields(): one entry per product, in order', ys.length === prods.length && ys.every((y, i) => y.sp === prods[i].sp && y.coef === prods[i].coef));
  ys.forEach(y => {
    const M = molarMass(y.sp);
    E('yields(): n = limiting batch × coefficient', Math.abs(y.n - batchL * y.coef) <= 1e-12 * y.n, `${y.sp}`);
    E('yields(): mass = n × Mr', Math.abs(y.mass - y.n * M) <= 1e-12 * y.mass);
    E('yields(): moles always offered, grams only from 0.1 g', y.units[0] === 'mol' && y.units.includes('g') === (y.mass >= 0.1), `${y.sp} ${y.mass} g`);
    E('yields(): dm³ only for a true gas, never NO2 / SO3 / HCl / H2O', !y.units.includes('dm3') || TRUE_GASES.has(y.sp), y.sp);
    E('yields(): gas volumes present exactly for true gases', (y.gas !== undefined) === TRUE_GASES.has(y.sp), y.sp);
    if (y.gas) {
      E('yields(): gas volumes are n × Vm', Math.abs(y.gas.RTP - y.n * 24) < 1e-9 && Math.abs(y.gas.STP - y.n * 22.4) < 1e-9);
      const ok = Math.min(y.gas.RTP, y.gas.STP) >= 0.05 && Math.max(y.gas.RTP, y.gas.STP) <= 20;
      E('yields(): dm³ offered exactly when 0.05–20 dm³', y.units.includes('dm3') === ok, `${y.sp} ${y.gas.RTP}`);
    }
    if (QUAL[0].products && typeof require('./chemistry.js').theoreticalMoles === 'function') {
      const prod = q.products.find(p => p.sp === y.sp && p.coef === y.coef);
      E('yields(): agrees with the yield trainer\'s theoreticalMoles()', prod && Math.abs(require('./chemistry.js').theoreticalMoles(sc.res, prod) - y.n) <= 1e-9 * y.n);
    }
  });
  // verdict, margin, ties — recomputed from the displayed givens
  const res = computeLimiting(q, n[0], n[1]);
  const bA = n[0] / q.A.coef, bB = n[1] / q.B.coef;
  const margin = Math.max(bA, bB) / Math.min(bA, bB);
  const verdict = res.tie ? 'tie' : (res.limiting === q.A ? 'A' : 'B');
  E('res is computeLimiting on the displayed givens', sc.res.tie === res.tie && sc.res.leftMol === res.leftMol && sc.res.leftMass === res.leftMass
    && (sc.res.limiting ? sc.res.limiting.sp : null) === (res.limiting ? res.limiting.sp : null));
  E('verdict stable after rounding (design = computeLimiting)', sc.design.limiting === verdict, `${sc.design.limiting} vs ${verdict}`);
  const must = EXPECT_ONE_WAY[q.eq];
  E('direction: a reaction that only holds one way round has that reactant running out (or a tie)',
    !must || verdict === 'tie' || (verdict === 'A' ? q.A.sp : q.B.sp) === must, `${verdict} limits, ${must} must`);
  if (verdict === 'tie') {
    E('tie: computeLimiting reports a real tie', res.tie === true && sc.res.tie === true);
    E('tie: margin 1', sc.design.margin === 1);
  } else {
    E('margin ≥ 1.15', margin >= 1.15, margin);
    E('design.margin is the recomputed ratio', Math.abs(sc.design.margin - margin) <= 1e-12 * margin);
    E('margin not absurd (≤ 5)', margin <= 5, margin);
    E('something is left over (≥ 0.003 mol and ≥ 0.05 g)', res.leftMol >= 0.003 && res.leftMass >= 0.05, `${res.leftMol} mol ${res.leftMass} g`);
  }
  E('every product is a measurable amount (≥ 0.004 mol)', parseReaction(q.eq).products.every(p => Math.min(bA, bB) * p.coef >= 0.004 * (1 - 1e-9)));
  return verdict;
}

/* ============================================================================ */
const variant = QUAL[0].products ? 'B (QUAL entries carry products)' : 'A (QUAL entries have no products)';
console.log(`Engine variant ${variant}; ${QUAL.length} reactions in QUAL.`);
const qualBefore = JSON.stringify(QUAL);
const safe = Generator.safeList();

section('reaction filter');
check('safe list is a sizeable subset of QUAL', safe.length >= 150 && safe.length < QUAL.length, `${safe.length} of ${QUAL.length}`);
check('safeList() entries are the QUAL objects themselves', safe.every(q => QUAL[q.id] === q));
check('safeList() returns a copy', Generator.safeList() !== Generator.safeList());
let bad = safe.filter(q => /\^/.test(q.eq) || q.equil || /<=>/.test(q.eq) || q.hadSpect);
check('no ionic, equilibrium or spectator reaction is safe', bad.length === 0, bad.map(q => q.eq).join('; '));
bad = safe.filter(q => speciesOf(q).some(s => molarMass(s) == null));
check('every species in a safe reaction has a molar mass', bad.length === 0, bad.map(q => q.eq).join('; '));
const tally = side => side.reduce((acc, t) => { const c = composition(t.sp); for (const el in c) acc[el] = (acc[el] || 0) + t.coef * c[el]; return acc; }, {});
bad = safe.filter(q => { const p = parseReaction(q.eq), l = tally(p.reactants), r = tally(p.products); return ![...new Set(Object.keys(l).concat(Object.keys(r)))].every(e => (l[e] || 0) === (r[e] || 0)); });
check('every safe equation is balanced, atom by atom', bad.length === 0, bad.map(q => q.eq).join('; '));
bad = safe.filter(q => !Number.isInteger(q.A.coef) || !Number.isInteger(q.B.coef) || q.A.coef < 1 || q.B.coef < 1 || parseReaction(q.eq).reactants.length !== 2);
check('every safe reaction has exactly two reactants with whole-number coefficients', bad.length === 0, bad.map(q => q.eq).join('; '));
bad = safe.filter(q => /disprop|incomplete|recombin|does not/i.test(q.cond));
check('no safe reaction is flagged as incomplete / disproportionation / recombining', bad.length === 0, bad.map(q => q.eq).join('; '));
bad = safe.filter(q => speciesOf(q).some(s => HAZARD_SPECIES.has(s) || HAZARD_ELEMENTS.some(e => composition(s)[e])));
check('no hazardous or exotic species (F, Xe, HCN, H2S, phosgene, superoxide …) in a safe reaction', bad.length === 0, bad.map(q => q.eq).join('; '));
bad = safe.filter(q => ['complex', 'titr', 'gasform', 'elec'].includes(q.cat));
check('no complex / titration / gas-forming / electrolysis row is safe', bad.length === 0, bad.map(q => q.eq).join('; '));
const unsafe = QUAL.filter(q => !Generator.isSafe(q));
check('every rejected reaction carries a one-line reason', unsafe.every(q => typeof Generator.rejection(q) === 'string' && Generator.rejection(q).length > 5 && !/\n/.test(Generator.rejection(q))));
check('safe + rejected = QUAL', safe.length + unsafe.length === QUAL.length);
const decisions = Generator.decisions();
bad = Object.keys(decisions).filter(eq => !QUAL.some(q => q.eq === eq));
check('every judgement in the reject table names a real reaction (no typos)', bad.length === 0, bad.join('; '));
bad = Object.keys(decisions).filter(eq => { const q = QUAL.find(x => x.eq === eq); return q && Generator.isSafe(q); });
check('every judgement in the reject table takes effect', bad.length === 0, bad.join('; '));
const mustReject = [
  'Ag^+ + Cl^- -> AgCl', 'N2 + 3H2 <=> 2NH3', '2SO2 + O2 <=> 2SO3', 'MnO4^- + 5Fe^2+ + 8H^+ -> Mn^2+ + 5Fe^3+ + 4H2O', 'Cu^2+ + 4NH3 -> [Cu(NH3)4]^2+',
  'Cl2 + 2NaOH -> NaCl + NaClO + H2O', '3Cl2 + 6NaOH -> 5NaCl + NaClO3 + 3H2O', '2C + O2 -> 2CO', 'H2 + F2 -> 2HF', 'I2 + 3XeF2 -> 2IF3 + 3Xe', 'I2 + F2 -> 2IF',
  '4KO2 + 2CO2 -> 2K2CO3 + 3O2', 'K + O2 -> KO2', 'Na2SiO3 + 8HF -> H2SiF6 + 2NaF + 3H2O', 'CO + Cl2 -> COCl2', '2NaCN + H2SO4 -> Na2SO4 + 2HCN', '2HCl + Na2S -> H2S + 2NaCl',
  'TiCl4 + 2Mg -> Ti + 2MgCl2', 'SiO2 + 2F2 -> SiF4 + O2', 'Ti + 2F2 -> TiF4', 'SeO2 + 2NaOH -> Na2SeO3 + H2O', '2NaCl + 2H2O -> 2NaOH + H2 + Cl2',
  'CaCO3 + H2SO4 -> CaSO4 + H2O + CO2', 'CO2 + 2NaOH -> Na2CO3 + H2O', 'Ca(OH)2 + CO2 -> CaCO3 + H2O', 'H3PO4 + 3NaOH -> Na3PO4 + 3H2O', 'Cl2 + 2KI -> 2KCl + I2',
  // the chemistry-logic audit: the stated equation is not what happens for every pair of amounts, or the precipitate/gas is not there
  'H2SO4 + Ca(OH)2 -> CaSO4 + 2H2O', 'Ca + 2HCl -> CaCl2 + H2', 'Pb(NO3)2 + 2NaCl -> PbCl2 + 2NaNO3', 'Pb(NO3)2 + 2KBr -> PbBr2 + 2KNO3',
  'SO3 + H2O -> H2SO4', 'Na2S2O3 + 2HCl -> 2NaCl + S + SO2 + H2O', '2Na + 2HCl -> 2NaCl + H2', '2AgNO3 + Na2SO4 -> Ag2SO4 + 2NaNO3',
  'Cu + 4HNO3 -> Cu(NO3)2 + 2H2O + 2NO2', 'Fe + 2AgNO3 -> Fe(NO3)2 + 2Ag', '4Fe + 3O2 -> 2Fe2O3', 'P4 + 5O2 -> P4O10', 'ZnSO4 + 2NaOH -> Zn(OH)2 + Na2SO4'
];
bad = mustReject.filter(eq => !QUAL.some(q => q.eq === eq) || Generator.isSafe(QUAL.find(q => q.eq === eq)));
check('spec exclusions and known chemistry traps stay rejected', bad.length === 0, bad.join('; '));
const mustKeep = ['HCl + NaOH -> NaCl + H2O', 'Zn + 2HCl -> ZnCl2 + H2', 'CaCO3 + 2HCl -> CaCl2 + H2O + CO2', 'CH4 + 2O2 -> CO2 + 2H2O', 'AgNO3 + NaCl -> AgCl + NaNO3',
  '2Al + Fe2O3 -> Al2O3 + 2Fe', '2H2 + O2 -> 2H2O', 'CuSO4 + 2NaOH -> Cu(OH)2 + Na2SO4', 'Mg + CuSO4 -> MgSO4 + Cu', 'H2SO4 + 2NaOH -> Na2SO4 + 2H2O',
  'Na2CO3 + 2HCl -> 2NaCl + H2O + CO2', 'Fe2O3 + 3CO -> 2Fe + 3CO2', 'Mg + 2HCl -> MgCl2 + H2', 'C3H8 + 5O2 -> 3CO2 + 4H2O', 'Fe + CuSO4 -> FeSO4 + Cu', 'CuO + H2 -> Cu + H2O'];
bad = mustKeep.filter(eq => !Generator.isSafe(QUAL.find(q => q.eq === eq)));
check('textbook staples stay safe', bad.length === 0, bad.join('; '));
check('isSafe() is false for objects outside the database', !Generator.isSafe({ eq: 'A + B -> C', cat: 'custom', A: { coef: 1, sp: 'H2' }, B: { coef: 1, sp: 'O2' } }) && !Generator.isSafe(null));
const cats = {}; safe.forEach(q => { cats[q.cat] = (cats[q.cat] || 0) + 1; });
console.log('     safe by category: ' + Object.keys(cats).map(c => `${c} ${cats[c]}`).join(', '));

section('chemistry-logic audit: rules written from the chemistry, applied to every safe reaction');
{
  const spOf = q => [q.A.sp, q.B.sp];
  const prods = q => parseReaction(q.eq).products.map(t => t.sp);
  const ow = q => Generator.oneWay(q);
  const ACID = new Set(['HCl', 'HBr', 'HI', 'HNO3', 'H2SO4']);
  const rule = (label, pool, ok, minimum) => {
    const hit = pool.filter(q => !ok(q));
    check(`${label} (${pool.length} reaction${pool.length === 1 ? '' : 's'} checked)`, hit.length === 0 && pool.length >= (minimum === undefined ? 1 : minimum), hit.map(q => q.eq).join('; '));
  };
  // 1  A soluble normal carbonate takes one H+ first (HCO3-): CO2 only if the acid is in excess. So the carbonate must run out.
  rule('a sodium / potassium carbonate with an acid is one-way, the carbonate running out',
    safe.filter(q => spOf(q).some(sp => /^(Na|K)2CO3$/.test(sp)) && spOf(q).some(sp => ACID.has(sp))),
    q => ow(q) && /^(Na|K)2CO3$/.test(ow(q).sp), 6);
  // 2  A reducing agent that runs short stops at a lower oxide (Fe, W) or lets CO2 form (Zn, Sn): the oxide must run out. CuO + H2 is a single step.
  rule('Fe2O3 / WO3 / ZnO / SnO2 reduced by H2, CO or C is one-way, the oxide running out',
    safe.filter(q => spOf(q).some(sp => ['Fe2O3', 'WO3', 'ZnO', 'SnO2'].includes(sp)) && spOf(q).some(sp => ['H2', 'CO', 'C'].includes(sp))),
    q => ow(q) && ['Fe2O3', 'WO3', 'ZnO', 'SnO2'].includes(ow(q).sp), 5);
  rule('citric acid with hydrogencarbonate is one-way, the citric acid running out',
    safe.filter(q => spOf(q).includes('H3C6H5O7')), q => ow(q) && ow(q).sp === 'H3C6H5O7');
  // 3  Metals that burn to more than one oxide: rejected, or (copper) one-way with the metal running out
  const MULTI = ['Na', 'K', 'Fe', 'Cr', 'P', 'P4', 'Cu'];
  rule('a metal / element with more than one oxide burnt in O2 is rejected, or one-way with the metal running out',
    safe.filter(q => q.cat === 'comb' && spOf(q).some(sp => MULTI.includes(sp))), q => ow(q) && MULTI.includes(ow(q).sp));
  rule('sodium / potassium + water is one-way, the metal running out (water is always in excess; with too little the metal reacts on with the hydroxide)',
    safe.filter(q => spOf(q).some(sp => ['Na', 'K'].includes(sp)) && spOf(q).includes('H2O')), q => ow(q) && ['Na', 'K'].includes(ow(q).sp), 2);
  rule('ammonia burning to N2 is one-way, the O2 running out (excess O2 and any catalyst give NO)',
    safe.filter(q => spOf(q).includes('NH3') && spOf(q).includes('O2')), q => ow(q) && ow(q).sp === 'O2');
  // 4  Reactions that go a different way when one reactant is short, and are not made one-way: must not be safe at all
  rule('no CO2 / SO2 / SO3 with a hydroxide, and no CO2 with limewater (product depends on which is in excess)',
    safe.filter(q => spOf(q).some(sp => ['CO2', 'SO2', 'SO3'].includes(sp)) && spOf(q).some(sp => /OH/.test(sp) && sp !== 'H2O')), () => false, 0);
  rule('no halogen displacing iodide (excess halogen goes on to iodate)',
    safe.filter(q => spOf(q).some(sp => ['Cl2', 'Br2'].includes(sp)) && spOf(q).some(sp => /^[A-Z][a-z]?I$/.test(sp))), () => false, 0);
  rule('no polyprotic H3PO4 neutralisation (the third H+ is only part-removed)', safe.filter(q => spOf(q).includes('H3PO4')), () => false, 0);
  rule('no amphoteric hydroxide precipitated by NaOH (excess redissolves it)',
    safe.filter(q => prods(q).some(sp => ['Zn(OH)2', 'Al(OH)3', 'Cr(OH)3'].includes(sp)) && spOf(q).includes('NaOH')), () => false, 0);
  // 5  Acid + metal: nothing that reacts with water itself, nothing that does not react
  rule('no sodium, potassium, calcium, lithium or caesium in an aqueous acid (the excess would react with the water)',
    safe.filter(q => spOf(q).some(sp => ['Na', 'K', 'Ca', 'Li', 'Cs'].includes(sp)) && spOf(q).some(sp => ACID.has(sp) || sp === 'CH3COOH')), () => false, 0);
  rule('copper, silver, gold, mercury never displace hydrogen from an acid',
    safe.filter(q => q.cat === 'ametal' && spOf(q).some(sp => ['Cu', 'Ag', 'Au', 'Hg', 'Pb'].includes(sp))), () => false, 0);
  // 5b Reactivity series, from standard electrode potentials (V): a metal displaces hydrogen or another metal only if its E° is lower by at least 0.1 V
  const EPOT = { Li: -3.04, K: -2.93, Ca: -2.87, Na: -2.71, Mg: -2.37, Al: -1.66, Mn: -1.18, Zn: -0.76, Cr: -0.74, Fe: -0.44, Co: -0.28, Ni: -0.26, Sn: -0.14, Pb: -0.13, Cu: 0.34, Ag: 0.80 };
  const DISPLACED = new Set(['HCl', 'HBr', 'HI', 'H2SO4', 'CH3COOH']);                 // non-oxidising acids: H⁺ is what the metal reduces
  const eOf = sp => (DISPLACED.has(sp) ? 0 : Object.keys(composition(sp)).filter(el => el in EPOT).map(el => EPOT[el])[0]);
  const metalOf = q => spOf(q).find(sp => sp in EPOT);
  const displacers = safe.filter(q => { const m = metalOf(q), o = spOf(q).find(sp => sp !== m); return m && eOf(o) !== undefined; });
  rule('every metal that displaces hydrogen or another metal is above it in the reactivity series by at least 0.1 V',
    displacers, q => { const m = metalOf(q), o = spOf(q).find(sp => sp !== m); return EPOT[m] + 0.1 <= eOf(o); }, 30);
  // 6  Dilute vs concentrated: no concentrated-acid reaction, and "dilute" always comes with a strength window
  rule('no reaction that needs a concentrated acid', safe.filter(q => /conc/i.test(q.cond)), () => false, 0);
  rule('a "dilute" condition has a strength window of at most 2 mol dm⁻³ on the acid',
    safe.filter(q => /dilute/i.test(q.cond)), q => { const w = EXPECT_WINDOW[q.eq]; return w && Object.keys(w).every(sp => w[sp][1] <= 2.0); });
  // 7  A precipitate or gas has to be there at school concentrations
  rule('no product that stays largely dissolved (PbCl2, PbBr2, CaSO4, Ag2SO4: 0.015 – 0.04 mol dm⁻³) is offered as a precipitate',
    safe.filter(q => prods(q).some(sp => ['PbCl2', 'PbBr2', 'CaSO4', 'Ag2SO4'].includes(sp))), () => false, 0);
  rule('no very soluble gas (SO2, NH3) is a product when one reactant is in aqueous solution',
    safe.filter(q => prods(q).some(sp => ['SO2', 'NH3'].includes(sp)) && spOf(q).some(sp => oracleSoluble(sp) && !TRUE_GASES.has(sp))), () => false, 0);
  // 8  The identity of the product: oxidation state of iron and copper follows the oxidant
  const state = f => {   // oxidation state of the metal in a simple salt of Cl, SO4, NO3, S
    const m = f.match(/^(Fe|Cu)(\d*)(Cl|SO4|S|\(NO3\)|\(SO4\))(\d*)$/);
    if (!m) return null;
    const metal = +(m[2] || 1), anionCharge = { Cl: 1, SO4: 2, S: 2, '(NO3)': 1, '(SO4)': 2 }[m[3]], anions = +(m[4] || 1);
    return anions * anionCharge / metal;
  };
  rule('iron is iron(II) with acid, copper(II) and nickel salts and sulfur, and iron(III) only with chlorine',
    safe.filter(q => spOf(q).includes('Fe') && prods(q).some(sp => /^Fe/.test(sp) && state(sp) !== null)),
    q => prods(q).filter(sp => /^Fe/.test(sp) && state(sp) !== null).every(sp => state(sp) === (spOf(q).includes('Cl2') ? 3 : 2)), 4);
  rule('copper is copper(II) in its chloride and nitrate', safe.filter(q => prods(q).some(sp => /^Cu/.test(sp) && state(sp) !== null)),
    q => prods(q).filter(sp => /^Cu/.test(sp) && state(sp) !== null).every(sp => state(sp) === 2), 3);
  // 9  The contract: the one-way table and the strength windows are exactly these, no more, no less
  const dir = Generator.directions(), want1 = Object.keys(EXPECT_ONE_WAY);
  check(`the one-way table is exactly the ${want1.length} audited reactions, with the audited reactant`,
    Object.keys(dir).sort().join('|') === want1.sort().join('|') && want1.every(eq => dir[eq][0] === EXPECT_ONE_WAY[eq] && typeof dir[eq][1] === 'string' && dir[eq][1].length > 10),
    Object.keys(dir).filter(eq => !(eq in EXPECT_ONE_WAY)).concat(want1.filter(eq => !(eq in dir))).join('; '));
  bad = want1.filter(eq => { const q = QUAL.find(x => x.eq === eq); return !q || !Generator.isSafe(q) || !ow(q) || ow(q).sp !== EXPECT_ONE_WAY[eq] || ow(q).side !== (q.A.sp === EXPECT_ONE_WAY[eq] ? 'A' : 'B'); });
  check('every one-way reaction is a safe reaction, and oneWay() names the right side', bad.length === 0, bad.join('; '));
  check('oneWay() is null for an ordinary reaction, a rejected one, and junk',
    ow(QUAL.find(q => q.eq === 'HCl + NaOH -> NaCl + H2O')) === null && ow(null) === null && ow({}) === null && ow({ eq: 'constructor', A: { sp: 'x' }, B: { sp: 'y' } }) === null);
  const win = Generator.windows();
  check('the strength windows are exactly the audited ones', JSON.stringify(Object.keys(win).sort()) === JSON.stringify(Object.keys(EXPECT_WINDOW).sort())
    && Object.keys(EXPECT_WINDOW).every(eq => Object.keys(EXPECT_WINDOW[eq]).every(sp => win[eq][sp] && win[eq][sp][0] === EXPECT_WINDOW[eq][sp][0] && win[eq][sp][1] === EXPECT_WINDOW[eq][sp][1] && typeof win[eq][sp][2] === 'string')));
  bad = Object.keys(EXPECT_WINDOW).filter(eq => { const q = QUAL.find(x => x.eq === eq); return !q || !Generator.isSafe(q) || Object.keys(EXPECT_WINDOW[eq]).some(sp => !Generator.species(sp).conc || EXPECT_WINDOW[eq][sp][1] > Generator.species(sp).concMax); });
  check('every window is for a safe reaction, on a species that can be a solution, inside its cap', bad.length === 0, bad.join('; '));
}

section('species table vs independent rules');
const allSp = new Set(); safe.forEach(q => speciesOf(q).forEach(s => allSp.add(s)));
bad = [...allSp].filter(s => !Generator.species(s).known);
check(`all ${allSp.size} species in the safe reactions are in the table (none left to the fallback)`, bad.length === 0, bad.join(' '));
const fb = Generator.species('Xx9');
check('an unknown species falls back to a solid: mass / moles only', fb.phase === 'solid' && fb.mass && !fb.conc && !fb.gas && fb.known === false);
bad = [...allSp].filter(s => Generator.species(s).phase !== oraclePhase(s));
check('phase of every species matches the independent rules', bad.length === 0, bad.map(s => `${s}: ${Generator.species(s).phase} vs ${oraclePhase(s)}`).join('; '));
bad = [...allSp].filter(s => Generator.species(s).conc !== oracleSoluble(s));
check('solution-capable ⇔ soluble by the school rules', bad.length === 0, bad.map(s => `${s}: ${Generator.species(s).conc}`).join('; '));
bad = [...allSp].filter(s => Generator.species(s).gas !== TRUE_GASES.has(s));
check('gas volume allowed ⇔ a true gas (never NO2, SO3, HCl, H2O …)', bad.length === 0, bad.join(' '));
bad = [...allSp].filter(s => !Generator.species(s).mass);
check('mass / moles allowed for every species', bad.length === 0, bad.join(' '));
bad = [...allSp].filter(s => { const x = Generator.species(s); return x.conc ? !(x.concMax > 0 && x.concMax <= 2.0) : x.concMax !== undefined; });
check('concentration cap present exactly when a solution is allowed, never above 2.0', bad.length === 0, bad.join(' '));
check('spec caps: H2SO4 ≤ 2.0, Ba(OH)2 ≤ 0.10, Ca(OH)2 / Mg(OH)2 never a solution',
  Generator.species('H2SO4').concMax <= 2.0 && Generator.species('Ba(OH)2').concMax === 0.1 && !Generator.species('Ca(OH)2').conc && !Generator.species('Mg(OH)2').conc);
check('NO2 and SO3 are not gas volumes', !Generator.species('NO2').gas && !Generator.species('SO3').gas);
check('Na, K and Br2 carry a 0.1 mol cap, nothing else does', ['Na', 'K', 'Br2'].every(x => Generator.species(x).nMax === 0.1)
  && [...allSp].filter(x => !(x in SMALL)).every(x => Generator.species(x).nMax === undefined));
check('species() ignores a leading coefficient and returns a copy', Generator.species('2HCl').conc === true && Generator.species('HCl') !== Generator.species('HCl'));
const kinds = {}; safe.forEach(q => [q.A.sp, q.B.sp].forEach(s => { kinds[s] = oracleKinds(s, { cat: 'x' }).join('+'); }));
const kindCount = {}; Object.values(kinds).forEach(k => { kindCount[k] = (kindCount[k] || 0) + 1; });
console.log('     reactant kinds: ' + Object.keys(kindCount).map(k => `${k} ×${kindCount[k]}`).join(', '));

section('formatting');
const dsc = (g, want) => check(`describe ${JSON.stringify(g)}`, Generator.describe(g, 'X') === want, Generator.describe(g, 'X'));
dsc({ kind: 'mass', value: 12, unit: 'g' }, '12.0 g');
dsc({ kind: 'mass', value: 4.35, unit: 'g' }, '4.35 g');
dsc({ kind: 'mass', value: 0.5, unit: 'g' }, '0.500 g');
dsc({ kind: 'mol', value: 0.25 }, '0.250 mol');
dsc({ kind: 'mol', value: 0.05 }, '0.0500 mol');
dsc({ kind: 'mol', value: 1.2 }, '1.20 mol');
dsc({ kind: 'conc', conc: 0.2, vol: 25, volUnit: 'cm3' }, '25.0 cm³ of 0.200 mol dm⁻³');
dsc({ kind: 'conc', conc: 2, vol: 250, volUnit: 'cm3' }, '250 cm³ of 2.00 mol dm⁻³');
dsc({ kind: 'gas', vol: 480, volUnit: 'cm3', cond: 'RTP' }, '480 cm³ gas at RTP');
dsc({ kind: 'gas', vol: 1.2, volUnit: 'dm3', cond: 'STP' }, '1.20 dm³ gas at STP');
dsc({ kind: 'gas', vol: 73.1, volUnit: 'cm3', cond: 'STP' }, '73.1 cm³ gas at STP');
const f1 = Generator.format({ kind: 'conc', conc: 0.2, vol: 25, volUnit: 'cm3' });
check('format() gives the parts', f1.num === '25.0' && f1.unit === 'cm³' && f1.conc === '0.200' && f1.concUnit === 'mol dm⁻³' && f1.text === '25.0 cm³ of 0.200 mol dm⁻³');
const ti = Generator.toInput({ kind: 'conc', conc: 0.2, vol: 25, volUnit: 'cm3' });
check('toInput() matches the apps\' input fields, as printed', JSON.stringify(ti) === JSON.stringify({ method: 'conc', mass: '', conc: '0.200', cvol: '25.0', cvolUnit: 'cm3', gvol: '', gvolUnit: 'dm3', cond: 'RTP' }));

section('rng');
const r1 = Generator.rng(42), r2 = Generator.rng(42), r3 = Generator.rng(43);
const s1 = [], s2 = [], s3 = [];
for (let i = 0; i < 1000; i++) { s1.push(r1()); s2.push(r2()); s3.push(r3()); }
check('same seed, same stream', JSON.stringify(s1) === JSON.stringify(s2));
check('different seed, different stream', JSON.stringify(s1) !== JSON.stringify(s3));
check('values in [0, 1)', s1.every(x => x >= 0 && x < 1));
check('mean close to 0.5', Math.abs(s1.reduce((a, b) => a + b, 0) / 1000 - 0.5) < 0.05);
check('string seeds work', Generator.rng('abc')() === Generator.rng('abc')() && Generator.rng('abc')() !== Generator.rng('abd')());

section(`sweep: ${PER_LEVEL} scenarios per level, one seed each, last 4 reactions avoided`);
Generator.resetStats();
const originalRandom = Math.random;
Math.random = () => { throw new Error('Math.random called although an rng was supplied'); };
const summary = {};
const rejectStats = {};
LEVELS.forEach((level, li) => {
  Generator.resetStats();
  const S = { n: 0, A: 0, B: 0, tie: 0, cat: {}, rxn: {}, pair: {}, nonMass: 0, massMass: 0, margins: [], gasCond: { RTP: 0, STP: 0 },
    gasUnit: { cm3: 0, dm3: 0, dm3_1to2: 0 }, vols: new Set(), concs: new Set() };
  const recent = [];
  for (let i = 0; i < PER_LEVEL; i++) {
    const seed = li * 100000 + i + 1;
    const sc = Generator.make({ level, rng: Generator.rng(seed), avoid: recent.slice() });
    const verdict = validate(sc, level, recent);
    recent.push(sc.q.id); if (recent.length > 4) recent.shift();
    S.n++; S[verdict]++;
    S.cat[sc.q.cat] = (S.cat[sc.q.cat] || 0) + 1;
    S.rxn[sc.q.id] = (S.rxn[sc.q.id] || 0) + 1;
    const pair = sc.givens.map(g => g.kind).join('+');
    S.pair[pair] = (S.pair[pair] || 0) + 1;
    if (sc.givens.some(g => g.kind !== 'mass')) S.nonMass++;
    if (pair === 'mass+mass') S.massMass++;
    if (verdict !== 'tie') S.margins.push(sc.design.margin);
    sc.givens.forEach(g => {
      if (g.kind === 'gas') { S.gasCond[g.cond]++; S.gasUnit[g.volUnit]++; if (g.volUnit === 'dm3' && g.vol < 2) S.gasUnit.dm3_1to2++; }
      if (g.kind === 'conc') { S.vols.add(g.vol); S.concs.add(g.conc); }
    });
  }
  summary[level] = S;
  rejectStats[level] = Generator.stats();
});
Math.random = originalRandom;
reportRules('every scenario obeys every rule');
const stats = LEVELS.reduce((t, l) => ({ made: t.made + rejectStats[l].made, attempts: t.attempts + rejectStats[l].attempts, fallbacks: t.fallbacks + rejectStats[l].fallbacks }), { made: 0, attempts: 0, fallbacks: 0 });

section('distribution');
LEVELS.forEach(level => {
  const S = summary[level], nonTie = S.A + S.B;
  const shareA = S.A / nonTie, tie = S.tie / S.n;
  const catShares = Object.keys(S.cat).map(c => S.cat[c] / S.n);
  const maxRxn = Math.max(...Object.values(S.rxn)) / S.n;
  const missing = safe.filter(q => !S.rxn[q.id]);
  const mean = S.margins.reduce((a, b) => a + b, 0) / S.margins.length;
  console.log(`  ${level}: A ${S.A} · B ${S.B} · tie ${S.tie} · reactions used ${Object.keys(S.rxn).length}/${safe.length} · margin mean ${mean.toFixed(2)} (min ${Math.min(...S.margins).toFixed(2)}, max ${Math.max(...S.margins).toFixed(2)})`);
  console.log(`     kinds: ` + Object.keys(S.pair).sort((a, b) => S.pair[b] - S.pair[a]).map(k => `${k} ${(100 * S.pair[k] / S.n).toFixed(1)}%`).join(', '));
  console.log(`     categories: ` + Object.keys(S.cat).sort((a, b) => S.cat[b] - S.cat[a]).map(c => `${c} ${(100 * S.cat[c] / S.n).toFixed(1)}%`).join(', '));
  const rs = rejectStats[level];
  console.log(`     attempts per scenario ${(rs.attempts / rs.made).toFixed(3)}; thrown away: ` + (Object.keys(rs.rejects).length
    ? Object.keys(rs.rejects).sort((a, b) => rs.rejects[b] - rs.rejects[a]).map(k => `${k} ${rs.rejects[k]}`).join(', ') : 'none'));
  check(`${level}: ${S.n} scenarios`, S.n === PER_LEVEL);
  check(`${level}: A and B each limit about half the time (share of A ${(100 * shareA).toFixed(1)}%)`, shareA > 0.44 && shareA < 0.56);
  check(`${level}: ties are about 8% (${(100 * tie).toFixed(1)}%)`, tie > 0.05 && tie < 0.11);
  check(`${level}: no category above 18%, none below 3% (max ${(100 * Math.max(...catShares)).toFixed(1)}%, min ${(100 * Math.min(...catShares)).toFixed(1)}%)`,
    Math.max(...catShares) <= 0.18 && Math.min(...catShares) >= 0.03 && Object.keys(S.cat).length === Object.keys(cats).length);
  check(`${level}: no single reaction above 2.5% (max ${(100 * maxRxn).toFixed(2)}%)`, maxRxn <= 0.025);
  check(`${level}: every safe reaction appears at least once`, missing.length === 0, missing.map(q => q.eq).join('; '));
});
const MX = summary.mixed;
check(`mixed: at least one non-mass given in ${(100 * MX.nonMass / MX.n).toFixed(1)}% (≥ 90%)`, MX.nonMass / MX.n >= 0.9);
check(`mixed: mass + mass still appears sometimes (${(100 * MX.massMass / MX.n).toFixed(1)}%)`, MX.massMass > 0 && MX.massMass / MX.n <= 0.15);
const mixedKinds = new Set(); Object.keys(MX.pair).forEach(p => p.split('+').forEach(k => mixedKinds.add(k)));
check('mixed: all four kinds of given occur', ['mol', 'mass', 'conc', 'gas'].every(k => mixedKinds.has(k)), [...mixedKinds].join(','));
check(`mixed: both RTP and STP occur (${MX.gasCond.RTP} / ${MX.gasCond.STP})`, MX.gasCond.RTP > 0 && MX.gasCond.STP > 0);
check(`mixed: gas volumes in cm³ and in dm³, including 1 to 2 dm³ (${MX.gasUnit.cm3} / ${MX.gasUnit.dm3} / ${MX.gasUnit.dm3_1to2})`, MX.gasUnit.cm3 > 0 && MX.gasUnit.dm3 > 0 && MX.gasUnit.dm3_1to2 > 0);
check(`mixed: every nice solution volume is used (${[...MX.vols].sort((a, b) => a - b).join(' ')})`, VOLS.every(v => MX.vols.has(v)));
check(`mixed: ${MX.concs.size} different concentrations used, 0.05 up to 2.00`, MX.concs.size >= 10 && MX.concs.has(0.05) && MX.concs.has(2));
check('moles: every given is mol; grams: every given is mass', Object.keys(summary.moles.pair).join() === 'mol+mol' && Object.keys(summary.grams.pair).join() === 'mass+mass');
check(`bounded retries never needed the fallback (${stats.fallbacks} of ${stats.made}; ${(stats.attempts / stats.made).toFixed(2)} attempts per scenario)`, stats.fallbacks === 0);

section('want: A, B, tie');
Generator.resetStats();
LEVELS.forEach((level, li) => {
  ['A', 'B', 'tie'].forEach((want, wi) => {
    let ok = 0, n = 0;
    for (let i = 0; i < 1000; i++) {
      const sc = Generator.make({ level, want, rng: Generator.rng(900000 + li * 10000 + wi * 1000 + i) });
      const v = validate(sc, level, null);
      n++; if (sc.design.limiting === want && v === want && (want !== 'tie' || sc.res.tie)) ok++;
    }
    check(`${level} want:${want} — ${ok}/${n} as asked`, ok === n);
  });
});
reportRules('want sweep obeys every rule');
check(`want sweep needed no fallback (${Generator.stats().fallbacks} of ${Generator.stats().made})`, Generator.stats().fallbacks === 0);

section('determinism');
let same = 0, total = 0;
LEVELS.forEach(level => { for (let seed = 1; seed <= 300; seed++) {
  const a = Generator.make({ level, rng: Generator.rng(seed), avoid: [3, 5] });
  const b = Generator.make({ level, rng: Generator.rng(seed), avoid: [3, 5] });
  total++; if (JSON.stringify(a) === JSON.stringify(b)) same++;
} });
check(`same seed → same scenario (${same}/${total})`, same === total);
const d1 = Generator.make({ level: 'mixed', rng: Generator.rng(1) }), d2 = Generator.make({ level: 'mixed', rng: Generator.rng(2) });
check('different seeds → different scenarios', JSON.stringify(d1) !== JSON.stringify(d2));
check('the default rng works (Math.random)', (() => { const sc = Generator.make({ level: 'grams' }); validate(sc, 'grams', null); return true; })());
reportRules('default-rng scenario');

section('avoid');
{
  const all = safe.map(q => q.id), keep = safe.find(q => q.eq === 'Mg + 2HCl -> MgCl2 + H2').id;
  const only = Generator.make({ level: 'mixed', rng: Generator.rng(5), avoid: all.filter(id => id !== keep) });
  check('avoiding everything but one reaction leaves that reaction', only.q.id === keep);
  const none = Generator.make({ level: 'mixed', rng: Generator.rng(5), avoid: all });
  check('avoiding every reaction is ignored rather than failing', Generator.isSafe(none.q));
  let repeats = 0;
  for (let i = 0; i < 1500; i++) { const sc = Generator.make({ level: LEVELS[i % 3], rng: Generator.rng(777000 + i), avoid: [safe[i % safe.length].id] }); if (sc.q.id === safe[i % safe.length].id) repeats++; }
  check('a reaction named in avoid never comes back', repeats === 0, repeats);
  check('avoid with junk entries is harmless', Generator.make({ level: 'moles', rng: Generator.rng(1), avoid: [null, 'x', -5, 1e9] }).q !== undefined);
}

section('robustness: make() never throws and always returns a valid scenario');
{
  const wild = [
    ['no arguments', undefined], ['empty options', {}], ['unknown level', { level: 'banana' }], ['unknown want', { level: 'mixed', want: 'C' }],
    ['rng always 0', { level: 'mixed', rng: () => 0 }], ['rng always 0.9999999999', { level: 'grams', rng: () => 0.9999999999 }], ['rng always 0.5', { level: 'moles', rng: () => 0.5 }],
    ['rng 0 and want tie', { level: 'mixed', want: 'tie', rng: () => 0 }], ['avoid not an array', { level: 'moles', avoid: 7 }]
  ];
  wild.forEach(([label, opts]) => {
    let sc = null, threw = null;
    try { sc = Generator.make(opts); validate(sc, sc.level, null); } catch (e) { threw = e; }
    check(`make(${label})`, !threw && sc && ['moles', 'grams', 'mixed'].includes(sc.level), threw ? threw.message : '');
  });
  reportRules('wild-input scenarios');
  // an rng that misbehaves: NaN, undefined, negative, above 1, not a number
  const badRngs = { NaN: () => NaN, undefined: () => undefined, negative: () => -3, 'above 1': () => 7.5, Infinity: () => Infinity, text: () => 'x', object: () => ({}) };
  let threw = 0, invalid = 0, tried = 0;
  Object.keys(badRngs).forEach(name => LEVELS.forEach(level => [undefined, 'A', 'B', 'tie'].forEach(want => {
    tried++;
    try { const sc = Generator.make({ level, want, rng: badRngs[name] }); validate(sc, level, null); if (!sc || (want && sc.design.limiting !== want)) invalid++; } catch (e) { threw++; console.log('     threw: ' + name + ' ' + level + ' ' + want + ' ' + e.message); }
  })));
  check(`a broken rng (NaN, undefined, negative, > 1, Infinity, text, object) never breaks make(): ${tried} calls`, threw === 0 && invalid === 0, `${threw} threw, ${invalid} invalid`);
  check('formatters and build() cope with junk', Generator.describe(undefined) === '' && Generator.format(null).text === '' && Generator.toInput(undefined).method === undefined
    && Generator.molesOf(undefined, 'H2') !== Generator.molesOf(undefined, 'H2') && Generator.build({ q: undefined }) === null && Generator.build() === null && Generator.species(undefined).known === false);
  // the fallback itself, every level × every verdict
  LEVELS.forEach(level => ['A', 'B', 'tie'].forEach(want => {
    const sc = Generator.fallback(level, want);
    validate(sc, level, null);
    expect('fallback gives the verdict asked for', sc.design.limiting === want, () => show(sc));
  }));
  reportRules('fallback scenarios');
}

section('build() refuses what it must');
{
  const by = eq => QUAL.find(q => q.eq === eq);
  check('a rejected reaction cannot be built', Generator.build({ q: by('CO2 + 2NaOH -> Na2CO3 + H2O'), level: 'mixed', rng: Generator.rng(1) }) === null
    && Generator.build({ q: by('Ag^+ + Cl^- -> AgCl'), level: 'moles', rng: Generator.rng(1) }) === null);
  check('a kind the species cannot take is refused (gas for a solid, solution for Ca(OH)2, solution in a combustion)',
    Generator.build({ q: by('Zn + 2HCl -> ZnCl2 + H2'), kinds: ['gas', 'mol'], rng: Generator.rng(1) }) === null
    && Generator.build({ q: by('2HCl + Ca(OH)2 -> CaCl2 + 2H2O'), kinds: ['mol', 'conc'], rng: Generator.rng(1) }) === null
    && Generator.build({ q: by('4NH3 + 3O2 -> 2N2 + 6H2O'), kinds: ['conc', 'gas'], rng: Generator.rng(1) }) === null
    && Generator.build({ q: by('4NH3 + 3O2 -> 2N2 + 6H2O'), kinds: ['gas', 'gas'], rng: Generator.rng(1) }) !== null);
  check('build() takes a reaction id as well as the entry', Generator.build({ q: by('HCl + NaOH -> NaCl + H2O').id, level: 'moles', want: 'A', rng: Generator.rng(3) }).q.eq === 'HCl + NaOH -> NaCl + H2O');
}

section('every safe reaction can generate at all three levels');
{
  const failures = [];
  let refused = 0, refusedWrong = 0;
  safe.forEach((q, qi) => LEVELS.forEach(level => {
    for (let k = 0; k < 20; k++) {
      const want = mustSide(q) || (k % 2 ? 'A' : 'B');       // a one-way reaction is only asked for the side that holds
      const sc = Generator.build({ q, level, want, rng: Generator.rng(31 * qi + k + 1) });
      if (!sc) { failures.push(`${q.eq} @ ${level} want ${want}`); continue; }
      validate(sc, level, null);
      expect('build() gives the verdict asked for', sc.design.limiting === want && sc.q === q, () => show(sc));
      if (mustSide(q) && k < 3) { refused++; if (Generator.build({ q, level, want: want === 'A' ? 'B' : 'A', rng: Generator.rng(k + 1) }) !== null) refusedWrong++; }
    }
  }));
  check(`${safe.length} reactions × 3 levels × 20 builds all succeed`, failures.length === 0, failures.slice(0, 5).join('; '));
  check(`a one-way reaction refuses to be built the other way round (${refused} attempts, ${refusedWrong} built)`, refused > 0 && refusedWrong === 0);
  reportRules('per-reaction builds');
}

section('exhaustive: every safe reaction × both limiting sides × every kind of given the reaction allows');
{
  let combos = 0, built = 0; const failures = [], perKind = {};
  safe.forEach((q, qi) => (mustSide(q) ? [mustSide(q)] : ['A', 'B']).forEach(want => {
    oracleKinds(q.A.sp, q).forEach(kA => oracleKinds(q.B.sp, q).forEach(kB => {
      combos++;
      perKind[kA + '+' + kB] = (perKind[kA + '+' + kB] || 0) + 1;
      for (let k = 0; k < 10; k++) {
        const sc = Generator.build({ q, want, kinds: [kA, kB], rng: Generator.rng(1009 * qi + 97 * combos + k + 1), tries: 80 });
        if (!sc) { failures.push(`${q.eq} limiting ${want} as ${kA}+${kB}`); break; }
        built++;
        validate(sc, sc.level, null);
        expect('forced kinds are honoured', sc.givens[0].kind === kA && sc.givens[1].kind === kB && sc.design.limiting === want, () => show(sc));
      }
    }));
  }));
  check(`${combos} combinations, ${built} scenarios built, none impossible`, failures.length === 0, failures.slice(0, 6).join('; '));
  const wrongWay = safe.filter(q => mustSide(q) && oracleKinds(q.A.sp, q).some(kA => oracleKinds(q.B.sp, q).some(kB =>
    Generator.build({ q, want: mustSide(q) === 'A' ? 'B' : 'A', kinds: [kA, kB], rng: Generator.rng(3), tries: 30 }) !== null)));
  check('no kind of given makes a one-way reaction buildable the other way round', wrongWay.length === 0, wrongWay.map(q => q.eq).join('; '));
  console.log('     combinations by kinds: ' + Object.keys(perKind).sort().map(k => `${k} ${perKind[k]}`).join(', '));
  reportRules('exhaustive scenarios');
}

section('direction: a one-way reaction is only ever set the way round where its equation holds');
{
  const ways = Object.keys(EXPECT_ONE_WAY).map(eq => QUAL.find(q => q.eq === eq));
  let seen = new Set(), made = 0, wrong = 0, tie = 0;
  Generator.resetStats();
  LEVELS.forEach((level, li) => ['A', 'B', 'tie'].forEach((want, wi) => {
    for (let i = 0; i < 1500; i++) {
      const sc = Generator.make({ level, want, rng: Generator.rng(4000000 + li * 100000 + wi * 10000 + i) });
      if (!mustSide(sc.q)) continue;
      made++; seen.add(sc.q.eq);
      if (sc.design.limiting === 'tie') tie++;
      else if (sc.design.limiting !== mustSide(sc.q)) wrong++;
    }
  }));
  check(`make() with want A, B or tie: ${made} one-way scenarios (${tie} ties), none the wrong way round`, made > 300 && wrong === 0, `${wrong} wrong`);
  check(`all ${ways.length} one-way reactions are reached by make() (${seen.size})`, seen.size === ways.length, ways.filter(q => !seen.has(q.eq)).map(q => q.eq).join('; '));
  const lone = ways.find(q => mustSide(q) === 'B');
  const sc = Generator.make({ level: 'mixed', want: 'A', rng: Generator.rng(9), avoid: safe.filter(q => q !== lone).map(q => q.id) });
  check('asking for A when the only reaction left holds just with B running out picks another reaction', sc.q !== lone && sc.design.limiting === 'A');
  const stuck = Generator.make({ level: 'moles', want: 'B', rng: Generator.rng(9), avoid: safe.filter(q => mustSide(q) !== 'A').map(q => q.id) });
  check('the same the other way round (reactions that need A running out are not set for B)', mustSide(stuck.q) !== 'A' && stuck.design.limiting === 'B');
  const st = Generator.stats();
  check(`make() never tries a one-way reaction the wrong way round, and never needed the fallback (${st.made} made, ${st.fallbacks} fallbacks)`,
    !st.rejects['the equation does not hold that way round'] && st.fallbacks === 0, JSON.stringify(st.rejects));
  const d1 = Generator.directions(), w1 = Generator.windows(), k1 = Object.keys(d1)[0], e1 = Object.keys(w1)[0];
  delete d1[k1]; d1.junk = ['x', 'y']; w1[e1][Object.keys(w1[e1])[0]][0] = 0;
  check('directions() and windows() hand out copies', Object.keys(Generator.directions()).length === ways.length && !('junk' in Generator.directions()) && Generator.windows()[e1][Object.keys(w1[e1])[0]][0] !== 0);
  bad = ways.filter(q => ['moles', 'mixed'].some(l => { const t = Generator.build({ q, level: l, want: 'tie', rng: Generator.rng(8), tries: 60 }); return !(Generator.canTie(q, l) && t && t.res.tie && t.q === q); }));
  check('a one-way reaction can still tie, at the moles and mixed levels, with computeLimiting agreeing', bad.length === 0, bad.map(q => q.eq).join('; '));
}

section('strength windows: a solution is the strength the reaction needs');
{
  Object.keys(EXPECT_WINDOW).forEach((eq, wi) => {
    const q = QUAL.find(x => x.eq === eq), sp = Object.keys(EXPECT_WINDOW[eq])[0], [lo, hi] = EXPECT_WINDOW[eq][sp];
    const solIsA = q.A.sp === sp, concs = new Set(), outside = [];
    for (let k = 0; k < 400; k++) {
      const partner = oracleKinds(solIsA ? q.B.sp : q.A.sp, q).filter(x => x !== 'gas' && x !== 'conc'), other = partner[k % partner.length];
      const kinds = solIsA ? ['conc', other] : [other, 'conc'];
      const sc = Generator.build({ q, kinds, want: k % 2 ? 'A' : 'B', rng: Generator.rng(777 + wi * 1000 + k), tries: 80 });
      if (!sc) { outside.push('nothing built'); continue; }
      const g = sc.givens[solIsA ? 0 : 1];
      concs.add(g.conc);
      if (g.conc < lo * (1 - 1e-9) || g.conc > hi * (1 + 1e-9)) outside.push(g.conc);
    }
    check(`${eq}: ${sp} solutions run ${[...concs].sort((a, b) => a - b).join(' / ')} mol dm⁻³, all inside ${lo} – ${hi}`,
      outside.length === 0 && concs.has(lo) && concs.has(hi) && concs.size >= 3, outside.slice(0, 5).join(', '));
  });
  // mass and mole givens of the same species are not touched by the window
  const cu = QUAL.find(q => q.eq === '3Cu + 8HNO3 -> 3Cu(NO3)2 + 4H2O + 2NO');
  const kindsSeen = new Set();
  for (let k = 0; k < 200; k++) { const sc = Generator.build({ q: cu, level: 'mixed', rng: Generator.rng(31 + k) }); if (sc) sc.givens.forEach(g => kindsSeen.add(g.kind)); }
  check('copper + nitric acid still comes as mass, moles and solution', ['mass', 'mol', 'conc'].every(k => kindsSeen.has(k)), [...kindsSeen].join(','));
}

section('condition: what is printed beside the equation');
{
  const by = eq => QUAL.find(q => q.eq === eq), cond = eq => Generator.condition(by(eq));
  check('the database condition is kept as it is', cond('2Al + Fe2O3 -> Al2O3 + 2Fe') === 'thermite, Δ' && cond('ZnO + C -> Zn + CO') === 'Δ' && cond('Mg + H2O -> MgO + H2') === 'steam'
    && cond('3Cu + 8HNO3 -> 3Cu(NO3)2 + 4H2O + 2NO') === 'dilute HNO₃' && cond('Fe2O3 + 3CO -> 2Fe + 3CO2') === 'blast furnace');
  check('a carbon fuel burns completely (named fuels keep their name first)', cond('C3H8 + 5O2 -> 3CO2 + 4H2O') === 'complete combustion' && cond('C2H5OH + 3O2 -> 2CO2 + 3H2O') === 'ethanol · complete combustion'
    && cond('C + O2 -> CO2') === 'complete combustion' && cond('CS2 + 3O2 -> CO2 + 2SO2') === 'complete combustion' && cond('C6H12O6 + 6O2 -> 6CO2 + 6H2O') === 'glucose / respiration · complete combustion');
  check('carbon monoxide, hydrogen, sulfur and the metals have nothing to complete', ['2CO + O2 -> 2CO2', '2H2 + O2 -> 2H2O', 'S + O2 -> SO2', '2Mg + O2 -> 2MgO'].every(eq => cond(eq) === '') && cond('4NH3 + 3O2 -> 2N2 + 6H2O') === 'ammonia burning');
  check('what needs heating says so (and keeps its label)', cond('Fe + S -> FeS') === 'heated' && cond('2Fe + 3Cl2 -> 2FeCl3') === 'heated' && cond('CuO + H2 -> Cu + H2O') === 'reduction · heated'
    && cond('SnO2 + 2C -> Sn + 2CO') === 'tin extraction · heated' && cond('H2 + Cl2 -> 2HCl') === 'spark or UV light');
  const HEATED = ['Fe + S -> FeS', 'Zn + S -> ZnS', '2Al + 3S -> Al2S3', '2Fe + 3Cl2 -> 2FeCl3', 'Cu + Cl2 -> CuCl2', 'Zn + Cl2 -> ZnCl2', 'Mg + Cl2 -> MgCl2',
    'Ca + Cl2 -> CaCl2', '2Na + Cl2 -> 2NaCl', '2Al + 3Cl2 -> 2AlCl3', 'Si + 2Cl2 -> SiCl4', '3Mg + N2 -> Mg3N2', 'H2 + Br2 -> 2HBr', 'H2 + Cl2 -> 2HCl',
    'CuO + H2 -> Cu + H2O', 'Fe2O3 + 3H2 -> 2Fe + 3H2O', 'WO3 + 3H2 -> W + 3H2O', 'SnO2 + 2C -> Sn + 2CO'];
  check(`exactly these ${HEATED.length} reactions say "heated" (or "spark or UV light"), and the table has no typo`,
    HEATED.every(eq => QUAL.some(q => q.eq === eq) && /heated|spark/.test(cond(eq))) && safe.filter(q => /heated|spark/.test(Generator.condition(q))).length === HEATED.length,
    safe.filter(q => /heated|spark/.test(Generator.condition(q))).map(q => q.eq).filter(eq => !HEATED.includes(eq)).join('; '));
  check('reactions in solution, at room temperature, say nothing', ['Zn + 2HCl -> ZnCl2 + H2', 'HCl + NaOH -> NaCl + H2O', 'AgNO3 + NaCl -> AgCl + NaNO3', 'CaCO3 + 2HCl -> CaCl2 + H2O + CO2'].every(eq => cond(eq) === ''));
  check('junk gives nothing', Generator.condition(null) === '' && Generator.condition({}) === '' && Generator.condition(undefined) === '');
  const hasC = q => q.cat === 'comb' && [q.A.sp, q.B.sp].some(sp => sp !== 'CO' && composition(sp).C);
  bad = safe.filter(q => /complete combustion/.test(Generator.condition(q)) !== !!hasC(q));
  check('"complete combustion" appears for exactly the carbon fuels, in every safe reaction', bad.length === 0 && safe.filter(hasC).length >= 15, bad.map(q => q.eq).join('; '));
  bad = safe.filter(q => q.cond && Generator.condition(q).indexOf(q.cond) !== 0);
  check('every safe reaction with a database condition shows it first', bad.length === 0, bad.map(q => q.eq).join('; '));
  bad = safe.filter(q => /Δ|thermite|steam|blast|burns/.test(q.cond) && /heated|spark/.test(Generator.condition(q)));
  check('nothing is told twice (a database "Δ", "thermite", "steam" is not followed by "heated")', bad.length === 0, bad.map(q => q.eq).join('; '));
  bad = safe.filter(q => /undefined|null|NaN|\s·\s*$|^\s*·/.test(Generator.condition(q)));
  check('no stray separators or "undefined" in any condition', bad.length === 0, bad.map(q => q.eq).join('; '));
  check('make() returns the condition with the scenario', Generator.make({ level: 'grams', rng: Generator.rng(3) }).cond === Generator.condition(Generator.make({ level: 'grams', rng: Generator.rng(3) }).q));
}

section('precipitation: the precipitate really forms (solubility equilibrium, two solutions mixed)');
{
  // Ksp at 25 °C (data book, rounded) and the ions in one formula unit: [Ksp, cations, anions, cation element, anion element ('OH' for hydroxides)]
  const KSP = { AgCl: [1.8e-10, 1, 1, 'Ag', 'Cl'], AgBr: [5.4e-13, 1, 1, 'Ag', 'Br'], AgI: [8.5e-17, 1, 1, 'Ag', 'I'], BaSO4: [1.1e-10, 1, 1, 'Ba', 'S'], PbI2: [9.8e-9, 1, 2, 'Pb', 'I'],
    PbSO4: [2.5e-8, 1, 1, 'Pb', 'S'], 'Cu(OH)2': [2.2e-20, 1, 2, 'Cu', 'OH'], 'Fe(OH)3': [4e-38, 1, 3, 'Fe', 'OH'], 'Fe(OH)2': [4.9e-17, 1, 2, 'Fe', 'OH'], 'Mg(OH)2': [5.6e-12, 1, 2, 'Mg', 'OH'],
    CaCO3: [3.4e-9, 1, 1, 'Ca', 'C'], BaCO3: [2.6e-9, 1, 1, 'Ba', 'C'], Ag2CO3: [8.5e-12, 2, 1, 'Ag', 'C'], 'Ni(OH)2': [5.5e-16, 1, 2, 'Ni', 'OH'], 'Co(OH)2': [5.9e-15, 1, 2, 'Co', 'OH'],
    Ag3PO4: [8.9e-17, 3, 1, 'Ag', 'P'],
    // sparingly soluble ones, for the record: PbCl2 and PbBr2 are not offered, and would fail this test
    PbCl2: [1.7e-5, 1, 2, 'Pb', 'Cl'], PbBr2: [6.6e-6, 1, 2, 'Pb', 'Br'], CaSO4: [4.9e-5, 1, 1, 'Ca', 'S'], Ag2SO4: [1.2e-5, 2, 1, 'Ag', 'S'] };
  const rows = safe.filter(q => q.cat === 'precip'), worst = {};
  bad = rows.filter(q => !parseReaction(q.eq).products.some(p => KSP[p.sp]));
  check(`every precipitate of the ${rows.length} precipitation reactions is in the Ksp table`, bad.length === 0, bad.map(q => q.eq).join('; '));
  rows.forEach((q, qi) => {
    const prod = parseReaction(q.eq).products.find(p => KSP[p.sp]);
    if (!prod) return;
    const [ksp, pc, pa, catEl, anEl] = KSP[prod.sp], refs = [q.A, q.B];
    const ci = composition(q.A.sp)[catEl] ? 0 : 1, ai = 1 - ci;
    const perCat = composition(refs[ci].sp)[catEl], perAn = anEl === 'OH' ? (refs[ai].sp === 'NaOH' ? 1 : 0) : composition(refs[ai].sp)[anEl];
    let w = 1, n = 0;
    for (let k = 0; k < 300; k++) {
      const sc = Generator.build({ q, level: 'mixed', kinds: ['conc', 'conc'], rng: Generator.rng(31000 + qi * 1000 + k), tries: 60 });
      if (!sc) continue;
      n++;
      const V = (sc.givens[0].vol + sc.givens[1].vol) / 1000, nm = [sc.nA, sc.nB], M0 = nm[ci] * perCat / V, X0 = nm[ai] * perAn / V, xmax = Math.min(M0 / pc, X0 / pa);
      const f = x => Math.pow(M0 - pc * x, pc) * Math.pow(X0 - pa * x, pa) - ksp;
      let x = 0;
      if (f(0) > 0) { let lo = 0, hi = xmax; for (let j = 0; j < 100; j++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; } x = (lo + hi) / 2; }
      w = Math.min(w, x / xmax);
    }
    worst[q.eq] = { w, n };
  });
  const weak = Object.keys(worst).filter(eq => worst[eq].n < 100 || worst[eq].w < 0.95);
  check(`at least 95 % of the theoretical precipitate forms in every two-solution problem (worst case ${Math.min(...Object.values(worst).map(x => x.w)).toFixed(3)} over ${Object.keys(worst).length} reactions)`,
    weak.length === 0, weak.map(eq => `${eq}: ${worst[eq].w.toFixed(2)} (${worst[eq].n})`).join('; '));
}

section('ties: which reactions can tie at which level');
{
  const can = {}; LEVELS.forEach(l => { can[l] = safe.filter(q => Generator.canTie(q, l)); });
  LEVELS.forEach((level, li) => {
    let ok = 0, n = 0, wrongClaim = 0;
    safe.forEach((q, qi) => {
      const sc = Generator.build({ q, level, want: 'tie', rng: Generator.rng(55 * qi + li + 1), tries: 60 });
      const claim = Generator.canTie(q, level);
      if (claim) { n++; if (sc && sc.res.tie && sc.q === q) { ok++; validate(sc, level, null); } }
      else if (sc) wrongClaim++;
    });
    check(`${level}: ${can[level].length}/${safe.length} reactions can tie; each of those builds a real tie (${ok}/${n}); none of the rest does (${wrongClaim} contradictions)`, ok === n && wrongClaim === 0);
    if (level !== 'moles') console.log(`     cannot tie at ${level}: ${safe.filter(q => !can[level].includes(q)).length} reactions`);
  });
  reportRules('tie scenarios');
  check('moles: every safe reaction can tie', can.moles.length === safe.length);
  check('grams: at least half of the safe reactions can tie', can.grams.length >= safe.length / 2, `${can.grams.length}/${safe.length}`);
  check('mixed: every safe reaction can tie', can.mixed.length === safe.length, safe.filter(q => !can.mixed.includes(q)).map(q => q.eq).join('; '));
  const hn = safe.find(q => q.eq === 'HCl + NaOH -> NaCl + H2O');
  check('HCl + NaOH ties at every level', LEVELS.every(l => Generator.canTie(hn, l)));
}

section('the browser path: chemistry.js and generator.js as plain scripts (no require, no module)');
{
  const ctx = vm.createContext({ console });
  ['chemistry.js', 'generator.js'].forEach(f => new vm.Script(fs.readFileSync(path.join(__dirname, f), 'utf8'), { filename: f }).runInContext(ctx));
  const G2 = vm.runInContext('Generator', ctx);
  check('Generator is a global once the script has run', typeof G2 === 'object' && typeof G2.make === 'function');
  let same = 0, total = 0;
  LEVELS.forEach(level => { for (let seed = 1; seed <= 200; seed++) {
    const a = Generator.make({ level, rng: Generator.rng(seed), avoid: [1, 2] });
    const b = G2.make({ level, rng: G2.rng(seed), avoid: [1, 2] });
    total++; if (JSON.stringify(a) === JSON.stringify(JSON.parse(JSON.stringify(b)))) same++;
  } });
  check(`same scenarios as under Node (${same}/${total})`, same === total);
  check('same safe list', G2.safeList().length === safe.length);
  const src = fs.readFileSync(path.join(__dirname, 'generator.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/ \/\/ .*$/gm, '');      // comments out
  const domFree = code.replace("if (typeof window !== 'undefined') window.Generator = Generator;", '');      // the one allowed mention
  check('no DOM access in generator.js (window only to publish the global)', !/\bdocument\b|\bwindow\b|localStorage|\bfetch\b/.test(domFree) && /window\.Generator = Generator/.test(code));
  const rnd = (code.match(/Math\.random/g) || []).length;
  check(`Math.random appears only as the default rng (${rnd} place)`, rnd === 1 && /typeof f !== 'function'\) return Math\.random/.test(src));
}

check('QUAL was not modified by any of this', JSON.stringify(QUAL) === qualBefore);

console.log(`\n${checks} checks, ${failed} failed.`);
process.exit(failed ? 1 : 0);
