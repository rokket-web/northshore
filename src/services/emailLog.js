const { Pool } = require('pg');
const config = require('../config');

// Durable log of every email attempt (sent, failed, or skipped before sending), shown on
// /dashboard so delivery problems can be traced without digging through server logs.
// Stored in Postgres (Neon) like settingsStore, so it survives redeploys.
const MAX_ROWS = 500;

let pool;
let schemaReady;

function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      throw new Error('DATABASE_URL is not configured — cannot read/write the email log.');
    }
    pool = new Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

async function ensureSchema() {
  if (!schemaReady) {
    schemaReady = getPool().query(`
      CREATE TABLE IF NOT EXISTS email_log (
        id SERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        kind TEXT,
        to_addr TEXT,
        subject TEXT,
        transport TEXT,
        status TEXT NOT NULL,
        detail TEXT
      )
    `);
  }
  await schemaReady;
}

/**
 * Never throws — a logging failure must not stop (or be mistaken for) a mail failure.
 *
 * @param {{kind?: string, to?: string, subject?: string, transport?: string,
 *          status: 'sent'|'failed'|'skipped', detail?: string}} entry
 */
async function record({ kind, to, subject, transport, status, detail }) {
  try {
    await ensureSchema();
    await getPool().query(
      'INSERT INTO email_log (kind, to_addr, subject, transport, status, detail) VALUES ($1, $2, $3, $4, $5, $6)',
      [kind || null, to || null, subject || null, transport || null, status, detail || null]
    );
    await getPool().query(
      'DELETE FROM email_log WHERE id NOT IN (SELECT id FROM email_log ORDER BY id DESC LIMIT $1)',
      [MAX_ROWS]
    );
  } catch (err) {
    console.error('[emailLog] failed to record entry:', err.message);
  }
}

async function getRecent(limit = 50) {
  await ensureSchema();
  const result = await getPool().query(
    'SELECT at, kind, to_addr, subject, transport, status, detail FROM email_log ORDER BY id DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

module.exports = { record, getRecent };
