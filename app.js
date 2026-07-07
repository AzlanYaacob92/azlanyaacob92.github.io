// app.js — Chemculator hub
// Responsibilities: fetch apps.json, render the tool cards, and wire the
// light/dark toggle (shared localStorage key so the choice persists as
// someone clicks through into concentrationtrainer/ or stoichiomathics/).

(function () {
  'use strict';

  var THEME_KEY = 'theme';

  function currentIsDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function updateToggleIcon(btn) {
    btn.textContent = currentIsDark() ? '☀️' : '🌙';
  }

  function initThemeToggle() {
    var btn = document.getElementById('theme-toggle');
    if (!btn) return;
    updateToggleIcon(btn);
    btn.addEventListener('click', function () {
      if (currentIsDark()) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem(THEME_KEY, 'light'); } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        try { localStorage.setItem(THEME_KEY, 'dark'); } catch (e) {}
      }
      updateToggleIcon(btn);
    });
  }

  function renderApps(apps) {
    var grid = document.getElementById('app-grid');
    grid.innerHTML = '';

    if (!Array.isArray(apps) || apps.length === 0) {
      grid.innerHTML = '<p class="form-error">No tools are listed in apps.json yet.</p>';
      return;
    }

    apps.forEach(function (app, i) {
      var card = document.createElement('a');
      card.href = app.path;
      card.className = 'choice-card choice-card--' + app.accent;
      card.style.animationDelay = (i * 0.08) + 's';

      var verb = document.createElement('span');
      verb.className = 'choice-verb';
      verb.textContent = app.verb;

      var desc = document.createElement('span');
      desc.className = 'choice-desc';
      desc.textContent = app.description;

      card.appendChild(verb);
      card.appendChild(desc);
      grid.appendChild(card);
    });
  }

  function loadApps() {
    fetch('apps.json')
      .then(function (res) {
        if (!res.ok) throw new Error('apps.json returned ' + res.status);
        return res.json();
      })
      .then(renderApps)
      .catch(function () {
        var grid = document.getElementById('app-grid');
        grid.innerHTML = '<p class="form-error">Could not load the tool list. Check that apps.json is in this folder.</p>';
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    initThemeToggle();
    loadApps();
  });

  // exposed for the test suite
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderApps: renderApps };
  }
})();
