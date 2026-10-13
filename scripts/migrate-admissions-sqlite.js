'use strict';

// Idempotently copies legacy SQLite admission rows and local uploads to Neon.
// Run from the repository root after setting DATABASE_URL; this never deletes
// or modifies the source SQLite database or upload directory.
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { pool, initialize } = require('../admissions-db');

function readUpload(meta, uploadsDir) {
  if (!meta) return { meta:null, bytes:null };
  const saved = JSON.parse(meta);
  const file = path.join(uploadsDir, path.basename(saved.stored || ''));
  if (!saved.stored || !fs.existsSync(file)) throw new Error(`Referenced upload is missing: ${path.basename(file)}`);
  return { meta:{ name:String(saved.name || 'upload').slice(0,100), mime:String(saved.mime || 'application/octet-stream') }, bytes:fs.readFileSync(file) };
}

async function main() {
  const sqlitePath = path.resolve(process.env.LEGACY_ADMISSIONS_SQLITE || 'data/admissions.sqlite');
  const uploadsDir = path.resolve(process.env.LEGACY_ADMISSIONS_UPLOADS || 'data/uploads');
  if (!fs.existsSync(sqlitePath)) throw new Error(`Legacy SQLite file not found: ${sqlitePath}`);
  const oldDb = new DatabaseSync(sqlitePath,{readOnly:true});
  await initialize();
  const records = oldDb.prepare('SELECT id,created,status,data,photo,document FROM applications ORDER BY created').all();
  let imported=0,skipped=0;
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    for (const record of records) {
      const exists=await client.query('SELECT 1 FROM public.admission_applications WHERE application_number=$1',[record.id]);
      if (exists.rowCount) { skipped++; continue; }
      const photo=readUpload(record.photo,uploadsDir),document=readUpload(record.document,uploadsDir);
      const data=JSON.parse(record.data);
      const created=new Date(record.created);
      if (!Number.isFinite(created.getTime())) throw new Error(`Invalid date for legacy application ${record.id}`);
      await client.query(
        `INSERT INTO public.admission_applications(id,application_number,created_at,updated_at,status,data,photo_meta,photo_bytes,document_meta,document_bytes)
         VALUES($1,$1,$2,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8) ON CONFLICT(application_number) DO NOTHING`,
        [record.id,created.toISOString(),['New','Approved','Rejected'].includes(record.status)?record.status:'New',JSON.stringify(data),
          photo.meta?JSON.stringify(photo.meta):null,photo.bytes,document.meta?JSON.stringify(document.meta):null,document.bytes]
      );
      imported++;
    }
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release(); oldDb.close();
  }
  console.log(`Migration complete. Imported ${imported}; skipped existing ${skipped}; source rows ${records.length}.`);
}

main().catch(error=>{console.error(`Migration failed: ${error.message}`);process.exitCode=1;}).finally(()=>pool.end());
