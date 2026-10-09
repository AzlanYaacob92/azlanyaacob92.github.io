/* ============================================================================
   app.js  —  presentation layer
   A wizard flow in the Chemculator house style:
     landing ("I want to…") → periodic-table reaction picker → what to
     calculate → which product / which unit → amounts → branch:
        Learn    — one card that grows a step at a time: the instruction, the
                   working typed in line by line (stacked equations), and the
                   ratio-ball picture where the step has one.
        Verify   — the key figures and the same picture, all at once.
        Practice — landing → a generated problem with instant feedback, a
                   picture and the working. No setup.
   Depends on chemistry.js (AM, CAT, QUAL, MOLAR_VOL, fmtEq, fmtFormula,
   molarMass, massParts, molesOf, solveProblem), generator.js + practice.js
   (Generator, Practice), ratiovis.js (RatioVis) and motion.js. All
   chemistry stays in chemistry.js.
   ========================================================================== */

/* ---------------- theme toggle ----------------
   Independent of the main IIFE below — it only flips the data-theme
   attribute the dark-mode CSS variables key off, and remembers the choice. */
(function () {
  const toggleBtn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');
  if (!toggleBtn) return;
  const root = document.documentElement;

  function isDark() {
    const t = root.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t === 'dark';
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); } catch (e) { return false; }
  }

  function reflect() {
    const dark = isDark();
    toggleBtn.setAttribute('aria-pressed', String(dark));
    toggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    if (icon) icon.innerHTML = Icons.svg(dark ? 'sun' : 'moon');
  }

  reflect(); // match whatever the inline head script already applied
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reflect);
  } catch (e) { /* older browsers */ }

  toggleBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) { /* private browsing, etc. */ }
    reflect();
  });
})();

