const $ = selector => document.querySelector(selector);
$('.hero').id = 'lookup';
$('.steps').id = 'how-it-works';
let language = 'en';
let challengeId = '';
let siteSettings = {};
let siteNotices = [];
let siteClasses = [];
let studentCount = 0;
const translations = {
  en: {search:'View result',empty:'No result matched those details.',loadError:'Could not load the portal. Please refresh the page.',emptyRoll:'Please enter your roll number.',captchaError:'Verification failed. Refresh the code and try again.',captchaLoad:'Could not load verification. Please refresh the page.',print:'Print marksheet',download:'Save as PDF',exam:'Examination result',student:'Student name',father:'Father’s name',roll:'Roll number',class:'Batch / Class',subject:'Subject',marks:'Marks',total:'Total marks',percent:'Percentage',grade:'Grade',status:'Result',pass:'Pass',fail:'Fail',allClasses:'All batches / classes',classFilter:'Batch / Class',totalStudents:'Student records',classesAvailable:'Batches / classes',languages:'Languages',searchAnother:'Search another result',admin:'Admin',noticeHeading:'Latest notices',noNotices:'There are no current notices.'},
  ur: {search:'نتیجہ دیکھیں',empty:'ان تفصیلات سے کوئی نتیجہ نہیں ملا۔',loadError:'پورٹل لوڈ نہیں ہوسکا۔ براہ کرم صفحہ تازہ کریں۔',emptyRoll:'براہ کرم اپنا رول نمبر درج کریں۔',captchaError:'تصدیق ناکام ہوگئی۔ کوڈ تازہ کرکے دوبارہ کوشش کریں۔',captchaLoad:'تصدیق لوڈ نہیں ہوسکی۔ براہ کرم صفحہ تازہ کریں۔',print:'مارک شیٹ پرنٹ کریں',download:'PDF محفوظ کریں',exam:'امتحانی نتیجہ',student:'طالب علم کا نام',father:'والد کا نام',roll:'رول نمبر',class:'بیچ / درجہ',subject:'مضمون',marks:'نمبر',total:'کل نمبر',percent:'فیصد',grade:'گریڈ',status:'نتیجہ',pass:'کامیاب',fail:'ناکام',allClasses:'تمام بیچ / درجات',classFilter:'بیچ / درجہ',totalStudents:'طلبہ کے ریکارڈ',classesAvailable:'بیچ / درجات',languages:'زبانیں',searchAnother:'ایک اور نتیجہ تلاش کریں',admin:'منتظم',noticeHeading:'تازہ ترین اعلانات',noNotices:'فی الحال کوئی اعلان نہیں ہے۔'}
};
const t = key => translations[language][key] || key;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

