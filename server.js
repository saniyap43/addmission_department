'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const resultsApp = require('./results/server.js');
const { pool, initialize } = require('./admissions-db');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admissions';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const ADMIN_SALT = crypto.randomBytes(16);
const sessions = new Map();
const limits = new Map();
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.jpeg':'image/jpeg', '.jpg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
const publicFiles = new Map([
  ['/','index.html'], ['/index.html','index.html'], ['/style.css','style.css'], ['/script.js','script.js'],
  ['/admission-poster-english.jpeg','admission-poster-english.jpeg'], ['/admission-poster-urdu.jpeg','admission-poster-urdu.jpeg'],
  ['/admission-poster-online.jpeg','admission-poster-online.jpeg'], ['/admission-group-poster.png','admission-group-poster.png'],
  ['/ram-course-details.jpeg','ram-course-details.jpeg'], ['/ram-today-offer.jpeg','ram-today-offer.jpeg'],
  ['/ramzan-course-offer-combined.jpg','ramzan-course-offer-combined.jpg']
]);

const send = (res, code, data, headers = {}) => {
  res.writeHead(code, {
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin',
    'Content-Security-Policy':"default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    ...headers
  });
  res.end(data);
};
const json = (res, code, data, headers = {}) => send(res, code, JSON.stringify(data), { 'Content-Type':'application/json; charset=utf-8', ...headers });
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const cookie = (req, name) => {
  const part = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : '';
};
function csrfOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host && ['http:','https:'].includes(new URL(origin).protocol); } catch { return false; }
}
function rateLimit(req, name, max) {
  const key = `${name}:${req.socket.remoteAddress || 'unknown'}`;
  const record = limits.get(key) || { start: Date.now(), count: 0 };
  if (Date.now() - record.start >= 60_000) { record.start = Date.now(); record.count = 0; }
  record.count++;
  limits.set(key, record);
  return record.count <= max;
}
function isAdmin(req) {
  const id = cookie(req, 'jamia_session');
  const session = sessions.get(id);
  if (!session || session.expires < Date.now()) { if (id) sessions.delete(id); return false; }
  session.expires = Date.now() + 60 * 60 * 1000;
  return true;
}
async function readJson(req, max = 18 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Request is too large.'), { status:413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid request data.'), { status:400 }); }
}
function safeFile(file) {
  if (!file) return null;
  if (typeof file.data !== 'string' || file.data.length > 9 * 1024 * 1024) throw Object.assign(new Error('Each upload must be under 6 MB.'), { status:400 });
  const match = file.data.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw Object.assign(new Error('Upload must be a JPG, PNG, WebP or PDF file under 6 MB.'), { status:400 });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 6 * 1024 * 1024) throw Object.assign(new Error('Each upload must be under 6 MB.'), { status:400 });
  const signatures = {
    'image/jpeg': bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])),
    'image/png': bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/webp': bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP',
    'application/pdf': bytes.subarray(0,5).toString() === '%PDF-'
  };
  if (!signatures[match[1]]) throw Object.assign(new Error('The uploaded file does not match its file type.'), { status:400 });
  const ext = { 'image/jpeg':'.jpg', 'image/png':'.png', 'image/webp':'.webp', 'application/pdf':'.pdf' }[match[1]];
  return { meta:{ name:path.basename(String(file.name || `upload${ext}`)).replace(/[^\w. -]/g,'_').slice(0,100), mime:match[1] }, bytes };
}
function validateApplication(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Complete the required application details.';
  for (const [key, max] of Object.entries({ studentName:160, fatherName:160, dob:30, gender:40, idNumber:80, mobile:40, email:254, address:2000, course:160, previousClass:120, previousSchool:200, hostel:80, occupation:160, guardianMobile:40, emergencyName:160, emergencyMobile:40 })) {
    if (data[key] !== undefined && (typeof data[key] !== 'string' || data[key].length > max)) return 'One or more application fields are invalid.';
  }
  for (const key of ['studentName','fatherName','dob','mobile','address','course']) if (!text(data[key])) return 'Complete the required application details.';
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return 'Enter a valid email address.';
  return '';
}
function appRow(row) {
  return {
    id:row.application_number, created:row.created_at, status:row.status, data:row.data,
    files:{ photo:row.photo_meta, document:row.document_meta }
  };
}
async function createApplication(data, files = {}, status = 'New') {
  const problem = validateApplication(data);
  if (problem) throw Object.assign(new Error(problem), { status:400 });
  const photo = safeFile(files.photo), document = safeFile(files.document);
  const id = crypto.randomUUID();
  const applicationNumber = `JTB-${new Date().getFullYear()}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
  const result = await pool.query(
    `INSERT INTO public.admission_applications(id,application_number,status,data,photo_meta,photo_bytes,document_meta,document_bytes)
     VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8) RETURNING *`,
    [id, applicationNumber, status, JSON.stringify(data), photo ? JSON.stringify(photo.meta) : null, photo?.bytes || null,
      document ? JSON.stringify(document.meta) : null, document?.bytes || null]
  );
  return appRow(result.rows[0]);
}
function publicFile(name, res) {
  const filePath = path.join(ROOT, name);
  fs.readFile(filePath, (error, bytes) => {
    if (error) return send(res,404,'Not found.');
    send(res,200,bytes,{ 'Content-Type':mime[path.extname(filePath)] || 'application/octet-stream' });
  });
}
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if ((url.pathname === '/results' || url.pathname.startsWith('/results/'))) {
      const original = req.url;
      req.url = req.url.slice('/results'.length) || '/';
      try { return resultsApp(req,res); } finally { req.url = original; }
    }
    if (req.method === 'GET' && publicFiles.has(url.pathname)) return publicFile(publicFiles.get(url.pathname),res);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const result=await pool.query("SELECT to_regclass('public.admission_applications') AS table_name");
      if (!result.rows[0]?.table_name) return json(res,503,{ok:false,storage:'postgresql',table:'missing'});
      return json(res,200,{ok:true,storage:'postgresql',table:'ready'});
    }
    if (req.method === 'POST' && url.pathname === '/api/applications') {
      if (!csrfOk(req)) return json(res,403,{error:'Request origin was rejected.'});
      if (!rateLimit(req,'application-submit',10)) return json(res,429,{error:'Too many submissions. Please wait and try again.'});
      const input = await readJson(req);
      const application = await createApplication(input.data,input.files || {});
      return json(res,201,{id:application.id,created:application.created});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      if (!rateLimit(req,'admin-login',6)) return json(res,429,{error:'Too many login attempts. Try again later.'});
      if (!csrfOk(req)) return json(res,403,{error:'Request origin was rejected.'});
      const input = await readJson(req,8192);
      const [candidate, expected] = await Promise.all([scrypt(String(input.password || ''),ADMIN_SALT,64),scrypt(ADMIN_PASSWORD,ADMIN_SALT,64)]);
      const userA=crypto.createHash('sha256').update(String(input.username || ADMIN_USERNAME)).digest();
      const userB=crypto.createHash('sha256').update(ADMIN_USERNAME).digest();
      if (!ADMIN_PASSWORD || !crypto.timingSafeEqual(candidate,expected) || !crypto.timingSafeEqual(userA,userB)) return json(res,401,{error:'Incorrect staff username or password.'});
      const sid=crypto.randomBytes(32).toString('hex');
      sessions.set(sid,{ expires:Date.now()+60*60*1000 });
      return json(res,200,{ok:true},{'Set-Cookie':`jamia_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${process.env.NODE_ENV==='production'?'; Secure':''}`});
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      if (!csrfOk(req)) return json(res,403,{error:'Request origin was rejected.'});
      sessions.delete(cookie(req,'jamia_session'));
      return json(res,200,{ok:true},{'Set-Cookie':'jamia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    }
    if (url.pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res,401,{error:'Please sign in again.'});
      if (req.method !== 'GET' && !csrfOk(req)) return json(res,403,{error:'Request origin was rejected.'});
      if (req.method === 'GET' && url.pathname === '/api/admin/applications') {
        const result=await pool.query('SELECT * FROM public.admission_applications ORDER BY created_at DESC');
        return json(res,200,result.rows.map(appRow));
      }
      if (req.method === 'POST' && url.pathname === '/api/admin/applications') {
        const input=await readJson(req);
        const application=await createApplication(input.data,input.files || {});
        return json(res,201,application);
      }
      const fileMatch=url.pathname.match(/^\/api\/admin\/files\/([A-Z0-9-]+)\/(photo|document)$/i);
      if (fileMatch && req.method === 'GET') {
        const column=fileMatch[2]==='photo'?'photo':'document';
        const result=await pool.query(`SELECT ${column}_meta AS meta, ${column}_bytes AS bytes FROM public.admission_applications WHERE application_number=$1`,[fileMatch[1]]);
        const file=result.rows[0];
        if (!file?.meta || !file.bytes) return json(res,404,{error:'File not found.'});
        return send(res,200,file.bytes,{ 'Content-Type':file.meta.mime, 'Content-Disposition':`inline; filename="${String(file.meta.name).replace(/["\\]/g,'_')}"`, 'Cache-Control':'private, no-store' });
      }
      const idMatch=url.pathname.match(/^\/api\/admin\/applications\/([A-Z0-9-]+)$/i);
      if (idMatch && req.method === 'PATCH') {
        const input=await readJson(req,128*1024);
        if (input.status !== undefined && !['New','Approved','Rejected'].includes(input.status)) return json(res,400,{error:'Invalid application status.'});
        if (input.data !== undefined) { const issue=validateApplication(input.data); if (issue) return json(res,400,{error:issue}); }
        const values=[],set=[];
        if (input.data !== undefined) { values.push(JSON.stringify(input.data)); set.push(`data=$${values.length}::jsonb`); }
        if (input.status !== undefined) { values.push(input.status); set.push(`status=$${values.length}`); }
        if (!set.length) return json(res,400,{error:'No changes were provided.'});
        values.push(idMatch[1]);
        const result=await pool.query(`UPDATE public.admission_applications SET ${set.join(',')},updated_at=NOW() WHERE application_number=$${values.length} RETURNING *`,values);
        if (!result.rowCount) return json(res,404,{error:'Application not found.'});
        return json(res,200,{ok:true});
      }
      if (idMatch && req.method === 'DELETE') {
        if (url.searchParams.get('confirm') !== 'true') return json(res,400,{error:'Deletion confirmation is required.'});
        const result=await pool.query('DELETE FROM public.admission_applications WHERE application_number=$1',[idMatch[1]]);
        return json(res,200,{ok:true,deleted:result.rowCount===1});
      }
      return json(res,404,{error:'Admin endpoint not found.'});
    }
    return json(res,404,{error:'Not found.'});
  } catch (error) {
    if (error.code === '23505') return json(res,409,{error:'An application with this reference already exists.'});
    if (error.status) return json(res,error.status,{error:error.message});
    const code=typeof error.code==='string'&&/^[0-9A-Z]{1,10}$/.test(error.code)?error.code:'unknown';
    console.error(`Request failed (code ${code}).`);
    return json(res,500,{error:'The request could not be completed. Please try again later.'});
  }
}

async function start() {
  if (ADMIN_USERNAME.length < 3 || ADMIN_PASSWORD.length < 12) throw new Error('Set ADMIN_PASSWORD (12+ characters) and ADMIN_USERNAME (3+ characters) in the environment.');
  await initialize();
  const server=http.createServer((req,res)=>{void handle(req,res);});
  const port=Number(process.env.PORT)||3000;
  const host=process.env.HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');
  server.listen(port,host,()=>console.log(`Jamia Admissions and Results portal running at http://${host}:${port}`));
  const shutdown=()=>server.close(()=>pool.end().finally(()=>process.exit(0)));
  process.on('SIGTERM',shutdown);
  process.on('SIGINT',shutdown);
}

if (require.main === module) start().catch(error=>{
  if (error.code) {
    const code=typeof error.code==='string'&&/^[0-9A-Z]{1,10}$/.test(error.code)?error.code:'unknown';
    console.error(`Database/server startup failed (code ${code}). Check DATABASE_URL, Neon connectivity, and database permissions. Credentials are not logged.`);
  } else {
    console.error(`Server startup failed: ${error.message}`);
  }
  process.exit(1);
});
module.exports = { handle, createApplication };
