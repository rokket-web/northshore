const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const settingsStore = require('../services/settingsStore');
const { sendMail } = require('../services/mailService');

const router = express.Router();

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderPage(settings, banner) {
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
  .btnrow{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
  button{font-size:14.5px;font-weight:600;border-radius:999px;padding:11px 22px;border:none;cursor:pointer;background:var(--ink);color:#fff}
  button:hover{background:var(--gold-deep)}
  button.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
  button.secondary:hover{background:var(--paper);border-color:var(--ink)}
  .banner{padding:10px 14px;border-radius:8px;font-size:13.5px;margin-bottom:16px}
  .banner.ok{background:#E7F0E9;border:1px solid #9BC2A6;color:#2A5A38}
  .banner.error{background:#FBEAE6;border:1px solid #E0A98F;color:#8A3A20}
</style>
</head>
<body>
<div class="wrap">
  <h1>Admin Settings</h1>
  <p class="sub">Changes here take effect immediately, no redeploy needed — saved to the database, so they stick around.</p>
  ${banner ? `<div class="banner ${banner.ok ? 'ok' : 'error'}">${escapeHtml(banner.message)}</div>` : ''}

  <form method="POST" action="/dashboard">
    <div class="card">
      <label for="staffAlertEmail">Staff notification email</label>
      <input type="email" id="staffAlertEmail" name="staffAlertEmail" placeholder="e.g. notifications@northshorechurch.org" value="${escapeHtml(settings.staffAlertEmail)}">
      <p class="hint">Where completion and "needs manual PCO match" alerts are sent. Leave blank to fall back to the STAFF_ALERT_EMAIL env var.</p>
    </div>

    <div class="card">
      <label for="completionEmailNote">Custom note on completion emails</label>
      <textarea id="completionEmailNote" name="completionEmailNote" placeholder="Optional — shown near the top of every &quot;quiz completed&quot; email">${escapeHtml(settings.completionEmailNote)}</textarea>
      <p class="hint">Added above the submission details on every successful completion email. Leave blank for no note. This does not change the "needs manual PCO match" alert email. "Send Test Email" below sends whatever is currently typed in these two fields, whether or not you've saved yet.</p>
    </div>

    <div class="btnrow">
      <button type="submit" formaction="/dashboard">Save Settings</button>
      <button type="submit" formaction="/dashboard/test-email" class="secondary">Send Test Email</button>
    </div>
  </form>
</div>
</body>
</html>`;
}

router.get('/', requireAdmin, async (req, res) => {
  try {
    res.type('html').send(renderPage(await settingsStore.load(), null));
  } catch (err) {
    console.error('[dashboard] failed to load settings:', err);
    res.status(500).send('Failed to load settings — check server logs.');
  }
});

router.post('/', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const submitted = {
    staffAlertEmail: (req.body.staffAlertEmail || '').trim(),
    completionEmailNote: (req.body.completionEmailNote || '').trim(),
  };
  try {
    const settings = await settingsStore.save(submitted);
    res.type('html').send(renderPage(settings, { ok: true, message: 'Saved.' }));
  } catch (err) {
    console.error('[dashboard] failed to save settings:', err);
    res.type('html').send(renderPage(submitted, { ok: false, message: `Failed to save: ${err.message}` }));
  }
});

// Sends a real test email using whatever is currently in the form fields — not
// necessarily saved yet — so admins can check wording/deliverability before committing.
router.post('/test-email', requireAdmin, express.urlencoded({ extended: false }), async (req, res) => {
  const to = (req.body.staffAlertEmail || '').trim();
  const note = (req.body.completionEmailNote || '').trim();
  const submitted = { staffAlertEmail: to, completionEmailNote: note };

  if (!to) {
    return res.type('html').send(renderPage(submitted, { ok: false, message: 'Enter an email address first.' }));
  }

  try {
    await sendMail({
      to,
      subject: 'Test email from Northshore admin dashboard',
      body: [
        'This is a test email from the Northshore admin dashboard, confirming notifications are working.',
        '',
        note ? `Custom note preview:\n${note}` : '(No custom note currently entered.)',
      ].join('\n'),
    });
    res.type('html').send(renderPage(submitted, { ok: true, message: `Test email sent to ${to}.` }));
  } catch (err) {
    console.error('[dashboard] test email failed:', err);
    res.type('html').send(renderPage(submitted, { ok: false, message: `Failed to send: ${err.message}` }));
  }
});

module.exports = router;
