/* =============================================
   Quiz App - Core Logic + Upload Feature
   ============================================= */

// Encrypted credentials (PBKDF2+XOR, decrypted only with correct password)
const _H="8e955fe8fb522ee81e7eee024339148d7bf602ea62c2db9e582c51d90da62bfc";
const _G="1quth0GKmFkNNPYYD/7G+JETONpYNOyz6zFJ7SIKCWHXwOiw0S8eQdPo70sN5f5IgQgnqmVU5r6zDyPoLn4yWdbu3L3y";
const _J="Hl9Slfly9gyv0hBm4AaaPcbEyhjDLDLeZ2eSf7rSsTv+pkzDQoNud0Pu+tCkAR62gKzoE8pxW6wvbeJT2enoZMmvM7lWmGlTb8Xa/Q==";
const _B="6a38ef0bda38895dfeea24cc";

// ---- State ----
let allSubjects = {};
let cloudSubjects = {};
let currentSubject = null;
let currentCourses = null;
let currentQuestions = [];
let currentIndex = 0;
let answers = {};
let confirmed = {};
let mode = 'learn';
let stats = {correct:0, wrong:0};
let decryptedGemini = null;
let decryptedJsonbin = null;
let isEditingSubjectKey = null; // Tracks if we are adding courses to an existing subject

// ---- Crypto helpers ----
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

async function decryptKey(encB64, password) {
  const raw = Uint8Array.from(atob(encB64), c=>c.charCodeAt(0));
  const salt = raw.slice(0,16);
  const enc = raw.slice(16);
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'}, km, 256));
  const dec = new Uint8Array(enc.length);
  for(let i=0;i<enc.length;i++) dec[i]=enc[i]^bits[i%bits.length];
  return new TextDecoder().decode(dec);
}

// ---- Cloud storage (JSONBin.io) ----
async function loadCloudSubjects() {
  try {
    const r = await fetch(`https://api.jsonbin.io/v3/b/${_B}/latest`, {headers:{'X-Bin-Meta':'false'}});
    if(r.ok) { const d = await r.json(); cloudSubjects = d.subjects||{}; }
  } catch(e) { console.log('Cloud load skipped:', e.message); }
}

