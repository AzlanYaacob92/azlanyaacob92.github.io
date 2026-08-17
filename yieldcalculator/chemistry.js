/* ============================================================================
   chemistry.js  —  domain layer (no DOM)
   Owns: relative atomic masses, the reaction database, reaction categories,
   formula notation, molar-mass calculation, the limiting-reactant maths, and
   the yield maths (theoretical / actual / percentage).
   Shared with Stoichiomathics, which uses the same reaction database and
   limiting-reactant engine; this copy adds the product list to each QUAL
   entry (yield questions are always *about* a product) and the yield block
   at the end. Loaded before app.js. Classic script so it works over file://.
   ========================================================================== */

/* ---- Relative atomic masses (common data-booklet precision) -------------- */
const AM = {
  H:1.0, He:4.0, Li:6.9, Be:9.0, B:10.8, C:12.0, N:14.0, O:16.0, F:19.0, Ne:20.2,
  Na:23.0, Mg:24.3, Al:27.0, Si:28.1, P:31.0, S:32.1, Cl:35.5, Ar:39.9,
  K:39.1, Ca:40.1, Sc:45.0, Ti:47.9, V:50.9, Cr:52.0, Mn:54.9, Fe:55.8, Co:58.9,
  Ni:58.7, Cu:63.5, Zn:65.4, Ga:69.7, Ge:72.6, As:74.9, Se:79.0, Br:79.9, Kr:83.8,
  Rb:85.5, Sr:87.6, Y:88.9, Zr:91.2, Nb:92.9, Mo:95.9, Tc:98.0, Ru:101.1, Rh:102.9,
  Pd:106.4, Ag:107.9, Cd:112.4, In:114.8, Sn:118.7, Sb:121.8, Te:127.6, I:126.9, Xe:131.3,
  Cs:132.9, Ba:137.3, La:138.9, Hf:178.5, Ta:180.9, W:183.8, Re:186.2, Os:190.2, Ir:192.2,
  Pt:195.1, Au:197.0, Hg:200.6, Tl:204.4, Pb:207.2, Bi:209.0, Po:209.0, At:210.0, Rn:222.0
};

/* ---- Reaction categories (label + accent colour) ------------------------- */
const CAT = {
  neut:{label:"Neutralisation",color:"var(--c-neut)"},
  ametal:{label:"Acid + metal",color:"var(--c-ametal)"},
  carb:{label:"Acid + carbonate",color:"var(--c-carb)"},
  oxide:{label:"Acid + oxide / base",color:"var(--c-oxide)"},
  comb:{label:"Combustion",color:"var(--c-comb)"},
  precip:{label:"Precipitation",color:"var(--c-precip)"},
  decomp:{label:"Thermal decomposition",color:"var(--c-decomp)"},
  disp:{label:"Redox / displacement",color:"var(--c-disp)"},
  complex:{label:"Complex ions & d-block",color:"var(--c-complex)"},
  pblock:{label:"p-block (groups 13–17)",color:"var(--c-pblock)"},
  synth:{label:"Synthesis / industrial",color:"var(--c-synth)"},
  titr:{label:"Redox titration (ionic)",color:"var(--c-titr)"},
  elec:{label:"Electrolysis",color:"var(--c-elec)"},
  gasform:{label:"Acid + salt (gas-forming)",color:"var(--c-gasform)"},
  custom:{label:"Custom reaction",color:"var(--c-custom)"}
};

