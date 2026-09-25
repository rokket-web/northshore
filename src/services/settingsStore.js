const fs = require('fs');
const path = require('path');
const config = require('../config');

// Admin-editable overrides, persisted as a JSON file so they survive idle-sleep/wake —
// but NOT a fresh deploy (Render rebuilds the container from the repo each time, and
// this file is git-ignored). A deploy just resets these back to the env var defaults
// below; re-enter them via /dashboard afterward. Good enough for "change this without
// a redeploy" without standing up a database for it.
const FILE_PATH = path.join(__dirname, '..', '..', 'data', 'settings.json');

const DEFAULTS = {
  staffAlertEmail: config.mail.staffAlertEmail,
  completionEmailNote: '',
};

function load() {
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Saving an empty string for a field reverts it to the env var default rather than
// persisting an empty override.
function save(partial) {
  const current = load();
  const next = { ...current, ...partial };
  Object.keys(DEFAULTS).forEach((key) => {
    if (next[key] === '') next[key] = DEFAULTS[key];
  });

  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { load, save, DEFAULTS };