async function saveCloudSubjects() {
  try {
    await fetch(`https://api.jsonbin.io/v3/b/${_B}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json','X-Master-Key':decryptedJsonbin},
      body: JSON.stringify({subjects:cloudSubjects})
    });
  } catch(e) { console.error('Cloud save failed:', e); }
}

// ---- Init ----
async function init() {
  allSubjects = {...BUILTIN_SUBJECTS};
  await loadCloudSubjects();
  Object.assign(allSubjects, cloudSubjects);
  
  // Auto-login if password is saved in sessionStorage
  const savedPwd = sessionStorage.getItem('admin_pwd');
  if (savedPwd) {
    const hash = await sha256(savedPwd);
    if (hash === _H) {
      decryptedGemini = await decryptKey(_G, savedPwd);
      decryptedJsonbin = await decryptKey(_J, savedPwd);
    }
  }
  
  renderSubjectPicker();
}

function renderSubjectPicker() {
  const grid = document.getElementById('subjectCards');
  grid.innerHTML = '';
  for(const [key, subj] of Object.entries(allSubjects)) {
    const totalQ = Object.values(subj.courses).reduce((s,c)=>s+c.questions.length,0);
    const isCloud = !!cloudSubjects[key];
    const showDelete = isCloud && decryptedJsonbin;
    const deleteHtml = showDelete ? `<button class="delete-btn" onclick="event.stopPropagation(); deleteSubject('${key}')" title="Șterge materia">🗑️</button>` : '';
    grid.innerHTML += `<div class="subject-card" onclick="selectSubject('${key}')">
      <div class="badge">${totalQ} întrebări</div>
      ${isCloud?'<div class="cloud-badge">☁️</div>':''}
      <div class="icon">${isCloud?'📁':'📊'}</div>
      <div class="name">${subj.title}</div>
      <div class="desc">${subj.sub||''}</div>
      ${deleteHtml}
    </div>`;
  }
  // Add upload card (changes name based on admin state)
  const uploadLabel = decryptedJsonbin ? 'Adaugă Materie Nouă (Admin)' : 'Adaugă Materie Nouă';
  grid.innerHTML += `<div class="subject-card upload-card" onclick="showPasswordModalOrUI()">
    <div class="icon">➕</div>
    <div class="name">${uploadLabel}</div>
    <div class="desc">Upload PDF/PPT → generare automată de grile cu AI</div>
  </div>`;
}

async function deleteSubject(key) {
  if (!decryptedJsonbin) return;
  if (!confirm(`Sigur doriți să ștergeți definitiv materia "${allSubjects[key].title}" din cloud? Această acțiune nu poate fi anulată.`)) return;
  
  delete cloudSubjects[key];
  delete allSubjects[key];
  renderSubjectPicker();
  
  try {
    await saveCloudSubjects();
    alert('Materia a fost ștearsă cu succes din cloud!');
  } catch(e) {
    alert('Eroare la salvarea în cloud, dar a fost ștearsă local.');
  }
}

// ---- Password Modal ----
function showPasswordModalOrUI() {
  isEditingSubjectKey = null; // Standard creation
  if (decryptedJsonbin) {
    showUploadUI();
  } else {
    showPasswordModal();
  }
}

function showPasswordModal() {
  document.getElementById('pwdModal').style.display = 'flex';
  document.getElementById('pwdInput').value = '';
  document.getElementById('pwdError').style.display = 'none';
  document.getElementById('pwdInput').focus();
}

function closePwdModal() {
  document.getElementById('pwdModal').style.display = 'none';
}

async function checkPassword() {
  const pwd = document.getElementById('pwdInput').value;
  const hash = await sha256(pwd);
  if(hash === _H) {
    decryptedGemini = await decryptKey(_G, pwd);
    decryptedJsonbin = await decryptKey(_J, pwd);
    
    // Save to sessionStorage to persist across refreshes
    sessionStorage.setItem('admin_pwd', pwd);
    
    closePwdModal();
    
    // Immediately refresh views to show admin actions (like trash icons)
    renderSubjectPicker();
    if (currentSubject) {
      selectSubject(currentSubject);
    }
    
    if (isEditingSubjectKey) {
      showUploadUIForEditing();
    } else {
      showUploadUI();
    }
  } else {
    document.getElementById('pwdError').style.display = 'block';
  }
}

// ---- Upload UI ----
function showUploadUI() {
  isEditingSubjectKey = null;
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('home').style.display = 'none'; // Ensure home is hidden
  document.getElementById('uploadArea').style.display = 'block';
  document.getElementById('uploadFiles').value = '';
  document.getElementById('uploadName').value = '';
  document.getElementById('uploadName').disabled = false;
  document.getElementById('uploadTitle').textContent = 'Adaugă Materie Nouă';
  document.getElementById('uploadSubText').textContent = 'Upload-ează cursurile (PDF/PPTX) și AI-ul generează grilele automat';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadForm').style.display = 'block';
}

function showAddCoursesUI() {
  isEditingSubjectKey = currentSubject;
  if (decryptedJsonbin) {
    showUploadUIForEditing();
  } else {
    showPasswordModal();
  }
}

function showUploadUIForEditing() {
  const subjName = allSubjects[isEditingSubjectKey].title;
  document.getElementById('home').style.display = 'none';
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('uploadArea').style.display = 'block';
  document.getElementById('uploadFiles').value = '';
  document.getElementById('uploadName').value = subjName;
  document.getElementById('uploadName').disabled = true; // cannot change name while editing
  document.getElementById('uploadTitle').textContent = `Adaugă Cursuri la "${subjName}"`;
  document.getElementById('uploadSubText').textContent = `Procesează fișiere adiționale care vor fi salvate direct în materia existentă`;
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadForm').style.display = 'block';
}

async function extractPdfText(file) {
  const ab = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:ab}).promise;
  let text = '';
  for(let i=1; i<=pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    text += tc.items.map(it=>it.str).join(' ') + '\n';
  }
  return text;
}

async function extractPptxText(file) {
  const ab = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(ab);
  let texts = [];
  const slideFiles = Object.keys(zip.files).filter(n=>n.match(/ppt\/slides\/slide\d+\.xml/)).sort((a,b)=>{
    const na=parseInt(a.match(/slide(\d+)/)[1]), nb=parseInt(b.match(/slide(\d+)/)[1]);
    return na-nb;
  });
  for(const sf of slideFiles) {
    const xml = await zip.file(sf).async('text');
    const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) || [];
    const slideText = matches.map(m=>m.replace(/<\/?a:t>/g,'')).join(' ');
    if(slideText.trim()) texts.push(slideText);
  }
  return texts.join('\n\n');
}

function sanitizeJsonString(raw) {
  let inside = false;
  let result = '';
  for (let i = 0; i < raw.length; i++) {
    let c = raw[i];
    if (c === '"' && (i === 0 || raw[i-1] !== '\\')) {
      inside = !inside;
    }
    if (inside) {
      if (c === '\n') {
        result += '\\n';
      } else if (c === '\r') {
        result += '\\r';
      } else if (c === '\t') {
        result += '\\t';
      } else if (c.charCodeAt(0) < 32) {
        // Remove or ignore bad control characters below ASCII 32
      } else {
        result += c;
      }
    } else {
      result += c;
    }
  }
  return result;
}

async function generateQuestions(text, courseName, courseNum) {
  const prompt = `Ești un profesor universitar. Din textul de mai jos, generează exact 15 întrebări grilă pentru examen.

REGULI STRICTE:
- Unele întrebări trebuie să aibă UN SINGUR răspuns corect, altele MAI MULTE răspunsuri corecte
- Fiecare întrebare are 4-5 variante (A, B, C, D, eventual E)
- Câmpul "correct" este un ARRAY de litere corecte: ["B"] sau ["A","C","D"]
- Include explicații scurte
- Păstrează diacriticele românești
- Răspunde DOAR cu JSON valid, fără markdown, fără text suplimentar

FORMAT JSON (array de obiecte):
[{"id":"${courseNum}_q1","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":["B"],"explanation":"..."}]

TEXT CURS "${courseName}":
${text.substring(0, 8000)}`;

  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
    method: 'POST',
    headers: {'Content-Type':'application/json', 'X-goog-api-key': decryptedGemini},
    body: JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.7}})
  });

  if(!r.ok) {
    const errData = await r.json().catch(()=>({}));
    const errMsg = errData.error?.message || `HTTP ${r.status}`;
    const err = new Error(errMsg);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  let responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  responseText = responseText.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim();
  responseText = sanitizeJsonString(responseText);
  return JSON.parse(responseText);
}

async function startGeneration() {
  const nameInput = document.getElementById('uploadName');
  const filesInput = document.getElementById('uploadFiles');
  const subjectName = nameInput.value.trim();
  const files = Array.from(filesInput.files);

  if(!subjectName) { alert('Introdu un nume pentru materie!'); return; }
  if(!files.length) { alert('Selectează cel puțin un fișier!'); return; }

  document.getElementById('uploadForm').style.display = 'none';
  document.getElementById('uploadProgress').style.display = 'block';

  const log = document.getElementById('progressLog');
  const bar = document.getElementById('genProgressFill');
  const courses = {};
  
  // Determine starting index for new courses if editing
  let startIdx = 0;
  if (isEditingSubjectKey) {
    startIdx = Object.keys(allSubjects[isEditingSubjectKey].courses).length;
  }
  
  const generatedSubjectKey = isEditingSubjectKey || (subjectName.toLowerCase().replace(/[^a-z0-9]/g,'_').substring(0,30) + '_' + Date.now());

  log.innerHTML = '';
  const addLog = (msg, type='info') => {
    log.innerHTML += `<div class="log-${type}">${msg}</div>`;
    log.scrollTop = log.scrollHeight;
  };

  for(let i=0; i<files.length; i++) {
    const file = files[i];
    const pct = Math.round(((i)/files.length)*100);
    bar.style.width = pct+'%';
    const fname = file.name.replace(/\.(pdf|pptx?)$/i,'');
    
    // Check if it's the old .ppt binary format
    if (file.name.toLowerCase().endsWith('.ppt')) {
      addLog(`📄 Procesez: ${file.name}...`);
      addLog(`⚠️ Fișierul "${file.name}" este în formatul binar vechi .ppt. Acest format nu poate fi citit direct în browser. Vă rugăm să îl salvați ca .pptx (Modern PowerPoint) sau .pdf și să reîncercați.`, 'error');
      continue;
    }

    addLog(`📄 Procesez: ${file.name}...`);

    try {
      // 1. Extract text
      let text = '';
      if(file.name.toLowerCase().endsWith('.pdf')) {
        text = await extractPdfText(file);
      } else if(file.name.toLowerCase().endsWith('.pptx')) {
        text = await extractPptxText(file);
      } else {
        addLog(`⚠️ Format necunoscut pentru "${file.name}" (folosiți .pdf sau .pptx), skip.`, 'warn');
        continue;
      }
      addLog(`✅ Text extras: ${text.length} caractere`);

      if(text.length < 100) {
        addLog(`⚠️ Text prea scurt în "${file.name}" (minim 100 caractere), skip.`, 'warn');
        continue;
      }

      // 2. Generate questions via Gemini with Retry / Exponential Backoff
      addLog(`🤖 Generez întrebări cu Gemini AI...`);
      let questions = null;
      let retries = 5; // Allow up to 5 retries for high traffic
      let delay = 10000; // start with 10s delay
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          questions = await generateQuestions(text, fname, `c${startIdx + i + 1}`);
          break;
        } catch(err) {
          const isRetryable = err.status === 429 || err.status === 503 || err.status === 500 ||
                              err.message.toLowerCase().includes('limit') || 
                              err.message.toLowerCase().includes('too many') || 
                              err.message.toLowerCase().includes('traffic') ||
                              err.message.toLowerCase().includes('overloaded') ||
                              err.message.toLowerCase().includes('quota') ||
                              err.message.toLowerCase().includes('resource') ||
                              err.message.toLowerCase().includes('exhausted');
          if (isRetryable && attempt < retries) {
            addLog(`⏳ Limită rată / Trafic intens atins (${err.status || 'API Error'}). Reîncerc încercarea ${attempt}/${retries} în ${delay/1000}s...`, 'warn');
            await new Promise(r => setTimeout(r, delay));
            delay *= 2; // exponential backoff
          } else {
            throw err;
          }
        }
      }

      addLog(`✅ ${questions.length} întrebări generate!`, 'success');
      courses[String(startIdx + i + 1)] = { name: fname, questions };

      // Rate limit spacer between files
      if(i < files.length-1) {
        addLog(`⏳ Aștept 3s pentru a evita limita de rată...`);
        await new Promise(r=>setTimeout(r, 3000));
      }
    } catch(e) {
      addLog(`❌ Eroare la "${file.name}": ${e.message}`, 'error');
    }
  }

  bar.style.width = '100%';

  const totalQ = Object.values(courses).reduce((s,c)=>s+c.questions.length, 0);
  if(totalQ === 0) {
    addLog(`❌ Nu s-au generat întrebări. Verificați erorile de mai sus și reîncărcați fișiere valide.`, 'error');
    return;
  }

  // 3. Save to cloud
  addLog(`☁️ Salvez în cloud (${totalQ} întrebări)...`);
  
  if (isEditingSubjectKey) {
    const targetSubject = allSubjects[isEditingSubjectKey];
    for (const [id, course] of Object.entries(courses)) {
      targetSubject.courses[id] = course;
    }
    targetSubject.sub = `${Object.keys(targetSubject.courses).length} cursuri • generat automat`;
    // Update cloudSubjects representation as well
    cloudSubjects[isEditingSubjectKey] = targetSubject;
  } else {
    const newSubject = { title: subjectName, sub: `${Object.keys(courses).length} cursuri • generat automat`, courses };
    cloudSubjects[generatedSubjectKey] = newSubject;
    allSubjects[generatedSubjectKey] = newSubject;
  }

  try {
    await saveCloudSubjects();
    addLog(`✅ Salvat în cloud! Toți utilizatorii vor vedea modificările.`, 'success');
  } catch(e) {
    addLog(`⚠️ Salvare cloud eșuată, disponibil doar local.`, 'warn');
  }

  addLog(`\n🎉 Gata! Modificările au fost aplicate cu succes.`, 'success');

  // Show "Done" button
  document.getElementById('uploadDone').style.display = 'block';
}

function finishUpload() {
  const finalKey = isEditingSubjectKey;
  hideUploadUI();
  if (finalKey) {
    selectSubject(finalKey);
  } else {
    renderSubjectPicker();
  }
}

function hideUploadUI() {
  document.getElementById('uploadArea').style.display = 'none';
  renderSubjectPicker();
  if (isEditingSubjectKey) {
    selectSubject(isEditingSubjectKey);
  } else {
    document.getElementById('subjectPicker').style.display = 'block';
  }
}

// ---- Subject / Course Selection ----
function selectSubject(key) {
  currentSubject = key;
  currentCourses = allSubjects[key].courses;
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('home').style.display = 'block';
  document.getElementById('subjectTitle').textContent = allSubjects[key].title;
  document.getElementById('subjectSub').textContent = allSubjects[key].sub||'';
  
  // Show Add Courses button if it is a cloud subject (anyone can click, but password will be prompted if not logged in)
  const isCloud = !!cloudSubjects[key];
  const addBtn = document.getElementById('addCoursesBtn');
  if (addBtn) {
    addBtn.style.display = isCloud ? 'block' : 'none';
  }
  
  renderHome();
}

function goToSubjects() {
  document.getElementById('subjectPicker').style.display = 'block';
  document.getElementById('home').style.display = 'none';
  document.getElementById('quizArea').style.display = 'none';
  renderSubjectPicker();
}

function renderHome() {
  const grid = document.getElementById('courseGrid');
  grid.innerHTML = '';
  let totalQ=0, totalC=0;
  for(const [id, course] of Object.entries(currentCourses)) {
    totalQ += course.questions.length; totalC++;
    const multi = course.questions.some(q=>Array.isArray(q.correct)&&q.correct.length>1);
    grid.innerHTML += `<div class="course-card" onclick="startCourse('${id}')">
      <div class="course-num">Curs ${id}</div>
      <div class="course-title">${course.name}</div>
      <div class="course-count">${course.questions.length} întrebări${multi?' (inclusiv răspunsuri multiple)':''}</div>
      <div class="course-progress"><div class="course-progress-fill" style="width:0%"></div></div>
    </div>`;
  }
  document.getElementById('totalQ').textContent = totalQ;
  document.getElementById('totalC').textContent = totalC;
  loadStats();
}

function loadStats() {
  try { const s=JSON.parse(localStorage.getItem('qs_'+currentSubject)||'{}'); stats={correct:s.correct||0,wrong:s.wrong||0}; } catch(e){stats={correct:0,wrong:0};}
  updateStats();
}
function saveStats() { localStorage.setItem('qs_'+currentSubject, JSON.stringify(stats)); updateStats(); }
function updateStats() {
  document.getElementById('totalCorrect').textContent = stats.correct;
  document.getElementById('totalWrong').textContent = stats.wrong;
}

// ---- Quiz Logic ----
function startCourse(id) {
  currentQuestions = [...currentCourses[id].questions];
  currentIndex=0; answers={}; confirmed={};
  document.getElementById('quizTitle').textContent = currentCourses[id].name;
  showQuiz();
}

function startAll() {
  currentQuestions = [];
  for(const c of Object.values(currentCourses)) currentQuestions.push(...c.questions);
  shuffle(currentQuestions);
  currentIndex=0; answers={}; confirmed={};
  document.getElementById('quizTitle').textContent = 'Simulare Examen';
  showQuiz();
}

function shuffle(arr) { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];} }

function showQuiz() {
  document.getElementById('home').style.display='none';
  document.getElementById('quizArea').style.display='block';
  document.getElementById('results').style.display='none';
  document.getElementById('navButtons').style.display='flex';
  document.getElementById('questionContainer').style.display='block';
  showQuestion();
}

function showQuestion() {
  if(currentIndex>=currentQuestions.length){showResults();return;}
  const q=currentQuestions[currentIndex], total=currentQuestions.length;
  const isMulti=Array.isArray(q.correct)&&q.correct.length>1;
  const done=confirmed[q.id], sel=answers[q.id]||[];

  document.getElementById('quizCounter').textContent=`${currentIndex+1} / ${total}`;
  document.getElementById('progressFill').style.width=`${((currentIndex+1)/total)*100}%`;

  let opts=q.options.map((opt,i)=>{
    const L=String.fromCharCode(65+i);
    let cls='option';
    if(done){cls+=' disabled';const isC=q.correct.includes(L),wasS=sel.includes(L);
      if(isC&&wasS)cls+=' correct';else if(!isC&&wasS)cls+=' wrong';else if(isC&&!wasS)cls+=' missed';}
    else if(sel.includes(L))cls+=' selected';
    const ic=done?(q.correct.includes(L)?'✓':(sel.includes(L)?'✗':'')):(sel.includes(L)?'✓':'');
    return `<div class="${cls}" onclick="toggleOpt('${q.id}','${L}')" data-letter="${L}"><span class="check">${ic}</span><span>${opt}</span></div>`;
  }).join('');

  const showCB=isMulti&&!done&&sel.length>0;
  const mb=isMulti?'<span class="multi-badge">Răspuns multiplu</span>':'';

  document.getElementById('questionContainer').innerHTML=`<div class="question-card">
    <div class="q-number">Întrebarea ${currentIndex+1} din ${total}${mb}</div>
    <div class="q-text">${q.question}</div>
    <div class="options">${opts}</div>
    <button class="btn btn-primary confirm-btn ${showCB?'show':''}" onclick="confirmAns('${q.id}')">Confirmă răspunsul</button>
    <div class="explanation ${done&&mode==='learn'?'show':''}">${q.explanation||''}</div>
  </div>`;
}

function toggleOpt(qId,L) {
  if(confirmed[qId])return;
  const q=currentQuestions.find(x=>x.id===qId);
  const isMulti=Array.isArray(q.correct)&&q.correct.length>1;
  if(!answers[qId])answers[qId]=[];
  if(isMulti){const i=answers[qId].indexOf(L);if(i>=0)answers[qId].splice(i,1);else answers[qId].push(L);showQuestion();}
  else{answers[qId]=[L];confirmAns(qId);}
}

function confirmAns(qId) {
  if(confirmed[qId])return;
  const q=currentQuestions.find(x=>x.id===qId), sel=answers[qId]||[];
  if(!sel.length)return;
  confirmed[qId]=true;
  const ok=q.correct.length===sel.length&&q.correct.every(c=>sel.includes(c));
  if(ok)stats.correct++;else stats.wrong++;
  saveStats();
  if(mode==='learn')showQuestion();
  else{document.querySelectorAll('.option').forEach(o=>{o.classList.add('disabled');if(sel.includes(o.dataset.letter))o.classList.add('selected');});document.querySelector('.confirm-btn')?.classList.remove('show');}
}

function nextQ(){if(currentIndex<currentQuestions.length-1){currentIndex++;showQuestion();}else showResults();}
function prevQ(){if(currentIndex>0){currentIndex--;showQuestion();}}

function showResults() {
  let ok=0;
  currentQuestions.forEach(q=>{const s=answers[q.id]||[],c=q.correct;if(c.length===s.length&&c.every(x=>s.includes(x)))ok++;});
  const total=currentQuestions.length, pct=Math.round((ok/total)*100);
  document.getElementById('questionContainer').style.display='none';
  document.getElementById('navButtons').style.display='none';
  document.getElementById('results').style.display='block';
  document.getElementById('scoreText').textContent=`${ok} / ${total} (${pct}%)`;
  document.getElementById('scoreDetail').textContent=pct>=90?'🏆 Excelent!':pct>=70?'👍 Bine!':pct>=50?'📖 Mai repetă!':'💪 Nu renunța!';
}

function retry(){currentIndex=0;answers={};confirmed={};shuffle(currentQuestions);
  document.getElementById('results').style.display='none';document.getElementById('navButtons').style.display='flex';
  document.getElementById('questionContainer').style.display='block';showQuestion();}

function goHome(){document.getElementById('home').style.display='block';document.getElementById('quizArea').style.display='none';}
function setMode(m){mode=m;document.getElementById('modeLearn').classList.toggle('active',m==='learn');document.getElementById('modeExam').classList.toggle('active',m==='exam');}

// Boot
init();
