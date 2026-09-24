const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const activityLog = require('../services/activityLog');

const router = express.Router();

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// "Complete" means the submission made it all the way through: matched to a PCO
// person and their profile was updated. Anything else (no PCO match, an error, a
// rejected request) shows as incomplete — see /recent for why, on the same entry.
function renderRow(entry) {
  const complete = entry.status === 'matched';
  return `<tr>
    <td>${escapeHtml(entry.name || '(no name)')}</td>
    <td>${escapeHtml(entry.email || '(no email)')}</td>
    <td><span class="pill ${complete ? 'yes' : 'no'}">${complete ? 'Yes' : 'No'}</span></td>
  </tr>`;
}

router.get('/', requireAdmin, (req, res) => {
  const entries = activityLog.getRecent();
  const rows = entries.map(renderRow).join('\n') || '<tr><td colspan="3">No submissions yet.</td></tr>';

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Submissions — Northshore</title>
<style>
  :root{ --ink:#231F20; --ink-soft:#373743; --paper:#F7F7F7; --paper-raised:#FFFFFF; --line:#D6D6D6; --teal:#3A7596; --gold-deep:#B96C3E; }
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px 48px;background:var(--paper);font-family:system-ui,-apple-system,sans-serif;color:var(--ink)}
  h1{font-size:22px;margin:0 0 4px}
  p.sub{color:var(--ink-soft);font-size:13px;margin:0 0 20px}
  table{width:100%;border-collapse:collapse;background:var(--paper-raised);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:14px}
  th,td{padding:12px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
  th{background:#FDFCFA;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft)}
  tr:last-child td{border-bottom:none}
  .pill{display:inline-block;font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:999px;color:#fff}
  .pill.yes{background:var(--teal)}
  .pill.no{background:var(--gold-deep)}
  .wrap{max-width:680px;margin:0 auto;overflow-x:auto}
</style>
</head>
<body>
<div class="wrap">
  <h1>Submissions</h1>
  <p class="sub">${entries.length} submission(s), most recent first. Resets on deploy/restart. For details on an incomplete submission, see <a href="/recent">/recent</a>.</p>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Assessment Complete</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`);
});

module.exports = router;
