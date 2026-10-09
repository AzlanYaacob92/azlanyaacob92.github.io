/* ============================================================================
   generator.js  —  practice-problem generator (no DOM, pure)
   Builds Practice scenarios for the limiting-reactant and yield trainers.
   Loaded after chemistry.js (classic script, works over file://); exposes the
   global `Generator`. Under Node:  const Generator = require('./generator.js');
   This file is copied unchanged into each repo — edit the canonical copy only.

   API
     Generator.make({ level, rng, avoid, want }) → scenario
       level  'moles' | 'grams' | 'mixed'       default 'mixed' (anything else is 'mixed')
       rng    () => number in [0, 1)            default Math.random; Generator.rng(seed) is
                                                deterministic (same seed, same scenario)
       avoid  [q.id, …]                         reactions to skip, e.g. the last five shown
       want   'A' | 'B' | 'tie'                 which reactant runs out. Default: A and B equally
                                                often, ties about 8 % of the time.
     make() never throws and always returns a valid scenario.

     scenario = {
       q,                    // the QUAL entry itself, never modified (q.cond travels with it)
       level,
       givens: [gA, gB],     // one per reactant, in q.A, q.B order — exactly what the student reads
       nA, nB,               // moles worked out from the DISPLAYED givens, the apps' way
       res,                  // computeLimiting(q, nA, nB)
       design: { limiting: 'A' | 'B' | 'tie', margin },  // margin = larger ÷ smaller of n ÷ coef:
                                                         // ≥ 1.15, or exactly 1 for a tie
       cond                  // Generator.condition(q): the text to print beside the equation
     }
     given = { kind:'mol',  value }
           | { kind:'mass', value, unit:'g' }
           | { kind:'conc', conc, vol, volUnit:'cm3' }                      n = conc × vol(dm³)
           | { kind:'gas',  vol, volUnit:'dm3'|'cm3', cond:'RTP'|'STP' }     n = vol(dm³) ÷ MOLAR_VOL[cond]
     On a tie design.limiting is 'tie' and res.tie is true (res.limiting is null, as computeLimiting
     gives it).
     Every number in a given is already rounded for display (3 s.f. or fewer). Print it, and
     work from it — never from nA, nB (they are the same numbers, but the student only has these).
     Solutions are always in cm³. Gases are in dm³ from 1 dm³ up, in cm³ below. Two gases in one
     problem share one condition.

     Generator.describe(given, sp) → '12.0 g'  '0.250 mol'  '25.0 cm³ of 0.200 mol dm⁻³'  '480 cm³ gas at RTP'
                                     (sp is accepted for symmetry; the amount reads the same for any species)
     Generator.format(given)       → { text, num, unit, conc?, concUnit?, cond? }: the same, in parts
     Generator.molesOf(given, sp)  → moles by the apps' formulas (m ÷ Mr · conc × V · V ÷ Vm)
     Generator.toInput(given)      → the apps' input-field object, all strings as printed:
                                     { method, mass, conc, cvol, cvolUnit, gvol, gvolUnit, cond }
                                     e.g. { method:'conc', conc:'0.200', cvol:'25.0', cvolUnit:'cm3', … }
                                     (a 'mol' given gives { method:'mol', mol:'0.250', … })
     Generator.species(sp)         → { phase:'gas'|'liquid'|'solid'|'aq', mass:true, conc, gas,
                                       concMax?, nMax?, known }. Use .gas to decide whether a
                                       product may be asked for in dm³ (never NO₂, SO₃, HCl, H₂O).
     Generator.yields(scenario)    → one entry per product, for yield questions:
                                     { sp, coef, n, mass, units, gas? } — n and mass are the theoretical
                                     moles and grams; units is the units it makes sense to ask in:
                                     'mol' always, 'g' from 0.1 g up, 'dm3' only for a true gas coming
                                     to 0.05–20 dm³ (gas: { RTP, STP } are those volumes in dm³)
     Generator.condition(q)        → the condition(s) to print beside the equation, one short string:
                                     q.cond (if any), plus 'complete combustion' for a carbon fuel and
                                     'heated' where the reaction needs it and q.cond does not say so.
                                     '' when there is nothing to say. scenario.cond is the same text.
     Generator.isSafe(q) · Generator.rejection(q) (the reason, or null) · Generator.safeList()
     Generator.oneWay(q)           → null, or { side:'A'|'B', sp, why }: the equation is only the
                                     reaction while sp is the reactant that runs out (or a tie), so
                                     every problem for it has that reactant limiting.
     Generator.rng(seed) · Generator.levels
     For tests and tooling: build({q, level, want, kinds, rng, tries}) one reaction on demand ·
       canTie(q, level) · decisions() · directions() · windows() · fallback(level, want) ·
       stats() → { made, attempts, fallbacks, rejects: { reason: count } } (attempts thrown away,
       and why) · resetStats()

   What every scenario guarantees (all of it is asserted by test-generator.js)
     · Only built-in, balanced, two-reactant equations with complete conversion: no ions,
       equilibria, titrations, half-equations, hazardous or ambiguous cases (GENERATOR-REVIEW.md
       lists every reaction kept and rejected, with the reason). Coefficients are never changed.
     · The equation is the reaction that happens for the amounts shown: where it holds only while
       one reactant is in excess (a carbonate in acid, an oxide reduced by H₂ / CO / C) the
       problem is set that way round (oneWay); where the product or the reaction needs a
       particular strength of acid it is kept to it (windows()).
     · A reactant is a solution only if it is soluble by school rules (and never in a combustion),
       a gas volume only for a true gas at RTP/STP, mass or moles for anything.
     · Each reactant is 0.005–1.5 mol and at most 60 g (Na, K, Br₂ at most 0.1 mol); masses
       0.1–60 g; concentrations 0.05–2.0 mol dm⁻³ and under the species cap (Ba(OH)₂ 0.10,
       Ba(NO₃)₂ 0.20, never more than 80 % of what dissolves); solution volumes from 10 … 250 cm³;
       gas 0.05–10 dm³.
     · The verdict is worked out from the displayed givens, then compared with the design; the
       larger batch is ≥ 1.15 × the smaller, something worth asking about is left over
       (≥ 0.003 mol and ≥ 0.05 g) and every product comes to ≥ 0.004 mol. A tie is only produced
       when computeLimiting reports one on the displayed givens.
     · Level moles: both mol. Level grams: both mass. Level mixed: any legal mix, at least one
       given that is not a mass almost always.

   Worked example   Generator.make({ level: 'mixed', rng: Generator.rng(11) })
     q.eq     'BaCO3 + 2HCl -> BaCl2 + H2O + CO2'          (q.A = BaCO3 × 1, q.B = HCl × 2)
     givens   [ { kind:'mass', value:10, unit:'g' },
                { kind:'conc', conc:0.5, vol:100, volUnit:'cm3' } ]
     read as  BaCO3  10.0 g          HCl  100 cm³ of 0.500 mol dm⁻³
     nA, nB   0.0506842…  (10.0 ÷ 197.3)       0.05  (0.500 × 0.100)
     design   { limiting:'B', margin:2.0274 }  →  HCl runs out; res.leftMol 0.0257 mol BaCO3 (5.07 g)
     cond     ''  (nothing to print beside this equation)
   ========================================================================== */

