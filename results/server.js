const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const STORE = path.resolve(process.env.RESULTS_DATA_DIR || process.env.DATA_DIR || path.join(ROOT, '..', 'data'));
fs.mkdirSync(STORE, { recursive: true });
const db = new DatabaseSync(path.join(STORE, 'portal.sqlite'));
function transaction(work){db.exec('BEGIN IMMEDIATE');try{const value=work();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY, class_name TEXT NOT NULL, roll_no TEXT NOT NULL, name TEXT NOT NULL, father_name TEXT NOT NULL DEFAULT '', marks_json TEXT NOT NULL DEFAULT '{}', total REAL NOT NULL DEFAULT 0, percentage REAL NOT NULL DEFAULT 0, grade TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, UNIQUE(class_name,roll_no));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notices(id INTEGER PRIMARY KEY,title_en TEXT NOT NULL,title_ur TEXT NOT NULL DEFAULT '',body_en TEXT NOT NULL DEFAULT '',body_ur TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'General',published INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);`);

const defaults={instituteNameEn:'Faizan e ummul khair',instituteNameUr:'جامعة البنات',taglineEn:'Student Result Portal',taglineUr:'طلبہ نتائج پورٹل',footerText:'Learning with purpose',heroTitleEn:'Your hard work,\nbeautifully reflected.',heroTitleUr:'آپ کی محنت کا\nخوبصورت نتیجہ۔',heroTextEn:'Find your academic result using your roll number.',heroTextUr:'اپنا رول نمبر درج کرکے اپنا تعلیمی نتیجہ دیکھیں۔',logoPath:'/results/mub-logo.jpeg'};
for(const [key,value] of Object.entries(defaults)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(key,value);
const recordCount=db.prepare('SELECT COUNT(*) AS n FROM records').get().n;
const seed=path.join(STORE,'seed-results.json');
if(!recordCount&&fs.existsSync(seed)){
  const insert=db.prepare('INSERT OR IGNORE INTO records(class_name,roll_no,name,father_name,marks_json,total,percentage,grade,status) VALUES(?,?,?,?,?,?,?,?,?)');
  transaction(()=>{for(const r of JSON.parse(fs.readFileSync(seed,'utf8'))) insert.run(String(r.className),String(r.rollNo),String(r.name),String(r.fatherName||''),JSON.stringify(r.marks||{}),Number(r.total)||0,Number(r.percentage)||0,String(r.grade||''),String(r.status||''));});
}

const username=process.env.ADMIN_USERNAME||'maimuna01';
const password=process.env.ADMIN_PASSWORD||'';
if(username.length<3||password.length<12){console.error('Set ADMIN_PASSWORD (at least 12 characters) before starting the combined portal.');process.exit(1);}
const adminSalt=crypto.randomBytes(16),adminHash=crypto.scryptSync(password,adminSalt,64);
const sessions=new Map(),captchas=new Map(),limits=new Map();
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const allowedFiles=new Set(['index.html','admin.html','styles.css','polish.css','captcha.css','visual.css','quran.css','motion.css','features.css','server-features.css','admin.css','admin-features.css','app.js','admin.js','mub-logo.jpeg']);
const now=()=>new Date().toISOString();
const send=(res,status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(JSON.stringify(data));};
function settings(){return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(x=>[x.key,x.value]));}
function row(r){return {id:r.id,className:r.class_name,rollNo:r.roll_no,name:r.name,fatherName:r.father_name,marks:JSON.parse(r.marks_json),total:r.total,percentage:r.percentage,grade:r.grade,status:r.status,active:Boolean(r.active)};}
function recordById(id){const r=db.prepare('SELECT * FROM records WHERE id=?').get(id);return r&&row(r);}
function audit(action,detail){db.prepare('INSERT INTO audit(action,detail,created_at) VALUES(?,?,?)').run(action,detail,now());}
function cookie(req,name){const part=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));return part?decodeURIComponent(part.slice(name.length+1)):'';}
function authenticated(req){const id=cookie(req,'portal_session'),entry=sessions.get(id);if(!entry||entry.expires<Date.now()){if(id)sessions.delete(id);return false;}entry.expires=Date.now()+60*60*1000;return true;}
function limited(req,key,max=25){const ip=req.socket.remoteAddress||'local',id=key+':'+ip;const item=limits.get(id)||{start:Date.now(),count:0};if(Date.now()-item.start>60000){item.start=Date.now();item.count=0;}item.count++;limits.set(id,item);return item.count<=max;}
function body(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>2*1024*1024){reject(new Error('Request too large'));req.destroy();}});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(new Error('Invalid JSON body'));}});req.on('error',reject);});}
function text(v,max=500){return String(v??'').trim().slice(0,max);}
function validRecord(d){return d&&text(d.className,80)&&text(d.rollNo,60)&&text(d.name,160)&&d.marks&&typeof d.marks==='object'&&!Array.isArray(d.marks)&&Object.entries(d.marks).every(([k,v])=>text(k,160)&&Number.isFinite(Number(v))&&Number(v)>=0)&&Number.isFinite(Number(d.total))&&Number(d.total)>=0&&Number.isFinite(Number(d.percentage))&&Number(d.percentage)>=0&&Number(d.percentage)<=100&&text(d.status,40);}
function parseCsv(input){const rows=[];let row=[],field='',quoted=false;for(let i=0;i<input.length;i++){const ch=input[i];if(quoted){if(ch==='"'&&input[i+1]==='"'){field+='"';i++;}else if(ch==='"')quoted=false;else field+=ch;}else if(ch==='"')quoted=true;else if(ch===','){row.push(field);field='';}else if(ch==='\n'){row.push(field.replace(/\r$/,''));if(row.some(x=>x.trim()))rows.push(row);row=[];field='';}else field+=ch;}if(quoted)throw Error('CSV has an unclosed quoted field.');row.push(field.replace(/\r$/,''));if(row.some(x=>x.trim()))rows.push(row);return rows;}
function csrfOk(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}}

async function handle(req,res){
  const url=new URL(req.url,'http://localhost');
  try{
    if(req.method==='GET'&&url.pathname==='/api/site'){
      const config=settings();const notices=db.prepare('SELECT id,title_en,title_ur,body_en,body_ur,category,created_at FROM notices WHERE published=1 ORDER BY id DESC LIMIT 10').all();
      return send(res,200,{settings:config,notices,classes:db.prepare('SELECT DISTINCT class_name FROM records WHERE active=1 ORDER BY class_name').all().map(x=>x.class_name),studentCount:db.prepare('SELECT COUNT(*) AS n FROM records WHERE active=1').get().n});
    }
    if(req.method==='GET'&&url.pathname==='/api/brand-logo'){
      const file=path.join(STORE,'brand-logo.bin');if(!fs.existsSync(file))return send(res,404,{error:'No replacement logo uploaded.'});res.writeHead(200,{'content-type':settings().logoMime||'image/jpeg','cache-control':'no-cache','x-content-type-options':'nosniff'});return fs.createReadStream(file).pipe(res);
    }
    if(req.method==='POST'&&url.pathname==='/api/captcha'){
      if(!limited(req,'captcha',45))return send(res,429,{error:'Please wait and request a new check.'});
      const upper='ABCDEFGHJKLMNPQRSTUVWXYZ',lower='abcdefghijkmnpqrstuvwxyz',chars=upper+lower;
      const answerChars=[upper[crypto.randomInt(upper.length)],lower[crypto.randomInt(lower.length)],...Array.from({length:4},()=>chars[crypto.randomInt(chars.length)])];
      for(let i=answerChars.length-1;i>0;i--){const j=crypto.randomInt(i+1);[answerChars[i],answerChars[j]]=[answerChars[j],answerChars[i]];}
      const answer=answerChars.join(''),id=crypto.randomBytes(24).toString('hex');captchas.set(id,{answer,expires:Date.now()+180000});
      return send(res,200,{id,letters:answer});
    }
    if(req.method==='POST'&&url.pathname==='/api/results/search'){
      if(!limited(req,'result-search',12))return send(res,429,{error:'Too many searches. Wait a minute and try again.'});
      const data=await body(req),challenge=captchas.get(text(data.challengeId,80));captchas.delete(text(data.challengeId,80));
      if(!challenge||challenge.expires<Date.now()||String(data.captcha||'')!==challenge.answer)return send(res,400,{error:'Verification failed. Refresh the code and try again.'});
      const rollNo=text(data.rollNo,60),className=text(data.className,80);
      if(!rollNo)return send(res,400,{error:'Enter your roll number.'});
      const record=className
        ?db.prepare('SELECT * FROM records WHERE active=1 AND roll_no=? AND class_name=?').get(rollNo,className)
        :db.prepare('SELECT * FROM records WHERE active=1 AND roll_no=? ORDER BY class_name LIMIT 1').get(rollNo);
      if(!record)return send(res,404,{error:'No result matched those details.'});
      return send(res,200,{result:row(record)});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/login'){
      if(!limited(req,'admin-login',6))return send(res,429,{error:'Too many login attempts. Try again later.'});
      if(!csrfOk(req))return send(res,403,{error:'Request origin rejected.'});
      const data=await body(req),user=text(data.username,100),pass=String(data.password||'');
      const hash=crypto.scryptSync(pass,adminSalt,64),userOk=crypto.timingSafeEqual(crypto.createHash('sha256').update(user).digest(),crypto.createHash('sha256').update(username).digest()),passOk=crypto.timingSafeEqual(hash,adminHash);
      if(!userOk||!passOk)return send(res,401,{error:'Invalid username or password.'});
      const sid=crypto.randomBytes(32).toString('hex');sessions.set(sid,{expires:Date.now()+60*60*1000,user});audit('admin.login',`Administrator ${user} signed in.`);
      return send(res,200,{ok:true},{'set-cookie':`portal_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${process.env.NODE_ENV==='production'?'; Secure':''}`});
    }
    if(req.method==='POST'&&url.pathname==='/api/admin/logout'){
      if(!csrfOk(req))return send(res,403,{error:'Request origin rejected.'});const sid=cookie(req,'portal_session');sessions.delete(sid);return send(res,200,{ok:true},{'set-cookie':'portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});
    }
    if(url.pathname.startsWith('/api/admin/')){
      if(!authenticated(req))return send(res,401,{error:'Please sign in.'});
      if(req.method!=='GET'&&!csrfOk(req))return send(res,403,{error:'Request origin rejected.'});
      if(req.method==='GET'&&url.pathname==='/api/admin/data')return send(res,200,{records:db.prepare('SELECT * FROM records ORDER BY class_name,roll_no').all().map(row),settings:settings(),notices:db.prepare('SELECT * FROM notices ORDER BY id DESC').all(),audit:db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all()});
      if(req.method==='PUT'&&url.pathname==='/api/admin/settings'){
        const d=await body(req),allowed=['instituteNameEn','instituteNameUr','taglineEn','taglineUr','footerText','heroTitleEn','heroTitleUr','heroTextEn','heroTextUr'];
        transaction(()=>{for(const key of allowed)if(d[key]!==undefined)db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,text(d[key],250));});audit('settings.update',`Administrator ${username} updated institute settings.`);return send(res,200,{settings:settings()});
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/logo'){
        const d=await body(req),match=String(d.image||'').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);if(!match)return send(res,400,{error:'Choose a PNG or JPEG image.'});const bytes=Buffer.from(match[2],'base64');if(bytes.length>1024*1024)return send(res,413,{error:'Logo file must be 1 MB or smaller.'});const valid=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,3).equals(Buffer.from([255,216,255]));if(!valid)return send(res,400,{error:'This image file could not be verified.'});fs.writeFileSync(path.join(STORE,'brand-logo.bin'),bytes);db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('logoPath','/results/api/brand-logo');db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('logoMime',`image/${match[1]}`);audit('settings.logo',`Administrator ${username} replaced the institute logo.`);return send(res,200,{settings:settings()});
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/import/results'){
        const d=await body(req);if(typeof d.csv!=='string'||d.csv.length>1500000)return send(res,400,{error:'Upload a CSV file smaller than 1.5 MB.'});let rows;try{rows=parseCsv(d.csv);}catch{return send(res,400,{error:'CSV contains an unclosed quoted field.'});}if(rows.length<2)return send(res,400,{error:'CSV contains no result rows.'});const heads=rows[0].map(x=>x.trim().replace(/^\uFEFF/,'').toLowerCase()),required=['class','rollno','name','fathername','subject','mark','total','percentage','grade','status'];if(required.some(h=>!heads.includes(h)))return send(res,400,{error:`CSV headers must include: ${required.join(', ')}`});const idx=Object.fromEntries(required.map(h=>[h,heads.indexOf(h)])),grouped=new Map();
        for(let i=1;i<rows.length;i++){const cells=rows[i],v=Object.fromEntries(required.map(h=>[h,cells[idx[h]]||''])),className=text(v.class,80),rollNo=text(v.rollno,60),name=text(v.name,160),fatherName=text(v.fathername,160),subject=text(v.subject,160),mark=Number(v.mark),total=Number(v.total),percentage=Number(v.percentage),grade=text(v.grade,40),status=text(v.status,40);if(!className||!rollNo||!name||!subject||!Number.isFinite(mark)||mark<0||!Number.isFinite(total)||total<0||!Number.isFinite(percentage)||percentage<0||percentage>100||!status)return send(res,400,{error:`Invalid or incomplete values on CSV row ${i+1}.`});const key=className+'\u0000'+rollNo;let item=grouped.get(key);if(!item){item={className,rollNo,name,fatherName,marks:{},total,percentage,grade,status};grouped.set(key,item);}else if(item.name!==name||item.fatherName!==fatherName||item.total!==total||item.percentage!==percentage||item.grade!==grade||item.status!==status)return send(res,400,{error:`Student details conflict on CSV row ${i+1}.`});if(Object.hasOwn(item.marks,subject))return send(res,400,{error:`Duplicate subject for roll ${rollNo} on CSV row ${i+1}.`});item.marks[subject]=mark;}
        const upsert=db.prepare('INSERT INTO records(class_name,roll_no,name,father_name,marks_json,total,percentage,grade,status,active) VALUES(?,?,?,?,?,?,?,?,?,1) ON CONFLICT(class_name,roll_no) DO UPDATE SET name=excluded.name,father_name=excluded.father_name,marks_json=excluded.marks_json,total=excluded.total,percentage=excluded.percentage,grade=excluded.grade,status=excluded.status,active=1');transaction(()=>{for(const r of grouped.values())upsert.run(r.className,r.rollNo,r.name,r.fatherName,JSON.stringify(r.marks),r.total,r.percentage,r.grade,r.status);});audit('records.import',`Imported or updated ${grouped.size} result records from CSV.`);return send(res,200,{imported:grouped.size});
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/records'){
        const d=await body(req);if(!validRecord(d))return send(res,400,{error:'Complete the required student and result fields.'});
        const result=db.prepare('INSERT INTO records(class_name,roll_no,name,father_name,marks_json,total,percentage,grade,status,active) VALUES(?,?,?,?,?,?,?,?,?,1)').run(text(d.className,80),text(d.rollNo,60),text(d.name,160),text(d.fatherName,160),JSON.stringify(d.marks),Number(d.total),Number(d.percentage),text(d.grade,40),text(d.status,40));audit('record.create',`Added ${text(d.rollNo,60)} (${text(d.className,80)}).`);return send(res,201,{record:recordById(result.lastInsertRowid)});
      }
      const recMatch=url.pathname.match(/^\/api\/admin\/records\/(\d+)$/);
      if(recMatch&&req.method==='PUT'){
        const id=Number(recMatch[1]),before=recordById(id),d=await body(req);if(!before)return send(res,404,{error:'Record not found.'});if(!validRecord(d))return send(res,400,{error:'Complete the required student and result fields.'});
        db.prepare('UPDATE records SET class_name=?,roll_no=?,name=?,father_name=?,marks_json=?,total=?,percentage=?,grade=?,status=?,active=? WHERE id=?').run(text(d.className,80),text(d.rollNo,60),text(d.name,160),text(d.fatherName,160),JSON.stringify(d.marks),Number(d.total),Number(d.percentage),text(d.grade,40),text(d.status,40),d.active===false?0:1,id);
        audit('record.update',`Updated ${before.rollNo} (${before.className}); before=${JSON.stringify(before)}; after=${JSON.stringify(recordById(id))}`);return send(res,200,{record:recordById(id)});
      }
      if(recMatch&&req.method==='DELETE'){
        const id=Number(recMatch[1]),before=recordById(id);if(!before)return send(res,404,{error:'Record not found.'});db.prepare('UPDATE records SET active=0 WHERE id=?').run(id);audit('record.deactivate',`Deactivated ${before.rollNo} (${before.className}).`);return send(res,200,{ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/admin/notices'){
        const d=await body(req);if(!text(d.titleEn,160)||!text(d.bodyEn,2000))return send(res,400,{error:'English title and message are required.'});const r=db.prepare('INSERT INTO notices(title_en,title_ur,body_en,body_ur,category,published,created_at) VALUES(?,?,?,?,?,?,?)').run(text(d.titleEn,160),text(d.titleUr,160),text(d.bodyEn,2000),text(d.bodyUr,2000),text(d.category,60)||'General',d.published?1:0,now());audit('notice.create',`Created notice ${r.lastInsertRowid}.`);return send(res,201,{id:r.lastInsertRowid});
      }
      const noticeMatch=url.pathname.match(/^\/api\/admin\/notices\/(\d+)$/);
      if(noticeMatch&&req.method==='PUT'){
        const d=await body(req),id=Number(noticeMatch[1]);if(!text(d.titleEn,160)||!text(d.bodyEn,2000))return send(res,400,{error:'English title and message are required.'});const old=db.prepare('SELECT id FROM notices WHERE id=?').get(id);if(!old)return send(res,404,{error:'Notice not found.'});db.prepare('UPDATE notices SET title_en=?,title_ur=?,body_en=?,body_ur=?,category=?,published=? WHERE id=?').run(text(d.titleEn,160),text(d.titleUr,160),text(d.bodyEn,2000),text(d.bodyUr,2000),text(d.category,60)||'General',d.published?1:0,id);audit('notice.update',`Updated notice ${id}.`);return send(res,200,{ok:true});
      }
      if(noticeMatch&&req.method==='DELETE'){const id=Number(noticeMatch[1]);db.prepare('DELETE FROM notices WHERE id=?').run(id);audit('notice.delete',`Deleted notice ${id}.`);return send(res,200,{ok:true});}
      return send(res,404,{error:'Admin endpoint not found.'});
    }
    if(req.method==='GET'&&url.pathname==='/')return serve('index.html',res);
    if(req.method==='GET'&&url.pathname==='/admin')return serve('admin.html',res);
    if(req.method==='GET'&&url.pathname==='/admin.html')return serve('admin.html',res);
    if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
    if(req.method==='GET'&&url.pathname.startsWith('/')){const file=decodeURIComponent(url.pathname.slice(1));if(allowedFiles.has(file))return serve(file,res);}
    return send(res,404,{error:'Not found.'});
    }catch(error){console.error(error);if(!res.headersSent)send(res,500,{error:'The request could not be completed.'});else res.destroy();}
}
function serve(name,res){const file=path.join(ROOT,name);if(!allowedFiles.has(name))return send(res,404,{error:'Not found.'});res.writeHead(200,{'content-type':mime[path.extname(name)]||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin','x-frame-options':'DENY'});fs.createReadStream(file).pipe(res);}
module.exports=handle;
if(require.main===module){
  const server=http.createServer(handle);
  const port=Number(process.env.PORT)||8000;
  const host=process.env.HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
  server.listen(port,host,()=>console.log(`Student Result Portal running at http://${host}:${port} (admin: /admin)`));
}