(function () {

  /* ---------------- display formatting ---------------- */
  function sig(x, n) { n = n || 4; if (x === 0) return '0'; if (!isFinite(x)) return '—'; return Number(x.toPrecision(n)).toString(); }
  const mm1 = x => x.toFixed(1);
  // stacked fraction — numerator over denominator with a bar, as on paper
  function frac(num, den) {
    return `<span class="frac"><span class="frac-num">${num}</span><span class="frac-den">${den}</span></span>`;
  }

  /* ---------------- motion ----------------
     Every JS-driven animation goes through motion.js (window.Motion), which
     takes its timing from the design-system tokens and honours reduced motion. */
  const Motion = window.Motion;

  // The one wizard transition primitive: `fromEl` leaves (if any), `updateFn`
  // runs, then `toEl` arrives. fromEl and toEl may be the same element,
  // refreshed in place.
  function panTransition(fromEl, toEl, direction, updateFn) {
    return Motion.swap(fromEl, toEl, updateFn);
  }

  /* ---------------- stacked-equation grid ----------------
     The quantity left of the first '=' appears once; every following
     '='-separated segment gets its own row with the '=' signs stacked in a
     shared column. Each row is one element, so the typewriter animates it as
     a single continuous left-to-right sweep. */
  function splitTopLevelEquals(line) {
    const parts = [];
    let depth = 0, cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '<') depth++;
      else if (c === '>') depth = Math.max(0, depth - 1);
      if (c === '=' && depth === 0) { parts.push(cur); cur = ''; }
      else cur += c;
    }
    parts.push(cur);
    return parts.map(s => s.trim());
  }

  function mathGrid(html) {
    const lines = String(html).split(/<br\s*\/?>/i);
    let rows = '';
    let row = 0;
    lines.forEach(line => {
      const segs = splitTopLevelEquals(line);
      if (segs.length === 1) {
        row += 1;
        rows += `<span class="eq-row" style="grid-row:${row}"><span class="eq-seg eq-solo" style="grid-column:1 / -1">${segs[0]}</span></span>`;
        return;
      }
      segs.slice(1).forEach((seg, si) => {
        row += 1;
        const lhs = si === 0 ? `<span class="eq-seg eq-lhs" style="grid-column:1">${segs[0]}</span>` : `<span class="eq-seg eq-lhs" style="grid-column:1"></span>`;
        rows += `<span class="eq-row" style="grid-row:${row}">${lhs}<span class="eq-op" style="grid-column:2">=</span><span class="eq-seg eq-rhs" style="grid-column:3">${seg}</span></span>`;
      });
    });
    return `<span class="eqgrid" style="grid-template-columns:max-content max-content minmax(0, max-content)">${rows}</span>`;
  }

  /* Reveal for a math grid: the working arrives one line at a time, top to
     bottom, at reading pace. The same reveal is used by every trainer.
     opts: { delay, gap } in ms, or { instant: true } for no reveal.
     Returns the time (ms from now) the last line has arrived. */
  function typewriterMathGrid(el, html, opts) {
    opts = opts || {};
    el.innerHTML = mathGrid(html);
    if (opts.instant) return 0;
    const rows = el.querySelectorAll('.eqgrid .eq-row');
    const start = opts.delay || 0;
    const gap = opts.gap || Math.min(LINE_GAP_MS, Math.floor(MAX_TYPE_MS / Math.max(rows.length, 1)));
    rows.forEach((row, i) => Motion.enter(row, { y: 4, duration: 'base', delay: start + i * gap }));
    return start + rows.length * gap;
  }
  const LINE_GAP_MS = 180;   // pause between lines of working
  const MAX_TYPE_MS = 2200;  // a long working speeds up rather than dragging on

  /* ---------------- periodic table layout (periods 1–6) ---------------- */
  const PT = [
    ["H",1,1,1],["He",2,1,18],
    ["Li",3,2,1],["Be",4,2,2],["B",5,2,13],["C",6,2,14],["N",7,2,15],["O",8,2,16],["F",9,2,17],["Ne",10,2,18],
    ["Na",11,3,1],["Mg",12,3,2],["Al",13,3,13],["Si",14,3,14],["P",15,3,15],["S",16,3,16],["Cl",17,3,17],["Ar",18,3,18],
    ["K",19,4,1],["Ca",20,4,2],["Sc",21,4,3],["Ti",22,4,4],["V",23,4,5],["Cr",24,4,6],["Mn",25,4,7],["Fe",26,4,8],["Co",27,4,9],["Ni",28,4,10],["Cu",29,4,11],["Zn",30,4,12],["Ga",31,4,13],["Ge",32,4,14],["As",33,4,15],["Se",34,4,16],["Br",35,4,17],["Kr",36,4,18],
    ["Rb",37,5,1],["Sr",38,5,2],["Y",39,5,3],["Zr",40,5,4],["Nb",41,5,5],["Mo",42,5,6],["Tc",43,5,7],["Ru",44,5,8],["Rh",45,5,9],["Pd",46,5,10],["Ag",47,5,11],["Cd",48,5,12],["In",49,5,13],["Sn",50,5,14],["Sb",51,5,15],["Te",52,5,16],["I",53,5,17],["Xe",54,5,18],
    ["Cs",55,6,1],["Ba",56,6,2],["La",57,6,3],["Hf",72,6,4],["Ta",73,6,5],["W",74,6,6],["Re",75,6,7],["Os",76,6,8],["Ir",77,6,9],["Pt",78,6,10],["Au",79,6,11],["Hg",80,6,12],["Tl",81,6,13],["Pb",82,6,14],["Bi",83,6,15],["Po",84,6,16],["At",85,6,17],["Rn",86,6,18]
  ];
  const ZBY = {}; PT.forEach(([s, z]) => ZBY[s] = z);
  const ACTIVE = new Set(); QUAL.forEach(q => q.el.forEach(e => ACTIVE.add(e)));

  /* ---------------- state ---------------- */
  function freshInput() { return { method: "mass", mass: "", mol: "", conc: "", cvol: "", cvolUnit: "cm3", gvol: "", gvolUnit: "dm3", cond: "RTP" }; }
  const state = {
    mode: null,             // 'learn' | 'verify' | 'practice'
    cat: "all", els: new Set(), matchMode: "all", query: "",
    sel: null,              // a QUAL index, or the string 'custom'
    target: null,           // 'theoretical' | 'percent' | 'actual' — the unknown
    prodIdx: 0,             // which product of the chosen reaction the yield is about
    unit: 'mass',           // 'mass' | 'gas' | 'mol' — how that yield is measured
    gasCond: 'RTP',         // molar-volume convention, only when unit === 'gas'
    inA: freshInput(), inB: freshInput(),
    known: { actual: '', percent: '' },  // whichever figure the question supplies
    learn: null,            // { steps, shown }
    customCount: 1,         // number of products chosen in the custom builder (1–4)
    customFields: null,     // working {coef, name} rows while the builder is open
    customQ: null           // the built custom reaction, same shape as a QUAL entry
  };

  const TARGET_LABEL = { theoretical: 'Theoretical yield', percent: 'Percentage yield', actual: 'Actual yield' };

  // Every place downstream reads the active reaction through this, so a
  // custom, session-only reaction can sit alongside the QUAL database
  // without ever being written into it.
  function currentQ() { return state.sel === 'custom' ? state.customQ : QUAL[state.sel]; }
  function currentProduct() { const q = currentQ(); return q.products[Math.min(state.prodIdx, q.products.length - 1)]; }

  /* ---------------- cards + navigation ---------------- */
  const cards = {
    landing: document.getElementById('card-landing'),
    picker:  document.getElementById('card-picker'),
    customSetup: document.getElementById('card-custom-setup'),
    customBuild: document.getElementById('card-custom-build'),
    target:  document.getElementById('card-target'),
    product: document.getElementById('card-product'),
    measure: document.getElementById('card-measure'),
    learn:   document.getElementById('card-learn'),
    verify:  document.getElementById('card-verify'),
    verdict: document.getElementById('card-verdict'),
    practice: document.getElementById('card-practice')
  };
  const backLink = document.getElementById('back-link');
  let current = 'landing';

  function goTo(key, direction, updateFn) {
    const from = cards[current], to = cards[key];
    current = key;
    backLink.hidden = (key === 'landing');
    panTransition(from === to ? null : from, to, direction || 'forward', updateFn)
      .then(() => { if (to && key !== 'landing' && current === key) Motion.scrollIntoView(to); });
  }

  function resetAll() {
    state.mode = null; state.sel = null; state.target = null;
    state.prodIdx = 0; state.unit = 'mass'; state.gasCond = 'RTP';
    state.inA = freshInput(); state.inB = freshInput();
    state.known = { actual: '', percent: '' };
    state.learn = null;
    state.customCount = 1; state.customFields = null; state.customQ = null;
    practice.P = null;
    renderCatalog();
  }

  backLink.addEventListener('click', () => {
    goTo('landing', 'back', resetAll);
  });

  /* ---------------- landing ---------------- */
  document.querySelectorAll('[data-choose]').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.choose === 'practice') { goTo('practice', 'forward', startPractice); return; }
    state.mode = btn.dataset.choose;
    goTo('picker', 'forward');
  }));

  // gentle entrance: the lead line arrives, then the choice cards grow in one after another
  function playLandingEntrance() {
    Motion.enter(document.getElementById('hero-lead'));
    Motion.stagger(document.querySelectorAll('#card-landing .choice-card'), { y: 0, scale: 0.92, delay: 120 });
  }

  /* ---------------- picker: periodic table ---------------- */
  const ptable = document.getElementById('ptable');
  PT.forEach(([sym, z, p, g]) => {
    const cell = document.createElement('button');
    const on = ACTIVE.has(sym);
    cell.type = 'button';
    cell.className = 'cell ' + (on ? 'on' : 'off');
    cell.style.gridColumn = g; cell.style.gridRow = p;
    cell.dataset.sym = sym; cell.dataset.col = g; cell.dataset.row = p;
    cell.innerHTML = '<span class="z">' + z + '</span>' + sym;
    cell.setAttribute('aria-label', sym + ', atomic number ' + z + (on ? '' : ', no reactions listed'));
    if (on) { cell.setAttribute('aria-pressed', 'false'); cell.addEventListener('click', () => toggleEl(sym)); }
    else cell.disabled = true;
    ptable.appendChild(cell);
  });
  // arrow keys step to the nearest element that has reactions, in that direction
  ptable.addEventListener('keydown', e => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    const from = e.target.closest ? e.target.closest('.cell') : null;
    if (!dir || !from) return;
    const c0 = +from.dataset.col, r0 = +from.dataset.row;
    let best = null, bestScore = Infinity;
    ptable.querySelectorAll('.cell:not(:disabled)').forEach(c => {
      const dc = +c.dataset.col - c0, dr = +c.dataset.row - r0;
      const along = dc * dir[0] + dr * dir[1], across = Math.abs(dir[0] ? dr : dc);
      if (along <= 0) return;
      const score = along + across * 20;
      if (score < bestScore) { bestScore = score; best = c; }
    });
    if (best) { e.preventDefault(); best.focus(); }
  });
  const ftag = document.createElement('div');
  ftag.className = 'ftag'; ftag.style.gridRow = 7; ftag.textContent = 'f-block omitted';
  ptable.appendChild(ftag);

  const catsel = document.getElementById('catsel');
  const presentCats = [...new Set(QUAL.map(q => q.cat))];
  catsel.innerHTML = '<option value="all">All reaction types</option>' +
    Object.entries(CAT).filter(([k]) => presentCats.includes(k)).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');

  // Species tokens are separated the same way stored equations join them: " + ".
  // Each typed token is reduced to its bare formula and matched as a PREFIX,
  // so incomplete typing filters live as you go. Non-formula tokens fall back
  // to a free-text substring search over the reaction's index instead.
  function speciesQueryMatches(q, rawQuery) {
    const tokens = rawQuery.split(/\s+\+\s+/).map(t => t.trim()).filter(Boolean);
    if (!tokens.length) return false;
    return tokens.every(tok => {
      const bare = bareFormula(tok).toLowerCase();
      if (!bare) return false;
      for (const bt of q.bareTexts) { if (bt.startsWith(bare)) return true; }
      return false;
    });
  }

  function queryMatches(q, rawQuery) {
    if (speciesQueryMatches(q, rawQuery)) return true;
    return q.search.includes(rawQuery.toLowerCase());
  }

  function catalogPass(q) {
    if (state.cat !== 'all' && q.cat !== state.cat) return false;
    if (state.els.size) {
      const arr = [...state.els];
      if (state.matchMode === 'all') { if (!arr.every(e => q.el.includes(e))) return false; }
      else { if (!arr.some(e => q.el.includes(e))) return false; }
    }
    const query = state.query.trim();
    if (query && !queryMatches(q, query)) return false;
    return true;
  }

  function renderCatalog() {
    document.querySelectorAll('.cell.on, .cell.sel').forEach(c => {
      const picked = state.els.has(c.dataset.sym);
      c.classList.toggle('sel', picked);
      c.setAttribute('aria-pressed', String(picked));
      if (!picked) c.classList.add('on');
    });
    const sc = document.getElementById('selchips');
    sc.innerHTML = [...state.els].sort((a, b) => ZBY[a] - ZBY[b]).map(s =>
      `<button class="selchip" data-rm="${s}" type="button">${s}<span>×</span></button>`).join('');
    sc.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => toggleEl(b.dataset.rm)));

    const filtering = state.els.size > 0 || state.query.trim().length > 0;
    const list = document.getElementById('list');
    const count = document.getElementById('count');

    const notListedCard = `<button type="button" class="rx rx--custom" id="rx-not-listed">
      <span class="idx" aria-hidden="true">+</span>
      <span class="rxbody">
        <span class="eq">My reaction is not listed</span>
        <span class="meta"><span class="cond">Build your own equation</span></span>
      </span>
      <span class="pick">Build →</span>
    </button>`;
    function wireNotListed() {
      const el = document.getElementById('rx-not-listed');
      if (el) el.addEventListener('click', goToCustomSetup);
    }

    if (!filtering) {
      count.innerHTML = '';
      list.innerHTML = '<div class="empty">Search a formula, or tap elements.</div>' + notListedCard;
      wireNotListed();
      return;
    }

    const out = QUAL.filter(catalogPass);
    count.innerHTML = out.length ? `<b>${out.length}</b> matching reaction${out.length > 1 ? 's' : ''}` : '';
    if (!out.length) {
      list.innerHTML = '<div class="empty">No reaction matches.<br>Try <b>Match any</b> or <b>Clear</b>.</div>' + notListedCard;
      wireNotListed();
      return;
    }
    list.innerHTML = out.map(q => {
      const c = CAT[q.cat];
      return `<button type="button" class="rx" data-id="${q.id}">
        <span class="idx" aria-hidden="true">${q.id + 1}</span>
        <span class="rxbody">
          <span class="eq">${fmtEq(q.eq)}</span>
          <span class="meta">
            <span class="tag" style="--tag:${c.color}">${c.label}</span>
            ${q.cond ? `<span class="cond">${q.cond}</span>` : ''}
            ${q.hadSpect ? `<span class="cond cond--warn">H⁺/OH⁻ omitted</span>` : ''}
          </span>
        </span>
        <span class="pick">Use →</span>
      </button>`;
    }).join('') + notListedCard;
    list.querySelectorAll('[data-id]').forEach(el => el.addEventListener('click', () => selectReaction(+el.dataset.id)));
    wireNotListed();
  }

  function toggleEl(sym) {
    if (state.els.has(sym)) state.els.delete(sym); else state.els.add(sym);
    renderCatalog();
  }

  document.querySelectorAll('#matchmode button').forEach(b => b.addEventListener('click', () => {
    state.matchMode = b.dataset.match;
    document.querySelectorAll('#matchmode button').forEach(x => x.classList.toggle('active', x === b));
    renderCatalog();
  }));
  catsel.addEventListener('change', e => { state.cat = e.target.value; renderCatalog(); });

  const searchInput = document.getElementById('speciesSearch');
  const searchPreview = document.getElementById('searchPreview');
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    const q = state.query.trim();
    searchPreview.innerHTML = q ? q.split(/\s+\+\s+/).map(t => t.trim()).filter(Boolean).map(fmtFormula).join(' + ') : '';
    renderCatalog();
  });

  document.getElementById('clear').addEventListener('click', () => {
    state.cat = 'all'; state.els.clear(); state.matchMode = 'all'; state.query = '';
    catsel.value = 'all';
    searchInput.value = ''; searchPreview.innerHTML = '';
    document.querySelectorAll('#matchmode button').forEach(x => x.classList.toggle('active', x.dataset.match === 'all'));
    renderCatalog();
  });

  function resetForNewReaction() {
    state.target = null; state.prodIdx = 0; state.unit = 'mass'; state.gasCond = 'RTP';
    state.inA = freshInput(); state.inB = freshInput();
    state.known = { actual: '', percent: '' };
    state.learn = null;
  }

  function selectReaction(id) {
    state.sel = id;
    resetForNewReaction();
    goTo('target', 'forward', renderTargetSelect);
  }

  /* ================= custom reaction builder =================
     Two reactants, one to four products — every product needs a real molar
     mass, since the yield may be asked for in grams or dm³ of any one of
     them. Nothing here is persisted: the built reaction lives in
     state.customQ for this session only. */
  const PROD_LETTERS = ['c', 'd', 'e', 'f'];
  const FORMULA_RE = /^[A-Za-z(][A-Za-z0-9()[\]^+-]*$/;

  function goToCustomSetup() {
    goTo('customSetup', 'forward', renderCustomSetup);
  }

  const prodcountEl = document.getElementById('prodcount');
  function renderCustomSetup() {
    prodcountEl.innerHTML = [1, 2, 3, 4].map(n =>
      `<button data-n="${n}" class="${n === state.customCount ? 'active' : ''}" type="button">${n}</button>`).join('');
    prodcountEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.customCount = +b.dataset.n;
      prodcountEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
    }));
  }
  document.getElementById('custom-setup-back').addEventListener('click', () => goTo('picker', 'back'));
  document.getElementById('custom-setup-continue').addEventListener('click', () => {
    const prevFields = state.customFields;
    const reactants = [0, 1].map(i => (prevFields && prevFields.reactants[i]) || { coef: '1', name: '' });
    const products = Array.from({ length: state.customCount }, (_, i) =>
      (prevFields && prevFields.products[i]) || { coef: '1', name: '' });
    state.customFields = { reactants, products };
    goTo('customBuild', 'forward', renderCustomBuild);
  });

  // The smart-cased reading of a formula, without touching the typed text:
  // the user's own casing if it already parses, the single fix if there's
  // exactly one, or the raw text unchanged if ambiguous or unrecognised.
  function resolvedFormula(raw) {
    raw = (raw || '').trim();
    if (!raw || isRecognisedFormula(raw)) return raw;
    const candidates = smartFormulaCandidates(raw);
    return candidates.length === 1 ? candidates[0] : raw;
  }

  function customEqPreview() {
    const { reactants, products } = state.customFields;
    const side = arr => arr.map(f => {
      const n = f.coef !== '' ? Number(f.coef) : NaN;
      return (isFinite(n) && n > 1 ? n : '') + (resolvedFormula(f.name) || '…');
    }).join(' + ');
    return side(reactants) + ' -> ' + side(products);
  }

  function customFieldCard(label, letter, side, idx, field) {
    return `<div class="customfield">
      <div class="cf-label">${label}</div>
      <div class="coefrow">
        <input class="num-input coef-input" type="number" min="1" step="1" value="${field.coef}"
          data-side="${side}" data-idx="${idx}" data-role="coef" aria-label="${letter} coefficient">
        <input class="num-input name-input" type="text" value="${field.name}" placeholder="e.g. H2SO4"
          data-side="${side}" data-idx="${idx}" data-role="name" aria-label="${letter} formula" autocomplete="off" spellcheck="false">
      </div>
      <div class="formula-preview" data-side="${side}" data-idx="${idx}">${field.name ? fmtFormula(field.name) : ''}</div>
      <div class="formula-conflict" data-side="${side}" data-idx="${idx}" hidden>
        <div class="formula-conflict-label">Multiple matches — which did you mean?</div>
        <div class="formula-conflict-options"></div>
      </div>
    </div>`;
  }

  function renderCustomBuild() {
    const { reactants, products } = state.customFields;
    document.getElementById('customReactants').innerHTML =
      customFieldCard('Reactant A', 'a', 'reactant', 0, reactants[0]) +
      customFieldCard('Reactant B', 'b', 'reactant', 1, reactants[1]);
    document.getElementById('customProducts').innerHTML =
      products.map((f, i) => customFieldCard(`Product ${PROD_LETTERS[i].toUpperCase()}`, PROD_LETTERS[i], 'product', i, f)).join('');
    document.getElementById('custom-error').hidden = true;
    updateCustomPreview();
    wireCustomBuild();
  }

  function updateCustomPreview() {
    document.getElementById('customPreview').innerHTML = fmtEq(customEqPreview());
  }

  function applyFormula(side, idx, formula) {
    const arr = side === 'reactant' ? state.customFields.reactants : state.customFields.products;
    arr[+idx].name = formula;
    const input = document.querySelector(`.name-input[data-side="${side}"][data-idx="${idx}"]`);
    if (input) input.value = formula;
    const preview = document.querySelector(`.formula-preview[data-side="${side}"][data-idx="${idx}"]`);
    if (preview) preview.innerHTML = fmtFormula(formula);
    clearFormulaConflict(side, idx);
    updateCustomPreview();
  }

  function clearFormulaConflict(side, idx) {
    const box = document.querySelector(`.formula-conflict[data-side="${side}"][data-idx="${idx}"]`);
    if (box) box.hidden = true;
  }

  function showFormulaConflict(side, idx, candidates) {
    const box = document.querySelector(`.formula-conflict[data-side="${side}"][data-idx="${idx}"]`);
    if (!box) return;
    box.querySelector('.formula-conflict-options').innerHTML = candidates.map(c =>
      `<button type="button" class="formula-option" data-value="${c}">${fmtFormula(c)}</button>`).join('');
    box.hidden = false;
    box.querySelectorAll('.formula-option').forEach(btn =>
      btn.addEventListener('click', () => applyFormula(side, idx, btn.dataset.value)));
  }

  // Live, on every keystroke: reflects the smart-cased reading in the preview
  // and conflict picker without ever rewriting the input's own text.
  function updateFormulaPreview(side, idx, raw) {
    const preview = document.querySelector(`.formula-preview[data-side="${side}"][data-idx="${idx}"]`);
    if (preview) preview.innerHTML = raw ? fmtFormula(resolvedFormula(raw)) : '';
    if (!raw || isRecognisedFormula(raw)) { clearFormulaConflict(side, idx); return; }
    const candidates = smartFormulaCandidates(raw);
    if (candidates.length > 1) showFormulaConflict(side, idx, candidates);
    else clearFormulaConflict(side, idx);
  }

  // On blur, commit an unambiguous smart-cased reading into the field itself.
  function trySmartFormula(side, idx) {
    const arr = side === 'reactant' ? state.customFields.reactants : state.customFields.products;
    const raw = (arr[+idx].name || '').trim();
    if (!raw || isRecognisedFormula(raw)) return;
    const candidates = smartFormulaCandidates(raw);
    if (candidates.length === 1 && candidates[0] !== raw) applyFormula(side, idx, candidates[0]);
  }

  function wireCustomBuild() {
    document.querySelectorAll('#customReactants input, #customProducts input').forEach(inp => {
      inp.addEventListener('input', e => {
        const { side, idx, role } = e.target.dataset;
        const arr = side === 'reactant' ? state.customFields.reactants : state.customFields.products;
        arr[+idx][role] = e.target.value;
        if (role === 'name') updateFormulaPreview(side, idx, e.target.value.trim());
        updateCustomPreview();
      });
      if (inp.dataset.role === 'name') {
        inp.addEventListener('blur', () => trySmartFormula(inp.dataset.side, inp.dataset.idx));
      }
    });
  }

  document.getElementById('custom-build-back').addEventListener('click', () => goTo('customSetup', 'back'));

  // Validate one field: a positive-integer coefficient and a formula whose
  // elements are all recognised (products need a molar mass too).
  function validateField(f, label) {
    const name = (f.name || '').trim();
    if (!name) return `Enter a formula for ${label}.`;
    if (!FORMULA_RE.test(name)) return `${label}: “${name}” has an invalid character.`;
    const comp = composition(name);
    if (!Object.keys(comp).length) return `${label}: “${name}” is not a valid formula.`;
    if (molarMass(name) == null) {
      const bad = Object.keys(comp).find(el => !(el in AM));
      return `${label}: “${bad || name}” is not a known element.`;
    }
    const coefN = Number(f.coef);
    if (!(Number.isInteger(coefN) && coefN >= 1)) return `${label}: use a whole number, 1 or more.`;
    return null;
  }

  /* An unbalanced equation gives a wrong yield: count atoms on each side
     and refuse to build until they match. */
  function balanceError(A, B, prods) {
    const tally = side => side.reduce((acc, t) => {
      const c = composition(t.sp);
      for (const el in c) acc[el] = (acc[el] || 0) + t.coef * c[el];
      return acc;
    }, {});
    const left = tally([A, B]), right = tally(prods);
    const elements = [...new Set([...Object.keys(left), ...Object.keys(right)])];
    const off = elements
      .map(el => ({ el, l: left[el] || 0, r: right[el] || 0 }))
      .filter(x => x.l !== x.r);
    if (!off.length) return null;
    return 'Not balanced. ' + off.map(x => `${x.el}: ${x.l} left, ${x.r} right`).join('; ') + '.';
  }

  document.getElementById('custom-build-continue').addEventListener('click', () => {
    const { reactants, products } = state.customFields;
    const err = document.getElementById('custom-error');
    const labels = { reactant: ['Reactant A', 'Reactant B'], product: products.map((_, i) => `Product ${PROD_LETTERS[i].toUpperCase()}`) };
    let msg = null;
    reactants.forEach((f, i) => { msg = msg || validateField(f, labels.reactant[i]); });
    products.forEach((f, i) => { msg = msg || validateField(f, labels.product[i]); });
    if (msg) { err.textContent = msg; err.hidden = false; return; }

    const A = { coef: Number(reactants[0].coef), sp: reactants[0].name.trim() };
    const B = { coef: Number(reactants[1].coef), sp: reactants[1].name.trim() };
    const prods = products.map(f => ({ coef: Number(f.coef), sp: f.name.trim() }));

    const unbalanced = balanceError(A, B, prods);
    if (unbalanced) { err.textContent = unbalanced; err.hidden = false; return; }
    err.hidden = true;

    const prodTokens = prods.map(p => `${p.coef > 1 ? p.coef : ''}${p.sp}`);
    const eq = `${A.coef > 1 ? A.coef : ''}${A.sp} + ${B.coef > 1 ? B.coef : ''}${B.sp} -> ${prodTokens.join(' + ')}`;
    const elset = new Set();
    [A.sp, B.sp, ...prods.map(p => p.sp)].forEach(sp => { const c = composition(sp); for (const k in c) elset.add(k); });

    state.sel = 'custom';
    state.customQ = { eq, cat: 'custom', el: [...elset], cond: '', equil: false, A, B, products: prods, hadSpect: false, custom: true };
    resetForNewReaction();
    goTo('target', 'forward', renderTargetSelect);
  });

  /* ---------------- what are you calculating? ---------------- */
  function renderTargetSelect() {
    const q = currentQ();
    document.getElementById('targetEq').innerHTML = fmtEq(q.eq);
    document.querySelectorAll('#card-target [data-target]').forEach(b =>
      b.classList.toggle('active', state.target === b.dataset.target));
  }
  document.querySelectorAll('#card-target [data-target]').forEach(b => b.addEventListener('click', () => {
    state.target = b.dataset.target;
    goTo('product', 'forward', renderProductSelect);
  }));
  document.getElementById('target-back').addEventListener('click', () => {
    goTo(state.sel === 'custom' ? 'customBuild' : 'picker', 'back', state.sel === 'custom' ? renderCustomBuild : undefined);
  });

  /* ---------------- which product, in what unit? ---------------- */
  const UNITS = [['mass', 'Mass (g)'], ['gas', 'Gas volume (dm³)'], ['mol', 'Moles (mol)']];

  function renderProductSelect() {
    const q = currentQ();
    document.getElementById('productEq').innerHTML = fmtEq(q.eq);

    const seg = document.getElementById('product-seg');
    seg.innerHTML = q.products.map((p, i) =>
      `<button type="button" data-prod="${i}" class="${state.prodIdx === i ? 'active' : ''}">${fmtFormula(p.sp)}${p.coef > 1 ? ` <span class="cf">coeff ${p.coef}</span>` : ''}</button>`).join('');
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.prodIdx = +b.dataset.prod;
      renderProductSelect();
    }));

    const useg = document.getElementById('unit-seg');
    useg.innerHTML = UNITS.map(([v, label]) =>
      `<button type="button" data-unit="${v}" class="${state.unit === v ? 'active' : ''}">${label}</button>`).join('');
    useg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.unit = b.dataset.unit;
      renderProductSelect();
    }));

    // The molar-volume convention only matters when the yield is a gas volume.
    document.getElementById('product-gas').innerHTML = state.unit === 'gas'
      ? `<div class="custom-side-label">Molar gas volume</div>
         <div class="seg seg--wide" id="gascond-seg" role="group" aria-label="Molar gas volume">
           ${[['RTP', 'RTP · 24.0 dm³ mol⁻¹'], ['STP', 'STP · 22.4 dm³ mol⁻¹']].map(([v, l]) =>
             `<button type="button" data-cond="${v}" class="${state.gasCond === v ? 'active' : ''}">${l}</button>`).join('')}
         </div>`
      : '';
    const gseg = document.getElementById('gascond-seg');
    if (gseg) gseg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.gasCond = b.dataset.cond;
      renderProductSelect();
    }));
  }

  document.getElementById('product-back').addEventListener('click', () => goTo('target', 'back', renderTargetSelect));
  document.getElementById('product-continue').addEventListener('click', () => goTo('measure', 'forward', renderMeasure));

  /* ---------------- measurements ---------------- */
  const VOL_LABEL = { cm3: 'cm³ (mL)', dm3: 'dm³ (L)' };

  function methodSelect(side, inp) {
    const opts = [['mass', 'Mass (g)'], ['mol', 'Moles (mol)'], ['conc', 'Molarity × volume'], ['gas', 'Gas volume']];
    return `<select class="msel select" data-side="${side}" data-role="method" aria-label="measurement method">` +
      opts.map(([v, l]) => `<option value="${v}" ${inp.method === v ? 'selected' : ''}>${l}</option>`).join('') + `</select>`;
  }
  function volUnitSelect(side, role, val, firstUnit) {
    const order = firstUnit === 'dm3' ? ['dm3', 'cm3'] : ['cm3', 'dm3'];
    return `<select class="uSel select" data-side="${side}" data-role="${role}">` +
      order.map(u => `<option value="${u}" ${val === u ? 'selected' : ''}>${VOL_LABEL[u]}</option>`).join('') + `</select>`;
  }
  function fieldsFor(side, inp, sp) {
    if (inp.method === 'mass') {
      return `<div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="mass" value="${inp.mass}" data-side="${side}" data-role="mass"><span class="unit">g</span></div>`;
    }
    if (inp.method === 'mol') {
      return `<div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="moles" value="${inp.mol}" data-side="${side}" data-role="mol"><span class="unit">mol</span></div>`;
    }
    if (inp.method === 'conc') {
      return `<div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="molarity" value="${inp.conc}" data-side="${side}" data-role="conc"><span class="unit">mol dm⁻³</span></div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="volume" value="${inp.cvol}" data-side="${side}" data-role="cvol">
          ${volUnitSelect(side, 'cvolUnit', inp.cvolUnit, 'cm3')}</div>`;
    }
    return `<div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="gas volume" value="${inp.gvol}" data-side="${side}" data-role="gvol">
        ${volUnitSelect(side, 'gvolUnit', inp.gvolUnit, 'dm3')}</div>
      <div class="massrow"><select class="uSel select wide" data-side="${side}" data-role="cond"><option value="RTP" ${inp.cond === 'RTP' ? 'selected' : ''}>RTP · 24.0 dm³ mol⁻¹</option><option value="STP" ${inp.cond === 'STP' ? 'selected' : ''}>STP · 22.4 dm³ mol⁻¹</option></select></div>`;
  }

  function renderMeasure() {
    const q = currentQ();
    document.getElementById('measureEq').innerHTML = fmtEq(q.eq);
    document.getElementById('measure-error').hidden = true;
    renderInputs();
    renderKnownInput();
  }

  function renderInputs() {
    const q = currentQ();
    const cardsHtml = [['a', state.inA, q.A], ['b', state.inB, q.B]].map(([side, inp, x]) =>
      `<div class="massfield">
        <div class="who">${fmtFormula(x.sp)}${x.coef > 1 ? ` <span class="cf">coeff ${x.coef}</span>` : ''}</div>
        <div class="methodrow">${methodSelect(side, inp)}</div>
        ${fieldsFor(side, inp, x.sp)}
      </div>`).join('');
    document.getElementById('inputs').innerHTML = cardsHtml;
    wireInputs();
  }

  /* The one extra figure a yield question supplies: the actual yield when
     the percentage is unknown, or the percentage when the actual is. */
  function renderKnownInput() {
    const wrap = document.getElementById('knownWrap');
    const prod = currentProduct();
    const f = fmtFormula(prod.sp);
    if (state.target === 'theoretical') { wrap.innerHTML = ''; return; }
    if (state.target === 'percent') {
      wrap.innerHTML = `<div class="custom-side-label">Actual yield</div>
        <div class="massfield">
          <div class="who">${f}</div>
          <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="actual yield" value="${state.known.actual}" data-known="actual"><span class="unit">${UNIT_LABEL[state.unit]}</span></div>
        </div>`;
    } else {
      wrap.innerHTML = `<div class="custom-side-label">Percentage yield</div>
        <div class="massfield">
          <div class="who">${f}</div>
          <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="percentage yield" value="${state.known.percent}" data-known="percent"><span class="unit">%</span></div>
        </div>`;
    }
    wrap.querySelectorAll('[data-known]').forEach(inp => inp.addEventListener('input', e => {
      state.known[e.target.dataset.known] = e.target.value;
    }));
  }

  function inpFor(side) { return side === 'a' ? state.inA : state.inB; }
  function wireInputs() {
    document.querySelectorAll('#inputs [data-role="method"]').forEach(sel => sel.addEventListener('change', e => {
      inpFor(e.target.dataset.side).method = e.target.value; renderInputs();
    }));
    document.querySelectorAll('#inputs input[data-role]').forEach(inp => inp.addEventListener('input', e => {
      inpFor(e.target.dataset.side)[e.target.dataset.role] = e.target.value;
    }));
    document.querySelectorAll('#inputs select.uSel').forEach(sel => sel.addEventListener('change', e => {
      inpFor(e.target.dataset.side)[e.target.dataset.role] = e.target.value;
    }));
  }

  document.getElementById('measure-back').addEventListener('click', () => {
    goTo('product', 'back', renderProductSelect);
  });

  document.getElementById('measure-continue').addEventListener('click', () => {
    const q = currentQ();
    const nA = molesOf(state.inA, q.A.sp), nB = molesOf(state.inB, q.B.sp);
    const err = document.getElementById('measure-error');
    if (!(isFinite(nA) && nA > 0 && isFinite(nB) && nB > 0)) {
      err.textContent = 'Enter a positive amount for both reactants.';
      err.hidden = false;
      return;
    }
    if (state.target === 'percent') {
      const a = parseFloat(state.known.actual);
      if (!(isFinite(a) && a > 0)) {
        err.textContent = `Enter the actual yield, in ${UNIT_LABEL[state.unit]}.`;
        err.hidden = false; return;
      }
    }
    if (state.target === 'actual') {
      const p = parseFloat(state.known.percent);
      if (!(isFinite(p) && p > 0)) {
        err.textContent = 'Enter a percentage yield above 0.';
        err.hidden = false; return;
      }
    }
    err.hidden = true;
    beginWorking();
  });

  /* ---------------- the problem, in one place ----------------
     Everything below works from a "problem": the wizard's answers, or a Practice
     problem (same fields). chemistry.js solves it. */
  function wizardProblem() {
    return { q: currentQ(), prodIdx: state.prodIdx, target: state.target, unit: state.unit, cond: state.gasCond,
             inA: state.inA, inB: state.inB, known: state.known };
  }

  function beginWorking() {
    if (state.mode === 'verify') { goTo('verify', 'forward', renderVerify); return; }
    goTo('learn', 'forward', renderLearn);
  }

  /* ---------------- shared working fragments ---------------- */
  function moleMath(inp, sp, n) {
    const f = fmtFormula(sp);
    if (inp.method === 'mass') {
      const m = parseFloat(inp.mass), M = molarMass(sp);
      return `n(${f}) = ${frac('m', 'M<sub>r</sub>')} = ${frac(sig(m) + ' g', mm1(M) + ' g mol⁻¹')} = ${sig(n)} mol`;
    }
    if (inp.method === 'mol') return `n(${f}) = ${sig(n)} mol`;
    if (inp.method === 'conc') {
      const c = parseFloat(inp.conc); let Vr = parseFloat(inp.cvol); let V = Vr;
      const conv = inp.cvolUnit === 'cm3' ? (V = Vr / 1000, `V = ${sig(Vr)} cm³ = ${sig(V)} dm³<br>`) : '';
      return `${conv}n(${f}) = M × V = ${sig(c)} × ${sig(V)} = ${sig(n)} mol`;
    }
    let Vr = parseFloat(inp.gvol); let V = Vr;
    const Vm = MOLAR_VOL[inp.cond];
    const conv = inp.gvolUnit === 'cm3' ? (V = Vr / 1000, `V = ${sig(Vr)} cm³ = ${sig(V)} dm³<br>`) : '';
    return `${conv}n(${f}) = ${frac('V', 'V<sub>m</sub>')} = ${frac(sig(V) + ' dm³', Vm.toFixed(1) + ' dm³ mol⁻¹')} = ${sig(n)} mol`;
  }

  /* molar-mass working for one species — one term per element (a lone atom is just its A_r) */
  function mmMath(sp) {
    const parts = massParts(sp), M = molarMass(sp);
    const formula = parts.map(p => (p.n > 1 ? p.n + 'A<sub>r</sub>(' + p.el + ')' : 'A<sub>r</sub>(' + p.el + ')')).join(' + ');
    const subst = parts.map(p => (p.n > 1 ? p.n + ' × ' + mm1(p.a) : mm1(p.a))).join(' + ');
    const lone = parts.length === 1 && parts[0].n === 1;
    return `M<sub>r</sub>(${fmtFormula(sp)}) = ${formula} = ${lone ? '' : subst + ' = '}${mm1(M)} g mol⁻¹`;
  }

  // Converting the theoretical moles of product into the unit the question asks for.
  function amountMath(n, sp, unit, cond, label) {
    const f = fmtFormula(sp);
    if (unit === 'mass') {
      const M = molarMass(sp);
      return `${label}(${f}) = n × M<sub>r</sub> = ${sig(n)} × ${mm1(M)} = ${sig(n * M)} g`;
    }
    if (unit === 'gas') {
      const Vm = MOLAR_VOL[cond];
      return `${label}(${f}) = n × V<sub>m</sub> = ${sig(n)} × ${Vm.toFixed(1)} = ${sig(n * Vm)} dm³`;
    }
    return `${label}(${f}) = ${sig(n)} mol`;
  }

  /* ---------------- ratio-ball pictures ----------------
     The spec for one picture of a solved problem `s` (solveProblem's result). `moles` are the exact
     figures from the working, never the rounded text. */
  function pictureSpec(s, view, extra) {
    return Object.assign({
      reactants: [s.q.A, s.q.B].map((x, i) => ({ html: fmtFormula(x.sp), coef: x.coef, moles: i ? s.res.nB : s.res.nA })),
      products: s.q.products.map(x => ({ html: fmtFormula(x.sp), coef: x.coef })),
      product: s.idx,
      view
    }, extra);
  }
  // actual ÷ theoretical, for the filled share of the product balls; nothing when no actual yield exists
  function fillOf(y) {
    const f = y.nActual / y.nTheo;
    return isFinite(f) && f >= 0 ? { fill: f } : {};
  }
  // `pic` = { spec, opts }. The host is shown first, so the entrance plays in view; a picture that
  // cannot be drawn (an absurd amount) leaves its host hidden.
  function mountPicture(host, pic, extra) {
    if (!host) return;
    host.hidden = false;
    if (!RatioVis.mount(host, pic.spec, Object.assign({ sf: 4 }, pic.opts, extra))) host.hidden = true;
  }

  /* ---------------- the working: ONE step list for Learn, Verify and Practice ----------------
     [{ instruction, math, picture? }] — `picture` is { spec, opts } for RatioVis. */
  function stepsFor(p) {
    const s = solveProblem(p), { q, prod, res, y } = s;
    const A = q.A, B = q.B;
    const fA = fmtFormula(A.sp), fB = fmtFormula(B.sp), fP = fmtFormula(prod.sp);
    const steps = [];

    // 1 — moles. Molar masses first, for whichever species need one: reactants entered by mass,
    // plus the product if the yield is a mass.
    const needMM = [];
    if (p.inA.method === 'mass') needMM.push(A.sp);
    if (p.inB.method === 'mass') needMM.push(B.sp);
    if (p.unit === 'mass' && !needMM.includes(prod.sp)) needMM.push(prod.sp);
    steps.push({
      instruction: !needMM.length && p.inA.method === 'mol' && p.inB.method === 'mol' ? 'Note the moles.' : 'Convert to moles.',
      math: needMM.map(mmMath).concat(moleMath(p.inA, A.sp, res.nA), moleMath(p.inB, B.sp, res.nB)).join('<br>')
    });

    // 2 — which one runs out first: n ÷ coefficient for each, the smaller wins
    const L = res.limiting || A;
    const fL = fmtFormula(L.sp);
    const batch = (f, n, c) => `n(${f}) ÷ ${c} = ${sig(n / c)} mol`;
    steps.push({
      instruction: 'Which one runs out first?',
      math: `${batch(fA, res.nA, res.a)}<br>${batch(fB, res.nB, res.b)}<br>` + (res.tie ? 'Both run out together.' : `${fL} runs out first.`),
      picture: { spec: pictureSpec(s, 'compare'), opts: { fitControl: true } }
    });

    // 3 — moles of product, from the one that runs out (on a tie either gives the same)
    const nL = (L === A) ? res.nA : res.nB;
    const lCoef = (L === A) ? res.a : res.b;
    const ratio = frac(String(prod.coef), String(lCoef));
    steps.push({
      instruction: `Find moles of ${fP}.`,
      math: `n(${fP}) = n(${fL}) × ${ratio} = ${sig(nL)} × ${ratio} = ${sig(y.nTheo)} mol`,
      picture: { spec: pictureSpec(s, 'product') }
    });

    // 4 — the unit the question uses
    if (p.unit !== 'mol') {
      steps.push({
        instruction: p.unit === 'mass' ? 'Convert to grams.' : 'Convert to dm³.',
        math: amountMath(y.nTheo, prod.sp, p.unit, p.cond, p.unit === 'mass' ? 'm' : 'V')
      });
    }

    // 5 — the actual question, when it isn't the theoretical yield itself
    if (p.target === 'percent') {
      steps.push({
        instruction: 'Find the percentage yield.',
        math: `% yield = ${frac('actual', 'theoretical')} × 100 = ${frac(sig(y.actual) + ' ' + y.unitLabel, sig(y.theoretical) + ' ' + y.unitLabel)} × 100 = ${sig(y.percent)} %`,
        picture: { spec: pictureSpec(s, 'product', fillOf(y)) }
      });
    } else if (p.target === 'actual') {
      steps.push({
        instruction: 'Find the actual yield.',
        math: `actual = theoretical × ${frac('percentage', '100')} = ${sig(y.theoretical)} × ${frac(sig(y.percent), '100')} = ${sig(y.actual)} ${y.unitLabel}`,
        picture: { spec: pictureSpec(s, 'product', fillOf(y)) }
      });
    }
    return steps;
  }

  // the answer, as a value with its unit
  function answerValue(p, y) {
    return p.target === 'percent' ? `${sig(y.percent)} %`
         : p.target === 'actual' ? `${sig(y.actual)} ${y.unitLabel}`
         : `${sig(y.theoretical)} ${y.unitLabel}`;
  }
  // the picture of the finished problem (with the filled share when a yield was measured)
  function finalPicture(p, opts) {
    const s = solveProblem(p);
    return { spec: pictureSpec(s, 'product', fillOf(s.y)), opts };
  }

  /* ---------------- step blocks ----------------
     One block = number + instruction + the working typed in + the picture, when the step has one.
     Learn appends them one at a time; Practice's "Show the maths" puts them all down at once. */
  const TYPE_START_MS = 250;      // the instruction arrives, then the working
  function addBlock(host, step, i, o) {
    host.insertAdjacentHTML('beforeend',
      `<li class="step-block">
        <div class="step-block__head"><span class="step-num" aria-hidden="true">${i + 1}</span><p class="step-block__title">${step.instruction}</p></div>
        <div class="step-block__math math-typed"></div>
        ${o.pictures && step.picture ? '<div class="step-pic"></div>' : ''}
      </li>`);
    const li = host.lastElementChild;
    const math = li.querySelector('.step-block__math'), pic = li.querySelector('.step-pic');
    let end = o.delay || 0;
    if (o.instant) {
      typewriterMathGrid(math, step.math, { instant: true });
      if (pic) mountPicture(pic, step.picture, { animate: false });
    } else {
      Motion.enter(li.querySelector('.step-block__head'), { delay: end });
      end = typewriterMathGrid(math, step.math, { delay: end + TYPE_START_MS, gap: o.gap });
      if (pic) {                                                           // the balls arrive last
        mountPicture(pic, step.picture, { delay: end + 120 });
        Motion.enter(pic, { y: 4, delay: end + 120 });
      }
    }
    return { li, end };
  }

  /* ---------------- LEARN: a worksheet that grows one step at a time ---------------- */
  const learnSteps = document.getElementById('learn-steps');
  const learnNext = document.getElementById('learn-next');
  const learnBack = document.getElementById('learn-back');
  const learnAll = document.getElementById('learn-all');
  const learnDots = document.getElementById('learn-dots');

  // Motion.swap calls this while the card is still hidden
  function renderLearn() {
    const p = wizardProblem(), s = solveProblem(p);
    state.learn = { steps: stepsFor(p), shown: 0 };
    document.getElementById('learn-eyebrow').innerHTML = `${TARGET_LABEL[p.target]} of ${fmtFormula(s.prod.sp)}`;
    document.getElementById('learnEq').innerHTML = fmtEq(s.q.eq);
    learnSteps.innerHTML = '';
    learnShow(1, false);
  }

  // show blocks until `count` are on the page; returns the first new one
  function learnShow(count, instant) {
    const L = state.learn;
    let first = null;
    while (L.shown < Math.min(count, L.steps.length)) {
      const { li } = addBlock(learnSteps, L.steps[L.shown], L.shown, { instant, pictures: true });
      first = first || li;
      L.shown++;
    }
    const n = L.steps.length, done = L.shown >= n;
    learnNext.textContent = done ? 'See the answer →' : 'Next step →';
    learnAll.hidden = done;
    learnDots.innerHTML = L.steps.map((_, i) => `<i class="${i < L.shown ? 'on' : ''}"></i>`).join('');
    learnDots.setAttribute('aria-label', `Step ${L.shown} of ${n}`);
    return first;
  }

  learnNext.addEventListener('click', () => {
    const L = state.learn;
    if (!L) return;
    if (L.shown >= L.steps.length) { goTo('verdict', 'forward', renderVerdict); return; }
    Motion.scrollIntoView(learnShow(L.shown + 1, false));
  });
  learnAll.addEventListener('click', () => {
    const L = state.learn;
    if (!L) return;
    const first = learnShow(L.steps.length, true);
    learnNext.focus();
    Motion.scrollIntoView(first, 'start');
  });
  learnBack.addEventListener('click', () => {
    const L = state.learn;
    if (!L) return;
    if (L.shown <= 1) { goTo('measure', 'back', renderMeasure); return; }
    learnSteps.lastElementChild.remove();
    L.shown--;
    learnShow(L.shown, false);                      // nothing to add: refreshes the buttons and the dots
  });

  /* ---------------- VERIFY: all the key figures at once ---------------- */
  function renderVerify() {
    const p = wizardProblem(), s = solveProblem(p), { prod, res, y } = s;
    const fA = fmtFormula(s.q.A.sp), fB = fmtFormula(s.q.B.sp), fP = fmtFormula(prod.sp);
    const num = (v, unit) => `<b>${sig(v)}</b> ${unit}`;
    const rows = [
      ['Moles', `n(${fA}) = ${num(res.nA, 'mol')}<span class="dotsep">·</span>n(${fB}) = ${num(res.nB, 'mol')}`],
      ['Runs out first', res.tie ? '<b>Both together</b>' : `<b>${fmtFormula(res.limiting.sp)}</b>`],
      [`Moles of ${fP}`, num(y.nTheo, 'mol')]
    ];
    if (p.unit !== 'mol') rows.push(['Theoretical', num(y.theoretical, y.unitLabel)]);
    if (p.target === 'percent') rows.push(['Actual', num(y.actual, y.unitLabel)], ['Percentage', `<b>${sig(y.percent)} %</b>`]);
    if (p.target === 'actual') rows.push(['Percentage', `<b>${sig(y.percent)} %</b>`], ['Actual', num(y.actual, y.unitLabel)]);
    rows.push(['Answer', `${TARGET_LABEL[p.target]} = <b>${answerValue(p, y)}</b>`]);

    document.getElementById('verify-body').innerHTML = rows.map(([label, html]) =>
      `<div class="vrow"><div class="vlabel">${label}</div><div class="vval">${html}</div></div>`).join('');
    mountPicture(document.getElementById('verify-pic'), finalPicture(p, { size: 'sm' }), { delay: 300 });
  }

  document.getElementById('verify-again').addEventListener('click', () => goTo('measure', 'back', renderMeasure));
  document.getElementById('verify-restart').addEventListener('click', () => goTo('landing', 'back', resetAll));

  /* ---------------- verdict card ---------------- */
  function renderVerdict() {
    const p = wizardProblem(), s = solveProblem(p), { res, y } = s;
    document.getElementById('verdict-headline').innerHTML =
      `${TARGET_LABEL[p.target]}: <span class="chip chip--lim">${answerValue(p, y)}</span>`;
    document.getElementById('verdict-body').innerHTML = res.tie
      ? 'Both run out together.'
      : `${fmtFormula(res.limiting.sp)} limits the yield.`;
    document.getElementById('verdict-flag').hidden = !(p.target === 'percent' && y.percent > 100);
    mountPicture(document.getElementById('verdict-pic'), finalPicture(p), { delay: 300 });
  }

  document.getElementById('verdict-again').addEventListener('click', () => goTo('measure', 'back', renderMeasure));
  document.getElementById('verdict-restart').addEventListener('click', () => goTo('landing', 'back', resetAll));

  /* ---------------- PRACTICE ----------------
     landing → a problem straight away. Practice.make() builds it (generator.js + practice.js); the working
     and the pictures are the very ones Learn uses. In memory only: nothing is stored. */
  const practice = {
    level: 'mixed', recent: [],        // the last five reaction ids, so a problem never repeats at once
    score: { right: 0, total: 0 },
    P: null, right: null               // the problem on screen, and whether Q1 / Q2 were right
  };
  const practiceBody = document.getElementById('practice-problem');
  const practiceScore = document.getElementById('practice-score');
  const LEVELS = ['moles', 'grams', 'mixed'];

  const esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const verdictWord = ok => `<span class="fb-ic" aria-hidden="true">${ok ? '✓' : '✗'}</span><b>${ok ? 'Correct.' : 'Not quite.'}</b>`;
  const pickLabel = (P, pick) => pick === 'tie' ? 'Neither' : fmtFormula((pick === 0 ? P.q.A : P.q.B).sp);

  function syncPracticeBar() {
    document.querySelectorAll('#practice-level button').forEach(b => {
      const on = b.dataset.level === practice.level;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    practiceScore.innerHTML = `<span class="sr-only">Score </span>✓ ${practice.score.right} / ${practice.score.total}`;
  }

  // Motion.swap calls this while the card is still hidden
  function startPractice() {
    state.mode = 'practice';
    newProblem(false);
  }

  function newProblem(animate) {
    const P = Practice.make({ level: practice.level, avoid: practice.recent });
    practice.recent.push(P.id);
    if (practice.recent.length > 5) practice.recent.shift();
    practice.P = P;
    practice.right = [];
    syncPracticeBar();
    practiceBody.innerHTML = problemHtml(P);
    if (animate !== false) Motion.enter(practiceBody);
  }

  function problemHtml(P) {
    const q = P.q, prod = q.products[P.prodIdx];
    const given = (label, text) => `<li class="given"><span class="given-f">${label}</span><span class="given-v">${text}</span></li>`;
    const givens = [
      given(fmtFormula(q.A.sp), Generator.format(P.scenario.givens[0]).text),
      given(fmtFormula(q.B.sp), Generator.format(P.scenario.givens[1]).text)
    ];
    if (P.target === 'percent') givens.push(given('Actual yield', `${P.known.actual} ${UNIT_LABEL[P.unit]}`));
    if (P.target === 'actual') givens.push(given('Percentage yield', `${P.known.percent} %`));
    if (P.unit === 'gas') givens.push(given(P.cond, `${MOLAR_VOL[P.cond].toFixed(1)} dm³ mol⁻¹`));
    const showHint = [P.inA, P.inB].some(inp => inp.method !== 'mol');
    const unit = P.unitLabel;
    return `
      <div class="calc-eq">${fmtEq(q.eq)}</div>
      ${P.scenario.cond ? `<div class="cond-row"><span class="cond-chip">${esc(P.scenario.cond)}</span></div>` : ''}
      <ul class="givens" aria-label="Given">${givens.join('')}</ul>

      <section class="pq" id="pq1">
        <p class="pq-title">Which one runs out first?</p>
        <div class="pq-row">
          <div class="pq-picks" role="group" aria-label="Answer">
            <button class="btn pq-pick" type="button" data-pick="0"><span>${fmtFormula(q.A.sp)}</span></button>
            <button class="btn pq-pick" type="button" data-pick="1"><span>${fmtFormula(q.B.sp)}</span></button>
            <button class="btn pq-pick" type="button" data-pick="tie"><span>Neither</span></button>
          </div>
          ${showHint ? '<button class="btn btn--ghost" type="button" data-hint aria-expanded="false" aria-controls="pq-hint">Hint</button>' : ''}
        </div>
        <p class="pq-hint" id="pq-hint" hidden>n(${fmtFormula(q.A.sp)}) = ${sig(P.scenario.res.nA)} mol<span class="dotsep">·</span>n(${fmtFormula(q.B.sp)}) = ${sig(P.scenario.res.nB)} mol</p>
        <div class="pq-feedback" tabindex="-1" aria-live="polite"></div>
        <div class="pq-pic" hidden></div>
      </section>

      <section class="pq" id="pq2" hidden>
        <p class="pq-title">Find the ${TARGET_LABEL[P.target].toLowerCase()} of ${fmtFormula(prod.sp)}.</p>
        <form class="pq-answer" novalidate>
          <label class="sr-only" for="pq-input">Answer in ${unit}</label>
          <input class="num-input" id="pq-input" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="answer">
          <span class="unit">${unit}</span>
          <button class="btn btn--primary" type="submit">Check</button>
        </form>
        <p class="form-error" id="pq-error" role="alert" hidden>Enter a number.</p>
        <div class="pq-feedback" tabindex="-1" aria-live="polite"></div>
        <div class="pq-pic" hidden></div>
      </section>

      <div class="pq-after" hidden>
        <button class="btn btn--ghost disclosure" type="button" data-maths aria-expanded="false" aria-controls="pq-maths">Show the maths ${Icons.svg('chevron-down')}</button>
        <ol class="step-list pq-maths" id="pq-maths" role="list" hidden></ol>
        <div class="pq-next">
          <button class="btn btn--primary" type="button" data-next>Next problem →</button>
          <button class="btn btn--ghost" type="button" data-steps>Work it step by step</button>
        </div>
      </div>`;
  }

  // Q1 — which one runs out first
  function answerQ1(btn) {
    const P = practice.P, sec = btn.closest('.pq');
    const pick = btn.dataset.pick === 'tie' ? 'tie' : Number(btn.dataset.pick);
    const right = pick === P.limiting;
    practice.right[0] = right;
    sec.querySelectorAll('.pq-pick').forEach(b => {
      const mine = b === btn, answer = String(b.dataset.pick) === String(P.limiting);
      b.disabled = true;
      b.classList.toggle('is-right', mine && right);
      b.classList.toggle('is-wrong', mine && !right);
      b.classList.toggle('is-answer', !mine && answer);
    });
    sec.querySelectorAll('[data-hint], .pq-hint').forEach(el => { el.hidden = true; });
    const s = solveProblem(P);
    const fb = sec.querySelector('.pq-feedback');
    fb.innerHTML = `<p class="fb ${right ? 'fb--ok' : 'fb--no'}">${verdictWord(right)}<span>${P.limiting === 'tie' ? 'Both run out together.' : `${pickLabel(P, P.limiting)} runs out first.`}</span></p>`;
    mountPicture(sec.querySelector('.pq-pic'), { spec: pictureSpec(s, 'compare', { mark: { pick } }) });
    const next = document.getElementById('pq2');
    next.hidden = false;
    Motion.enter(next);
    fb.focus();
  }

  // Q2 — the yield
  function answerQ2(form) {
    const P = practice.P, sec = form.closest('.pq'), input = form.querySelector('input');
    const g = Practice.grade(P, input.value);
    const err = document.getElementById('pq-error');
    if (!g.valid) { err.hidden = false; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    input.readOnly = true;
    input.classList.toggle('is-right', g.ok);
    input.classList.toggle('is-wrong', !g.ok);
    form.querySelector('button').hidden = true;
    practice.right[1] = g.ok;
    practice.score.total++;
    if (practice.right[0] && g.ok) practice.score.right++;
    syncPracticeBar();

    const answer = `<b>${sig(P.expected)} ${P.unitLabel}</b>`;
    const fb = sec.querySelector('.pq-feedback');
    fb.innerHTML = `<p class="fb ${g.ok ? 'fb--ok' : 'fb--no'}">${verdictWord(g.ok)}<span>${g.ok ? answer : `Answer: ${answer}`}</span></p>` +
                   (g.slip ? `<p class="fb-slip">${g.slip}</p>` : '');
    mountPicture(sec.querySelector('.pq-pic'), finalPicture(P));
    const after = practiceBody.querySelector('.pq-after');
    after.hidden = false;
    Motion.enter(after);
    fb.focus();
  }

  // "Show the maths": every step at once, typed in the first time it opens
  function toggleMaths(btn) {
    const host = document.getElementById('pq-maths');
    const open = host.hidden;
    host.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.innerHTML = `${open ? 'Hide the maths' : 'Show the maths'} ${Icons.svg(open ? 'chevron-up' : 'chevron-down')}`;
    if (open && !host.children.length) {
      let t = 0;
      stepsFor(practice.P).forEach((st, i) => { t = addBlock(host, st, i, { instant: false, pictures: false, delay: t, gap: 90 }).end; });
    }
  }

  // "Work it step by step": this problem, as given, in the normal flow
  function loadProblem(P) {
    state.mode = 'learn';
    state.sel = P.q.id;
    state.target = P.target; state.prodIdx = P.prodIdx; state.unit = P.unit; state.gasCond = P.cond;
    state.inA = Object.assign(freshInput(), P.inA); state.inB = Object.assign(freshInput(), P.inB);
    state.known = Object.assign({ actual: '', percent: '' }, P.known);
    beginWorking();
  }

  practiceBody.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !practice.P) return;
    if (b.classList.contains('pq-pick')) answerQ1(b);
    else if (b.hasAttribute('data-hint')) {
      const hint = document.getElementById('pq-hint');
      hint.hidden = !hint.hidden;
      b.setAttribute('aria-expanded', String(!hint.hidden));
    } else if (b.hasAttribute('data-maths')) toggleMaths(b);
    else if (b.hasAttribute('data-next')) { newProblem(); focusProblem(true); }
    else if (b.hasAttribute('data-steps')) loadProblem(practice.P);
  });
  practiceBody.addEventListener('submit', e => {
    e.preventDefault();
    if (practice.P) answerQ2(e.target);
  });
  // the old problem's buttons are gone: keyboard focus goes to the new problem
  function focusProblem(scroll) {
    practiceBody.focus({ preventScroll: true });
    if (scroll) Motion.scrollIntoView(cards.practice, 'start');
  }

  document.querySelectorAll('#practice-level button').forEach(b => b.addEventListener('click', () => {
    if (!LEVELS.includes(b.dataset.level) || b.dataset.level === practice.level) return;
    practice.level = b.dataset.level;
    newProblem();
    focusProblem();
  }));
  document.getElementById('practice-new').addEventListener('click', () => { newProblem(); focusProblem(); });

  /* ---------------- boot ---------------- */
  renderCatalog();
  syncPracticeBar();
  playLandingEntrance();
})();
