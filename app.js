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
    card.className = 'choice-card choice-card--' + app.accent + (isLive ? '' : ' choice-card--disabled');
    card.style.animationDelay = (i * 0.08) + 's';

    var verb = document.createElement('span');
    verb.className = 'choice-verb';
    verb.textContent = app.verb;

    var desc = document.createElement('span');
    desc.className = 'choice-desc';
    desc.textContent = app.description;

    card.appendChild(verb);
    card.appendChild(desc);

    if (!isLive) {
      var badge = document.createElement('span');
      badge.className = 'choice-badge';
      badge.textContent = 'Coming soon';
      card.appendChild(badge);
    }

    grid.appendChild(card);
  });
}
