const config = require('../config');

// Shared by any page that shows submitter names/emails (e.g. /recent, /submissions) —
// gated behind a password rather than left open. Refuses to serve at all if
// ADMIN_PASSWORD hasn't been set, rather than silently exposing PII by default.
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

module.exports = requireAdmin;