function applyBrand(){
  const name = language === 'ur' ? siteSettings.instituteNameUr : siteSettings.instituteNameEn;
  const tagline = language === 'ur' ? siteSettings.taglineUr : siteSettings.taglineEn;
  if(name) $('#site-name').textContent = name;
  if(tagline) $('#site-tagline').textContent = tagline;
  const title=language==='ur'?siteSettings.heroTitleUr:siteSettings.heroTitleEn,description=language==='ur'?siteSettings.heroTextUr:siteSettings.heroTextEn;
  if(title){const heading=$('.hero h1');heading.textContent=title;heading.style.whiteSpace='pre-line';}
  if(description) $('.hero-inner>p').textContent=description;
  if(siteSettings.logoPath) document.querySelectorAll('.brand-logo,.result-brand img,.auth-logo').forEach(img => img.src = siteSettings.logoPath);
  const footerText = $('footer [data-en]');
  if(footerText) footerText.textContent = language === 'ur' ? (siteSettings.taglineUr || 'طلبہ نتائج پورٹل') : (siteSettings.footerText || 'Learning with purpose');
}
function renderStats(){
  let section = $('.stats-strip');
  if(!section){section=document.createElement('section');section.className='stats-strip';section.setAttribute('aria-label','Portal information');$('#result').insertAdjacentElement('afterend',section);}
  section.innerHTML = `<div class="stat"><strong>${studentCount}</strong><span>${t('totalStudents')}</span></div><div class="stat"><strong>${siteClasses.length}</strong><span>${t('classesAvailable')}</span></div><div class="stat"><strong>2</strong><span>${t('languages')}</span></div>`;
}
function renderPublicNotices(){
  let section = $('#public-notices');
  if(!section){section=document.createElement('section');section.id='public-notices';section.className='public-notices';$('.steps').insertAdjacentElement('beforebegin',section);}
  section.innerHTML = `<div class="notice-heading"><span class="eyebrow">${t('noticeHeading')}</span></div>` + (siteNotices.length ? `<div class="public-notice-grid">${siteNotices.map(n=>`<article class="public-notice"><small>${escapeHtml(n.category)} · ${new Date(n.created_at).toLocaleDateString(language==='ur'?'ur':'en')}</small><h3>${escapeHtml(language==='ur'?(n.title_ur||n.title_en):n.title_en)}</h3><p>${escapeHtml(language==='ur'?(n.body_ur||n.body_en):n.body_en)}</p></article>`).join('')}</div>` : `<p class="no-notices">${t('noNotices')}</p>`);
}
function setLanguage(next){
  language=next;document.documentElement.lang=next;document.documentElement.dir=next==='ur'?'rtl':'ltr';$('#language').textContent=next==='en'?'اردو':'English';
  document.querySelectorAll('[data-en]').forEach(el=>{el.innerHTML=next==='en'?el.dataset.en.replace(/\n/g,'<br>'):el.dataset.ur.replace(/\n/g,'<br>')});
  $('#roll').placeholder=next==='en'?$('#roll').dataset.enPlaceholder:$('#roll').dataset.urPlaceholder;
  $('#class-filter').setAttribute('aria-label',t('classFilter'));$('#class-filter').options[0].textContent=t('allClasses');
  $('#captcha').placeholder=next==='en'?'Type letters':'حروف لکھیں';$('#captcha').setAttribute('aria-label',next==='en'?'CAPTCHA answer':'کیپچا کا جواب');
  $('#captcha-question').setAttribute('aria-label',next==='en'?'Enter the six letters shown':'دکھائے گئے چھ حروف درج کریں');
  $('#refresh-captcha').setAttribute('aria-label',next==='en'?'New CAPTCHA':'نیا کیپچا');$('#refresh-captcha').title=next==='en'?'New CAPTCHA':'نیا کیپچا';
  $('#search span').textContent=t('search');$('#admin-link').textContent=t('admin');$('#result').innerHTML='';$('#result').hidden=true;$('#notice').textContent='';applyBrand();renderStats();renderPublicNotices();
}
function resultCard(s){
  const rows=Object.entries(s.marks||{}).map(([subject,value])=>`<tr><td>${escapeHtml(subject)}</td><td>${escapeHtml(value??'—')}</td></tr>`).join('');
  const passed=String(s.status).toLowerCase()==='pass',institute=language==='ur'?siteSettings.instituteNameUr:siteSettings.instituteNameEn,pct=Math.max(0,Math.min(100,Number(s.percentage)||0));
  return `<article class="result-card"><div class="result-head"><div class="result-brand"><img src="${escapeHtml(siteSettings.logoPath||'mub-logo.jpeg')}" alt=""><div><span class="result-kicker">${escapeHtml(institute||'')}</span><h2>${t('exam')}</h2><p>${escapeHtml(s.className)} · ${t('class')}</p></div></div><div class="actions"><button onclick="window.print()">▤ ${t('print')}</button><button onclick="window.print()">⇩ ${t('download')}</button><button class="another-result" onclick="resetSearch()">↩ ${t('searchAnother')}</button></div></div><div class="student-grid"><div class="field"><label>${t('student')}</label><strong>${escapeHtml(s.name)}</strong></div><div class="field"><label>${t('father')}</label><strong>${escapeHtml(s.fatherName)}</strong></div><div class="field"><label>${t('roll')}</label><strong>${escapeHtml(s.rollNo)}</strong></div><div class="field"><label>${t('class')}</label><strong>${escapeHtml(s.className)}</strong></div></div><div style="overflow-x:auto"><table class="marks"><thead><tr><th>${t('subject')}</th><th>${t('marks')}</th></tr></thead><tbody>${rows}</tbody></table></div><div class="summary"><div class="metric"><label>${t('total')}</label><strong>${escapeHtml(s.total)}</strong></div><div class="metric"><label>${t('percent')}</label><strong>${pct.toFixed(2)}%</strong><span class="score-track" aria-label="${pct.toFixed(2)} percent"><span style="width:${pct}%"></span></span></div><div class="metric"><label>${t('grade')}</label><strong>${escapeHtml(s.grade)}</strong></div><span class="status ${passed?'':'fail'}">${passed?t('pass'):t('fail')}</span></div></article>`;
}
async function newCaptcha(){
  challengeId='';$('#captcha').value='';$('#captcha-question').replaceChildren();$('#captcha-question').setAttribute('aria-busy','true');$('#refresh-captcha').disabled=true;
  try{const response=await fetch('/results/api/captcha',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),data=await response.json();if(!response.ok||!data.id||typeof data.letters!=='string'||data.letters.length!==6)throw Error();challengeId=data.id;$('#captcha-question').innerHTML=[...data.letters].map(letter=>`<span style="--tilt:${Math.floor(Math.random()*17)-8}deg;--lift:${Math.floor(Math.random()*5)-2}px">${escapeHtml(letter)}</span>`).join('');}
  catch{$('#notice').textContent=t('captchaLoad');}
  finally{$('#captcha-question').removeAttribute('aria-busy');$('#refresh-captcha').disabled=false;}
}
async function search(){
  const rollNo=$('#roll').value.trim().replace(/\.0$/,'');if(!rollNo){$('#notice').textContent=t('emptyRoll');$('#result').hidden=true;return;}
  if(!challengeId){$('#notice').textContent=t('captchaLoad');return;}
  $('#notice').textContent='';$('#search').disabled=true;
  try{const response=await fetch('/results/api/results/search',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rollNo,className:$('#class-filter').value,captcha:$('#captcha').value,challengeId})}),data=await response.json();if(!response.ok)throw Error(response.status===404?t('empty'):response.status===400?t('captchaError'):data.error||t('empty'));$('#result').innerHTML=resultCard(data.result);$('#result').hidden=false;await newCaptcha();$('#result').scrollIntoView({behavior:'smooth',block:'start'});}
  catch(error){$('#result').hidden=true;await newCaptcha();$('#notice').textContent=challengeId?error.message:t('captchaLoad');}
  finally{$('#search').disabled=false;}
}
function resetSearch(){$('#result').hidden=true;$('#result').innerHTML='';$('#notice').textContent='';$('#roll').value='';newCaptcha();$('#roll').focus();$('.hero').scrollIntoView({behavior:'smooth',block:'start'});}

