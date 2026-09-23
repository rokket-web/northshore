const MAX_ENTRIES = 200;
const entries = [];

/**
 * In-memory log of what happened on each /webhook/survey request, for the /recent
 * admin page. Resets on every deploy or idle-sleep/wake (Render's free tier wipes the
 * container) — this is "recent activity for eyeballing," not a durable audit log.
 */
function record(entry) {
  entries.unshift({ at: new Date().toISOString(), ...entry });
  if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
}

function getRecent(limit = MAX_ENTRIES) {
  return entries.slice(0, limit);
}

module.exports = { record, getRecent };
