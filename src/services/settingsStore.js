const { Pool } = require('pg');
const config = require('../config');

// Admin-editable overrides (staff notification email, completion email note), backed by
// Postgres (Neon) so they survive redeploys — unlike the in-memory activity log, these
// are meant to be "enter once, edit only when it changes."
const DEFAULTS = {
  staffAlertEmail: config.mail.staffAlertEmail,
  completionEmailNote: '',
};

let pool;
let schemaReady;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured — cannot read/write admin settings.');
    }
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }
  await schemaReady;
}

async function load() {
  await ensureSchema();
  const result = await getPool().query('SELECT key, value FROM settings');
  const overrides = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return { ...DEFAULTS, ...overrides };
}

// Saving an empty string for a field deletes its row, reverting to the env var default
// rather than persisting an empty override.
async function save(partial) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(partial)) {
      if (!(key in DEFAULTS)) continue;
      if (value === '') {
        await client.query('DELETE FROM settings WHERE key = $1', [key]);
      } else {
        await client.query(
          `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, value]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return load();
}

module.exports = { load, save, DEFAULTS };
