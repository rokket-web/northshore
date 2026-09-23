const express = require('express');
const config = require('../config');
const activityLog = require('../services/activityLog');

const router = express.Router();

// Shows submitter names/emails, so this is gated behind a password rather than left
// open — refuses to serve at all if ADMIN_PASSWORD hasn't been set, rather than
// silently exposing PII by default.
function requireAdmin(req, res, next) {
  if (!config.admin.password) {
    return res.status(503).send('Set ADMIN_PASSWORD to enable this page.');
  }

  const [scheme, encoded] = (req.get('authorization') || '').split(' ');
  if (scheme === 'Basic' && encoded) {
    const [, password] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (password === config.admin.password) return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="Northshore Admin"');
  return res.status(401).send('Authentication required.');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const STATUS_LABELS = {
  matched: { label: 'Matched', color: '#3A7596' },
  none: { label: 'No PCO match', color: '#B4543A' },
  ambiguous: { label: 'Ambiguous match', color: '#D78A5C' },
  rejected: { label: 'Rejected', color: '#B4543A' },
  error: { label: 'Error', color: '#B4543A' },
};

function renderRow(entry) {
  const status = STATUS_LABELS[entry.status] || { label: entry.status, color: '#555' };
  const details = [];
  if (entry.pcoPersonId) details.push(`PCO id ${escapeHtml(entry.pcoPersonId)}`);
  if (entry.topGifts?.length) details.push(`Gifts: ${escapeHtml(entry.topGifts.join(', '))}`);
  if (entry.topRoles?.length) details.push(`Roles: ${escapeHtml(entry.topRoles.join(', '))}`);
  if (entry.detail) details.push(escapeHtml(entry.detail));
  if (entry.pdfLink) details.push(`<a href="${escapeHtml(entry.pdfLink)}" target="_blank" rel="noopener">PDF</a>`);

  return `<tr>
    <td>${escapeHtml(new Date(entry.at).toLocaleString())}</td>
    <td>${escapeHtml(entry.name || '(no name)')}</td>
    <td>${escapeHtml(entry.email || '(no email)')}</td>
    <td><span class="status" style="background:${status.color}">${escapeHtml(status.label)}</span></td>
    <td>${details.join('<br>') || '&mdash;'}</td>
  </tr>`;
}

router.get('/', requireAdmin, (req, res) => {
  const entries = activityLog.getRecent();
  const rows = entries.map(renderRow).join('\n') || '<tr><td colspan="5">No submissions yet.</td></tr>';

  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Recent Activity — Northshore</title>
<style>
  :root{ --ink:#231F20; --ink-soft:#373743; --paper:#F7F7F7; --paper-raised:#FFFFFF; --line:#D6D6D6; }
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px 48px;background:var(--paper);font-family:system-ui,-apple-system,sans-serif;color:var(--ink)}
  h1{font-size:22px;margin:0 0 4px}
  p.sub{color:var(--ink-soft);font-size:13px;margin:0 0 20px}
  table{width:100%;border-collapse:collapse;background:var(--paper-raised);border:1px solid var(--line);border-radius:10px;overflow:hidden;font-size:13.5px}
  th,td{padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}
  th{background:#FDFCFA;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft)}
  tr:last-child td{border-bottom:none}
  .status{display:inline-block;color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;white-space:nowrap}
  .wrap{max-width:1000px;margin:0 auto;overflow-x:auto}
</style>
</head>
<body>
<div class="wrap">
  <h1>Recent Quiz Activity</h1>
  <p class="sub">Last ${entries.length} submission(s), most recent first. Resets on deploy/restart — not a permanent log.</p>
  <table>
    <thead><tr><th>Time</th><th>Name</th><th>Email</th><th>Status</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
</body>
</html>`);
});

module.exports = router;
