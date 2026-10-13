'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  keepAlive: true
});

pool.on('error', error => {
  const code = typeof error.code === 'string' && /^[0-9A-Z]{1,10}$/.test(error.code) ? error.code : 'unknown';
  console.error(`Database: idle connection failed (code ${code}). Check Neon availability and DATABASE_URL settings.`);
});

async function initialize() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set in the application environment.');
  }

  console.info('Database: connecting to Neon PostgreSQL.');
  await pool.query('SELECT 1');
  console.info('Database: connection successful.');

  await pool.query(`CREATE TABLE IF NOT EXISTS public.admission_applications (
      id TEXT PRIMARY KEY,
      application_number TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Approved','Rejected')),
      data JSONB NOT NULL,
      photo_meta JSONB,
      photo_bytes BYTEA,
      document_meta JSONB,
      document_bytes BYTEA
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS admission_applications_created_at_idx ON public.admission_applications (created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS admission_applications_status_idx ON public.admission_applications (status)');
  await pool.query("CREATE INDEX IF NOT EXISTS admission_applications_course_idx ON public.admission_applications ((data->>'course'))");

  const verification = await pool.query("SELECT to_regclass('public.admission_applications') AS table_name");
  if (!verification.rows[0]?.table_name) {
    throw new Error('Database initialization did not create public.admission_applications.');
  }
  console.info('Database: admission_applications table and indexes are ready.');
}

module.exports = { pool, initialize };
