// app.js — Chemculator hub
// Responsibilities: fetch apps.json, render the tool cards, and wire the
// light/dark toggle (shared localStorage key so the choice persists as
// someone clicks through into concentrationtrainer/ or stoichiomathics/).

(function () {
  'use strict';

  var THEME_KEY = 'theme';
  var ACCENTS = { teal: 'teal', gold: 'gold', amber: 'gold', lilac: 'lilac' };

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
      var isLive = app.status === 'live';
      var card = document.createElement(isLive ? 'a' : 'div');
      if (isLive) {
        card.href = app.path;
      } else {
        card.setAttribute('aria-disabled', 'true');
      }

      // Signature card (spec component A): .sig-card > .sig-front + .sig-back.
      // 'amber' is the legacy name for the gold accent.
      var accent = ACCENTS[app.accent] || 'teal';
      card.className = 'sig-card sig-card--' + accent + (isLive ? '' : ' sig-card--disabled');
      card.style.animationDelay = (i * 0.08) + 's';

      var front = document.createElement('span');
      front.className = 'sig-front';
      front.textContent = app.verb || app.name;

      var back = document.createElement('span');
      back.className = 'sig-back';
      back.textContent = app.description;

      card.appendChild(front);
      card.appendChild(back);

      if (!isLive) {
        var badge = document.createElement('span');
        badge.className = 'sig-badge';
        badge.textContent = 'Coming soon';
        card.appendChild(badge);
      }

      grid.appendChild(card);
    });
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function typeText(el, text, speedMs) {
    return new Promise(function (resolve) {
      el.textContent = '';
      var i = 0;
      (function step() {
        if (i < text.length) {
          el.textContent += text.charAt(i);
          i++;
          setTimeout(step, speedMs);
        } else {
          resolve();
        }
      })();
    });
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function revealMainContent() {
    var intro = document.getElementById('intro');
    var main = document.getElementById('main-content');
    if (!main) return;
    if (!intro) { main.hidden = false; return; }
    intro.classList.add('intro--fade-out');
    setTimeout(function () {
      intro.hidden = true;
      main.hidden = false;
    }, 500); // matches .intro fade-out transition duration
  }

  function playIntro() {
    var introTitle = document.getElementById('intro-title');
    var introSubtitle = document.getElementById('intro-subtitle');
    var intro = document.getElementById('intro');
    var main = document.getElementById('main-content');
    if (!introTitle || !introSubtitle || !intro || !main) return;

    if (prefersReducedMotion()) {
      intro.hidden = true;
      main.hidden = false;
      return;
    }

    introTitle.classList.add('typing-cursor');
    typeText(introTitle, 'Welcome to Chemculator', 55)
      .then(function () {
        introTitle.classList.remove('typing-cursor');
        introSubtitle.classList.add('typing-cursor');
        return typeText(introSubtitle, 'The calculator you never knew you needed for chemistry', 32);
      })
      .then(function () {
        return wait(2000);
      })
      .then(function () {
        introSubtitle.classList.remove('typing-cursor');
        revealMainContent();
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
    playIntro();
  });

  // exposed for the test suite
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { renderApps: renderApps, typeText: typeText, playIntro: playIntro, revealMainContent: revealMainContent };
  }
})();