const Generator = (() => {
  'use strict';

  /* ---- Engine ---------------------------------------------------------------
     Node: chemistry.js is required. Browser: chemistry.js is loaded first and
     its top-level names are already global. Local names differ from the
     engine's on purpose, so the browser fallback below never hits a TDZ. */
  const ENGINE = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./chemistry.js')
    : { QUAL, molarMass, computeLimiting, MOLAR_VOL, parseReaction, composition };
  const DB = ENGINE.QUAL, VM = ENGINE.MOLAR_VOL, solve = ENGINE.computeLimiting, parse = ENGINE.parseReaction;
  const mmCache = {};
  const mm = sp => (sp in mmCache ? mmCache[sp] : (mmCache[sp] = ENGINE.molarMass(sp)));

  /* ---- Limits (SPEC §4 rule 4, plus the floors that keep answers sensible) -- */
  const LEVELS = ['moles', 'grams', 'mixed'];
  const N_MIN = 0.005, N_MAX = 1.5;          // mol, every reactant whatever the given
  const M_MIN = 0.1, M_MAX = 60;             // g, a mass given — and the most any reactant weighs
  const GAS_MIN = 0.05, GAS_MAX = 10;        // dm³ of gas
  const C_MIN = 0.05, C_MAX = 2.0;           // mol dm⁻³
  const VOLS = [10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250];                         // cm³ of solution
  const CONCS = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.75, 1.00, 1.50, 2.00];
  const MARGIN_MIN = 1.15;                   // larger batch ÷ smaller batch
  const LEFT_MOL = 0.003, LEFT_MASS = 0.05;  // what is left over must be worth asking about
  const PROD_MIN = 0.004;                    // mol of every product the limiting reactant can make
  const YIELD_GAS_MAX = 20;                  // dm³, the most a product's gas volume may come to when it is asked for
  const FACTORS = [[1.25, 3], [1.5, 5], [2, 6], [2.5, 3], [3, 3], [4, 2]];                    // [factor, weight]
  const TIE_SHARE = 0.08;

  /* ---- Species -------------------------------------------------------------
     Every species in a reaction the generator may use is listed here, so that
     what can be given as mass / moles / concentration × volume / gas volume is
     a decision, not a guess. The tests fail if a usable reaction contains a
     species that is missing.
       g   gas — a gas volume may be given        n   gas, but never as a volume
       l   liquid                                 s   solid
       aN  can be a solution, up to N mol dm⁻³ (phase 'aq' unless it is also g). N is never more
           than 80 % of what dissolves at 20 °C, and no more than a reagent bottle could hold
       mN  never more than N mol (violent or corrosive: a piece, not a block)
     Anything missing is treated as a solid: mass or moles only. */
  const TABLE = [
    'g: H2 O2 N2 Cl2 CO2 CO NO SO2 CH4 C2H6 C3H8 C4H10 C2H4 C2H2 C3H6',
    'n: NO2',                                        // N₂O₄ dimerises
    'g a2: NH3',                                     // gas, or ammonia solution
    'l m0.1: Br2',
    'l: H2O C2H5OH CH3OH C3H7OH C4H9OH C5H12 C6H14 C7H16 C8H18 CS2 SO3 SiCl4',
    's m0.1: Na K',
    's: Zn Mg Fe Ca Al Cu Sn Ni Co Mn Pb Ag W Cr Si C S',
    's: CuO MgO ZnO CaO Fe2O3 Al2O3 FeO PbO NiO Cr2O3 SnO2 WO3 SiO2',
    's: Ca(OH)2 Mg(OH)2 Al(OH)3 Cu(OH)2 Fe(OH)2 Fe(OH)3 Ni(OH)2 Co(OH)2',
    's: CaCO3 MgCO3 BaCO3 ZnCO3 FeCO3 CuCO3 Ag2CO3 Ag3PO4',
    's: AgCl AgBr AgI PbCl2 PbBr2 PbI2 BaSO4 PbSO4 CaSO4',
    's: C6H12O6 CaC2 Mg3N2 FeS ZnS Al2S3',
    'a2: HCl HNO3 H2SO4 CH3COOH NaOH KOH NaCl KCl LiCl NaNO3 NH4Cl NH4NO3',
    'a1: HBr HI LiOH KBr NaBr KI NaI Na2CO3 K2CO3 KHCO3 Na2S2O3 K3PO4 H3C6H5O7 Na3C6H5O7',
    'a1: CaCl2 MgCl2 ZnCl2 CuCl2 MnCl2 MgSO4 ZnSO4 CuSO4 (NH4)2SO4 KNO3 Ca(NO3)2 Mg(NO3)2',
    'a1: Cu(NO3)2 Zn(NO3)2 Ni(NO3)2 CH3COONa (CH3COO)2Ca (CH3COO)2Mg',
    'a0.5: NaHCO3 FeCl2 FeCl3 AlCl3 NiCl2 CoCl2 SnCl2 BaCl2 ZnBr2 MgBr2 AlBr3 Na2SO4 FeSO4 NiSO4',
    'a0.5: AgNO3 Pb(NO3)2 Fe(NO3)2 Mn(NO3)2',
    'a0.25: K2SO4 Al2(SO4)3 Fe2(SO4)3',
    'a0.2: Ba(NO3)2',                                // dissolves to about 0.34 mol dm⁻³ at 20 °C, less when cool
    'a0.1: Ba(OH)2'                                  // sparingly soluble (about 0.2 mol dm⁻³ at 20 °C)
  ];
  const SPECIES = {};
  TABLE.forEach(line => {
    const [flags, names] = line.split(':');
    const f = flags.trim().split(/\s+/);
    const s = { phase: null, mass: true, conc: false, gas: false, known: true };
    f.forEach(t => {
      if (t === 'g') { s.phase = 'gas'; s.gas = true; }
      else if (t === 'n') s.phase = 'gas';
      else if (t === 'l') s.phase = 'liquid';
      else if (t === 's') s.phase = 'solid';
      else if (t[0] === 'a') { s.conc = true; s.concMax = parseFloat(t.slice(1)); }
      else if (t[0] === 'm') s.nMax = parseFloat(t.slice(1));
    });
    if (!s.phase) s.phase = s.conc ? 'aq' : 'solid';
    names.trim().split(/\s+/).forEach(sp => { SPECIES[sp] = Object.assign({}, s); });
  });
  const spec = sp => SPECIES[sp] || (SPECIES[sp] = { phase: 'solid', mass: true, conc: false, gas: false, known: false });
  const species = sp => Object.assign({}, spec(String(sp).replace(/^\d+/, '')));

  /* ---- Reaction filter ---------------------------------------------------- */
  // Decided one by one; the reason is shown to a reviewer, so keep it to a line.
  const REJECT = {
    // neutralisation
    'H3PO4 + 3NaOH -> Na3PO4 + 3H2O': 'H₃PO₄ gives up its third H⁺ only partly in water, so the product depends on the ratio',
    'H3PO4 + 3KOH -> K3PO4 + 3H2O': 'H₃PO₄ gives up its third H⁺ only partly in water, so the product depends on the ratio',
    '2H3PO4 + 3Ca(OH)2 -> Ca3(PO4)2 + 6H2O': 'excess H₃PO₄ gives soluble acid phosphates, not Ca₃(PO₄)₂',
    'H2SO4 + Ca(OH)2 -> CaSO4 + 2H2O': 'CaSO₄ dissolves a little (0.015 mol dm⁻³) and coats the hydroxide, like CaCO₃ and CaO in H₂SO₄',
    // acid + metal
    '2Na + 2HCl -> 2NaCl + H2': 'sodium in acid is explosive, not a school experiment',
    '2K + 2HCl -> 2KCl + H2': 'potassium in acid is explosive, not a school experiment',
    'Ca + H2SO4 -> CaSO4 + H2': 'insoluble CaSO₄ coats the calcium and stops the reaction',
    'Ca + 2HCl -> CaCl2 + H2': 'calcium left over after the acid is used up reacts with the water, so the leftover and the H₂ would be wrong',
    // acid + carbonate / oxide
    'CaCO3 + H2SO4 -> CaSO4 + H2O + CO2': 'insoluble CaSO₄ coats the carbonate and stops the reaction',
    'CaO + H2SO4 -> CaSO4 + H2O': 'insoluble CaSO₄ coats the oxide and stops the reaction',
    'PbO + 2HCl -> PbCl2 + H2O': 'poorly soluble PbCl₂ coats the oxide',
    'Na2O + 2HCl -> 2NaCl + H2O': 'Na₂O is not a stock reagent (reacts violently with water)',
    'K2O + 2HCl -> 2KCl + H2O': 'K₂O is not a stock reagent (reacts violently with water)',
    'BaO + 2HCl -> BaCl2 + H2O': 'BaO is toxic and not a stock reagent',
    'Sc2O3 + 6HNO3 -> 2Sc(NO3)3 + 3H2O': 'scandium is a rare-earth reagent, not a school exercise',
    'Bi2O3 + 6HNO3 -> 2Bi(NO3)3 + 3H2O': 'Bi(NO₃)₃ hydrolyses to a basic salt on dilution',
    'Mn2O3 + 6HCl -> 2MnCl3 + 3H2O': 'MnCl₃ is unstable: the real products are MnCl₂ + Cl₂',
    'Mn(OH)2 + 2HBr -> MnBr2 + 2H2O': 'Mn(OH)₂ is air-sensitive and not a school reagent',
    // combustion
    '4Na + O2 -> 2Na2O': 'sodium gives Na₂O or Na₂O₂ depending on the O₂ supply',
    '2Na + O2 -> Na2O2': 'sodium gives Na₂O or Na₂O₂ depending on the O₂ supply',
    '4K + O2 -> 2K2O': 'potassium gives K₂O, K₂O₂ or KO₂ depending on the O₂ supply',
    'K + O2 -> KO2': 'superoxide is exotic and the product depends on the O₂ supply',
    '4Fe + 3O2 -> 2Fe2O3': 'iron gives Fe₂O₃ or Fe₃O₄ depending on conditions',
    '3Fe + 2O2 -> Fe3O4': 'iron gives Fe₂O₃ or Fe₃O₄ depending on conditions',
    '4Cr + 3O2 -> 2Cr2O3': 'burning chromium is not a school reaction',
    'P4 + 5O2 -> P4O10': 'limited O₂ gives P₄O₆; white phosphorus is pyrophoric',
    '2H2S + 3O2 -> 2SO2 + 2H2O': 'limited O₂ gives sulfur; H₂S is a toxic gas',
    // precipitation
    'ZnSO4 + 2NaOH -> Zn(OH)2 + Na2SO4': 'Zn(OH)₂ is amphoteric: excess NaOH redissolves it',
    'AlCl3 + 3NaOH -> Al(OH)3 + 3NaCl': 'Al(OH)₃ is amphoteric: excess NaOH redissolves it',
    'CrCl3 + 3NaOH -> Cr(OH)3 + 3NaCl': 'Cr(OH)₃ is amphoteric: excess NaOH redissolves it',
    '2AgNO3 + Na2SO4 -> Ag2SO4 + 2NaNO3': 'Ag₂SO₄ is too soluble (about 0.03 mol dm⁻³) for complete precipitation',
    'Pb(NO3)2 + 2NaCl -> PbCl2 + 2NaNO3': 'PbCl₂ is too soluble (about 0.04 mol dm⁻³): at school concentrations it precipitates only partly, or not at all',
    'Pb(NO3)2 + 2KBr -> PbBr2 + 2KNO3': 'PbBr₂ is too soluble (about 0.03 mol dm⁻³): at school concentrations it precipitates only partly, or not at all',
    // displacement
    'Fe + 2AgNO3 -> Fe(NO3)2 + 2Ag': 'excess Ag⁺ can oxidise the Fe²⁺ on to Fe³⁺',
    'Cl2 + 2KI -> 2KCl + I2': 'excess Cl₂ oxidises the I₂ further, to iodate',
    'Cl2 + 2NaI -> 2NaCl + I2': 'excess Cl₂ oxidises the I₂ further, to iodate',
    'Br2 + 2KI -> 2KBr + I2': 'excess Br₂ can oxidise the I₂ further, to iodate',
    'Br2 + 2NaI -> 2NaBr + I2': 'excess Br₂ can oxidise the I₂ further, to iodate',
    '2Al + 3CuO -> Al2O3 + 3Cu': 'violent thermite-type reaction, not a standard exercise',
    'TiCl4 + 2Mg -> Ti + 2MgCl2': 'Kroll process: industrial, under argon, TiCl₄ fumes',
    // synthesis
    '4NH3 + 5O2 -> 4NO + 6H2O': 'excess O₂ takes the NO on to NO₂ (industrial multi-stage process)',
    '3NO2 + H2O -> 2HNO3 + NO': 'NO₂ disproportionates and dimerises to N₂O₄',
    'N2 + O2 -> 2NO': 'equilibrium: only a few % NO forms even at very high temperature',
    'CO2 + H2O -> H2CO3': 'equilibrium: almost no H₂CO₃ forms',
    'Ca(OH)2 + CO2 -> CaCO3 + H2O': 'excess CO₂ redissolves the precipitate as Ca(HCO₃)₂',
    'C + H2O -> CO + H2': 'high-temperature equilibrium (water gas): products depend on conditions',
    'CO + 2H2 -> CH3OH': 'industrial equilibrium: conversion is incomplete',
    '2C + SiO2 -> Si + 2CO': 'excess carbon gives SiC instead of Si',
    'SO3 + H2O -> H2SO4': 'excess SO₃ dissolves in the acid as oleum; violent, and not a laboratory-scale reaction',
    'CO2 + 2NaOH -> Na2CO3 + H2O': 'excess CO₂ gives NaHCO₃: the product depends on the ratio',
    'CO2 + NaOH -> NaHCO3': 'excess NaOH gives Na₂CO₃: the product depends on the ratio',
    'SO2 + 2NaOH -> Na2SO3 + H2O': 'excess SO₂ gives NaHSO₃: the product depends on the ratio',
    'SO3 + 2NaOH -> Na2SO4 + H2O': 'excess SO₃ gives NaHSO₄: the product depends on the ratio',
    '2LiOH + CO2 -> Li2CO3 + H2O': 'excess CO₂ gives LiHCO₃ in solution: the product depends on the ratio',
    '4KO2 + 2CO2 -> 2K2CO3 + 3O2': 'KO₂ (superoxide) is exotic',
    'Na2O + H2O -> 2NaOH': 'Na₂O is not a stock reagent (reacts violently with water)',
    'K2O + H2O -> 2KOH': 'K₂O is not a stock reagent (reacts violently with water)',
    'BaO + H2O -> Ba(OH)2': 'BaO is toxic and not a stock reagent',
    'H2 + S -> H2S': 'H₂S is a toxic gas and the reaction is reversible',
    '6Li + N2 -> 2Li3N': 'lithium nitride is an exotic reagent',
    'H2 + F2 -> 2HF': 'F₂ and HF are far too hazardous',
    '2K + Cl2 -> 2KCl': 'potassium in chlorine is explosive',
    'Br2 + 2K -> 2KBr': 'potassium in bromine is explosive',
    '2Cs + Cl2 -> 2CsCl': 'caesium is exotic and explosive',
    '2Cs + 2H2O -> 2CsOH + H2': 'caesium is exotic and explosive',
    'Pb + Cl2 -> PbCl2': 'lead gives PbCl₂ or PbCl₄ with excess Cl₂; not a school reaction',
    'Mg3N2 + 6H2O -> 3Mg(OH)2 + 2NH3': 'exotic, and the NH₃ dissolves in the water that is a reactant',
    '2HCl + Na2S -> H2S + 2NaCl': 'evolves toxic H₂S',
    '2NaCN + H2SO4 -> Na2SO4 + 2HCN': 'evolves HCN, far too hazardous',
    'CO + Cl2 -> COCl2': 'phosgene is far too hazardous',
    'Cu + 4HNO3 -> Cu(NO3)2 + 2H2O + 2NO2': 'needs concentrated HNO₃ and gives toxic NO₂',
    '2NaCl + 2H2O -> 2NaOH + H2 + Cl2': 'electrolysis: driven by the charge passed, not by mixing reactants',
    // p-block
    'SiO2 + 2NaOH -> Na2SiO3 + H2O': 'sand barely reacts with aqueous alkali (needs fusion)',
    'SiCl4 + 2H2O -> SiO2 + 4HCl': 'hydrolysis is stepwise: the product depends on how much water; fuming hazard',
    'PbO2 + 4HCl -> PbCl2 + Cl2 + 2H2O': 'redox that evolves Cl₂, not a school exercise',
    'P4O10 + 6H2O -> 4H3PO4': 'limited water gives polyphosphoric acids',
    '2P + 3Cl2 -> 2PCl3': 'excess Cl₂ gives PCl₅',
    'P4 + 6Cl2 -> 4PCl3': 'excess Cl₂ gives PCl₅',
    '2P + 3Br2 -> 2PBr3': 'excess Br₂ gives PBr₅',
    'PCl3 + Cl2 -> PCl5': 'reversible',
    'PCl5 + 4H2O -> H3PO4 + 5HCl': 'hydrolysis is stepwise: the product depends on how much water',
    'PCl5 + H2O -> POCl3 + 2HCl': 'hydrolysis is stepwise: the product depends on how much water',
    'SO2 + H2O -> H2SO3': 'equilibrium: H₂SO₃ cannot be isolated',
    'SO2 + 2H2S -> 3S + 2H2O': 'H₂S is a toxic gas (Claus process)',
    'SO2 + Cl2 -> SO2Cl2': 'needs a catalyst and is reversible',
    'Na2S2O3 + 2HCl -> 2NaCl + S + SO2 + H2O': 'with thiosulfate in excess the first product is HSO₃⁻, not SO₂, and SO₂ stays dissolved',
    'NaCl + H2SO4 -> NaHSO4 + HCl': 'needs concentrated H₂SO₄; qualitative halide test',
    '2NaBr + 2H2SO4 -> Na2SO4 + Br2 + SO2 + 2H2O': 'redox with concentrated H₂SO₄ (halide test)',
    '8NaI + 5H2SO4 -> 4Na2SO4 + 4I2 + H2S + 4H2O': 'evolves H₂S (halide test)',
    'Na2SiO3 + 8HF -> H2SiF6 + 2NaF + 3H2O': 'HF is far too hazardous',
    'SeO2 + 2NaOH -> Na2SeO3 + H2O': 'selenium is toxic and exotic',
    'SeO2 + H2O -> H2SeO3': 'selenium is toxic and exotic',
    'SiO2 + 2F2 -> SiF4 + O2': 'F₂ is far too hazardous',
    'Mg2Si + 4H2O -> SiH4 + 2Mg(OH)2': 'silane is pyrophoric, exotic',
    'GeCl4 + 2H2O -> GeO2 + 4HCl': 'germanium is exotic; hydrolysis is stepwise',
    'Sn + 2H2O -> SnO2 + 2H2': 'tin does not react with steam under school conditions',
    'I2 + F2 -> 2IF': 'F₂ and interhalogens are far too hazardous',
    'I2 + AgF -> IF + AgI': 'interhalogen, exotic',
    'I2 + 3XeF2 -> 2IF3 + 3Xe': 'XeF₂ is exotic',
    'Ti + 2F2 -> TiF4': 'F₂ is far too hazardous'
  };
  const BUILT_IN = new Set(DB.map(q => q.eq));
  const reasons = new Map();
  function reasonOf(q) {
    if (!q || !q.eq || !q.A || !q.B) return 'not a two-reactant reaction';
    if (q.cat === 'custom' || !BUILT_IN.has(q.eq)) return 'not in the built-in database';
    if (q.hadSpect || q.eq.indexOf('^') >= 0) return 'ionic: net-ionic, complex-ion, half-equation or titration';
    if (q.equil || q.eq.indexOf('<=>') >= 0) return 'equilibrium: does not go to completion';
    if (/disprop/i.test(q.cond || '')) return 'disproportionation: the product depends on temperature';
    if (/incomplete/i.test(q.cond || '')) return 'incomplete combustion: excess O₂ would give CO₂';
    if (/recombin/i.test(q.cond || '')) return 'the products recombine: does not go to completion';
    const p = parse(q.eq);
    if (p.reactants.concat(p.products).some(t => mm(t.sp) == null)) return 'unknown molar mass';
    return REJECT[q.eq] || null;
  }
  function rejection(q) {
    const key = q && q.eq;
    if (!reasons.has(key)) reasons.set(key, reasonOf(q));
    return reasons.get(key);
  }
  const isSafe = q => rejection(q) === null;
  let safeCache = null;
  const safeList = () => (safeCache || (safeCache = DB.filter(isSafe))).slice();
  const has = (table, key) => Object.prototype.hasOwnProperty.call(table, key);

  /* ---- Direction ------------------------------------------------------------
     A few equations are the reaction only while one particular reactant is the one
     that runs out (or the two are matched). For those, every problem is set that
     way round, so the equation on screen is true whatever amounts the student
     meets. Set the other way round the products themselves change (a hydrogen-
     carbonate, a lower oxide, Cu₂O …), so "how much is left" and "how much forms"
     would have no honest answer.
       equation: [the reactant that must run out, why] */
  const CARB = 'a carbonate takes one H⁺ first (to HCO₃⁻): CO₂ is released only once the acid is in excess';
  const SLIP = 'with the carbon short, CO goes on reducing the oxide and CO₂ forms instead';
  const WET = 'with the water short, the leftover metal reacts on with the molten hydroxide it made, so there is no honest leftover';
  const ONE_WAY = {
    'Na2CO3 + 2HCl -> 2NaCl + H2O + CO2': ['Na2CO3', CARB],
    'Na2CO3 + H2SO4 -> Na2SO4 + H2O + CO2': ['Na2CO3', CARB],
    'Na2CO3 + 2HNO3 -> 2NaNO3 + H2O + CO2': ['Na2CO3', CARB],
    'K2CO3 + 2HCl -> 2KCl + H2O + CO2': ['K2CO3', CARB],
    'K2CO3 + H2SO4 -> K2SO4 + H2O + CO2': ['K2CO3', CARB],
    'K2CO3 + 2HNO3 -> 2KNO3 + H2O + CO2': ['K2CO3', CARB],
    '3NaHCO3 + H3C6H5O7 -> 3CO2 + 3H2O + Na3C6H5O7': ['H3C6H5O7', 'with the hydrogencarbonate short, the citric acid keeps some of its H⁺: the salt is not Na₃C₆H₅O₇'],
    'Fe2O3 + 3CO -> 2Fe + 3CO2': ['Fe2O3', 'with the CO short, the reduction stops at Fe₃O₄ / FeO: not all of it is iron'],
    'Fe2O3 + 3H2 -> 2Fe + 3H2O': ['Fe2O3', 'with the H₂ short, the reduction stops at Fe₃O₄ / FeO: not all of it is iron'],
    'WO3 + 3H2 -> W + 3H2O': ['WO3', 'with the H₂ short, the reduction stops at lower oxides (WO₂): not all of it is tungsten'],
    'ZnO + C -> Zn + CO': ['ZnO', SLIP],
    'SnO2 + 2C -> Sn + 2CO': ['SnO2', SLIP],
    '2Cu + O2 -> 2CuO': ['Cu', 'with the O₂ short, some of the copper stops at Cu₂O instead of CuO'],
    '2Na + 2H2O -> 2NaOH + H2': ['Na', WET],
    '2K + 2H2O -> 2KOH + H2': ['K', WET],
    '4NH3 + 3O2 -> 2N2 + 6H2O': ['O2', 'with O₂ in excess, some of the ammonia burns on to NO instead of N₂']
  };
  // null (either reactant may run out) or { side: 'A' | 'B', sp, why }
  function oneWay(q) {
    if (!q || !q.A || !q.B || !has(ONE_WAY, q.eq)) return null;
    const row = ONE_WAY[q.eq], side = q.A.sp === row[0] ? 'A' : (q.B.sp === row[0] ? 'B' : null);
    return side ? { side, sp: row[0], why: row[1] } : null;
  }
  // Can this reaction be set with `verdict` ('A' | 'B' | 'tie') as the answer?
  const allows = (q, verdict) => { const o = oneWay(q); return !o || verdict === 'tie' || verdict === o.side; };

  /* ---- Strength of solution --------------------------------------------------
     A few reactions only run, or only give the stated product, with the acid at a
     certain strength: [lowest, highest, why] in mol dm⁻³ for that species in that
     reaction, always inside the species' own cap. Mass and mole givens are not affected. */
  const SLOW = 'dissolves too slowly in acid weaker than 1 mol dm⁻³';
  const WINDOW = {
    '3Cu + 8HNO3 -> 3Cu(NO3)2 + 4H2O + 2NO': { HNO3: [1.0, 2.0, 'dilute nitric acid gives NO (concentrated gives NO₂); weaker than 1 mol dm⁻³ copper hardly reacts'] },
    'Sn + 2HCl -> SnCl2 + H2': { HCl: [1.0, 2.0, 'tin ' + SLOW] },
    'Ni + 2HCl -> NiCl2 + H2': { HCl: [1.0, 2.0, 'nickel ' + SLOW] },
    'Co + 2HCl -> CoCl2 + H2': { HCl: [1.0, 2.0, 'cobalt ' + SLOW] },
    'Ni + H2SO4 -> NiSO4 + H2': { H2SO4: [1.0, 2.0, 'nickel ' + SLOW] }
  };
  const windowOf = (q, sp) => (q && has(WINDOW, q.eq) && has(WINDOW[q.eq], sp) ? WINDOW[q.eq][sp] : null);

  /* ---- What to print beside the equation ---------------------------------------
     q.cond says some of it ("thermite, Δ", "dilute HNO₃", "steam"). Added here: a carbon
     fuel burns completely, and the reactions that need heat (or a spark) say so. */
  const NEEDS = {
    'Fe + S -> FeS': 'heated', 'Zn + S -> ZnS': 'heated', '2Al + 3S -> Al2S3': 'heated',
    '2Fe + 3Cl2 -> 2FeCl3': 'heated', 'Cu + Cl2 -> CuCl2': 'heated', 'Zn + Cl2 -> ZnCl2': 'heated', 'Mg + Cl2 -> MgCl2': 'heated',
    'Ca + Cl2 -> CaCl2': 'heated', '2Na + Cl2 -> 2NaCl': 'heated', '2Al + 3Cl2 -> 2AlCl3': 'heated', 'Si + 2Cl2 -> SiCl4': 'heated',
    '3Mg + N2 -> Mg3N2': 'heated', 'H2 + Br2 -> 2HBr': 'heated', 'H2 + Cl2 -> 2HCl': 'spark or UV light',
    'CuO + H2 -> Cu + H2O': 'heated', 'Fe2O3 + 3H2 -> 2Fe + 3H2O': 'heated', 'WO3 + 3H2 -> W + 3H2O': 'heated', 'SnO2 + 2C -> Sn + 2CO': 'heated'
  };
  function condition(q) {
    if (!q || !q.eq) return '';
    const out = q.cond ? [q.cond] : [];
    const fuel = q.cat === 'comb' && [q.A, q.B].some(t => t && t.sp !== 'CO' && (ENGINE.composition(t.sp).C || 0) > 0);
    if (fuel) out.push('complete combustion');
    else if (has(NEEDS, q.eq)) out.push(NEEDS[q.eq]);
    return out.join(' · ');
  }

  /* ---- Amounts → moles: the exact formulas the apps use --------------------- */
  const volDm3 = g => (g.volUnit === 'cm3' ? g.vol / 1000 : g.vol);
  function molesOf(g, sp) {
    if (!g) return NaN;
    if (g.kind === 'mol') return g.value;
    if (g.kind === 'mass') return g.value / mm(sp);
    if (g.kind === 'conc') return g.conc * (g.volUnit === 'cm3' ? g.vol / 1000 : g.vol);
    if (g.kind === 'gas') return (g.volUnit === 'cm3' ? g.vol / 1000 : g.vol) / VM[g.cond];
    return NaN;
  }
  // The same amount as the apps' input fields hold it: strings, exactly as printed ('12.0', '0.200'),
  // which parseFloat turns back into the very number in the given.
  function toInput(g) {
    g = g || {};
    const o = { method: g.kind, mass: '', conc: '', cvol: '', cvolUnit: 'cm3', gvol: '', gvolUnit: 'dm3', cond: 'RTP' };
    if (g.kind === 'mol') o.mol = fmt(g.value);
    if (g.kind === 'mass') o.mass = fmt(g.value);
    if (g.kind === 'conc') { o.conc = fmt(g.conc); o.cvol = fmt(g.vol); o.cvolUnit = g.volUnit; }
    if (g.kind === 'gas') { o.gvol = fmt(g.vol); o.gvolUnit = g.volUnit; o.cond = g.cond; }
    return o;
  }

  /* ---- Text ------------------------------------------------------------------- */
  const roundSig = (x, n) => Number(x.toPrecision(n));
  // 3 s.f. in fixed notation, trailing zeros kept: 12.0  0.250  480  0.0500  1.20
  function fmt(x) {
    const r = roundSig(x, 3);
    const e = Math.floor(Math.log10(Math.abs(r)) + 1e-9);
    return r.toFixed(Math.max(0, 2 - e));
  }
  const UNIT = { cm3: 'cm³', dm3: 'dm³' };
  function format(g) {
    g = g || {};
    if (g.kind === 'mol') { const n = fmt(g.value); return { num: n, unit: 'mol', text: `${n} mol` }; }
    if (g.kind === 'mass') { const n = fmt(g.value); return { num: n, unit: 'g', text: `${n} g` }; }
    if (g.kind === 'conc') {
      const v = fmt(g.vol), c = fmt(g.conc), u = UNIT[g.volUnit];
      return { num: v, unit: u, conc: c, concUnit: 'mol dm⁻³', text: `${v} ${u} of ${c} mol dm⁻³` };
    }
    if (g.kind === 'gas') {
      const v = fmt(g.vol), u = UNIT[g.volUnit];
      return { num: v, unit: u, cond: g.cond, text: `${v} ${u} gas at ${g.cond}` };
    }
    return { num: '', unit: '', text: '' };
  }
  const describe = (g, sp) => format(g).text;

  /* ---- Randomness ---------------------------------------------------------------- */
  function rng(seed) {
    let a = typeof seed === 'string' ? Array.from(seed).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) : (seed >>> 0);
    return function () {                                  // mulberry32
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  // The caller's rng, kept inside [0, 1) whatever it returns; Math.random when none is given.
  function useRng(f) {
    if (typeof f !== 'function') return Math.random;
    return () => { const u = f(); return u >= 0 && u < 1 ? +u : 0; };
  }
  const pick = (arr, r) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
  function pickW(items, weight, r) {
    const ws = items.map(weight);
    let t = r() * ws.reduce((s, w) => s + w, 0);
    for (let i = 0; i < items.length; i++) { t -= ws[i]; if (t < 0) return items[i]; }
    return items[items.length - 1];
  }
  // The shortest of 1, 2 or 3 s.f. that stays close to x, so numbers look printed.
  function nice(x) {
    const r1 = roundSig(x, 1); if (Math.abs(r1 - x) <= 0.012 * x) return r1;
    const r2 = roundSig(x, 2); if (Math.abs(r2 - x) <= 0.022 * x) return r2;
    return roundSig(x, 3);
  }

  /* ---- Givens ---------------------------------------------------------------------- */
  // What a reactant may be given as. Nothing burns in solution, so no solutions in combustion.
  const kindsOf = (sp, q) => { const s = spec(sp); return ['mol', 'mass'].concat(s.conc && q.cat !== 'comb' ? ['conc'] : [], s.gas ? ['gas'] : []); };
  // Gas volumes print in dm³ from 1 dm³ up, in cm³ below.
  function gasGiven(vDm3, cond) {
    const d = roundSig(vDm3, 3);
    return d >= 1 ? { kind: 'gas', vol: d, volUnit: 'dm3', cond }
                  : { kind: 'gas', vol: roundSig(d * 1000, 3), volUnit: 'cm3', cond };
  }
  const near = (x, y, tol) => Math.abs(x - y) <= tol * Math.abs(y);
  function validGiven(g, sp, q) {
    const s = spec(sp), w = windowOf(q, sp);
    if (g.kind === 'mol') return g.value > 0 && near(g.value, roundSig(g.value, 3), 1e-12);
    if (g.kind === 'mass') return g.unit === 'g' && g.value >= M_MIN && g.value <= M_MAX && near(g.value, roundSig(g.value, 3), 1e-12);
    if (g.kind === 'conc') return s.conc && g.volUnit === 'cm3' && VOLS.indexOf(g.vol) >= 0
      && g.conc >= Math.max(C_MIN, w ? w[0] : 0) * (1 - 1e-9) && g.conc <= Math.min(C_MAX, s.concMax, w ? w[1] : Infinity) * (1 + 1e-9);
    if (g.kind === 'gas') return s.gas && (g.cond === 'RTP' || g.cond === 'STP')
      && volDm3(g) >= GAS_MIN * (1 - 1e-9) && volDm3(g) <= GAS_MAX * (1 + 1e-9)
      && near(g.vol, roundSig(g.vol, 3), 1e-12) && (g.volUnit === 'dm3' ? g.vol >= 1 : g.vol < 1000);
    return false;
  }
  // Whatever the form of the given, the reactant must be a bench-sized amount (and, for a
  // solution, the strength this reaction needs: q is optional, without it only the species cap applies).
  function inWindow(g, sp, q) {
    const n = molesOf(g, sp);
    return validGiven(g, sp, q) && n >= N_MIN * (1 - 1e-9) && n <= Math.min(N_MAX, spec(sp).nMax || N_MAX) * (1 + 1e-9)
      && n * mm(sp) <= M_MAX * (1 + 1e-9);
  }

  const NICE_MOL = [0.010, 0.015, 0.020, 0.025, 0.030, 0.040, 0.050, 0.060, 0.075, 0.080, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.60, 0.75, 1.0, 1.2];
  const NICE_MASS = [0.50, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 7.5, 8.0, 10, 12, 15, 20, 25, 30, 40, 50];
  const GENERIC_GAS = [0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10];
  const NICE_GAS = {
    RTP: GENERIC_GAS.concat([0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.96, 1.2, 1.8, 2.4, 3.6, 4.8, 7.2, 9.6]),
    STP: GENERIC_GAS.concat([0.112, 0.224, 0.336, 0.448, 0.56, 0.672, 0.896, 1.12, 1.68, 2.24, 3.36, 4.48, 6.72, 8.96])
  };
  const anchorCache = {};
  // Every legal given of one kind for one species (the pool anchors and solutions draw from).
  function choices(kind, sp, cond, q) {
    const key = kind + '|' + sp + '|' + (kind === 'gas' ? cond : '') + (kind === 'conc' && windowOf(q, sp) ? '|' + q.id : '');
    if (anchorCache[key]) return anchorCache[key];
    let list = [];
    if (kind === 'mol') list = NICE_MOL.map(value => ({ kind, value }));
    else if (kind === 'mass') list = NICE_MASS.map(value => ({ kind, value, unit: 'g' }));
    else if (kind === 'gas') list = NICE_GAS[cond].map(v => gasGiven(v, cond));
    else if (kind === 'conc') {
      CONCS.filter(c => c <= spec(sp).concMax * (1 + 1e-9)).forEach(conc => VOLS.forEach(vol => list.push({ kind, conc, vol, volUnit: 'cm3' })));
    }
    return (anchorCache[key] = list.filter(g => inWindow(g, sp, q)));
  }
  const concWeight = g => (g.conc >= 0.1 && g.conc <= 1 ? 1 : 0.5);
  // A given of `kind` close to `n` mol, rounded the way a textbook would print it.
  function givenFor(kind, sp, n, cond, r, q) {
    if (kind === 'mol') return { kind, value: nice(n) };
    if (kind === 'mass') return { kind, value: nice(n * mm(sp)), unit: 'g' };
    if (kind === 'gas') return gasGiven(nice(n * VM[cond]), cond);
    const close = choices('conc', sp, cond, q).filter(g => near(molesOf(g, sp), n, 0.06));
    return close.length ? pickW(close, g => concWeight(g) / (1 + 15 * Math.abs(molesOf(g, sp) - n) / n), r) : null;
  }

  /* ---- Scenarios --------------------------------------------------------------------- */
  // Why the last attempt was thrown away (for stats()).
  let miss = null;
  const no = why => { miss = why; return null; };
  const productCache = new Map();
  const productsOf = q => {
    if (!productCache.has(q.eq)) productCache.set(q.eq, parse(q.eq).products);
    return productCache.get(q.eq);
  };
  // Check a pair of givens against every rule; null if any fails.
  function assemble(q, givens, want, level) {
    const sps = [q.A.sp, q.B.sp];
    const n = givens.map((g, i) => molesOf(g, sps[i]));
    if (!n.every(x => isFinite(x) && x > 0)) return no('not a number');
    if (!givens.every((g, i) => inWindow(g, sps[i], q) && kindsOf(sps[i], q).indexOf(g.kind) >= 0)) return no('outside its allowed range');
    if (givens[0].kind === 'gas' && givens[1].kind === 'gas' && givens[0].cond !== givens[1].cond) return no('gas conditions differ');
    const res = solve(q, n[0], n[1]);
    const bA = n[0] / q.A.coef, bB = n[1] / q.B.coef;
    const margin = Math.max(bA, bB) / Math.min(bA, bB);
    const verdict = res.tie ? 'tie' : (res.limiting === q.A ? 'A' : 'B');
    if (!allows(q, verdict)) return no('the equation does not hold that way round');
    if (want && verdict !== want) return no('rounding changed the verdict');
    if (verdict !== 'tie' && !(margin >= MARGIN_MIN)) return no('margin under 1.15');
    if (verdict !== 'tie' && !(res.leftMol >= LEFT_MOL && res.leftMass >= LEFT_MASS)) return no('too little left over');
    if (!productsOf(q).every(p => Math.min(bA, bB) * p.coef >= PROD_MIN * (1 - 1e-9))) return no('a product too small');
    return { q, level, givens, nA: n[0], nB: n[1], res, design: { limiting: verdict, margin: verdict === 'tie' ? 1 : margin }, cond: condition(q) };
  }

  const KIND_W = { mol: 0.5, mass: 2, conc: 3, gas: 3 };
  function pickKinds(level, q, r) {
    if (level === 'moles') return ['mol', 'mol'];
    if (level === 'grams') return ['mass', 'mass'];
    const ks = [kindsOf(q.A.sp, q), kindsOf(q.B.sp, q)];
    const k = ks.map(list => pickW(list, x => KIND_W[x], r));
    if (k[0] === k[1] && (k[0] === 'mass' || k[0] === 'mol') && r() < 0.85) {   // mostly, not two of the plain kind
      const i = r() < 0.5 ? 0 : 1;
      k[i] = pickW(ks[i].filter(x => x !== k[0]), x => KIND_W[x], r);
    }
    return k;
  }

  // The least and most (mol) a reactant may be when given as `kind`.
  function span(kind, sp, cond, q) {
    const M = mm(sp), top = Math.min(N_MAX, spec(sp).nMax || N_MAX, M_MAX / M);
    if (kind === 'mol') return [N_MIN, top];
    if (kind === 'mass') return [Math.max(N_MIN, M_MIN / M), top];
    if (kind === 'gas') return [Math.max(N_MIN, GAS_MIN / VM[cond]), Math.min(top, GAS_MAX / VM[cond])];
    const ns = choices('conc', sp, cond, q).map(g => molesOf(g, sp));
    return [Math.min.apply(null, ns), Math.max.apply(null, ns)];
  }

  // Build, don't roll: one reactant gets a round number, the other follows from the
  // equation ratio × a factor (more for the excess, less for the one that runs out).
  // Only round numbers whose partner lands inside its own window are considered.
  function construct(q, level, want, kinds, r) {
    const ref = [q.A, q.B];
    const cond = r() < 0.6 ? 'RTP' : 'STP';
    const side = r() < 0.5 ? 0 : 1;                       // the reactant with the round number
    const other = 1 - side;
    const lim = want === 'A' ? 0 : 1;                     // the reactant that runs out
    const f = pickW(FACTORS, x => x[1], r)[0];
    const scale = (side === lim ? f : 1 / f) * ref[other].coef / ref[side].coef;      // partner mol per anchor mol
    const [lo, hi] = span(kinds[other], ref[other].sp, cond, q);
    const pool = choices(kinds[side], ref[side].sp, cond, q).filter(g => {
      const t = molesOf(g, ref[side].sp) * scale;
      return t >= lo * 0.97 && t <= hi * 1.03;
    });
    if (!pool.length) return no('no round number keeps the partner in range');
    const anchor = kinds[side] === 'conc' ? pickW(pool, concWeight, r) : pick(pool, r);
    const target = molesOf(anchor, ref[side].sp) * scale;
    const g2 = givenFor(kinds[other], ref[other].sp, target, cond, r, q);
    if (!g2) return no('no solution close enough');
    const givens = []; givens[side] = anchor; givens[other] = g2;
    return assemble(q, givens, want, level);
  }

  /* ---- Ties ---------------------------------------------------------------------------
     A tie only counts when the displayed givens give exactly equal batches, so ties are
     found by search: for each batch size, every given that stays exact after rounding. */
  const TIE_T = [0.005, 0.01, 0.0125, 0.02, 0.025, 0.03, 0.04, 0.05, 0.06, 0.075, 0.08, 0.1, 0.125, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.75, 1.0];
  function exactGivens(kind, sp, n, q) {
    const out = [], M = mm(sp);
    if (kind === 'mol') out.push({ kind, value: roundSig(n, 3) });
    else if (kind === 'mass') out.push({ kind, value: roundSig(n * M, 3), unit: 'g' });
    else if (kind === 'conc') choices('conc', sp, undefined, q).forEach(g => out.push(g));
    else if (kind === 'gas') ['RTP', 'STP'].forEach(c => out.push(gasGiven(n * VM[c], c)));
    return out.filter(g => near(molesOf(g, sp), n, 1e-9) && inWindow(g, sp, q));
  }
  const tieCache = {};
  function tieOptions(q, kA, kB) {
    const key = q.id + '|' + kA + '|' + kB;
    if (tieCache[key]) return tieCache[key];
    const opts = [];
    TIE_T.forEach(t => {
      const ga = exactGivens(kA, q.A.sp, q.A.coef * t, q), gb = exactGivens(kB, q.B.sp, q.B.coef * t, q);
      if (ga.length && gb.length) opts.push({ t, ga, gb });
    });
    return (tieCache[key] = opts);
  }
  function constructTie(q, level, kinds, r) {
    const opts = tieOptions(q, kinds[0], kinds[1]);
    if (!opts.length) return no('no exact tie for these givens');
    const o = pick(opts, r);
    const ga = pick(o.ga, r);
    const gb = pick(o.gb.filter(g => !(ga.kind === 'gas' && g.kind === 'gas') || g.cond === ga.cond), r);
    return gb ? assemble(q, [ga, gb], 'tie', level) : no('gas conditions differ');
  }
  const pairsFor = (level, q) => {
    if (level === 'moles') return [['mol', 'mol']];
    if (level === 'grams') return [['mass', 'mass']];
    const out = [];
    kindsOf(q.A.sp, q).forEach(a => kindsOf(q.B.sp, q).forEach(b => out.push([a, b])));
    return out;
  };
  const canTieCache = {};
  function canTie(q, level) {
    const key = q.id + '|' + level;
    if (!(key in canTieCache)) {
      canTieCache[key] = pairsFor(level, q).some(p => tieOptions(q, p[0], p[1]).some(o =>
        o.ga.some(ga => o.gb.some(gb => assemble(q, [ga, gb], 'tie', level)))));
    }
    return canTieCache[key];
  }

  /* ---- Public: build / make ------------------------------------------------------------- */
  const resolve = x => (typeof x === 'number' ? DB[x] : x);
  // One construction attempt on a given reaction (null if the numbers don't work out).
  function attempt(q, level, want, kinds, r) {
    const k = kinds || pickKinds(level, q, r);
    return want === 'tie' ? constructTie(q, level, k, r) : construct(q, level, want, k, r);
  }
  // Up to `tries` attempts on one reaction. For tests, review tooling and "again, same reaction".
  function build(opts) {
    opts = opts || {};
    const q = resolve(opts.q);
    if (!isSafe(q)) return null;
    if (opts.kinds && !(opts.kinds.length === 2 && opts.kinds.every((k, i) => kindsOf(i ? q.B.sp : q.A.sp, q).indexOf(k) >= 0))) return null;
    const level = LEVELS.indexOf(opts.level) >= 0 ? opts.level : 'mixed';
    const r = useRng(opts.rng);
    const ow = oneWay(q);
    const want = opts.want === 'A' || opts.want === 'B' || opts.want === 'tie' ? opts.want : (ow ? ow.side : (r() < 0.5 ? 'A' : 'B'));
    if (!allows(q, want)) return null;
    for (let i = 0; i < (opts.tries || 60); i++) {
      const sc = attempt(q, level, want, opts.kinds, r);
      if (sc) return sc;
    }
    return null;
  }

  // Category weights: share of a category ∝ √(its size), so no family swamps the rest.
  let catCount = null;
  function catWeight(cat) {
    if (!catCount) { catCount = {}; safeList().forEach(q => { catCount[q.cat] = (catCount[q.cat] || 0) + 1; }); }
    return 1 / Math.sqrt(catCount[cat] || 1);
  }
  function chooseReaction(want, level, avoid, r) {
    const fits = q => allows(q, want);                   // a one-way reaction only where its equation holds
    let pool = safeList().filter(q => !avoid.has(q.id) && fits(q));
    if (!pool.length) pool = safeList().filter(fits);
    if (want === 'tie') { const t = pool.filter(q => canTie(q, level)); if (t.length) pool = t; }
    return pickW(pool, q => catWeight(q.cat), r);
  }

  // A known-good scenario (HCl + NaOH, 1 : 1) for when every attempt fails — never expected.
  const FALLBACK_GIVENS = {
    moles: { A: [{ kind: 'mol', value: 0.1 }, { kind: 'mol', value: 0.15 }], B: [{ kind: 'mol', value: 0.15 }, { kind: 'mol', value: 0.1 }], tie: [{ kind: 'mol', value: 0.1 }, { kind: 'mol', value: 0.1 }] },
    grams: { A: [{ kind: 'mass', value: 3.65, unit: 'g' }, { kind: 'mass', value: 6, unit: 'g' }], B: [{ kind: 'mass', value: 5.48, unit: 'g' }, { kind: 'mass', value: 4, unit: 'g' }], tie: [{ kind: 'mass', value: 3.65, unit: 'g' }, { kind: 'mass', value: 4, unit: 'g' }] },
    mixed: {
      A: [{ kind: 'conc', conc: 0.2, vol: 50, volUnit: 'cm3' }, { kind: 'mass', value: 0.6, unit: 'g' }],
      B: [{ kind: 'conc', conc: 0.2, vol: 75, volUnit: 'cm3' }, { kind: 'mass', value: 0.4, unit: 'g' }],
      tie: [{ kind: 'conc', conc: 0.2, vol: 50, volUnit: 'cm3' }, { kind: 'mass', value: 0.4, unit: 'g' }]
    }
  };
  function fallback(level, want) {
    const q = DB.filter(x => x.eq === 'HCl + NaOH -> NaCl + H2O')[0] || safeList()[0];
    const w = want === 'A' || want === 'B' || want === 'tie' ? want : 'A';
    return assemble(q, FALLBACK_GIVENS[level][w], w, level);
  }

  // What each product comes to, and the units it makes sense to ask for it in (for yield questions):
  // moles always, grams from 0.1 g up, dm³ only for a true gas that comes to 0.05–20 dm³.
  function yields(sc) {
    const batch = Math.min(sc.nA / sc.q.A.coef, sc.nB / sc.q.B.coef);
    return productsOf(sc.q).map(p => {
      const n = batch * p.coef, mass = n * mm(p.sp), out = { sp: p.sp, coef: p.coef, n, mass, units: ['mol'] };
      if (mass >= M_MIN) out.units.push('g');
      if (spec(p.sp).gas) {
        out.gas = { RTP: n * VM.RTP, STP: n * VM.STP };
        if (Math.min(out.gas.RTP, out.gas.STP) >= GAS_MIN && Math.max(out.gas.RTP, out.gas.STP) <= YIELD_GAS_MAX) out.units.push('dm3');
      }
      return out;
    });
  }

  const stats = { made: 0, attempts: 0, fallbacks: 0, rejects: {} };
  function make(opts) {
    opts = opts || {};
    const r = useRng(opts.rng);
    const level = LEVELS.indexOf(opts.level) >= 0 ? opts.level : 'mixed';
    const avoid = new Set(Array.isArray(opts.avoid) ? opts.avoid : []);
    const want = opts.want === 'A' || opts.want === 'B' || opts.want === 'tie' ? opts.want
      : (r() < TIE_SHARE ? 'tie' : (r() < 0.5 ? 'A' : 'B'));
    stats.made++;
    for (let round = 0; round < 8; round++) {
      const q = chooseReaction(want, level, avoid, r);
      for (let i = 0; i < 12; i++) {
        stats.attempts++;
        miss = null;
        const sc = attempt(q, level, want, null, r);
        if (sc) return sc;
        stats.rejects[miss || 'other'] = (stats.rejects[miss || 'other'] || 0) + 1;
      }
    }
    stats.fallbacks++;
    return fallback(level, want);
  }

  return {
    make, build, rng, species, isSafe, safeList, rejection, describe, format, molesOf, toInput, yields, canTie, oneWay, condition,
    decisions: () => Object.assign({}, REJECT),
    directions: () => Object.assign({}, ONE_WAY),
    windows: () => JSON.parse(JSON.stringify(WINDOW)),
    levels: LEVELS.slice(),
    stats: () => Object.assign({}, stats, { rejects: Object.assign({}, stats.rejects) }),
    resetStats: () => { stats.made = stats.attempts = stats.fallbacks = 0; stats.rejects = {}; },
    fallback: (level, want) => fallback(LEVELS.indexOf(level) >= 0 ? level : 'mixed', want)
  };
})();

/* In the browser Generator is a global (also window.Generator), loaded after
   chemistry.js. The module block exists only so the tests can require it under Node. */
if (typeof window !== 'undefined') window.Generator = Generator;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Generator;
  Object.defineProperty(Generator, 'Generator', { value: Generator, enumerable: false });
}