/* ---- Formula notation: species/equation string -> HTML ------------------- */
// A single species, e.g. "2Al2(SO4)3" or "MnO4^-", with subscripts + charges.
function fmtSpecies(s){
  let coef="", rest=s;
  const m = s.match(/^(\d+(?:\/\d+)?)([A-Za-z(\[].*)$/);
  if(m){ coef=m[1]; rest=m[2]; }
  let out="";
  for(let i=0;i<rest.length;i++){
    const c=rest[i];
    if(c==="^"){
      let j=i+1, ch="";
      while(j<rest.length && /[0-9+\-]/.test(rest[j])){ ch+=rest[j]; j++; }
      out+="<sup>"+ch+"</sup>"; i=j-1;
    } else if(/[0-9]/.test(c)){
      let j=i, dg="";
      while(j<rest.length && /[0-9]/.test(rest[j])){ dg+=rest[j]; j++; }
      out+="<sub>"+dg+"</sub>"; i=j-1;
    } else { out+=c; }
  }
  return (coef?'<span class="coef">'+coef+'</span>':'')+out;
}
// A whole equation with +, ->, <=> separators.
function fmtEq(eq){
  return eq.split(" ").map(t=>{
    if(t==="+") return '<span class="op">+</span>';
    if(t==="->") return '<span class="arrow">→</span>';
    if(t==="<=>") return '<span class="arrow">⇌</span>';
    return fmtSpecies(t);
  }).join(" ");
}
// A species with no leading coefficient (same renderer, clearer name at call sites).
const fmtFormula = fmtSpecies;

/* ---- Composition, molar mass -------------------------------------------- */
// Parse a formula into {element: count}, honouring ( ) and [ ] groups.
// The charge (^…) is dropped — it does not affect molar mass.
function composition(formula){
  formula = formula.split('^')[0];
  let i=0;
  function readNum(){ let s=''; while(i<formula.length && /[0-9]/.test(formula[i])){ s+=formula[i]; i++; } return s?parseInt(s,10):null; }
  function parseGroup(){
    const comp={};
    const merge=(sub,mult)=>{ for(const k in sub) comp[k]=(comp[k]||0)+sub[k]*mult; };
    while(i<formula.length){
      const c=formula[i];
      if(c==='('||c==='['){ i++; const sub=parseGroup(); const m=readNum()||1; merge(sub,m); }
      else if(c===')'||c===']'){ i++; return comp; }
      else if(/[A-Z]/.test(c)){ let sym=c; i++; while(i<formula.length && /[a-z]/.test(formula[i])){ sym+=formula[i]; i++; } const n=readNum()||1; comp[sym]=(comp[sym]||0)+n; }
      else { i++; }
    }
    return comp;
  }
  return parseGroup();
}
function molarMass(sp){ const c=composition(sp); let m=0; for(const k in c){ if(!(k in AM)) return null; m+=AM[k]*c[k]; } return m; }
// Per-element contributions, used to show the molar-mass breakdown.
function massParts(sp){ const c=composition(sp); return Object.entries(c).map(([el,n])=>({el,n,a:AM[el]})); }
// Whether `sp` already parses (via composition()'s strict, case-sensitive
// reading) into a fully recognised formula. When this is true the user's own
// capitalisation is trusted as-is — it's the only signal that disambiguates
// e.g. "CO" (C + O) from "Co" (cobalt), so smart-casing must never override it.
function isRecognisedFormula(sp){ const c=composition(sp); return !!Object.keys(c).length && molarMass(sp)!=null; }

/* ---- Smart formula detection ---------------------------------------------
   Recovers a real formula from sloppy/uncased input like "h2so4" or "nacl",
   for when isRecognisedFormula() above says the as-typed text doesn't parse.
   Case is meaningless at that point, so every letter run is re-segmented
   case-insensitively against the known element symbols; digits, parentheses
   and a trailing charge are structural and stay exactly where the user put
   them. A run can segment more than one way (S+O+S vs S+Os for "sos"; C+O+Cl2
   vs Co+Cl2 for "cocl2") — each is a real, mutually exclusive reading, so all
   of them come back rather than silently picking one. */
const AM_BY_LOWER = {};
Object.keys(AM).forEach(sym => { AM_BY_LOWER[sym.toLowerCase()] = sym; });

// All ways to split a pure-letter run into known element symbols (1 or 2
// letters, matched case-insensitively). "sos" -> [["S","O","S"],["S","Os"]].
function segmentElements(run){
  const n = run.length;
  const memo = new Array(n + 1);
  function go(pos){
    if (pos === n) return [[]];
    if (memo[pos]) return memo[pos];
    const out = [];
    for (let len = 1; len <= 2 && pos + len <= n; len++){
      const sym = AM_BY_LOWER[run.slice(pos, pos + len).toLowerCase()];
      if (!sym) continue;
      for (const rest of go(pos + len)) out.push([sym, ...rest]);
    }
    memo[pos] = out;
    return out;
  }
  return go(0);
}

const MAX_FORMULA_CANDIDATES = 6;

// Every fully-cased formula string consistent with the known element symbols
// for a raw, sloppily-cased formula. [] means no reading was recognisable;
// one entry means an unambiguous fix; several means a real conflict the user
// needs to resolve (see the module doc comment above for examples).
function smartFormulaCandidates(raw){
  const chargeM = raw.match(/\^[0-9+\-]*$/);
  const charge = chargeM ? chargeM[0] : '';
  const body = charge ? raw.slice(0, raw.length - charge.length) : raw;
  let i = 0;
  function readDigits(){ let s=''; while(i<body.length && /[0-9]/.test(body[i])){ s+=body[i]; i++; } return s; }
  function cross(prev, additions, wrap){
    const out = [];
    for (const p of prev) for (const a of additions) out.push(p + wrap(a));
    return out;
  }
  function parseGroup(nested){
    let candidates = [''];
    while (i < body.length){
      const c = body[i];
      if (c === '(' || c === '['){
        const close = c === '(' ? ')' : ']';
        i++;
        const inner = parseGroup(nested + 1);
        if (inner == null) return null;
        if (i < body.length && body[i] === close) i++;
        const digits = readDigits();
        candidates = cross(candidates, inner, s => c + s + close + digits);
      } else if ((c === ')' || c === ']') && nested > 0){
        break;
      } else if (/[A-Za-z]/.test(c)){
        let j = i; while (j < body.length && /[A-Za-z]/.test(body[j])) j++;
        const run = body.slice(i, j); i = j;
        const digits = readDigits();
        const segs = segmentElements(run);
        if (!segs.length) return null;
        const runCandidates = segs.map(symList => {
          const last = symList.length - 1;
          return symList.map((sym, idx) => sym + (idx === last ? digits : '')).join('');
        });
        candidates = cross(candidates, runCandidates, s => s);
      } else if (/[0-9]/.test(c)){
        i++; // orphan digit with no preceding symbol at this level — drop it
      } else {
        candidates = candidates.map(s => s + c); i++;
      }
    }
    return candidates;
  }
  const result = parseGroup(0);
  if (!result) return [];
  return [...new Set(result.map(s => s + charge))].slice(0, MAX_FORMULA_CANDIDATES);
}
// Strip a leading stoichiometric coefficient and any trailing charge notation
// from a species token, keeping the literal formula characters intact (so
// partial/incomplete typing can still be prefix-matched against it).
// "2MnO4^-" / "MnO4-" / "MnO4 ^-" all reduce to "MnO4"; "5C2O4^2-" / "C2O4 2-"
// both reduce to "C2O4". Returns "" if nothing formula-like is left.
function bareFormula(sp){
  let s=(sp||"").trim();
  if(!s) return "";
  const coefM=s.match(/^(\d+(?:\/\d+)?)([A-Za-z(\[].*)$/);
  if(coefM) s=coefM[2];
  s=s.replace(/\^\d*[+\-]+$/,"");     // caret form: ^-, ^2-, ^3+
  s=s.replace(/\s+\d+[+\-]+$/,"");    // spaced magnitude form: " 2-", " 3+"
  s=s.replace(/[+\-]+$/,"");          // bare trailing sign(s): "MnO4-", "OH-"
  return s.trim();
}

/* ---- Reaction parsing --------------------------------------------------- */
// Spectators excluded from limiting-reactant logic (supplied in excess).
const SPECT = new Set(['H^+','OH^-','e^-']);
/* ---- Molar gas volume (school conventions), dm^3 per mol ------------------
   RTP = room temperature and pressure, 20 °C and 1 atm → 24.0
   STP = standard temperature and pressure, 0 °C and 1 atm → 22.4
   These are the rounded data-booklet values used in SK015 / A-level, not
   values recomputed from the ideal gas equation. Note 24.0 goes with 20 °C:
   at 25 °C the molar volume is 24.5 dm³ mol⁻¹. If your syllabus defines RTP
   as 25 °C, change the value here and the footer note in index.html together. */
const MOLAR_VOL = { RTP:24.0, STP:22.4 };
// Split a token into {coef, sp}, e.g. "2HCl" -> {coef:2, sp:"HCl"}.
function splitToken(tok){
  const m = tok.match(/^(\d+)(.+)$/);
  if(m && /^[A-Za-z(\[]/.test(m[2])) return {coef:parseInt(m[1],10), sp:m[2]};
  return {coef:1, sp:tok};
}
function parseSide(side){ return side.trim().split(' + ').map(t=>t.trim()).filter(Boolean).map(splitToken); }
function parseReaction(eq){
  const isEq = eq.includes('<=>');
  const [lhs,rhs] = eq.split(isEq?'<=>':'->');
  return { reactants:parseSide(lhs), products:parseSide(rhs), equil:isEq };
}

/* ---- The reaction database ---------------------------------------------- */
const R = [
  // Neutralisation
  {eq:"HCl + NaOH -> NaCl + H2O", cat:"neut", el:["H","Cl","Na","O"]},
  {eq:"2HCl + Ca(OH)2 -> CaCl2 + 2H2O", cat:"neut", el:["H","Cl","Ca","O"]},
  {eq:"H2SO4 + 2NaOH -> Na2SO4 + 2H2O", cat:"neut", el:["H","S","O","Na"]},
  {eq:"H2SO4 + 2KOH -> K2SO4 + 2H2O", cat:"neut", el:["H","S","O","K"]},
  {eq:"HNO3 + NaOH -> NaNO3 + H2O", cat:"neut", el:["H","N","O","Na"]},
  {eq:"HNO3 + KOH -> KNO3 + H2O", cat:"neut", el:["H","N","O","K"]},
  {eq:"2HNO3 + Ca(OH)2 -> Ca(NO3)2 + 2H2O", cat:"neut", el:["H","N","O","Ca"]},
  {eq:"H3PO4 + 3NaOH -> Na3PO4 + 3H2O", cat:"neut", el:["H","P","O","Na"]},
  {eq:"3HCl + Al(OH)3 -> AlCl3 + 3H2O", cat:"neut", el:["H","Cl","Al","O"]},
  {eq:"CH3COOH + NaOH -> CH3COONa + H2O", cat:"neut", el:["C","H","O","Na"]},
  {eq:"H2SO4 + 2NH3 -> (NH4)2SO4", cat:"neut", el:["H","S","O","N"]},
  {eq:"NH3 + HCl -> NH4Cl", cat:"neut", el:["N","H","Cl"]},
  {eq:"H^+ + OH^- -> H2O", cat:"neut", el:["H","O"], cond:"net ionic"},

  // Acid + metal
  {eq:"Zn + 2HCl -> ZnCl2 + H2", cat:"ametal", el:["Zn","H","Cl"]},
  {eq:"Mg + 2HCl -> MgCl2 + H2", cat:"ametal", el:["Mg","H","Cl"]},
  {eq:"Fe + 2HCl -> FeCl2 + H2", cat:"ametal", el:["Fe","H","Cl"]},
  {eq:"Ca + 2HCl -> CaCl2 + H2", cat:"ametal", el:["Ca","H","Cl"]},
  {eq:"2Al + 6HCl -> 2AlCl3 + 3H2", cat:"ametal", el:["Al","H","Cl"]},
  {eq:"Mg + H2SO4 -> MgSO4 + H2", cat:"ametal", el:["Mg","H","S","O"]},
  {eq:"Zn + H2SO4 -> ZnSO4 + H2", cat:"ametal", el:["Zn","H","S","O"]},
  {eq:"Fe + H2SO4 -> FeSO4 + H2", cat:"ametal", el:["Fe","H","S","O"]},
  {eq:"2Al + 3H2SO4 -> Al2(SO4)3 + 3H2", cat:"ametal", el:["Al","H","S","O"]},

  // Acid + carbonate / hydrogencarbonate
  {eq:"CaCO3 + 2HCl -> CaCl2 + H2O + CO2", cat:"carb", el:["Ca","C","O","H","Cl"]},
  {eq:"Na2CO3 + 2HCl -> 2NaCl + H2O + CO2", cat:"carb", el:["Na","C","O","H","Cl"]},
  {eq:"NaHCO3 + HCl -> NaCl + H2O + CO2", cat:"carb", el:["Na","H","C","O","Cl"]},
  {eq:"MgCO3 + 2HCl -> MgCl2 + H2O + CO2", cat:"carb", el:["Mg","C","O","H","Cl"]},
  {eq:"CaCO3 + H2SO4 -> CaSO4 + H2O + CO2", cat:"carb", el:["Ca","C","O","H","S"]},
  {eq:"2NaHCO3 + H2SO4 -> Na2SO4 + 2H2O + 2CO2", cat:"carb", el:["Na","H","C","O","S"]},
  {eq:"K2CO3 + 2HNO3 -> 2KNO3 + H2O + CO2", cat:"carb", el:["K","C","O","H","N"]},

  // Acid + oxide / base (oxides)
  {eq:"CuO + H2SO4 -> CuSO4 + H2O", cat:"oxide", el:["Cu","O","H","S"]},
  {eq:"CuO + 2HCl -> CuCl2 + H2O", cat:"oxide", el:["Cu","O","H","Cl"]},
  {eq:"MgO + 2HCl -> MgCl2 + H2O", cat:"oxide", el:["Mg","O","H","Cl"]},
  {eq:"ZnO + 2HCl -> ZnCl2 + H2O", cat:"oxide", el:["Zn","O","H","Cl"]},
  {eq:"CaO + 2HCl -> CaCl2 + H2O", cat:"oxide", el:["Ca","O","H","Cl"]},
  {eq:"Fe2O3 + 6HCl -> 2FeCl3 + 3H2O", cat:"oxide", el:["Fe","O","H","Cl"]},
  {eq:"Al2O3 + 6HCl -> 2AlCl3 + 3H2O", cat:"oxide", el:["Al","O","H","Cl"]},
  {eq:"CuO + H2SO4 -> CuSO4 + H2O", cat:"oxide", el:["Cu","O","H","S"], skip:true},

  // Combustion
  {eq:"C + O2 -> CO2", cat:"comb", el:["C","O"]},
  {eq:"2C + O2 -> 2CO", cat:"comb", el:["C","O"], cond:"incomplete"},
  {eq:"2H2 + O2 -> 2H2O", cat:"comb", el:["H","O"]},
  {eq:"S + O2 -> SO2", cat:"comb", el:["S","O"]},
  {eq:"2Mg + O2 -> 2MgO", cat:"comb", el:["Mg","O"]},
  {eq:"4Al + 3O2 -> 2Al2O3", cat:"comb", el:["Al","O"]},
  {eq:"CH4 + 2O2 -> CO2 + 2H2O", cat:"comb", el:["C","H","O"]},
  {eq:"2C2H6 + 7O2 -> 4CO2 + 6H2O", cat:"comb", el:["C","H","O"]},
  {eq:"C3H8 + 5O2 -> 3CO2 + 4H2O", cat:"comb", el:["C","H","O"]},
  {eq:"2C4H10 + 13O2 -> 8CO2 + 10H2O", cat:"comb", el:["C","H","O"]},
  {eq:"2C8H18 + 25O2 -> 16CO2 + 18H2O", cat:"comb", el:["C","H","O"], cond:"octane"},
  {eq:"C2H5OH + 3O2 -> 2CO2 + 3H2O", cat:"comb", el:["C","H","O"], cond:"ethanol"},
  {eq:"2CH3OH + 3O2 -> 2CO2 + 4H2O", cat:"comb", el:["C","H","O"], cond:"methanol"},
  {eq:"C6H12O6 + 6O2 -> 6CO2 + 6H2O", cat:"comb", el:["C","H","O"], cond:"glucose / respiration"},

  // Precipitation
  {eq:"AgNO3 + NaCl -> AgCl + NaNO3", cat:"precip", el:["Ag","N","O","Na","Cl"]},
  {eq:"AgNO3 + KBr -> AgBr + KNO3", cat:"precip", el:["Ag","N","O","K","Br"]},
  {eq:"AgNO3 + KI -> AgI + KNO3", cat:"precip", el:["Ag","N","O","K","I"]},
  {eq:"BaCl2 + Na2SO4 -> BaSO4 + 2NaCl", cat:"precip", el:["Ba","Cl","Na","S","O"]},
  {eq:"BaCl2 + H2SO4 -> BaSO4 + 2HCl", cat:"precip", el:["Ba","Cl","H","S","O"]},
  {eq:"Pb(NO3)2 + 2KI -> PbI2 + 2KNO3", cat:"precip", el:["Pb","N","O","K","I"]},
  {eq:"Pb(NO3)2 + 2NaCl -> PbCl2 + 2NaNO3", cat:"precip", el:["Pb","N","O","Na","Cl"]},
  {eq:"Pb(NO3)2 + Na2SO4 -> PbSO4 + 2NaNO3", cat:"precip", el:["Pb","N","O","Na","S"]},
  {eq:"CuSO4 + 2NaOH -> Cu(OH)2 + Na2SO4", cat:"precip", el:["Cu","S","O","Na","H"]},
  {eq:"FeCl3 + 3NaOH -> Fe(OH)3 + 3NaCl", cat:"precip", el:["Fe","Cl","Na","O","H"]},
  {eq:"FeSO4 + 2NaOH -> Fe(OH)2 + Na2SO4", cat:"precip", el:["Fe","S","O","Na","H"]},
  {eq:"MgCl2 + 2NaOH -> Mg(OH)2 + 2NaCl", cat:"precip", el:["Mg","Cl","Na","O","H"]},
  {eq:"CaCl2 + Na2CO3 -> CaCO3 + 2NaCl", cat:"precip", el:["Ca","Cl","Na","C","O"]},
  {eq:"BaCl2 + Na2CO3 -> BaCO3 + 2NaCl", cat:"precip", el:["Ba","Cl","Na","C","O"]},
  {eq:"2AgNO3 + Na2CO3 -> Ag2CO3 + 2NaNO3", cat:"precip", el:["Ag","N","O","Na","C"]},
  {eq:"Ag^+ + Cl^- -> AgCl", cat:"precip", el:["Ag","Cl"], cond:"net ionic"},

  // Thermal decomposition
  {eq:"CaCO3 -> CaO + CO2", cat:"decomp", el:["Ca","C","O"], cond:"Δ"},
  {eq:"2NaHCO3 -> Na2CO3 + H2O + CO2", cat:"decomp", el:["Na","H","C","O"], cond:"Δ"},
  {eq:"CuCO3 -> CuO + CO2", cat:"decomp", el:["Cu","C","O"], cond:"Δ"},
  {eq:"MgCO3 -> MgO + CO2", cat:"decomp", el:["Mg","C","O"], cond:"Δ"},
  {eq:"Cu(OH)2 -> CuO + H2O", cat:"decomp", el:["Cu","O","H"], cond:"Δ"},
  {eq:"2KClO3 -> 2KCl + 3O2", cat:"decomp", el:["K","Cl","O"], cond:"Δ, MnO₂ cat."},
  {eq:"2H2O2 -> 2H2O + O2", cat:"decomp", el:["H","O"], cond:"MnO₂ cat."},
  {eq:"2KMnO4 -> K2MnO4 + MnO2 + O2", cat:"decomp", el:["K","Mn","O"], cond:"Δ"},
  {eq:"2KNO3 -> 2KNO2 + O2", cat:"decomp", el:["K","N","O"], cond:"Δ"},
  {eq:"2Pb(NO3)2 -> 2PbO + 4NO2 + O2", cat:"decomp", el:["Pb","N","O"], cond:"Δ"},
  {eq:"2Cu(NO3)2 -> 2CuO + 4NO2 + O2", cat:"decomp", el:["Cu","N","O"], cond:"Δ"},
  {eq:"2AgNO3 -> 2Ag + 2NO2 + O2", cat:"decomp", el:["Ag","N","O"], cond:"Δ"},
  {eq:"NH4Cl -> NH3 + HCl", cat:"decomp", el:["N","H","Cl"], cond:"Δ (then recombines)"},
  {eq:"(NH4)2Cr2O7 -> Cr2O3 + N2 + 4H2O", cat:"decomp", el:["N","H","Cr","O"], cond:"Δ"},

  // Redox / displacement
  {eq:"Zn + CuSO4 -> ZnSO4 + Cu", cat:"disp", el:["Zn","Cu","S","O"]},
  {eq:"Fe + CuSO4 -> FeSO4 + Cu", cat:"disp", el:["Fe","Cu","S","O"]},
  {eq:"Mg + CuSO4 -> MgSO4 + Cu", cat:"disp", el:["Mg","Cu","S","O"]},
  {eq:"Cu + 2AgNO3 -> Cu(NO3)2 + 2Ag", cat:"disp", el:["Cu","Ag","N","O"]},
  {eq:"Zn + Pb(NO3)2 -> Zn(NO3)2 + Pb", cat:"disp", el:["Zn","Pb","N","O"]},
  {eq:"Cl2 + 2KBr -> 2KCl + Br2", cat:"disp", el:["Cl","K","Br"]},
  {eq:"Cl2 + 2KI -> 2KCl + I2", cat:"disp", el:["Cl","K","I"]},
  {eq:"Br2 + 2KI -> 2KBr + I2", cat:"disp", el:["Br","K","I"]},
  {eq:"2Na + 2H2O -> 2NaOH + H2", cat:"disp", el:["Na","H","O"]},
  {eq:"2K + 2H2O -> 2KOH + H2", cat:"disp", el:["K","H","O"]},
  {eq:"Ca + 2H2O -> Ca(OH)2 + H2", cat:"disp", el:["Ca","H","O"]},
  {eq:"2Al + Fe2O3 -> Al2O3 + 2Fe", cat:"disp", el:["Al","Fe","O"], cond:"thermite, Δ"},
  {eq:"Fe2O3 + 3CO -> 2Fe + 3CO2", cat:"disp", el:["Fe","O","C"], cond:"blast furnace"},
  {eq:"ZnO + C -> Zn + CO", cat:"disp", el:["Zn","O","C"], cond:"Δ"},
  {eq:"CuO + H2 -> Cu + H2O", cat:"disp", el:["Cu","O","H"], cond:"reduction"},
  {eq:"3Mg + N2 -> Mg3N2", cat:"disp", el:["Mg","N"]},

  // Synthesis / industrial
  {eq:"N2 + 3H2 <=> 2NH3", cat:"synth", el:["N","H"], cond:"Haber; Fe cat., 450 °C, 200 atm"},
  {eq:"2SO2 + O2 <=> 2SO3", cat:"synth", el:["S","O"], cond:"Contact; V₂O₅, 450 °C"},
  {eq:"SO3 + H2O -> H2SO4", cat:"synth", el:["S","O","H"]},
  {eq:"4NH3 + 5O2 -> 4NO + 6H2O", cat:"synth", el:["N","H","O"], cond:"Ostwald; Pt/Rh cat."},
  {eq:"2NO + O2 -> 2NO2", cat:"synth", el:["N","O"]},
  {eq:"3NO2 + H2O -> 2HNO3 + NO", cat:"synth", el:["N","O","H"]},
  {eq:"N2 + O2 -> 2NO", cat:"synth", el:["N","O"], cond:"high T"},
  {eq:"H2 + Cl2 -> 2HCl", cat:"synth", el:["H","Cl"]},
  {eq:"2Fe + 3Cl2 -> 2FeCl3", cat:"synth", el:["Fe","Cl"]},
  {eq:"CaO + H2O -> Ca(OH)2", cat:"synth", el:["Ca","O","H"]},
  {eq:"Na2O + H2O -> 2NaOH", cat:"synth", el:["Na","O","H"]},
  {eq:"CO2 + H2O -> H2CO3", cat:"synth", el:["C","O","H"]},
  {eq:"CaO + CO2 -> CaCO3", cat:"synth", el:["Ca","O","C"]},
  {eq:"Ca(OH)2 + CO2 -> CaCO3 + H2O", cat:"synth", el:["Ca","O","H","C"], cond:"limewater test"},
  {eq:"C + H2O -> CO + H2", cat:"synth", el:["C","H","O"], cond:"water gas, Δ"},
  {eq:"CO + 2H2 -> CH3OH", cat:"synth", el:["C","O","H"], cond:"catalyst"},
  {eq:"2C + SiO2 -> Si + 2CO", cat:"synth", el:["C","Si","O"], cond:"Δ"},
  {eq:"CaC2 + 2H2O -> Ca(OH)2 + C2H2", cat:"synth", el:["Ca","C","H","O"]},

  // Redox titration (ionic + half equations)
  {eq:"2MnO4^- + 5C2O4^2- + 16H^+ -> 2Mn^2+ + 10CO2 + 8H2O", cat:"titr", el:["Mn","O","C","H"], cond:"permanganate–oxalate"},
  {eq:"MnO4^- + 5Fe^2+ + 8H^+ -> Mn^2+ + 5Fe^3+ + 4H2O", cat:"titr", el:["Mn","O","Fe","H"], cond:"permanganate–iron(II)"},
  {eq:"2MnO4^- + 5H2O2 + 6H^+ -> 2Mn^2+ + 5O2 + 8H2O", cat:"titr", el:["Mn","O","H"], cond:"permanganate–peroxide"},
  {eq:"Cr2O7^2- + 6Fe^2+ + 14H^+ -> 2Cr^3+ + 6Fe^3+ + 7H2O", cat:"titr", el:["Cr","O","Fe","H"], cond:"dichromate–iron(II)"},
  {eq:"I2 + 2S2O3^2- -> 2I^- + S4O6^2-", cat:"titr", el:["I","S","O"], cond:"iodine–thiosulfate"},
  {eq:"2Cu^2+ + 4I^- -> 2CuI + I2", cat:"titr", el:["Cu","I"], cond:"iodometry of Cu(II)"},
  {eq:"MnO4^- + 8H^+ + 5e^- -> Mn^2+ + 4H2O", cat:"titr", el:["Mn","O","H"], cond:"half-equation"},
  {eq:"Cr2O7^2- + 14H^+ + 6e^- -> 2Cr^3+ + 7H2O", cat:"titr", el:["Cr","O","H"], cond:"half-equation"},

  // Electrolysis
  {eq:"2H2O -> 2H2 + O2", cat:"elec", el:["H","O"], cond:"electrolysis of water"},
  {eq:"2NaCl -> 2Na + Cl2", cat:"elec", el:["Na","Cl"], cond:"molten"},
  {eq:"2KBr -> 2K + Br2", cat:"elec", el:["K","Br"], cond:"molten"},
  {eq:"2Al2O3 -> 4Al + 3O2", cat:"elec", el:["Al","O"], cond:"molten, cryolite"},
  {eq:"2NaCl + 2H2O -> 2NaOH + H2 + Cl2", cat:"elec", el:["Na","Cl","H","O"], cond:"chlor-alkali (aq)"},

  // --- Transition metals: precipitates, complexes, colour tests (d-block) ---
  {eq:"Cu^2+ + 2OH^- -> Cu(OH)2", cat:"complex", el:["Cu","O","H"], cond:"blue ppt"},
  {eq:"Fe^2+ + 2OH^- -> Fe(OH)2", cat:"complex", el:["Fe","O","H"], cond:"green ppt"},
  {eq:"Fe^3+ + 3OH^- -> Fe(OH)3", cat:"complex", el:["Fe","O","H"], cond:"red-brown ppt"},
  {eq:"4Fe(OH)2 + O2 + 2H2O -> 4Fe(OH)3", cat:"complex", el:["Fe","O","H"], cond:"aerial oxidation"},
  {eq:"Cr^3+ + 3OH^- -> Cr(OH)3", cat:"complex", el:["Cr","O","H"], cond:"grey-green ppt"},
  {eq:"Cr(OH)3 + 3OH^- -> [Cr(OH)6]^3-", cat:"complex", el:["Cr","O","H"], cond:"amphoteric, dissolves"},
  {eq:"Zn^2+ + 2OH^- -> Zn(OH)2", cat:"complex", el:["Zn","O","H"], cond:"white ppt"},
  {eq:"Zn(OH)2 + 2OH^- -> [Zn(OH)4]^2-", cat:"complex", el:["Zn","O","H"], cond:"amphoteric, dissolves"},
  {eq:"Cu^2+ + 4NH3 -> [Cu(NH3)4]^2+", cat:"complex", el:["Cu","N","H"], cond:"deep blue"},
  {eq:"Ag^+ + 2NH3 -> [Ag(NH3)2]^+", cat:"complex", el:["Ag","N","H"], cond:"Tollens' reagent"},
  {eq:"Ni^2+ + 6NH3 -> [Ni(NH3)6]^2+", cat:"complex", el:["Ni","N","H"], cond:"ligand exchange"},
  {eq:"[Co(H2O)6]^2+ + 4Cl^- <=> [CoCl4]^2- + 6H2O", cat:"complex", el:["Co","H","O","Cl"], cond:"pink ⇌ blue"},
  {eq:"Fe^3+ + SCN^- -> [Fe(SCN)]^2+", cat:"complex", el:["Fe","S","C","N"], cond:"blood-red test"},
  {eq:"Cr2O7^2- + H2O <=> 2CrO4^2- + 2H^+", cat:"complex", el:["Cr","O","H"], cond:"orange ⇌ yellow"},
  {eq:"2Cu^+ -> Cu + Cu^2+", cat:"complex", el:["Cu"], cond:"disproportionation"},

  // --- Transition-metal redox & extraction (d-block) ---
  {eq:"2Fe^3+ + Cu -> 2Fe^2+ + Cu^2+", cat:"disp", el:["Fe","Cu"], cond:"PCB etching"},
  {eq:"2Fe^3+ + 2I^- -> 2Fe^2+ + I2", cat:"disp", el:["Fe","I"]},
  {eq:"2Fe^2+ + Cl2 -> 2Fe^3+ + 2Cl^-", cat:"disp", el:["Fe","Cl"]},
  {eq:"TiCl4 + 2Mg -> Ti + 2MgCl2", cat:"disp", el:["Ti","Cl","Mg"], cond:"Kroll process"},
  {eq:"Cr2O3 + 2Al -> Al2O3 + 2Cr", cat:"disp", el:["Cr","O","Al"], cond:"thermite, Δ"},
  {eq:"2VO2^+ + Zn + 4H^+ -> 2VO^2+ + Zn^2+ + 2H2O", cat:"disp", el:["V","O","Zn","H"], cond:"vanadium +5 → +4"},

  // --- Heavier p-block (groups 13–17) ---
  {eq:"2Al + 2NaOH + 6H2O -> 2NaAl(OH)4 + 3H2", cat:"pblock", el:["Al","Na","O","H"], cond:"amphoteric"},
  {eq:"Al2O3 + 2NaOH + 3H2O -> 2NaAl(OH)4", cat:"pblock", el:["Al","Na","O","H"], cond:"amphoteric oxide"},
  {eq:"2Al + 3Cl2 -> 2AlCl3", cat:"pblock", el:["Al","Cl"]},
  {eq:"SiO2 + 2NaOH -> Na2SiO3 + H2O", cat:"pblock", el:["Si","O","Na","H"], cond:"acidic oxide"},
  {eq:"SiCl4 + 2H2O -> SiO2 + 4HCl", cat:"pblock", el:["Si","Cl","H","O"], cond:"hydrolysis"},
  {eq:"PbO2 + 4HCl -> PbCl2 + Cl2 + 2H2O", cat:"pblock", el:["Pb","O","H","Cl"], cond:"PbO₂ as oxidant"},
  {eq:"SnO2 + 2C -> Sn + 2CO", cat:"pblock", el:["Sn","O","C"], cond:"tin extraction"},
  {eq:"Sn^2+ + 2Fe^3+ -> Sn^4+ + 2Fe^2+", cat:"pblock", el:["Sn","Fe"], cond:"Sn(II) reductant"},
  {eq:"P4 + 5O2 -> P4O10", cat:"pblock", el:["P","O"]},
  {eq:"P4O10 + 6H2O -> 4H3PO4", cat:"pblock", el:["P","O","H"]},
  {eq:"2P + 3Cl2 -> 2PCl3", cat:"pblock", el:["P","Cl"]},
  {eq:"PCl3 + Cl2 -> PCl5", cat:"pblock", el:["P","Cl"]},
  {eq:"PCl5 + 4H2O -> H3PO4 + 5HCl", cat:"pblock", el:["P","Cl","H","O"], cond:"full hydrolysis"},
  {eq:"PCl5 + H2O -> POCl3 + 2HCl", cat:"pblock", el:["P","Cl","O","H"], cond:"partial hydrolysis"},
  {eq:"SO2 + H2O -> H2SO3", cat:"pblock", el:["S","O","H"]},
  {eq:"SO2 + 2H2S -> 3S + 2H2O", cat:"pblock", el:["S","H","O"], cond:"Claus reaction"},
  {eq:"2H2S + 3O2 -> 2SO2 + 2H2O", cat:"pblock", el:["H","S","O"]},
  {eq:"Na2S2O3 + 2HCl -> 2NaCl + S + SO2 + H2O", cat:"pblock", el:["Na","S","O","Cl","H"], cond:"rate-of-reaction expt"},
  {eq:"Cl2 + H2O <=> HCl + HOCl", cat:"pblock", el:["Cl","H","O"], cond:"chlorine water, disprop."},
  {eq:"Cl2 + 2NaOH -> NaCl + NaClO + H2O", cat:"pblock", el:["Cl","Na","O","H"], cond:"cold dilute, disprop."},
  {eq:"3Cl2 + 6NaOH -> 5NaCl + NaClO3 + 3H2O", cat:"pblock", el:["Cl","Na","O","H"], cond:"hot conc., disprop."},
  {eq:"NaCl + H2SO4 -> NaHSO4 + HCl", cat:"pblock", el:["Na","Cl","H","S","O"], cond:"halide test"},
  {eq:"2NaBr + 2H2SO4 -> Na2SO4 + Br2 + SO2 + 2H2O", cat:"pblock", el:["Na","Br","H","S","O"], cond:"halide test"},
  {eq:"8NaI + 5H2SO4 -> 4Na2SO4 + 4I2 + H2S + 4H2O", cat:"pblock", el:["Na","I","H","S","O"], cond:"halide test"},

  /* ===== added reactions (round 2 — element list auto-derived) ===== */
  {eq:"2HCl + Mg(OH)2 -> MgCl2 + 2H2O", cat:"neut"},
  {eq:"H2SO4 + Mg(OH)2 -> MgSO4 + 2H2O", cat:"neut"},
  {eq:"2HNO3 + Mg(OH)2 -> Mg(NO3)2 + 2H2O", cat:"neut"},
  {eq:"H2SO4 + Ca(OH)2 -> CaSO4 + 2H2O", cat:"neut"},
  {eq:"3H2SO4 + 2Al(OH)3 -> Al2(SO4)3 + 6H2O", cat:"neut"},
  {eq:"H3PO4 + 3KOH -> K3PO4 + 3H2O", cat:"neut"},
  {eq:"2H3PO4 + 3Ca(OH)2 -> Ca3(PO4)2 + 6H2O", cat:"neut"},
  {eq:"2HCl + Ba(OH)2 -> BaCl2 + 2H2O", cat:"neut"},
  {eq:"2HNO3 + Ba(OH)2 -> Ba(NO3)2 + 2H2O", cat:"neut"},
  {eq:"H2SO4 + Ba(OH)2 -> BaSO4 + 2H2O", cat:"neut"},
  {eq:"HCl + KOH -> KCl + H2O", cat:"neut"},
  {eq:"HCl + LiOH -> LiCl + H2O", cat:"neut"},
  {eq:"HBr + NaOH -> NaBr + H2O", cat:"neut"},
  {eq:"HBr + KOH -> KBr + H2O", cat:"neut"},
  {eq:"HI + NaOH -> NaI + H2O", cat:"neut"},
  {eq:"HNO3 + NH3 -> NH4NO3", cat:"neut"},
  {eq:"2CH3COOH + Ca(OH)2 -> (CH3COO)2Ca + 2H2O", cat:"neut"},
  {eq:"2Na + 2HCl -> 2NaCl + H2", cat:"ametal"},
  {eq:"2K + 2HCl -> 2KCl + H2", cat:"ametal"},
  {eq:"Ca + H2SO4 -> CaSO4 + H2", cat:"ametal"},
  {eq:"Zn + 2HBr -> ZnBr2 + H2", cat:"ametal"},
  {eq:"Mg + 2HBr -> MgBr2 + H2", cat:"ametal"},
  {eq:"2Al + 6HBr -> 2AlBr3 + 3H2", cat:"ametal"},
  {eq:"Sn + 2HCl -> SnCl2 + H2", cat:"ametal"},
  {eq:"Ni + 2HCl -> NiCl2 + H2", cat:"ametal"},
  {eq:"Co + 2HCl -> CoCl2 + H2", cat:"ametal"},
  {eq:"Mn + 2HCl -> MnCl2 + H2", cat:"ametal"},
  {eq:"Ni + H2SO4 -> NiSO4 + H2", cat:"ametal"},
  {eq:"Mg + 2CH3COOH -> (CH3COO)2Mg + H2", cat:"ametal"},
  {eq:"CaCO3 + 2HNO3 -> Ca(NO3)2 + H2O + CO2", cat:"carb"},
  {eq:"MgCO3 + H2SO4 -> MgSO4 + H2O + CO2", cat:"carb"},
  {eq:"MgCO3 + 2HNO3 -> Mg(NO3)2 + H2O + CO2", cat:"carb"},
  {eq:"Na2CO3 + H2SO4 -> Na2SO4 + H2O + CO2", cat:"carb"},
  {eq:"Na2CO3 + 2HNO3 -> 2NaNO3 + H2O + CO2", cat:"carb"},
  {eq:"K2CO3 + 2HCl -> 2KCl + H2O + CO2", cat:"carb"},
  {eq:"K2CO3 + H2SO4 -> K2SO4 + H2O + CO2", cat:"carb"},
  {eq:"ZnCO3 + 2HCl -> ZnCl2 + H2O + CO2", cat:"carb"},
  {eq:"FeCO3 + 2HCl -> FeCl2 + H2O + CO2", cat:"carb"},
  {eq:"CuCO3 + 2HCl -> CuCl2 + H2O + CO2", cat:"carb"},
  {eq:"CuCO3 + H2SO4 -> CuSO4 + H2O + CO2", cat:"carb"},
  {eq:"BaCO3 + 2HCl -> BaCl2 + H2O + CO2", cat:"carb"},
  {eq:"KHCO3 + HCl -> KCl + H2O + CO2", cat:"carb"},
  {eq:"Na2O + 2HCl -> 2NaCl + H2O", cat:"oxide"},
  {eq:"K2O + 2HCl -> 2KCl + H2O", cat:"oxide"},
  {eq:"CaO + H2SO4 -> CaSO4 + H2O", cat:"oxide"},
  {eq:"MgO + H2SO4 -> MgSO4 + H2O", cat:"oxide"},
  {eq:"ZnO + H2SO4 -> ZnSO4 + H2O", cat:"oxide"},
  {eq:"FeO + 2HCl -> FeCl2 + H2O", cat:"oxide"},
  {eq:"FeO + H2SO4 -> FeSO4 + H2O", cat:"oxide"},
  {eq:"Fe2O3 + 3H2SO4 -> Fe2(SO4)3 + 3H2O", cat:"oxide"},
  {eq:"Al2O3 + 3H2SO4 -> Al2(SO4)3 + 3H2O", cat:"oxide"},
  {eq:"PbO + 2HCl -> PbCl2 + H2O", cat:"oxide"},
  {eq:"PbO + 2HNO3 -> Pb(NO3)2 + H2O", cat:"oxide"},
  {eq:"CuO + 2HNO3 -> Cu(NO3)2 + H2O", cat:"oxide"},
  {eq:"ZnO + 2HNO3 -> Zn(NO3)2 + H2O", cat:"oxide"},
  {eq:"MgO + 2HNO3 -> Mg(NO3)2 + H2O", cat:"oxide"},
  {eq:"BaO + 2HCl -> BaCl2 + H2O", cat:"oxide"},
  {eq:"CaO + 2HNO3 -> Ca(NO3)2 + H2O", cat:"oxide"},
  {eq:"2CO + O2 -> 2CO2", cat:"comb"},
  {eq:"C2H4 + 3O2 -> 2CO2 + 2H2O", cat:"comb", cond:"ethene"},
  {eq:"2C2H2 + 5O2 -> 4CO2 + 2H2O", cat:"comb", cond:"ethyne"},
  {eq:"2C3H6 + 9O2 -> 6CO2 + 6H2O", cat:"comb", cond:"propene"},
  {eq:"C5H12 + 8O2 -> 5CO2 + 6H2O", cat:"comb", cond:"pentane"},
  {eq:"2C6H14 + 19O2 -> 12CO2 + 14H2O", cat:"comb", cond:"hexane"},
  {eq:"C7H16 + 11O2 -> 7CO2 + 8H2O", cat:"comb", cond:"heptane"},
  {eq:"2C3H7OH + 9O2 -> 6CO2 + 8H2O", cat:"comb", cond:"propan-1-ol"},
  {eq:"C4H9OH + 6O2 -> 4CO2 + 5H2O", cat:"comb", cond:"butan-1-ol"},
  {eq:"4NH3 + 3O2 -> 2N2 + 6H2O", cat:"comb", cond:"ammonia burning"},
  {eq:"CS2 + 3O2 -> CO2 + 2SO2", cat:"comb"},
  {eq:"4Na + O2 -> 2Na2O", cat:"comb"},
  {eq:"2Ca + O2 -> 2CaO", cat:"comb"},
  {eq:"4K + O2 -> 2K2O", cat:"comb"},
  {eq:"2Zn + O2 -> 2ZnO", cat:"comb"},
  {eq:"2Cu + O2 -> 2CuO", cat:"comb"},
  {eq:"4Fe + 3O2 -> 2Fe2O3", cat:"comb"},
  {eq:"3Fe + 2O2 -> Fe3O4", cat:"comb"},
  {eq:"Si + O2 -> SiO2", cat:"comb"},
  {eq:"MgSO4 + 2NaOH -> Mg(OH)2 + Na2SO4", cat:"precip"},
  {eq:"ZnSO4 + 2NaOH -> Zn(OH)2 + Na2SO4", cat:"precip"},
  {eq:"FeCl2 + 2NaOH -> Fe(OH)2 + 2NaCl", cat:"precip"},
  {eq:"CuCl2 + 2NaOH -> Cu(OH)2 + 2NaCl", cat:"precip"},
  {eq:"Cu(NO3)2 + 2NaOH -> Cu(OH)2 + 2NaNO3", cat:"precip"},
  {eq:"AlCl3 + 3NaOH -> Al(OH)3 + 3NaCl", cat:"precip"},
  {eq:"NiCl2 + 2NaOH -> Ni(OH)2 + 2NaCl", cat:"precip"},
  {eq:"CoCl2 + 2NaOH -> Co(OH)2 + 2NaCl", cat:"precip"},
  {eq:"CrCl3 + 3NaOH -> Cr(OH)3 + 3NaCl", cat:"precip"},
  {eq:"Pb(NO3)2 + 2KBr -> PbBr2 + 2KNO3", cat:"precip"},
  {eq:"AgNO3 + NaBr -> AgBr + NaNO3", cat:"precip"},
  {eq:"AgNO3 + NaI -> AgI + NaNO3", cat:"precip"},
  {eq:"2AgNO3 + Na2SO4 -> Ag2SO4 + 2NaNO3", cat:"precip"},
  {eq:"BaCl2 + K2SO4 -> BaSO4 + 2KCl", cat:"precip"},
  {eq:"Ba(NO3)2 + Na2SO4 -> BaSO4 + 2NaNO3", cat:"precip"},
  {eq:"Ba(NO3)2 + H2SO4 -> BaSO4 + 2HNO3", cat:"precip"},
  {eq:"CaCl2 + 2AgNO3 -> 2AgCl + Ca(NO3)2", cat:"precip"},
  {eq:"MgCl2 + 2AgNO3 -> 2AgCl + Mg(NO3)2", cat:"precip"},
  {eq:"Pb(NO3)2 + K2SO4 -> PbSO4 + 2KNO3", cat:"precip"},
  {eq:"Pb(NO3)2 + H2SO4 -> PbSO4 + 2HNO3", cat:"precip"},
  {eq:"Fe + Cu(NO3)2 -> Fe(NO3)2 + Cu", cat:"disp"},
  {eq:"Zn + FeSO4 -> ZnSO4 + Fe", cat:"disp"},
  {eq:"Mg + FeSO4 -> MgSO4 + Fe", cat:"disp"},
  {eq:"Mg + 2AgNO3 -> Mg(NO3)2 + 2Ag", cat:"disp"},
  {eq:"Zn + 2AgNO3 -> Zn(NO3)2 + 2Ag", cat:"disp"},
  {eq:"Fe + 2AgNO3 -> Fe(NO3)2 + 2Ag", cat:"disp"},
  {eq:"Mg + ZnSO4 -> MgSO4 + Zn", cat:"disp"},
  {eq:"2Al + 3CuSO4 -> Al2(SO4)3 + 3Cu", cat:"disp"},
  {eq:"2Al + 3CuO -> Al2O3 + 3Cu", cat:"disp", cond:"thermite-type"},
  {eq:"Fe2O3 + 3H2 -> 2Fe + 3H2O", cat:"disp"},
  {eq:"WO3 + 3H2 -> W + 3H2O", cat:"disp"},
  {eq:"Cl2 + 2NaBr -> 2NaCl + Br2", cat:"disp"},
  {eq:"Cl2 + 2NaI -> 2NaCl + I2", cat:"disp"},
  {eq:"Br2 + 2NaI -> 2NaBr + I2", cat:"disp"},
  {eq:"2Mg + CO2 -> 2MgO + C", cat:"disp", cond:"Mg burns in CO2"},
  {eq:"2Fe^2+ + Br2 -> 2Fe^3+ + 2Br^-", cat:"disp"},
  {eq:"H2 + Br2 -> 2HBr", cat:"synth"},
  {eq:"H2 + I2 <=> 2HI", cat:"synth"},
  {eq:"H2 + S -> H2S", cat:"synth"},
  {eq:"K2O + H2O -> 2KOH", cat:"synth"},
  {eq:"BaO + H2O -> Ba(OH)2", cat:"synth"},
  {eq:"CO2 + 2NaOH -> Na2CO3 + H2O", cat:"synth"},
  {eq:"CO2 + NaOH -> NaHCO3", cat:"synth"},
  {eq:"SO2 + 2NaOH -> Na2SO3 + H2O", cat:"synth"},
  {eq:"SO3 + 2NaOH -> Na2SO4 + H2O", cat:"synth"},
  {eq:"2Na + Cl2 -> 2NaCl", cat:"synth"},
  {eq:"2K + Cl2 -> 2KCl", cat:"synth"},
  {eq:"Mg + Cl2 -> MgCl2", cat:"synth"},
  {eq:"Ca + Cl2 -> CaCl2", cat:"synth"},
  {eq:"Zn + Cl2 -> ZnCl2", cat:"synth"},
  {eq:"Cu + Cl2 -> CuCl2", cat:"synth"},
  {eq:"Fe + S -> FeS", cat:"synth"},
  {eq:"Zn + S -> ZnS", cat:"synth"},
  {eq:"2Al + 3S -> Al2S3", cat:"synth"},
  {eq:"6Li + N2 -> 2Li3N", cat:"synth"},
  {eq:"H2 + F2 -> 2HF", cat:"synth"},
  {eq:"2Al + 3Br2 -> 2AlBr3", cat:"pblock"},
  {eq:"Si + 2Cl2 -> SiCl4", cat:"pblock"},
  {eq:"P4 + 6Cl2 -> 4PCl3", cat:"pblock"},
  {eq:"2P + 3Br2 -> 2PBr3", cat:"pblock"},
  {eq:"SO2 + Cl2 -> SO2Cl2", cat:"pblock"},
  {eq:"Co^2+ + 6NH3 -> [Co(NH3)6]^2+", cat:"complex", cond:"ligand exchange"},
  {eq:"Zn^2+ + 4NH3 -> [Zn(NH3)4]^2+", cat:"complex", cond:"colourless"},
  {eq:"Fe^3+ + 6CN^- -> [Fe(CN)6]^3-", cat:"complex", cond:"hexacyanoferrate(III)"},
  {eq:"Cu^2+ + 4Cl^- -> [CuCl4]^2-", cat:"complex", cond:"yellow-green"},

  /* ===== added reactions (round 3 — sourced from Chemistry: The Central
     Science 14e and the Inorganic Chemistry LibreText; each balanced and
     mass-checked before inclusion) ===== */
  {eq:"Mn + Pb(NO3)2 -> Mn(NO3)2 + Pb", cat:"disp"},
  {eq:"Fe + Ni(NO3)2 -> Fe(NO3)2 + Ni", cat:"disp"},
  {eq:"Cu + 4HNO3 -> Cu(NO3)2 + 2H2O + 2NO2", cat:"disp", cond:"conc. HNO₃"},
  {eq:"3Cu + 8HNO3 -> 3Cu(NO3)2 + 4H2O + 2NO", cat:"disp", cond:"dilute HNO₃"},
  {eq:"K3PO4 + 3AgNO3 -> Ag3PO4 + 3KNO3", cat:"precip"},
  {eq:"Br2 + 2K -> 2KBr", cat:"synth"},
  {eq:"2LiOH + CO2 -> Li2CO3 + H2O", cat:"synth", cond:"CO₂ scrubbing"},
  {eq:"Na2SiO3 + 8HF -> H2SiF6 + 2NaF + 3H2O", cat:"pblock", cond:"glass etching"},
  {eq:"4KO2 + 2CO2 -> 2K2CO3 + 3O2", cat:"synth", cond:"rebreather O₂ supply"},
  {eq:"3NaHCO3 + H3C6H5O7 -> 3CO2 + 3H2O + Na3C6H5O7", cat:"carb", cond:"Alka-Seltzer fizz"},
  {eq:"2HCl + Na2S -> H2S + 2NaCl", cat:"gasform"},
  {eq:"2NaCN + H2SO4 -> Na2SO4 + 2HCN", cat:"gasform"},
  {eq:"Mg3N2 + 6H2O -> 3Mg(OH)2 + 2NH3", cat:"synth", cond:"nitride hydrolysis"},
  {eq:"Sc2O3 + 6HNO3 -> 2Sc(NO3)3 + 3H2O", cat:"oxide"},
  {eq:"NiO + 2HNO3 -> Ni(NO3)2 + H2O", cat:"oxide"},
  {eq:"Bi2O3 + 6HNO3 -> 2Bi(NO3)3 + 3H2O", cat:"oxide"},
  {eq:"Mn2O3 + 6HCl -> 2MnCl3 + 3H2O", cat:"oxide"},
  {eq:"SeO2 + 2NaOH -> Na2SeO3 + H2O", cat:"pblock"},
  {eq:"SeO2 + H2O -> H2SeO3", cat:"pblock"},
  {eq:"SiO2 + 2F2 -> SiF4 + O2", cat:"pblock"},
  {eq:"2Na + O2 -> Na2O2", cat:"comb", cond:"sodium peroxide"},
  {eq:"K + O2 -> KO2", cat:"comb", cond:"potassium superoxide"},
  {eq:"2Cs + Cl2 -> 2CsCl", cat:"synth"},
  {eq:"2Cs + 2H2O -> 2CsOH + H2", cat:"disp"},
  {eq:"Mg + H2O -> MgO + H2", cat:"disp", cond:"steam"},
  {eq:"Pb + Cl2 -> PbCl2", cat:"synth"},
  {eq:"Mg2Si + 4H2O -> SiH4 + 2Mg(OH)2", cat:"pblock", cond:"silane synthesis"},
  {eq:"GeCl4 + 2H2O -> GeO2 + 4HCl", cat:"pblock", cond:"hydrolysis"},
  {eq:"Sn + 2H2O -> SnO2 + 2H2", cat:"disp", cond:"steam"},
  {eq:"I2 + F2 -> 2IF", cat:"pblock", cond:"interhalogen, low temp"},
  {eq:"I2 + AgF -> IF + AgI", cat:"pblock", cond:"halogen exchange"},
  {eq:"I2 + 3XeF2 -> 2IF3 + 3Xe", cat:"pblock", cond:"noble-gas fluorinating agent"},
  {eq:"Cd + Ni^2+ -> Cd^2+ + Ni", cat:"disp", cond:"Ni–Cd battery"},
  {eq:"Mn(OH)2 + 2HBr -> MnBr2 + 2H2O", cat:"neut"},
  {eq:"4Cr + 3O2 -> 2Cr2O3", cat:"comb", cond:"Δ"},
  {eq:"Ti + 2F2 -> TiF4", cat:"pblock", cond:"F₂ in excess"},
  {eq:"CO + Cl2 -> COCl2", cat:"synth", cond:"phosgene synthesis, catalysed"}
];
/* ---- Qualifying set: exactly two reactants after dropping spectators ------ */
const QUAL = [];
R.filter(r=>!r.skip).forEach(r=>{
  const p = parseReaction(r.eq);
  const real = p.reactants.filter(x=>!SPECT.has(x.sp));
  const hadSpect = p.reactants.some(x=>SPECT.has(x.sp));
  if(real.length!==2) return;                                  // curriculum: 2 reactants only
  if(real.some(x=>molarMass(x.sp)==null)) return;              // skip if any mass is unknown
  const elset=new Set();
  [...p.reactants, ...p.products].forEach(t=>{ const c=composition(t.sp); for(const k in c) elset.add(k); });
  const el=[...elset];
  const bareTexts=new Set();
  [...p.reactants, ...p.products].forEach(t=>{ const b=bareFormula(t.sp); if(b) bareTexts.add(b.toLowerCase()); });
  // Yield questions are always asked about a product, so unlike
  // Stoichiomathics this build keeps the product list on every entry. Only
  // products with a known molar mass are offered as yield targets — a yield
  // in grams or dm³ is meaningless without one.
  const products = p.products.filter(x=>molarMass(x.sp)!=null);
  if(!products.length) return;
  QUAL.push({
    eq:r.eq, cat:r.cat, el, cond:r.cond||"", equil:p.equil,
    A:real[0], B:real[1], products, hadSpect, bareTexts,
    search:(r.eq+" "+el.join(" ")+" "+(r.cond||"")+" "+CAT[r.cat].label).toLowerCase()
  });
});
QUAL.forEach((q,i)=>q.id=i);

/* ---- Limiting-reactant maths (pure — returns raw numbers, no DOM) --------
   For aA + bB -> …, the amount of B needed to use up all of A is n(A)·b/a.
   Compare n/coefficient for each reactant; the smaller one is limiting.      */
function computeLimiting(q, nA, nB){
  const A=q.A, B=q.B, a=A.coef, b=B.coef;
  const MA=molarMass(A.sp), MB=molarMass(B.sp);
  const nBneed=nA*(b/a);
  const ratioA=nA/a, ratioB=nB/b;
  const tol=1e-9*Math.max(ratioA,ratioB,1e-30);
  const enough = nB >= nBneed - tol;
  let tie=false, limiting=null, excess=null, leftMol=0, leftMass=0;
  if(Math.abs(ratioA-ratioB)<=tol){ tie=true; }
  else if(ratioA<ratioB){ limiting=A; excess=B; leftMol=nB-nBneed;   leftMass=leftMol*MB; }
  else                  { limiting=B; excess=A; leftMol=nA-nB*(a/b); leftMass=leftMol*MA; }
  return {A,B,a,b,MA,MB,nA,nB,nBneed,ratioA,ratioB,tie,enough,limiting,excess,leftMol,leftMass};
}

/* ---- Pivot reframing ------------------------------------------------------
   The physics (which reactant is actually limiting) never depends on which
   one a student chooses to test first — computeLimiting() above is already
   symmetric. pivotView() just re-expresses the same result from whichever
   side ("A" or "B") the student picked to "use up first": P is the one
   assumed fully consumed, Q is the one being checked for enough supply.
   pv.enough === true  means the assumption held: P really is limiting.
   pv.enough === false means it didn't: Q actually runs out first, so Q is
   limiting and P is left in excess instead. Either way res.limiting /
   res.excess (from computeLimiting) remain the ground truth — pivotView
   never overrides them, it just reframes the working around the choice. */
function pivotView(res, pivot){
  const useA = pivot !== 'B';
  const P = useA ? res.A : res.B, Q = useA ? res.B : res.A;
  const nP = useA ? res.nA : res.nB, nQ = useA ? res.nB : res.nA;
  const pCoef = useA ? res.a : res.b, qCoef = useA ? res.b : res.a;
  const MP = useA ? res.MA : res.MB, MQ = useA ? res.MB : res.MA;
  const nQneed = nP*(qCoef/pCoef);
  const tol = 1e-9*Math.max(nP/pCoef, nQ/qCoef, 1e-30);
  const enough = res.tie ? true : (nQ >= nQneed - tol);
  return {P,Q,nP,nQ,pCoef,qCoef,MP,MQ,nQneed,enough,tie:res.tie,pivot:useA?'A':'B'};
}

/* ---- Direct mol comparison ------------------------------------------------
   An alternative to pivotView's "assume one runs out first, check the other"
   framing: instead, scale the actual moles so the reactant with the SMALLER
   stoichiometric coefficient exactly matches that coefficient, then read the
   other reactant's scaled amount straight off against ITS coefficient — no
   assumption to test, just a direct side-by-side ratio comparison. Always
   normalises to the smaller-coefficient side, so which one is S vs O is
   fixed by the equation, not by student choice. Mathematically it reaches
   the same res.limiting/res.excess as pivotView — just a different lens. */
function ratioCompareView(res){
  const aSmaller = res.a <= res.b;
  const S = aSmaller ? res.A : res.B, O = aSmaller ? res.B : res.A;
  const nS = aSmaller ? res.nA : res.nB, nO = aSmaller ? res.nB : res.nA;
  const sCoef = aSmaller ? res.a : res.b, oCoef = aSmaller ? res.b : res.a;
  const MS = aSmaller ? res.MA : res.MB, MO = aSmaller ? res.MB : res.MA;
  const k = sCoef/nS;              // scale factor bringing S's actual moles to exactly sCoef
  const oScaled = nO*k;            // O's actual moles under that same scale factor
  const tol = 1e-9*Math.max(sCoef, oCoef, 1e-30);
  const tie = Math.abs(oScaled-oCoef) <= tol;
  // oScaled < oCoef -> O is limiting (falls short once scaled to match S)
  // oScaled > oCoef -> S is limiting (O has more than its scaled share)
  return {S,O,nS,nO,sCoef,oCoef,MS,MO,k,oScaled,tie};
}

/* ---- Yield maths ----------------------------------------------------------
   Everything here hangs off one fact: the limiting reactant fixes how much
   product *can* form. For aA + bB -> cC, once the limiting reactant L is
   known, the theoretical amount of product C is n(L)/coef(L) × c — the most
   the reaction could ever give. What a real experiment actually collects (the
   actual yield) is normally less, and

     percentage yield = actual ÷ theoretical × 100

   Which of the three is unknown is the student's choice, so solveYield()
   below takes whichever two are known and returns the third. Amounts convert
   between moles / mass / gas volume through the same factors used for the
   reactant inputs, so a yield can be asked for in whichever unit the
   question uses. */

// Moles of product `prod` obtainable from a solved limiting-reactant result.
function theoreticalMoles(res, prod){
  if(!res.limiting && !res.tie) return NaN;
  // On an exact tie either reactant fixes the same amount — use A.
  const L = res.limiting || res.A;
  const nL = (L === res.A) ? res.nA : res.nB;
  const lCoef = (L === res.A) ? res.a : res.b;
  return nL/lCoef*prod.coef;
}

// moles <-> the unit a yield is expressed in. `unit` is 'mol' | 'mass' | 'gas'.
function molesToAmount(n, sp, unit, cond){
  if(unit === 'mass') return n*molarMass(sp);
  if(unit === 'gas')  return n*MOLAR_VOL[cond||'RTP'];
  return n;
}
function amountToMoles(x, sp, unit, cond){
  if(unit === 'mass') return x/molarMass(sp);
  if(unit === 'gas')  return x/MOLAR_VOL[cond||'RTP'];
  return x;
}
const UNIT_LABEL = { mol:'mol', mass:'g', gas:'dm³' };

/* Given the limiting-reactant result and the chosen product, return every
   yield figure in both moles and the requested unit. `target` names the
   unknown ('percent' | 'theoretical' | 'actual'); `known` supplies whichever
   of actual/percent the student was able to state, in `unit`.
   Percentages above 100 are returned as-is rather than clamped: they signal
   a real measurement problem (impure or wet product, mis-weighing), and
   hiding that would teach the wrong lesson. */
function solveYield(res, prod, target, unit, cond, known){
  const sp = prod.sp;
  const nTheo = theoreticalMoles(res, prod);
  const theoretical = molesToAmount(nTheo, sp, unit, cond);
  let actual = NaN, nActual = NaN, percent = NaN;

  if(target === 'theoretical'){
    // Nothing else needed: the reactant amounts alone fix it.
  } else if(target === 'percent'){
    actual = known.actual;
    nActual = amountToMoles(actual, sp, unit, cond);
    percent = theoretical > 0 ? actual/theoretical*100 : NaN;
  } else { // 'actual'
    percent = known.percent;
    actual = theoretical*percent/100;
    nActual = nTheo*percent/100;
  }
  return { sp, prod, unit, cond, nTheo, theoretical, nActual, actual, percent,
           unitLabel: UNIT_LABEL[unit], target };
}

/* In the browser these are already globals, loaded before app.js. This block
   exists only so test-chemistry.js can require the engine under Node. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AM, MOLAR_VOL, SPECT, R, QUAL, composition, molarMass, massParts,
                     isRecognisedFormula, smartFormulaCandidates, parseReaction,
                     computeLimiting, pivotView, ratioCompareView,
                     theoreticalMoles, molesToAmount, amountToMoles, solveYield, UNIT_LABEL };
}