// app.js - Chemculator hub
// Renders the tool cards immediately from an embedded list (so they appear on first
// paint, even from file://), then refreshes from apps.json if it can be fetched.
// Also wires the light/dark toggle (shared localStorage key "theme").

(function () {
  'use strict';

  var THEME_KEY = 'theme';

  // Embedded fallback: keep in sync with apps.json.
  var FALLBACK_APPS = [
    { id: 'concentration-trainer', path: 'concentrationtrainer/', verb: 'Chemculate Concentrations',
      description: 'Convert fluently between molarity, molality, % w/w, % v/v, and mole fraction — 20 unit pairs, with guided Learn and Check modes.',
      accent: 'teal', status: 'live' },
    { id: 'stoichiomathics', path: 'stoichiomathics/', verb: 'Chemculate Limiting Reactants',
      description: 'Find the limiting reactant with ratio pictures, three step-by-step methods and practice problems.',
      accent: 'gold', status: 'live' },
    { id: 'yieldcalculator', path: 'yieldcalculator/', verb: 'Chemculate Yields',
      description: 'Find theoretical, actual or percentage yield with ratio pictures, step-by-step working and practice problems.',
      accent: 'lilac', status: 'live' },
    { id: 'chemulator-titration', path: 'chemulator/titration.html', verb: 'Chemulate Titrations',
      description: 'Titrate strong or weak acids against strong or weak bases, watch the pH curve build, and see the ICE-table working at the initial, half-equivalence and equivalence points.',
      accent: 'teal', status: 'live' },
    { id: 'chemulator-emission', path: 'chemulator/', verb: 'Chemulate Emission Spectra',
      description: 'Follow light from a glowing gas tube through a spectrometer, see all five hydrogen series, and add a UV screen or IR viewer to make invisible lines glow.',
      accent: 'lilac', status: 'live' },
    { id: 'orbitalvisualiser', path: 'orbitalvisualiser/', verb: 'Chemulate Orbitals',
      description: 'See how n, l, mₗ and mₛ place an electron — an energy-ordered orbital diagram from 1s to 5p with 3-D orbital shapes, sliced by orbital, subshell or shell.',
      accent: 'gold', status: 'live' }
  ];

  // Effective theme: an explicit data-theme wins, otherwise the OS preference
  // (the CSS handles the OS case itself; this is only for the toggle's label).
  function currentIsDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function updateToggleIcon(btn) {
    var dark = currentIsDark();
    var label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.innerHTML = Icons.svg(dark ? 'sun' : 'moon');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }

  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    updateToggleIcon(btn);
    btn.addEventListener('click', function () {
      var next = currentIsDark() ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
      updateToggleIcon(btn);
    });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', function () { updateToggleIcon(btn); });
    }
  }

  var shownApps = '';
  function renderApps(apps) {
    var grid = document.getElementById('app-grid');
    var key = JSON.stringify(apps);
    if (key === shownApps) return;          // the refresh from apps.json usually changes nothing
    var first = shownApps === '';
    shownApps = key;
    grid.innerHTML = '';

    if (!Array.isArray(apps) || apps.length === 0) {
      grid.innerHTML = '<p class="ds-note">No tools are listed yet.</p>';
      return;
    }

    apps.forEach(function (app) {
      var isLive = app.status === 'live';
      var card = document.createElement(isLive ? 'a' : 'div');
      if (isLive) {
        card.href = app.path;
      } else {
        card.setAttribute('aria-disabled', 'true');
      }
      card.className = 'app-card' + (isLive ? '' : ' app-card--disabled');

      var title = document.createElement('span');
      title.className = 'app-card__title';
      title.textContent = app.verb;

      var desc = document.createElement('span');
      desc.className = 'app-card__desc';
      desc.textContent = app.description;

      var chip = document.createElement('span');
      chip.className = 'ds-chip app-card__chip';
      chip.textContent = isLive ? 'Open tool →' : 'Coming soon';

      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(chip);
      grid.appendChild(card);
    });
    if (first) Motion.stagger(grid.children, { y: 12 });
  }

  // Cards first (synchronous, no hidden state), then quietly refresh from apps.json.
  function loadApps() {
    renderApps(FALLBACK_APPS);
    if (typeof fetch !== 'function') return;
    fetch('apps.json')
      .then(function (res) {
        if (!res.ok) throw new Error('apps.json returned ' + res.status);
        return res.json();
      })
      .then(function (apps) {
        if (Array.isArray(apps) && apps.length) renderApps(apps);
      })
      .catch(function () { /* keep the embedded list */ });
  }

  function init() {
    initThemeToggle();
    loadApps();
  }
  // script is at the end of <body>, so the DOM is ready; render now to avoid any flash
  if (document.getElementById('app-grid')) init();
  else document.addEventListener('DOMContentLoaded', init);

  // exposed for the test suite
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderApps: renderApps };
  }
})();
