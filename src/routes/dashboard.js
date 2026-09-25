const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const settingsStore = require('../services/settingsStore');

const router = express.Router();

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPage(settings, saved) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Settings — Northshore</title>
<style>
  :root{ --ink:#231F20; --ink-soft:#373743; --paper:#F7F7F7; --paper-raised:#FFFFFF; --line:#D6D6D6; --gold-deep:#B96C3E; }
  *{box-sizing:border-box}
  body{margin:0;padding:24px 16px 48px;background:var(--paper);font-family:system-ui,-apple-system,sans-serif;color:var(--ink)}
  h1{font-size:22px;margin:0 0 4px}
  p.sub{color:var(--ink-soft);font-size:13px;margin:0 0 20px}
  .wrap{max-width:560px;margin:0 auto}
  .card{background:var(--paper-raised);border:1px solid var(--line);border-radius:10px;padding:20px;margin-bottom:16px}
  label{display:block;font-size:12.5px;font-weight:600;color:var(--ink-soft);margin-bottom:6px}
  p.hint{font-size:12px;color:var(--ink-soft);margin:6px 0 0}
  input[type=email],input[type=text],textarea{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;font-family:inherit;font-size:14px;margin-bottom:4px}
  textarea{min-height:90px;resize:vertical}
  button{font-size:14.5px;font-weight:600;border-radius:999px;padding:11px 22px;border:none;cursor:pointer;background:var(--ink);color:#fff;margin-top:8px}
  button:hover{background:var(--gold-deep)}
  .banner{background:#E7F0E9;border:1px solid #9BC2A6;color:#2A5A38;padding:10px 14px;border-radius:8px;font-size:13.5px;margin-bottom:16px}
</style>
</head>
<body>
<div class="wrap">
  <h1>Admin Settings</h1>
  <p class="sub">Changes here take effect immediately, no redeploy needed. They persist while the service stays up, but reset to the env var defaults on the next code deploy — just re-enter them if that happens.</p>
  ${saved ? '<div class="banner">Saved.</div>' : ''}

  <form method="POST" action="/dashboard">
    <div class="card">
      <label for="staffAlertEmail">Staff notification email</label>
      <input type="email" id="staffAlertEmail" name="staffAlertEmail" placeholder="e.g. notifications@northshorechurch.org" value="${escapeHtml(settings.staffAlertEmail)}">
      <p class="hint">Where completion and "needs manual PCO match" alerts are sent. Leave blank to fall back to the STAFF_ALERT_EMAIL env var.</p>
    </div>

    <div class="card">
      <label for="completionEmailNote">Custom note on completion emails</label>
      <textarea id="completionEmailNote" name="completionEmailNote" placeholder="Optional — shown near the top of every &quot;quiz completed&quot; email">${escapeHtml(settings.completionEmailNote)}</textarea>
      <p class="hint">Added above the submission details on every successful completion email. Leave blank for no note. This does not change the "needs manual PCO match" alert email.</p>
    </div>

    <button type="submit">Save Settings</button>
  </form>
</div>
</body>
</html>`;
}

router.get('/', requireAdmin, (req, res) => {
  res.type('html').send(renderPage(settingsStore.load(), false));
});

router.post('/', requireAdmin, express.urlencoded({ extended: false }), (req, res) => {
  const settings = settingsStore.save({
    staffAlertEmail: (req.body.staffAlertEmail || '').trim(),
    completionEmailNote: (req.body.completionEmailNote || '').trim(),
  });
  res.type('html').send(renderPage(settings, true));
});

module.exports = router;
