# Jamia tul Banat Admissions and Student Results

This existing project serves the admission website at `/` and the student results portal at `/results/`. The admission site keeps its existing pages and styling. Admission applications and their photo/identity uploads are stored in Neon PostgreSQL through the Node.js server. Staff records are only available after signing in.

## Architecture and persistence

- Admission pages: `index.html`, `style.css`, and `script.js`.
- Admission API and staff session: `server.js`.
- Neon connection and non-destructive schema setup: `admissions-db.js`.
- Existing results portal: `results/` (it continues to use its existing SQLite database and is not migrated by the admissions migration).
- Legacy admissions data migration: `scripts/migrate-admissions-sqlite.js`.

The existing local admissions database was inspected before implementation: it had zero application rows. The migration script is still included for a repeat-safe copy if records appear in a backup later. It never deletes the source SQLite file or uploads.

## Create Neon database

1. Create a project at [Neon](https://neon.tech/).
2. In the Neon project, open **Dashboard** and copy the PostgreSQL connection string. Use the pooled connection string if Neon offers it; keep the SSL option enabled.
3. Keep that string private. Do not put it in frontend files, screenshots, GitHub, or messages.
4. The application creates `admission_applications` and its indexes on startup with `CREATE TABLE IF NOT EXISTS`; it does not clear or recreate existing data.

## Run locally

Use Node.js 24 or newer and PowerShell from this project folder:

```powershell
npm install
$env:DATABASE_URL = Read-Host "Paste the Neon connection string"
$env:ADMIN_USERNAME = "admissions"
$env:ADMIN_PASSWORD = Read-Host "Choose a unique staff password (12+ characters)"
npm start
```

Open `http://127.0.0.1:3000/`. The admission Staff Portal is in the top navigation. The results portal is at `http://127.0.0.1:3000/results/`; its admin username defaults to `maimuna01` in the existing results application. Use `ADMIN_USERNAME=maimuna01` if you want the same username in both areas; the password environment variable is shared by the current combined server.

At startup, the server logs connection success and confirms that `public.admission_applications` and its indexes are ready. On Render, open **Logs** and check for `Database: admission_applications table and indexes are ready.` The health endpoint `http://127.0.0.1:3000/api/health` should return `{"ok":true,"storage":"postgresql","table":"ready"}`. If initialization fails, startup stops and logs a database error code and safe setup guidance; the connection string is never logged.

You can verify the table in Neon’s SQL Editor:

```sql
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

The admissions schema is initialized by the deployed Node server at startup, not by manually running a SQL script. If this query is empty, first confirm Render deployed the commit containing `admissions-db.js` and the updated `server.js`, then inspect the startup logs for the database connection or schema error.

## Render deployment

1. Push the code to the Git branch connected to the Render web service.
2. In Render, open the service's **Settings** and use **Build Command** `npm install` and **Start Command** `npm start`.
3. Open **Environment** and add `DATABASE_URL` with the Neon connection string, `ADMIN_USERNAME` (at least 3 characters), `ADMIN_PASSWORD` (unique, at least 12 characters), and `NODE_ENV=production`.
4. Save changes and deploy. Render provides `PORT`; the server binds to `0.0.0.0` when deployed.
5. Check `/api/health`, submit a test application, sign in to Staff Portal, and confirm it appears. Redeploy and verify that it remains. Delete only the test application after confirming persistence.

Render's filesystem is not the primary store for admissions submissions. The application table and uploaded files are kept in PostgreSQL. Staff-only APIs check the session server-side, use parameterized queries, and require same-origin requests for changes. Never share Aadhaar images or secrets in support messages.

## Migrating old admissions SQLite rows

Before migration, make a private copy of `data/admissions.sqlite` and `data/uploads`. Set `DATABASE_URL` in the environment, then run:

```powershell
npm run migrate:admissions
```

The script copies each application and its uploads in a transaction, skips application numbers already present in Neon, and leaves the original SQLite database and files untouched. Verify the import in Neon before archiving the local copy. Do not run an import if you are unsure which database copy is authoritative.

## Backups and limits

Database persistence is not a backup. Use Neon’s backup/restore features available for your plan and periodically export important records to a private, access-controlled location. Verify that a backup can be restored. Avoid storing Aadhaar details unless the Madrasa needs them; restrict access and retain sensitive documents only as long as required.

The student results portal still uses its original local SQLite database in this project. Its records are therefore not made persistent on Render by this admissions change. They need a separate migration to PostgreSQL or persistent storage before relying on Render for long-term results data.