const classFilterRow=document.createElement('div');classFilterRow.className='class-filter-row';classFilterRow.innerHTML=`<label for="class-filter" data-en="Batch / Class" data-ur="بیچ / درجہ">Batch / Class</label>`;
const classFilter=document.createElement('select');classFilter.id='class-filter';classFilter.setAttribute('aria-label',t('classFilter'));classFilter.innerHTML=`<option value="">${t('allClasses')}</option>`;classFilterRow.append(classFilter);$('.searchbox').insertAdjacentElement('afterend',classFilterRow);
const captcha=document.createElement('div');captcha.className='captcha-row';captcha.innerHTML='<label for="captcha" data-en="Quick check" data-ur="تصدیقی سوال">Quick check</label><span id="captcha-question" class="captcha-question" aria-label="Enter the six letters shown" aria-live="polite"></span><input id="captcha" inputmode="text" autocapitalize="off" spellcheck="false" autocomplete="off" maxlength="6" aria-label="CAPTCHA answer" placeholder="Type letters" data-en-placeholder="Type letters" data-ur-placeholder="حروف لکھیں"><button id="refresh-captcha" type="button" aria-label="New CAPTCHA" title="New CAPTCHA">↻</button>';
classFilterRow.insertAdjacentElement('afterend',captcha);const captchaHint=document.createElement('small');captchaHint.className='captcha-hint';captchaHint.dataset.en='Enter all six letters. Uppercase and lowercase must match.';captchaHint.dataset.ur='چھوں حروف درج کریں۔ بڑے اور چھوٹے حروف کا فرق ملحوظ رکھیں۔';captchaHint.textContent=captchaHint.dataset.en;captcha.insertAdjacentElement('afterend',captchaHint);
$('#language').addEventListener('click',()=>setLanguage(language==='en'?'ur':'en'));$('#search').addEventListener('click',search);$('#roll').addEventListener('keydown',e=>{if(e.key==='Enter')search();});$('#captcha').addEventListener('keydown',e=>{if(e.key==='Enter')search();});$('#refresh-captcha').addEventListener('click',()=>{$('#notice').textContent='';newCaptcha();});$('#year').textContent=new Date().getFullYear();
fetch('/results/api/site').then(r=>{if(!r.ok)throw Error();return r.json();}).then(data=>{siteSettings=data.settings;siteNotices=data.notices||[];siteClasses=data.classes||[];studentCount=data.studentCount||0;for(const name of siteClasses){const option=document.createElement('option');option.value=name;option.textContent=name;classFilter.append(option);}applyBrand();renderStats();renderPublicNotices();}).catch(()=>{$('#notice').textContent=t('loadError');$('#search').disabled=true;});
newCaptcha();
