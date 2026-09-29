'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const ROOT=__dirname,DATA=process.env.DATA_DIR||path.join(ROOT,'data'),UPLOADS=path.join(DATA,'uploads');
for(const dir of [DATA,UPLOADS])fs.mkdirSync(dir,{recursive:true});
const ADMIN_PASSWORD=process.env.ADMIN_PASSWORD;
if(!ADMIN_PASSWORD||ADMIN_PASSWORD.length<12){console.error('Set ADMIN_PASSWORD to a unique password of at least 12 characters before starting.');process.exit(1)}
const db=new DatabaseSync(path.join(DATA,'admissions.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS applications(id TEXT PRIMARY KEY,created TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL,photo TEXT,document TEXT);`);
const sessions=new Map();
const publicFiles=new Map([['/','index.html'],['/index.html','index.html'],['/style.css','style.css'],['/script.js','script.js'],['/admission-poster-english.jpeg','admission-poster-english.jpeg'],['/admission-poster-urdu.jpeg','admission-poster-urdu.jpeg'],['/admission-poster-online.jpeg','admission-poster-online.jpeg']]);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpeg':'image/jpeg'};
function send(res,code,data,headers={}){res.writeHead(code,{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",...headers});res.end(data)}
function json(res,code,data,headers={}){send(res,code,JSON.stringify(data),{'Content-Type':'application/json; charset=utf-8',...headers})}
function getSession(req){const sid=(req.headers.cookie||'').match(/(?:^|;\s*)jamia_session=([a-f0-9]+)/)?.[1];return sid?sessions.get(sid):null}
function requireAdmin(req,res){const session=getSession(req);if(!session){json(res,401,{error:'Please sign in again.'});return null}return session}
function checkOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host&&['http:','https:'].includes(new URL(origin).protocol)}catch{return false}}
async function body(req,limit=12*1024*1024){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw Object.assign(new Error('Request is too large.'),{status:413});chunks.push(c)}return Buffer.concat(chunks)}
function safeFile(file){if(!file||typeof file.data!=='string'||file.data.length>9*1024*1024)return null;const match=file.data.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Object.assign(new Error('Upload must be a JPG, PNG, WebP or PDF file under 6 MB.'),{status:400});const bytes=Buffer.from(match[2],'base64');if(bytes.length>6*1024*1024)throw Object.assign(new Error('Each upload must be under 6 MB.'),{status:400});const ext={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','application/pdf':'.pdf'}[match[1]];return {name:path.basename(String(file.name||'document')).replace(/[^\w. -]/g,'_').slice(0,100),mime:match[1],bytes,stored:crypto.randomUUID()+ext}}
function row(r){return {id:r.id,created:r.created,status:r.status,data:JSON.parse(r.data),files:{photo:r.photo?JSON.parse(r.photo):null,document:r.document?JSON.parse(r.document):null}}}
function applications(){return db.prepare('SELECT * FROM applications ORDER BY created DESC').all().map(row)}
function app(req,res){
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&publicFiles.has(url.pathname)){const f=path.join(ROOT,publicFiles.get(url.pathname));try{send(res,200,fs.readFileSync(f),{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});}catch{send(res,404,'Not found')}return}
 if(url.pathname==='/api/health'&&req.method==='GET'){json(res,200,{ok:true});return}
 if(url.pathname==='/api/applications'&&req.method==='POST'){
  if(!checkOrigin(req)){json(res,403,{error:'Request origin was rejected.'});return}
  body(req).then(buf=>{const input=JSON.parse(buf.toString('utf8'));const data=input.data;if(!data||typeof data!=='object'||!data.studentName||!data.fatherName||!data.mobile||!data.address||!data.course){json(res,400,{error:'Complete the required application details.'});return}
   const photo=safeFile(input.files?.photo),document=safeFile(input.files?.document),id='JTB-'+new Date().getFullYear()+'-'+String(Date.now()).slice(-6),created=new Date().toISOString(),saved=[];
   for(const file of [photo,document])if(file){fs.writeFileSync(path.join(UPLOADS,file.stored),file.bytes,{flag:'wx'});saved.push(file.stored)}
   const info=f=>f?JSON.stringify({name:f.name,mime:f.mime,stored:f.stored}):null;
   db.prepare('INSERT INTO applications(id,created,status,data,photo,document) VALUES(?,?,?,?,?,?)').run(id,created,'New',JSON.stringify(data),info(photo),info(document));json(res,201,{id,created});
  }).catch(e=>json(res,e.status||400,{error:e.status?e.message:'Invalid application submission.'}));return;
 }
 if(url.pathname==='/api/admin/login'&&req.method==='POST'){
  if(!checkOrigin(req)){json(res,403,{error:'Request origin was rejected.'});return}
  body(req,8192).then(buf=>{let input;try{input=JSON.parse(buf.toString())}catch{input={}}const candidate=crypto.createHash('sha256').update(String(input.password||'')).digest(),expected=crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();if(!crypto.timingSafeEqual(candidate,expected)){json(res,401,{error:'Incorrect staff password.'});return}const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,{created:Date.now()});json(res,200,{ok:true},{'Set-Cookie':`jamia_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`})}).catch(()=>json(res,400,{error:'Invalid request.'}));return;
 }
 if(url.pathname==='/api/admin/logout'&&req.method==='POST'){if(!checkOrigin(req)){json(res,403,{error:'Request origin was rejected.'});return}sessions.delete((req.headers.cookie||'').match(/jamia_session=([a-f0-9]+)/)?.[1]);json(res,200,{ok:true},{'Set-Cookie':'jamia_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});return}
 if(url.pathname.startsWith('/api/admin/')){
  if(!requireAdmin(req,res))return;
  if(url.pathname==='/api/admin/applications'&&req.method==='GET'){json(res,200,applications());return}
  const fileMatch=url.pathname.match(/^\/api\/admin\/files\/([A-Z0-9-]+)\/(photo|document)$/);
  if(fileMatch&&req.method==='GET'){const rec=db.prepare('SELECT photo,document FROM applications WHERE id=?').get(fileMatch[1]);const f=rec&&rec[fileMatch[2]]?JSON.parse(rec[fileMatch[2]]):null;if(!f){json(res,404,{error:'File not found.'});return}try{const bytes=fs.readFileSync(path.join(UPLOADS,path.basename(f.stored)));send(res,200,bytes,{'Content-Type':f.mime,'Content-Disposition':`inline; filename="${f.name.replace(/["\\]/g,'_')}"`,'X-Content-Type-Options':'nosniff'})}catch{json(res,404,{error:'File not found.'})}return}
  const idMatch=url.pathname.match(/^\/api\/admin\/applications\/([A-Z0-9-]+)$/);
  if(idMatch&&req.method==='PATCH'){if(!checkOrigin(req)){json(res,403,{error:'Request origin was rejected.'});return}body(req,128*1024).then(buf=>{const val=JSON.parse(buf.toString()),r=db.prepare('SELECT * FROM applications WHERE id=?').get(idMatch[1]);if(!r){json(res,404,{error:'Application not found.'});return}if(val.status&&!['New','Approved','Rejected'].includes(val.status)){json(res,400,{error:'Invalid status.'});return}const data=val.data&&typeof val.data==='object'?val.data:JSON.parse(r.data);db.prepare('UPDATE applications SET data=?,status=? WHERE id=?').run(JSON.stringify(data),val.status||r.status,idMatch[1]);json(res,200,{ok:true})}).catch(()=>json(res,400,{error:'Invalid update.'}));return}
  if(idMatch&&req.method==='DELETE'){if(!checkOrigin(req)){json(res,403,{error:'Request origin was rejected.'});return}db.prepare('DELETE FROM applications WHERE id=?').run(idMatch[1]);json(res,200,{ok:true});return}
 }
 json(res,404,{error:'Not found.'});
}
const server=http.createServer((req,res)=>{Promise.resolve(app(req,res)).catch(err=>{console.error(err);if(!res.headersSent)json(res,500,{error:'An unexpected server error occurred.'})})});
const PORT=Number(process.env.PORT)||3000,HOST=process.env.HOST||(process.env.PORT?'0.0.0.0':'127.0.0.1');server.listen(PORT,HOST,()=>console.log(`Jamia admissions app is running at http://${HOST}:${PORT}`));





