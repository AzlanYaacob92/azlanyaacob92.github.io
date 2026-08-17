/* ============================================================================
   app.js  —  presentation layer
   A wizard flow in the Chemculator house style:
     landing ("I want to…") → periodic-table reaction picker → what to
     calculate → which product / which unit → measurements → branch:
        Learn    — one step-combo card at a time, stacked equations revealed
                   line by line with a typewriter wipe; formula first, then
                   substitution, then the result.
        Verify   — answers only, on a single worksheet card.
   The limiting reactant is found silently and simply stated: this app is
   about yield, and the limiting-reactant working belongs to Stoichiomathics.
   Depends on chemistry.js (AM, CAT, QUAL, MOLAR_VOL, fmtEq, fmtFormula,
   molarMass, massParts, computeLimiting, solveYield). All chemistry stays
   in chemistry.js.
   ========================================================================== */

/* ---------------- theme toggle ----------------
   Independent of the main IIFE below — it only flips the data-theme
   attribute the dark-mode CSS variables key off, and remembers the choice. */
(function () {
  const toggleBtn = document.getElementById('theme-toggle');
  const icon = document.getElementById('theme-toggle-icon');
  if (!toggleBtn) return;
  const root = document.documentElement;

  function isDark() { return root.getAttribute('data-theme') === 'dark'; }

  function reflect() {
    const dark = isDark();
    toggleBtn.setAttribute('aria-pressed', String(dark));
    toggleBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    if (icon) icon.textContent = dark ? '☀️' : '🌙';
  }

  reflect(); // match whatever the inline head script already applied

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

  /* ---------------- reduced motion ---------------- */
  let prefersReducedMotion = false;
  try {
    prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (e) { /* matchMedia unavailable — treat as full motion */ }

  /* ---------------- animation helpers ----------------
     Every pan pairs a real CSS animation with a timed fallback, so
     navigation never gets stuck. */
  function onAnimEnd(el, fallbackMs, cb) {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      el.removeEventListener('animationend', onEnd);
      clearTimeout(timer);
      cb();
    }
    function onEnd(e) { if (e.target === el) finish(); }
    el.addEventListener('animationend', onEnd);
    const timer = setTimeout(finish, fallbackMs);
  }

  function enterCard(el, direction) {
    if (!el) return;
    el.hidden = false;
    if (prefersReducedMotion) return;
    const cls = direction === 'back' ? 'anim-pan-in-left' : 'anim-pan-in-right';
    el.classList.remove('anim-pan-in-left', 'anim-pan-in-right');
    void el.offsetWidth;
    el.classList.add(cls);
    onAnimEnd(el, 700, () => el.classList.remove(cls));
  }

  function exitCard(el, direction, cb) {
    if (!el) { if (cb) cb(); return; }
    if (prefersReducedMotion) { el.hidden = true; if (cb) cb(); return; }
    const cls = direction === 'back' ? 'anim-pan-out-right' : 'anim-pan-out-left';
    el.classList.remove('anim-pan-out-left', 'anim-pan-out-right');
    void el.offsetWidth;
    el.classList.add(cls);
    onAnimEnd(el, 550, () => {
      el.hidden = true;
      el.classList.remove(cls);
      if (cb) cb();
    });
  }

  // The one wizard transition primitive: pan `fromEl` out (if any), run
  // `updateFn`, then pan `toEl` in. fromEl and toEl may be the same element,
  // refreshed in place.
  function panTransition(fromEl, toEl, direction, updateFn) {
    function doEnter() {
      if (updateFn) updateFn();
      enterCard(toEl, direction);
    }
    if (fromEl) exitCard(fromEl, direction, doEnter);
    else doEnter();
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

  function typewriterMathGrid(el, html) {
    el.innerHTML = mathGrid(html);
    if (prefersReducedMotion) return;
    try {
      const grid = el.querySelector('.eqgrid');
      if (!grid) return;
      const rowsEls = Array.from(grid.querySelectorAll('.eq-row'));
      let delay = 0;
      rowsEls.forEach(rowEl => {
        const len = Math.max(rowEl.textContent.length, 4);
        const steps = Math.max(10, Math.min(60, Math.round(len * 1.4)));
        const duration = steps * 26; // ms — consistent typing speed regardless of line length
        rowEl.classList.add('typewipe');
        rowEl.style.setProperty('--tw-steps', steps);
        rowEl.style.animationDuration = duration + 'ms';
        rowEl.style.animationDelay = delay + 'ms';
        delay += duration + 160;
      });
    } catch (e) { /* content already shown; animation is best-effort */ }
  }

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
  function freshInput() { return { method: "mass", mass: "", conc: "", cvol: "", cvolUnit: "cm3", gvol: "", gvolUnit: "dm3", cond: "RTP" }; }
  const state = {
    mode: null,             // 'learn' | 'verify'
    cat: "all", els: new Set(), matchMode: "all", query: "",
    sel: null,              // a QUAL index, or the string 'custom'
    target: null,           // 'theoretical' | 'percent' | 'actual' — the unknown
    prodIdx: 0,             // which product of the chosen reaction the yield is about
    unit: 'mass',           // 'mass' | 'gas' | 'mol' — how that yield is measured
    gasCond: 'RTP',         // molar-volume convention, only when unit === 'gas'
    inA: freshInput(), inB: freshInput(),
    known: { actual: '', percent: '' },  // whichever figure the question supplies
    learn: null,            // { steps, idx, calcShown }
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
    verdict: document.getElementById('card-verdict')
  };
  const backLink = document.getElementById('back-link');
  let current = 'landing';

  function goTo(key, direction, updateFn) {
    const from = cards[current], to = cards[key];
    current = key;
    backLink.hidden = (key === 'landing');
    panTransition(from === to ? null : from, to, direction || 'forward', updateFn);
    if (to && to.scrollIntoView && key !== 'landing') {
      setTimeout(() => { try { to.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) {} }, 60);
    }
  }

  function resetAll() {
    state.mode = null; state.sel = null; state.target = null;
    state.prodIdx = 0; state.unit = 'mass'; state.gasCond = 'RTP';
    state.inA = freshInput(); state.inB = freshInput();
    state.known = { actual: '', percent: '' };
    state.learn = null;
    state.customCount = 1; state.customFields = null; state.customQ = null;
    renderCatalog();
  }

  backLink.addEventListener('click', () => {
    goTo('landing', 'back', resetAll);
  });

  /* ---------------- landing ---------------- */
  document.querySelectorAll('[data-choose]').forEach(btn => btn.addEventListener('click', () => {
    state.mode = btn.dataset.choose;
    goTo('picker', 'forward');
  }));

  // gentle entrance: lead line pans in, choice cards grow in with a stagger
  function playLandingEntrance() {
    if (prefersReducedMotion) return;
    const lead = document.getElementById('hero-lead');
    if (lead) lead.classList.add('anim-hero-in');
    document.querySelectorAll('.choice-card').forEach((c, i) => {
      c.classList.add('anim-grow-in');
      c.style.animationDelay = (120 + i * 110) + 'ms';
    });
  }

  /* ---------------- picker: periodic table ---------------- */
  const ptable = document.getElementById('ptable');
  PT.forEach(([sym, z, p, g]) => {
    const cell = document.createElement('div');
    const on = ACTIVE.has(sym);
    cell.className = 'cell ' + (on ? 'on' : 'off');
    cell.style.gridColumn = g; cell.style.gridRow = p;
    cell.dataset.sym = sym;
    cell.innerHTML = '<span class="z">' + z + '</span>' + sym;
    if (on) cell.addEventListener('click', () => toggleEl(sym));
    ptable.appendChild(cell);
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
      if (!picked) c.classList.add('on');
    });
    const sc = document.getElementById('selchips');
    sc.innerHTML = [...state.els].sort((a, b) => ZBY[a] - ZBY[b]).map(s =>
      `<button class="selchip" data-rm="${s}" type="button">${s}<span>×</span></button>`).join('');
    sc.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => toggleEl(b.dataset.rm)));

    const filtering = state.els.size > 0 || state.query.trim().length > 0;
    const list = document.getElementById('list');
    const count = document.getElementById('count');

    const notListedCard = `<div class="rx rx--custom" id="rx-not-listed">
      <div class="idx">+</div>
      <div class="rxbody">
        <div class="eq">My reaction is not listed</div>
        <div class="meta"><span class="cond">Build your own equation and use the same working</span></div>
      </div>
      <div class="pick">Build →</div>
    </div>`;
    function wireNotListed() {
      const el = document.getElementById('rx-not-listed');
      if (el) el.addEventListener('click', goToCustomSetup);
    }

    if (!filtering) {
      count.innerHTML = '';
      list.innerHTML = '<div class="empty">Search a species or formula above, or tap one or more <b>lit elements</b> in the table below to surface a matching reaction — then pick it to continue.<br><span class="empty-faint">Dim elements don’t appear in any two-reactant reaction.</span></div>' + notListedCard;
      wireNotListed();
      return;
    }

    const out = QUAL.filter(catalogPass);
    count.innerHTML = out.length ? `<b>${out.length}</b> matching reaction${out.length > 1 ? 's' : ''}` : '';
    if (!out.length) {
      const query = state.query.trim();
      const queryDisplay = query.split(/\s+\+\s+/).map(t => t.trim()).filter(Boolean).map(fmtFormula).join(' + ');
      const reason = query
        ? `No two-reactant reaction matches <b>${queryDisplay}</b>${state.els.size ? ' with that element combination' : ''}`
        : 'No two-reactant reaction contains ' + (state.matchMode === 'all' && state.els.size > 1 ? '<b>all</b> of those elements together' : 'that combination');
      list.innerHTML = `<div class="empty">${reason}.<br>Try <b>Match any</b>, remove an element, clear the search, or clear the filters.</div>` + notListedCard;
      wireNotListed();
      return;
    }
    list.innerHTML = out.map(q => {
      const c = CAT[q.cat];
      return `<div class="rx" data-id="${q.id}">
        <div class="idx">${q.id + 1}</div>
        <div class="rxbody">
          <div class="eq">${fmtEq(q.eq)}</div>
          <div class="meta">
            <span class="tag" style="background:${c.color}22;color:${c.color};border:1px solid ${c.color}55">${c.label}</span>
            ${q.cond ? `<span class="cond">${q.cond}</span>` : ''}
            ${q.hadSpect ? `<span class="cond cond--warn">H⁺/OH⁻ omitted</span>` : ''}
          </div>
        </div>
        <div class="pick">Use →</div>
      </div>`;
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
     Reactants stay fixed at two, matching the two-reactant limiting-reactant
     engine. Product count (1–4) is free — and unlike Stoichiomathics every
     product needs a real molar mass here, since the yield may be asked for
     in grams or dm³ of any one of them. Nothing here is persisted: the built
     reaction lives in state.customQ for this session only. */
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
  // elements are all recognised. Unlike Stoichiomathics, products need a
  // molar mass too — a yield in grams or dm³ depends on it.
  function validateField(f, label) {
    const name = (f.name || '').trim();
    if (!name) return `Enter a formula for ${label}.`;
    if (!FORMULA_RE.test(name)) return `${label}'s formula (“${name}”) has a character that doesn't belong in a chemical formula.`;
    const comp = composition(name);
    if (!Object.keys(comp).length) return `${label}'s formula (“${name}”) doesn't look like a valid formula.`;
    if (molarMass(name) == null) {
      const bad = Object.keys(comp).find(el => !(el in AM));
      return `${label}'s formula (“${name}”) contains an element symbol${bad ? ` (“${bad}”)` : ''} that isn't recognised — check the spelling and capitalisation.`;
    }
    const coefN = Number(f.coef);
    if (!(Number.isInteger(coefN) && coefN >= 1)) return `${label}'s ratio number must be a whole number of 1 or more.`;
    return null;
  }

  /* A yield is read straight off the mole ratio, so an unbalanced equation
     gives a confidently wrong theoretical yield. Count atoms on each side
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
    const detail = off.map(x => `${x.el}: ${x.l} on the left, ${x.r} on the right`).join('; ');
    return `That equation isn't balanced yet — ${detail}. ` +
           `The theoretical yield comes straight from the mole ratio, so the ` +
           `ratio numbers have to balance first. Adjust them and try again.`;
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
    document.getElementById('product-question').innerHTML =
      `Which product is the ${TARGET_LABEL[state.target].toLowerCase()} about?`;
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
    document.getElementById('product-gas-note').innerHTML = state.unit === 'gas'
      ? `<div class="custom-side-label">Molar gas volume</div>
         <div class="seg seg--wide" id="gascond-seg" role="group" aria-label="Molar gas volume convention">
           ${[['RTP', 'RTP · 24.0 dm³ mol⁻¹'], ['STP', 'STP · 22.4 dm³ mol⁻¹']].map(([v, l]) =>
             `<button type="button" data-cond="${v}" class="${state.gasCond === v ? 'active' : ''}">${l}</button>`).join('')}
         </div>
         <div class="note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
           <span>Only meaningful if <b>${fmtFormula(currentProduct().sp)}</b> really is a gas under these conditions — check that before using a gas volume.</span></div>`
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
    const opts = [['mass', 'Mass (g)'], ['conc', 'Molarity × volume'], ['gas', 'Gas volume']];
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
      const M = molarMass(sp);
      return `<div class="hint">moles = mass ÷ M<sub>r</sub> &nbsp;·&nbsp; M<sub>r</sub> = ${mm1(M)} g mol⁻¹</div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="mass" value="${inp.mass}" data-side="${side}" data-role="mass"><span class="unit">g</span></div>`;
    }
    if (inp.method === 'conc') {
      return `<div class="hint">moles = molarity × volume</div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="molarity" value="${inp.conc}" data-side="${side}" data-role="conc"><span class="unit">mol dm⁻³</span></div>
        <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="volume" value="${inp.cvol}" data-side="${side}" data-role="cvol">
          ${volUnitSelect(side, 'cvolUnit', inp.cvolUnit, 'cm3')}</div>`;
    }
    return `<div class="hint">moles = gas volume ÷ molar volume</div>
      <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="gas volume" value="${inp.gvol}" data-side="${side}" data-role="gvol">
        ${volUnitSelect(side, 'gvolUnit', inp.gvolUnit, 'dm3')}</div>
      <div class="massrow"><select class="uSel select wide" data-side="${side}" data-role="cond"><option value="RTP" ${inp.cond === 'RTP' ? 'selected' : ''}>RTP · 24.0 dm³ mol⁻¹</option><option value="STP" ${inp.cond === 'STP' ? 'selected' : ''}>STP · 22.4 dm³ mol⁻¹</option></select></div>`;
  }

  function renderMeasure() {
    const q = currentQ(), prod = currentProduct();
    document.getElementById('measureEq').innerHTML = fmtEq(q.eq);
    document.getElementById('measureNote').innerHTML =
      `<div class="note"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>
        <span>Both reactant amounts are needed so the limiting reactant can be worked out — that's what fixes the yield of <b>${fmtFormula(prod.sp)}</b>.${q.hadSpect ? ' H⁺ (or OH⁻) is supplied in excess and is not compared.' : ''}</span></div>`;
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
     the percentage is unknown, or the percentage when the actual is. A
     theoretical yield needs neither — the reactants alone fix it. */
  function renderKnownInput() {
    const wrap = document.getElementById('knownWrap');
    const prod = currentProduct();
    const f = fmtFormula(prod.sp);
    if (state.target === 'theoretical') { wrap.innerHTML = ''; return; }
    if (state.target === 'percent') {
      wrap.innerHTML = `<div class="custom-side-label">Actual yield — what you really collected</div>
        <div class="massfield">
          <div class="who">${f}</div>
          <div class="hint">The measured amount of product from the experiment.</div>
          <div class="massrow"><input class="num-input" type="number" min="0" step="any" inputmode="decimal" placeholder="actual yield" value="${state.known.actual}" data-known="actual"><span class="unit">${UNIT_LABEL[state.unit]}</span></div>
        </div>`;
    } else {
      wrap.innerHTML = `<div class="custom-side-label">Percentage yield — given in the question</div>
        <div class="massfield">
          <div class="who">${f}</div>
          <div class="hint">The percentage of the theoretical maximum this reaction actually gives.</div>
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

  /* amount → moles */
  function molesOf(inp, sp) {
    if (inp.method === 'mass') { const m = parseFloat(inp.mass), M = molarMass(sp); return (m > 0) ? m / M : NaN; }
    if (inp.method === 'conc') { const c = parseFloat(inp.conc); let V = parseFloat(inp.cvol); if (!(c > 0) || !(V > 0)) return NaN; if (inp.cvolUnit === 'cm3') V /= 1000; return c * V; }
    if (inp.method === 'gas') { let V = parseFloat(inp.gvol); if (!(V > 0)) return NaN; if (inp.gvolUnit === 'cm3') V /= 1000; return V / MOLAR_VOL[inp.cond]; }
    return NaN;
  }

  document.getElementById('measure-back').addEventListener('click', () => {
    goTo('product', 'back', renderProductSelect);
  });

  document.getElementById('measure-continue').addEventListener('click', () => {
    const q = currentQ();
    const nA = molesOf(state.inA, q.A.sp), nB = molesOf(state.inB, q.B.sp);
    const err = document.getElementById('measure-error');
    if (!(isFinite(nA) && nA > 0 && isFinite(nB) && nB > 0)) {
      err.textContent = 'Enter a positive amount for both reactants — choose Mass, Molarity × volume, or Gas volume for each.';
      err.hidden = false;
      return;
    }
    if (state.target === 'percent') {
      const a = parseFloat(state.known.actual);
      if (!(isFinite(a) && a > 0)) {
        err.textContent = `Enter the actual yield you collected, in ${UNIT_LABEL[state.unit]} — that's what the percentage is measured against.`;
        err.hidden = false; return;
      }
    }
    if (state.target === 'actual') {
      const p = parseFloat(state.known.percent);
      if (!(isFinite(p) && p > 0)) {
        err.textContent = 'Enter the percentage yield given in the question, as a number greater than 0.';
        err.hidden = false; return;
      }
    }
    err.hidden = true;
    beginWorking();
  });

  /* ---------------- the solved result, in one place ---------------- */
  function computed() {
    const q = currentQ(), prod = currentProduct();
    const nA = molesOf(state.inA, q.A.sp), nB = molesOf(state.inB, q.B.sp);
    const res = computeLimiting(q, nA, nB);
    const known = { actual: parseFloat(state.known.actual), percent: parseFloat(state.known.percent) };
    const y = solveYield(res, prod, state.target, state.unit, state.gasCond, known);
    return { q, prod, res, y };
  }

  function beginWorking() {
    if (state.mode === 'verify') { goTo('verify', 'forward', renderVerify); return; }
    state.learn = { steps: buildLearnSteps(), idx: 0, calcShown: false };
    goTo('learn', 'forward', renderLearnStep);
  }

  /* ---------------- shared working fragments ---------------- */
  function moleMath(inp, sp, n) {
    const f = fmtFormula(sp);
    if (inp.method === 'mass') {
      const m = parseFloat(inp.mass), M = molarMass(sp);
      return `n(${f}) = ${frac('m', 'M<sub>r</sub>')} = ${frac(sig(m) + ' g', mm1(M) + ' g mol⁻¹')} = ${sig(n)} mol`;
    }
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

  function moleStrategy(inp, sp) {
    const f = fmtFormula(sp);
    if (inp.method === 'mass') return `The amount of ${f} is given as a mass, so divide by its molar mass: n = m ÷ M<sub>r</sub>.`;
    if (inp.method === 'conc') return `The amount of ${f} is given as a solution, so multiply molarity by volume (in dm³): n = M × V.`;
    return `The amount of ${f} is a gas volume, so divide by the molar gas volume: n = V ÷ V<sub>m</sub>.`;
  }
  function moleFootnote(inp) {
    if (inp.method === 'conc' && inp.cvolUnit === 'cm3') return 'The volume was entered in cm³ (mL) — convert to dm³ (L) by dividing by 1000 before multiplying.';
    if (inp.method === 'gas') {
      const base = inp.cond === 'RTP' ? 'RTP: 24.0 dm³ mol⁻¹ (room temperature and pressure)' : 'STP: 22.4 dm³ mol⁻¹ (standard temperature and pressure)';
      return (inp.gvolUnit === 'cm3' ? 'The gas volume was entered in cm³ (mL) — convert to dm³ (L) by dividing by 1000. ' : '') + 'Molar volume at ' + base + '.';
    }
    return null;
  }
  function moleStrategyCombined(inpA, spA, inpB, spB) {
    const fA = fmtFormula(spA), fB = fmtFormula(spB);
    if (inpA.method === inpB.method) {
      const how = inpA.method === 'mass' ? `given as a mass, so divide each by its molar mass: n = m ÷ M<sub>r</sub>`
                : inpA.method === 'conc' ? `given as a solution, so multiply molarity by volume (in dm³): n = M × V`
                : `a gas volume, so divide by the molar gas volume: n = V ÷ V<sub>m</sub>`;
      return `Both amounts are ${how} — do this for ${fA} first, then ${fB}.`;
    }
    return `${moleStrategy(inpA, spA)} ${moleStrategy(inpB, spB)}`;
  }
  function moleFootnoteCombined(inpA, inpB) {
    return [moleFootnote(inpA), moleFootnote(inpB)].filter(Boolean).join(' ') || null;
  }

  /* molar-mass working for one species — one term per element */
  function mmMath(sp) {
    const parts = massParts(sp), M = molarMass(sp);
    const formula = parts.map(p => (p.n > 1 ? p.n + 'A<sub>r</sub>(' + p.el + ')' : 'A<sub>r</sub>(' + p.el + ')')).join(' + ');
    const subst = parts.map(p => (p.n > 1 ? p.n + ' × ' + mm1(p.a) : mm1(p.a))).join(' + ');
    return `M<sub>r</sub>(${fmtFormula(sp)}) = ${formula} = ${subst} = ${mm1(M)} g mol⁻¹`;
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

  /* ---------------- LEARN: build the step list ---------------- */
  function buildLearnSteps() {
    const { q, prod, res, y } = computed();
    const A = q.A, B = q.B;
    const fA = fmtFormula(A.sp), fB = fmtFormula(B.sp), fP = fmtFormula(prod.sp);
    const steps = [];

    // 1 — molar masses, for whichever species actually need one: reactants
    // entered by mass, plus the product if the yield is a mass.
    const needMM = [];
    if (state.inA.method === 'mass') needMM.push(A.sp);
    if (state.inB.method === 'mass') needMM.push(B.sp);
    if (state.unit === 'mass' && !needMM.includes(prod.sp)) needMM.push(prod.sp);
    if (needMM.length) {
      const names = needMM.map(fmtFormula);
      steps.push({
        instruction: `Work out the molar mass${needMM.length > 1 ? 'es' : ''} of ${names.join(' and ')}.`,
        strategy: 'Add up the relative atomic masses of every atom in each formula — multiply by the subscript where an element appears more than once.',
        math: needMM.map(mmMath).join('<br>')
      });
    }

    // 2 — moles of both reactants
    steps.push({
      instruction: `Convert the amounts of ${fA} and ${fB} to moles.`,
      strategy: moleStrategyCombined(state.inA, A.sp, state.inB, B.sp),
      footnote: moleFootnoteCombined(state.inA, state.inB),
      math: `${moleMath(state.inA, A.sp, res.nA)}<br>${moleMath(state.inB, B.sp, res.nB)}`
    });

    // 3 — the limiting reactant, stated rather than derived. Working it out
    // is Stoichiomathics' job; here it's just the fact the yield hangs off.
    const L = res.limiting || A;
    const fL = fmtFormula(L.sp);
    steps.push({
      instruction: res.tie ? 'Both reactants run out together.' : `${fL} is the limiting reactant.`,
      strategy: res.tie
        ? `Comparing n ÷ coefficient for each reactant gives the same value, so neither is in excess — either one fixes how much ${fP} can form.`
        : `Comparing n ÷ coefficient for each reactant, ${fL} gives the smaller value, so it runs out first and fixes how much ${fP} can form. ${fmtFormula(res.excess.sp)} is left in excess.`,
      footnote: 'This app states the limiting reactant rather than deriving it — for that working step by step, use Chemculate Limiting Reactant.',
      math: `${frac(`n(${fA})`, String(res.a))} = ${sig(res.nA / res.a)} mol<br>` +
            `${frac(`n(${fB})`, String(res.b))} = ${sig(res.nB / res.b)} mol<br>` +
            `limiting = ${res.tie ? 'neither — exactly stoichiometric' : fL}`
    });

    // 4 — theoretical moles of the product, from the limiting reactant
    const nL = (L === A) ? res.nA : res.nB;
    const lCoef = (L === A) ? res.a : res.b;
    const ratio = frac(String(prod.coef), String(lCoef));
    steps.push({
      instruction: `Find the theoretical amount of ${fP} in moles.`,
      strategy: `From the balanced equation, ${fL} and ${fP} are in the ratio ${lCoef} : ${prod.coef} — every ${lCoef} mol of ${fL} makes ${prod.coef} mol of ${fP}. Multiply the moles of the limiting reactant by that ratio to get the most ${fP} the reaction could give.`,
      math: `${frac(`n(${fP})`, `n(${fL})`)} = ${ratio}<br>` +
            `n(${fP}) = n(${fL}) × ${ratio} = ${sig(nL)} × ${ratio} = ${sig(y.nTheo)} mol`
    });

    // 5 — express that theoretical amount in the unit the question uses
    if (state.unit !== 'mol') {
      steps.push({
        instruction: `Convert the theoretical yield to ${state.unit === 'mass' ? 'grams' : 'a gas volume'}.`,
        strategy: state.unit === 'mass'
          ? `Multiply the moles of ${fP} by its molar mass: m = n × M<sub>r</sub>.`
          : `Multiply the moles of ${fP} by the molar gas volume: V = n × V<sub>m</sub>.`,
        footnote: state.unit === 'gas'
          ? `Molar volume at ${state.gasCond === 'RTP' ? 'RTP: 24.0 dm³ mol⁻¹ (room temperature and pressure)' : 'STP: 22.4 dm³ mol⁻¹ (standard temperature and pressure)'}.`
          : null,
        math: amountMath(y.nTheo, prod.sp, state.unit, state.gasCond, 'theoretical')
      });
    }

    // 6 — the actual question, when it isn't the theoretical yield itself
    if (state.target === 'percent') {
      steps.push({
        instruction: 'Work out the percentage yield.',
        strategy: `The percentage yield compares what you really collected with the theoretical maximum: divide the actual yield by the theoretical yield and multiply by 100. Both must be in the same unit — here, ${y.unitLabel}.`,
        math: `percentage yield = ${frac('actual', 'theoretical')} × 100<br>` +
              `= ${frac(sig(y.actual) + ' ' + y.unitLabel, sig(y.theoretical) + ' ' + y.unitLabel)} × 100 = ${sig(y.percent)} %`
      });
    } else if (state.target === 'actual') {
      steps.push({
        instruction: 'Work out the actual yield.',
        strategy: `The percentage yield tells you what fraction of the theoretical maximum this reaction really gives. Multiply the theoretical yield by that percentage and divide by 100.`,
        math: `actual = theoretical × ${frac('percentage', '100')}<br>` +
              `= ${sig(y.theoretical)} × ${frac(sig(y.percent), '100')} = ${sig(y.actual)} ${y.unitLabel}`
      });
    }

    return steps;
  }

  const learnEyebrow = document.getElementById('learn-eyebrow');
  const learnInstruction = document.getElementById('learn-instruction');
  const learnStrategy = document.getElementById('learn-strategy');
  const learnFootnote = document.getElementById('learn-footnote');
  const learnMath = document.getElementById('learn-math');
  const learnNext = document.getElementById('learn-next');

  function renderLearnStep() {
    const { steps, idx } = state.learn;
    const s = steps[idx];
    learnEyebrow.textContent = `Step ${idx + 1} of ${steps.length}`;
    learnInstruction.innerHTML = s.instruction;
    learnStrategy.innerHTML = s.strategy;
    if (s.footnote) { learnFootnote.innerHTML = s.footnote; learnFootnote.hidden = false; }
    else { learnFootnote.hidden = true; }
    learnMath.innerHTML = '';
    learnNext.textContent = 'Show the calculation';
    state.learn.calcShown = false;
  }

  learnNext.addEventListener('click', () => {
    if (!state.learn) return;
    const { steps, idx, calcShown } = state.learn;
    if (!calcShown) {
      typewriterMathGrid(learnMath, steps[idx].math);
      state.learn.calcShown = true;
      const isLast = idx === steps.length - 1;
      learnNext.textContent = isLast ? 'Reveal the answer' : 'Next step →';
      return;
    }
    if (idx + 1 < steps.length) {
      panTransition(cards.learn, cards.learn, 'forward', () => {
        state.learn.idx = idx + 1;
        renderLearnStep();
      });
    } else {
      goTo('verdict', 'forward', renderVerdict);
    }
  });

  /* ---------------- VERIFY: answers only ---------------- */
  function renderVerify() {
    const { q, prod, res, y } = computed();
    const A = q.A, B = q.B;
    const fA = fmtFormula(A.sp), fB = fmtFormula(B.sp), fP = fmtFormula(prod.sp);
    const rows = [];

    const needMM = [];
    if (state.inA.method === 'mass') needMM.push(A.sp);
    if (state.inB.method === 'mass') needMM.push(B.sp);
    if (state.unit === 'mass' && !needMM.includes(prod.sp)) needMM.push(prod.sp);
    if (needMM.length) {
      rows.push(['Molar mass' + (needMM.length > 1 ? 'es' : ''),
        needMM.map(sp => `M<sub>r</sub>(${fmtFormula(sp)}) = <b>${mm1(molarMass(sp))}</b> g mol⁻¹`).join('<span class="dotsep">·</span>')]);
    }
    rows.push(['Moles of reactants', `n(${fA}) = <b>${sig(res.nA)}</b> mol<span class="dotsep">·</span>n(${fB}) = <b>${sig(res.nB)}</b> mol`]);
    rows.push(['Limiting reactant', res.tie
      ? `<b>Neither — exactly stoichiometric</b>`
      : `<b>${fmtFormula(res.limiting.sp)}</b><span class="dotsep">·</span>Excess: ${fmtFormula(res.excess.sp)} (${sig(res.leftMol)} mol left over)`]);
    rows.push([`Mole ratio to ${fP}`, `${fmtFormula((res.limiting || A).sp)} : ${fP} = <b>${(res.limiting === B) ? res.b : res.a} : ${prod.coef}</b>`]);
    rows.push(['Theoretical yield', `<b>${sig(y.nTheo)}</b> mol` +
      (state.unit !== 'mol' ? `<span class="dotsep">·</span><b>${sig(y.theoretical)}</b> ${y.unitLabel}` : '')]);

    if (state.target === 'percent') {
      rows.push(['Actual yield (given)', `<b>${sig(y.actual)}</b> ${y.unitLabel}`]);
      rows.push(['Percentage yield', `<b>${sig(y.percent)} %</b>`]);
    } else if (state.target === 'actual') {
      rows.push(['Percentage yield (given)', `<b>${sig(y.percent)} %</b>`]);
      rows.push(['Actual yield', `<b>${sig(y.actual)}</b> ${y.unitLabel}`]);
    }
    rows.push(['Answer', answerLine(y, prod)]);

    document.getElementById('verify-title').innerHTML = `${TARGET_LABEL[state.target]} of ${fP}`;
    document.getElementById('verify-body').innerHTML = rows.map(([label, html]) =>
      `<div class="vrow"><div class="vlabel">${label}</div><div class="vval">${html}</div></div>`).join('');
  }

  document.getElementById('verify-again').addEventListener('click', () => goTo('measure', 'back', renderMeasure));
  document.getElementById('verify-restart').addEventListener('click', () => goTo('landing', 'back', resetAll));

  /* ---------------- verdict card ---------------- */
  function answerLine(y, prod) {
    const fP = fmtFormula(prod.sp);
    if (state.target === 'percent') return `Percentage yield of ${fP} = <b>${sig(y.percent)} %</b>`;
    if (state.target === 'actual') return `Actual yield of ${fP} = <b>${sig(y.actual)} ${y.unitLabel}</b>`;
    return `Theoretical yield of ${fP} = <b>${sig(y.theoretical)} ${y.unitLabel}</b>`;
  }

  function renderVerdict() {
    const { q, prod, res, y } = computed();
    const head = document.getElementById('verdict-headline');
    const body = document.getElementById('verdict-body');
    const fP = fmtFormula(prod.sp);
    const fL = res.tie ? null : fmtFormula(res.limiting.sp);

    const value = state.target === 'percent' ? `${sig(y.percent)} %`
                : state.target === 'actual' ? `${sig(y.actual)} ${y.unitLabel}`
                : `${sig(y.theoretical)} ${y.unitLabel}`;
    head.innerHTML = `${TARGET_LABEL[state.target]}: <span class="chip chip--lim">${value}</span>`;

    const limSentence = res.tie
      ? `Both reactants run out together, so either one fixes the yield.`
      : `<b>${fL}</b> is the limiting reactant, so it fixes how much ${fP} can form.`;

    if (state.target === 'theoretical') {
      body.innerHTML = `${limSentence} At most <b>${sig(y.theoretical)} ${y.unitLabel}</b> ` +
        `(${sig(y.nTheo)} mol) of ${fP} could be made — assuming the reaction goes to completion and nothing is lost.`;
    } else if (state.target === 'percent') {
      const over = y.percent > 100;
      body.innerHTML = `${limSentence} The theoretical maximum is <b>${sig(y.theoretical)} ${y.unitLabel}</b>, ` +
        `and you collected <b>${sig(y.actual)} ${y.unitLabel}</b> — that's <b>${sig(y.percent)} %</b> of what was possible. ` +
        (over
          ? `A yield above 100 % isn't chemically possible, so something is off with the measurement — the product may still be wet or impure, or the actual yield may be mis-recorded.`
          : `The shortfall is normal: product is lost in transfers, filtration and purification, and few reactions truly go to completion.`);
    } else {
      body.innerHTML = `${limSentence} The theoretical maximum is <b>${sig(y.theoretical)} ${y.unitLabel}</b>, ` +
        `so at <b>${sig(y.percent)} %</b> yield you would really collect about <b>${sig(y.actual)} ${y.unitLabel}</b> ` +
        `(${sig(y.nActual)} mol) of ${fP}.`;
    }
  }

  document.getElementById('verdict-again').addEventListener('click', () => goTo('measure', 'back', renderMeasure));
  document.getElementById('verdict-restart').addEventListener('click', () => goTo('landing', 'back', resetAll));

  /* ---------------- boot ---------------- */
  renderCatalog();
  playLandingEntrance();
})();
