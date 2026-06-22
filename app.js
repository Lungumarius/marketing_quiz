/* =============================================
   Quiz App - Core Logic + Upload Feature
   ============================================= */

// Encrypted credentials (decrypted automatically on client or via admin login)
const _H="8e955fe8fb522ee81e7eee024339148d7bf602ea62c2db9e582c51d90da62bfc";
const _G="1quth0GKmFkNNPYYD/7G+JETONpYNOyz6zFJ7SIKCWHXwOiw0S8eQdPo70sN5f5IgQgnqmVU5r6zDyPoLn4yWdbu3L3y";
const _B="6a38ef0bda38895dfeea24cc";

// Auto-decrypt JSONBin key and Gemini key for basic user operations
let decryptedJsonbin = (() => {
  const enc = [85, 67, 16, 85, 64, 65, 85, 66, 8, 62, 72, 37, 71, 30, 16, 0, 0, 73, 94, 66, 20, 34, 26, 50, 40, 21, 9, 11, 4, 54, 66, 72, 19, 43, 50, 94, 73, 28, 60, 48, 64, 52, 56, 9, 36, 37, 73, 95, 55, 64, 33, 56, 0, 57, 29, 22, 4, 62, 41, 38];
  return enc.map(c => String.fromCharCode(c ^ 113)).join('');
})();

let decryptedGemini = (() => {
  const enc = [48, 32, 95, 48, 19, 73, 35, 63, 71, 59, 54, 29, 25, 67, 16, 30, 2, 0, 9, 20, 19, 22, 67, 92, 23, 29, 29, 25, 16, 7, 18, 38, 32, 59, 64, 64, 46, 41, 41, 50, 31, 5, 92, 24, 21, 55, 43, 38, 3, 46, 61, 25, 48];
  return enc.map(c => String.fromCharCode(c ^ 113)).join('');
})();

// ---- State ----
let allSubjects = {};
let cloudSubjects = {};
let cloudUsers = {};
let currentSubject = null;
let currentSubjectIsPrivate = false;
let currentCourseId = null;
let currentCourses = null;
let currentQuestions = [];
let currentIndex = 0;
let answers = {};
let confirmed = {};
let mode = 'learn';
let stats = {correct:0, wrong:0, wrongQuestions:[], courses:{}, exams:[]};
let isEditingSubjectKey = null;

// User Session State
let loggedInUser = null;
let userDecryptedData = { progress: {}, privateSubjects: {} };
let userSalt = null;
let isAdmin = false;

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

// ---- E2EE Crypto helpers for users ----
async function deriveUserKey(password, saltHex) {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(password);
  const saltBuffer = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBuffer,
      iterations: 100000,
      hash: "SHA-256"
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptUserData(plainText, password, saltHex) {
  const key = await deriveUserKey(password, saltHex);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encoded
  );
  
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
  const dataHex = Array.from(new Uint8Array(encrypted)).map(b => b.toString(16).padStart(2, '0')).join('');
  
  return `${ivHex}:${dataHex}`;
}

async function decryptUserData(encryptedStr, password, saltHex) {
  const parts = encryptedStr.split(':');
  if (parts.length !== 2) throw new Error('Format date criptate invalid');
  const [ivHex, dataHex] = parts;
  
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const encryptedData = new Uint8Array(dataHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  
  const key = await deriveUserKey(password, saltHex);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv },
    key,
    encryptedData
  );
  
  return new TextDecoder().decode(decrypted);
}

// ---- Cloud storage (JSONBin.io) ----
async function loadCloudData() {
  try {
    const r = await fetch(`https://api.jsonbin.io/v3/b/${_B}/latest`, {
      headers: {
        'X-Bin-Meta': 'false',
        'X-Master-Key': decryptedJsonbin
      }
    });
    if(r.ok) { 
      const d = await r.json(); 
      cloudSubjects = d.subjects||{}; 
      cloudUsers = d.users||{};
    }
  } catch(e) { console.error('Cloud load failed:', e.message); }
}

async function saveCloudData() {
  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${_B}`, {
      method:'PUT',
      headers:{
        'Content-Type':'application/json',
        'X-Master-Key':decryptedJsonbin
      },
      body: JSON.stringify({
        subjects: cloudSubjects,
        users: cloudUsers
      })
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch(e) { 
    console.error('Cloud save failed:', e);
    throw e;
  }
}

// ---- Init ----
async function init() {
  allSubjects = {...BUILTIN_SUBJECTS};
  await loadCloudData();
  Object.assign(allSubjects, cloudSubjects);
  
  // Restore admin session if saved
  const savedAdminPwd = sessionStorage.getItem('admin_pwd');
  if (savedAdminPwd) {
    const hash = await sha256(savedAdminPwd);
    if (hash === _H) {
      decryptedGemini = await decryptKey(_G, savedAdminPwd);
      isAdmin = true;
    }
  }

  // Restore user session if saved
  await autoLogin();
  
  // Enforce login and signup
  if (!loggedInUser && !isAdmin) {
    showAuthModal();
  }
  
  // Load stats for current subject if selected, otherwise general stats
  if (currentSubject) {
    loadStats();
  }
  
  renderSubjectPicker();
}

function renderSubjectPicker() {
  const grid = document.getElementById('subjectCards');
  grid.innerHTML = '';
  
  // Combine public subjects and E2EE private subjects
  const userPrivate = (loggedInUser && userDecryptedData.privateSubjects) ? userDecryptedData.privateSubjects : {};
  const combinedSubjects = { ...allSubjects, ...userPrivate };
  
  // Load wrongQuestions globally if logged in to display recap card
  let totalWrongQ = 0;
  if (loggedInUser) {
    // Collect all wrong questions from all subjects
    const wrongQs = [];
    for (const [subId, subProg] of Object.entries(userDecryptedData.progress || {})) {
      if (subProg.wrongQuestions && subProg.wrongQuestions.length > 0) {
        wrongQs.push(...subProg.wrongQuestions);
      }
    }
    stats.wrongQuestions = wrongQs;
    totalWrongQ = wrongQs.length;
  } else {
    // If not logged in, count local storage wrong questions for the current subject if any
    totalWrongQ = stats.wrongQuestions ? stats.wrongQuestions.length : 0;
  }

  // Inject Smart Spaced Repetition card if there are wrong questions
  if (totalWrongQ > 0) {
    grid.innerHTML += `<div class="subject-card recap-card" onclick="startRecapitulare()" style="border: 2px dashed var(--accent);">
      <div class="badge" style="background: var(--accent);">${totalWrongQ} grile</div>
      <div class="icon">🎯</div>
      <div class="name">Recapitulare Inteligentă</div>
      <div class="desc">Antrenează-te pe întrebările pe care le-ai greșit în trecut</div>
    </div>`;
  }
  
  for(const [key, subj] of Object.entries(combinedSubjects)) {
    const totalQ = Object.values(subj.courses).reduce((s,c)=>s+c.questions.length,0);
    const isCloud = !!cloudSubjects[key];
    const isPrivate = !!userPrivate[key];
    
    // Can delete if:
    // 1. Cloud public and logged in as admin
    // 2. Or is a private subject owned by the logged in user
    const canDelete = (isCloud && isAdmin) || isPrivate;
    const deleteHtml = canDelete ? `<button class="delete-btn" onclick="event.stopPropagation(); deleteSubject('${key}', ${isPrivate})" title="Șterge materia">🗑️</button>` : '';
    
    const icon = isPrivate ? '🔒' : (isCloud ? '📁' : '📊');
    const cloudLabel = isPrivate ? '<div class="cloud-badge private-badge">🔒 Privat</div>' : (isCloud ? '<div class="cloud-badge">☁️ Public</div>' : '');
    
    grid.innerHTML += `<div class="subject-card ${isPrivate?'private-card':''}" onclick="selectSubject('${key}', ${isPrivate})">
      <div class="badge">${totalQ} întrebări</div>
      ${cloudLabel}
      <div class="icon">${icon}</div>
      <div class="name">${subj.title}</div>
      <div class="desc">${subj.sub||''}</div>
      ${deleteHtml}
    </div>`;
  }
  
  // Add upload card (changes name based on admin state)
  const uploadLabel = isAdmin ? 'Adaugă Materie Nouă (Admin)' : 'Adaugă Materie Nouă';
  grid.innerHTML += `<div class="subject-card upload-card" onclick="showPasswordModalOrUI()">
    <div class="icon">➕</div>
    <div class="name">${uploadLabel}</div>
    <div class="desc">Upload PDF/PPT → generare automată de grile cu AI</div>
  </div>`;
  
  updateUserUI();
}

async function deleteSubject(key, isPrivate = false) {
  const title = isPrivate ? userDecryptedData.privateSubjects[key].title : allSubjects[key].title;
  if (!confirm(`Sigur doriți să ștergeți definitiv materia "${title}"? Această acțiune nu poate fi anulată.`)) return;
  
  if (isPrivate) {
    delete userDecryptedData.privateSubjects[key];
    // also delete its progress
    delete userDecryptedData.progress[key];
    renderSubjectPicker();
    try {
      await syncUserProgressToCloud();
      alert('Materia privată a fost ștearsă cu succes!');
    } catch(e) {
      alert('Eroare la sincronizarea modificării în cloud.');
    }
  } else {
    if (!isAdmin) return;
    delete cloudSubjects[key];
    delete allSubjects[key];
    renderSubjectPicker();
    
    try {
      await saveCloudData();
      alert('Materia publică a fost ștearsă din cloud!');
    } catch(e) {
      alert('Eroare la salvarea în cloud, dar a fost ștearsă local.');
    }
  }
}

// ---- Authentication & Admin Actions UI ----
function showPasswordModalOrUI() {
  isEditingSubjectKey = null;
  if (isAdmin || loggedInUser) {
    showUploadUI();
  } else {
    showAuthModal();
  }
}

function showAuthModal() {
  document.getElementById('authModal').style.display = 'flex';
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authError').style.display = 'none';
  
  // Hide cancel button if not authenticated
  const cancelBtn = document.querySelector('#authModal .modal-btns .btn-outline');
  if (cancelBtn) {
    cancelBtn.style.display = (loggedInUser || isAdmin) ? 'inline-block' : 'none';
  }
  
  switchAuthTab('signin');
}

function closeAuthModal() {
  if (!loggedInUser && !isAdmin) return;
  document.getElementById('authModal').style.display = 'none';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  
  const formTitle = document.getElementById('authFormTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const adminNote = document.getElementById('adminLoginNote');
  
  if (tab === 'signin') {
    formTitle.textContent = 'Conectare Student';
    submitBtn.textContent = 'Conectează-te';
    adminNote.style.display = 'block';
  } else {
    formTitle.textContent = 'Înregistrare Student Nou';
    submitBtn.textContent = 'Creează cont';
    adminNote.style.display = 'none';
  }
}

async function handleAuthSubmit(e) {
  if (e) e.preventDefault();
  const user = document.getElementById('authUsername').value.trim();
  const pass = document.getElementById('authPassword').value;
  const isSignIn = document.getElementById('tab-signin').classList.contains('active');
  const errorEl = document.getElementById('authError');
  
  if (!user || !pass) {
    errorEl.textContent = 'Te rugăm să completezi toate câmpurile!';
    errorEl.style.display = 'block';
    return;
  }
  
  try {
    errorEl.style.display = 'none';
    if (isSignIn) {
      await signIn(user, pass);
    } else {
      await signUp(user, pass);
    }
    // We can only close now since loggedInUser is populated
    document.getElementById('authModal').style.display = 'none';
  } catch(err) {
    errorEl.textContent = err.message;
    errorEl.style.display = 'block';
  }
}

function showAdminLogin() {
  // We don't close auth modal fully, just hide it so that if admin login is cancelled, it returns back.
  document.getElementById('authModal').style.display = 'none';
  document.getElementById('pwdModal').style.display = 'flex';
  document.getElementById('pwdInput').value = '';
  document.getElementById('pwdError').style.display = 'none';
  document.getElementById('pwdInput').focus();
}

function closePwdModal() {
  document.getElementById('pwdModal').style.display = 'none';
  if (!loggedInUser && !isAdmin) {
    showAuthModal();
  }
}

async function checkPassword() {
  const pwd = document.getElementById('pwdInput').value;
  const hash = await sha256(pwd);
  if(hash === _H) {
    decryptedGemini = await decryptKey(_G, pwd);
    isAdmin = true;
    
    // Save to sessionStorage to persist across refreshes
    sessionStorage.setItem('admin_pwd', pwd);
    
    closePwdModal();
    
    // Immediately refresh views
    renderSubjectPicker();
    if (currentSubject) {
      selectSubject(currentSubject, currentSubjectIsPrivate);
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

// ---- User Management & Authentication ----
async function signUp(username, password) {
  const userKeyLower = username.trim().toLowerCase();
  const userHash = await sha256(userKeyLower);
  
  if (cloudUsers[userHash]) {
    throw new Error('Numele de utilizator este deja înregistrat!');
  }
  
  // Generate 16 bytes random salt in hex
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const initialData = {
    progress: {},
    privateSubjects: {}
  };
  
  const plainText = JSON.stringify(initialData);
  const encData = await encryptUserData(plainText, password, saltHex);
  
  cloudUsers[userHash] = {
    username: username.trim(),
    salt: saltHex,
    encData: encData,
    createdAt: new Date().toISOString()
  };
  
  await saveCloudData();
  
  loggedInUser = username.trim();
  userDecryptedData = initialData;
  userSalt = saltHex;
  
  // Save credentials in sessionStorage
  sessionStorage.setItem('quiz_user', loggedInUser);
  sessionStorage.setItem('quiz_user_pwd', password);
  sessionStorage.setItem('quiz_user_salt', saltHex);
  
  updateUserUI();
  renderSubjectPicker();
}

async function signIn(username, password) {
  const userKeyLower = username.trim().toLowerCase();
  const userHash = await sha256(userKeyLower);
  
  const userData = cloudUsers[userHash];
  if (!userData) {
    throw new Error('Nume de utilizator sau parolă incorectă!');
  }
  
  try {
    const saltHex = userData.salt;
    const decryptedText = await decryptUserData(userData.encData, password, saltHex);
    
    loggedInUser = userData.username;
    userDecryptedData = JSON.parse(decryptedText);
    userSalt = saltHex;
    
    sessionStorage.setItem('quiz_user', loggedInUser);
    sessionStorage.setItem('quiz_user_pwd', password);
    sessionStorage.setItem('quiz_user_salt', saltHex);
    
    updateUserUI();
    renderSubjectPicker();
  } catch (err) {
    throw new Error('Nume de utilizator sau parolă incorectă!');
  }
}

function logOut() {
  loggedInUser = null;
  userDecryptedData = { progress: {}, privateSubjects: {} };
  userSalt = null;
  isAdmin = false;
  
  sessionStorage.removeItem('quiz_user');
  sessionStorage.removeItem('quiz_user_pwd');
  sessionStorage.removeItem('quiz_user_salt');
  sessionStorage.removeItem('admin_pwd');
  
  updateUserUI();
  renderSubjectPicker();
  
  // Go back to main picker if inside a subject
  document.getElementById('home').style.display = 'none';
  document.getElementById('quizArea').style.display = 'none';
  document.getElementById('subjectPicker').style.display = 'block';
  
  showAuthModal();
}

async function autoLogin() {
  const savedUser = sessionStorage.getItem('quiz_user');
  const savedPwd = sessionStorage.getItem('quiz_user_pwd');
  const savedSalt = sessionStorage.getItem('quiz_user_salt');
  
  if (savedUser && savedPwd && savedSalt) {
    try {
      const userHash = await sha256(savedUser.toLowerCase());
      const userData = cloudUsers[userHash];
      if (userData) {
        const decryptedText = await decryptUserData(userData.encData, savedPwd, savedSalt);
        loggedInUser = userData.username;
        userDecryptedData = JSON.parse(decryptedText);
        userSalt = savedSalt;
        updateUserUI();
      }
    } catch (e) {
      console.error('Auto login failed:', e);
      logOut();
    }
  }
}

async function syncUserProgressToCloud() {
  if (!loggedInUser || !userSalt) return;
  const pwd = sessionStorage.getItem('quiz_user_pwd');
  if (!pwd) return;
  
  const userHash = await sha256(loggedInUser.toLowerCase());
  const plainText = JSON.stringify(userDecryptedData);
  const encData = await encryptUserData(plainText, pwd, userSalt);
  
  cloudUsers[userHash].encData = encData;
  await saveCloudData();
}

function updateUserUI() {
  const userStatus = document.getElementById('userStatusArea');
  if (!userStatus) return;
  
  if (isAdmin) {
    userStatus.innerHTML = `
      <div class="user-badge admin-badge">
        <span>🔑 Admin Mode</span>
        <button class="logout-link" onclick="logOut()">Ieșire</button>
      </div>
    `;
  } else if (loggedInUser) {
    userStatus.innerHTML = `
      <div class="user-badge student-badge">
        <span>👨‍🎓 ${loggedInUser}</span>
        <button class="logout-link" onclick="logOut()">Deconectare</button>
      </div>
    `;
  } else {
    userStatus.innerHTML = `
      <button class="btn btn-secondary auth-trigger-btn" onclick="showAuthModal()">Conectare Student</button>
      <button class="admin-trigger-btn" onclick="showAdminLogin()" style="margin-left:10px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:0.85rem;">🔐 Admin</button>
    `;
  }
}

// ---- Upload UI ----
function showUploadUI() {
  isEditingSubjectKey = null;
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('home').style.display = 'none';
  document.getElementById('uploadArea').style.display = 'block';
  document.getElementById('uploadFiles').value = '';
  document.getElementById('uploadName').value = '';
  document.getElementById('uploadName').disabled = false;
  
  // Set upload title and notes
  document.getElementById('uploadTitle').textContent = 'Adaugă Materie Nouă';
  
  const privateGroup = document.getElementById('privateCheckboxGroup');
  const privateCheck = document.getElementById('uploadPrivate');
  
  if (privateGroup && privateCheck) {
    if (isAdmin) {
      privateGroup.style.display = 'block';
      privateCheck.checked = false;
      privateCheck.disabled = false;
    } else if (loggedInUser) {
      // Force private for regular students
      privateGroup.style.display = 'block';
      privateCheck.checked = true;
      privateCheck.disabled = true;
    } else {
      privateGroup.style.display = 'none';
    }
  }

  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadForm').style.display = 'block';
}

function showAddCoursesUI() {
  isEditingSubjectKey = currentSubject;
  if (isAdmin || (loggedInUser && currentSubjectIsPrivate)) {
    showUploadUIForEditing();
  } else {
    showAuthModal();
  }
}

function showUploadUIForEditing() {
  const userPrivate = (loggedInUser && userDecryptedData.privateSubjects) ? userDecryptedData.privateSubjects : {};
  const subjName = currentSubjectIsPrivate ? userPrivate[isEditingSubjectKey].title : allSubjects[isEditingSubjectKey].title;
  
  document.getElementById('home').style.display = 'none';
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('uploadArea').style.display = 'block';
  document.getElementById('uploadFiles').value = '';
  document.getElementById('uploadName').value = subjName;
  document.getElementById('uploadName').disabled = true;
  document.getElementById('uploadTitle').textContent = `Adaugă Cursuri la "${subjName}"`;
  
  const privateGroup = document.getElementById('privateCheckboxGroup');
  const privateCheck = document.getElementById('uploadPrivate');
  if (privateGroup && privateCheck) {
    privateGroup.style.display = 'block';
    privateCheck.checked = currentSubjectIsPrivate;
    privateCheck.disabled = true; // cannot change privacy once created
  }

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

  // 3. Save to cloud (Private E2EE vs Public Cloud)
  const isPrivateCheck = document.getElementById('uploadPrivate');
  const isPrivate = isPrivateCheck ? isPrivateCheck.checked : false;
  
  addLog(`☁️ Salvez în cloud (${isPrivate ? 'Mod Privat Securizat E2EE' : 'Mod Public'})...`);
  
  if (isPrivate) {
    if (isEditingSubjectKey) {
      const targetSubject = userDecryptedData.privateSubjects[isEditingSubjectKey];
      for (const [id, course] of Object.entries(courses)) {
        targetSubject.courses[id] = course;
      }
      targetSubject.sub = `${Object.keys(targetSubject.courses).length} cursuri • generat privat`;
    } else {
      const newSubject = { title: subjectName, sub: `${Object.keys(courses).length} cursuri • generat privat`, courses };
      userDecryptedData.privateSubjects[generatedSubjectKey] = newSubject;
    }
    
    try {
      await syncUserProgressToCloud();
      addLog(`✅ Salvat în cloud-ul tău privat! Doar tu o poți accesa.`, 'success');
    } catch(e) {
      addLog(`⚠️ Salvare în cloud privat eșuată. Modificările sunt doar temporare.`, 'warn');
    }
  } else {
    // Public Cloud Subject (Admin only)
    if (isEditingSubjectKey) {
      const targetSubject = allSubjects[isEditingSubjectKey];
      for (const [id, course] of Object.entries(courses)) {
        targetSubject.courses[id] = course;
      }
      targetSubject.sub = `${Object.keys(targetSubject.courses).length} cursuri • generat automat`;
      cloudSubjects[isEditingSubjectKey] = targetSubject;
    } else {
      const newSubject = { title: subjectName, sub: `${Object.keys(courses).length} cursuri • generat automat`, courses };
      cloudSubjects[generatedSubjectKey] = newSubject;
      allSubjects[generatedSubjectKey] = newSubject;
    }

    try {
      await saveCloudData();
      addLog(`✅ Salvat în cloud! Toți utilizatorii vor vedea modificările.`, 'success');
    } catch(e) {
      addLog(`⚠️ Salvare cloud eșuată.`, 'warn');
    }
  }

  addLog(`\n🎉 Gata! Modificările au fost aplicate cu succes.`, 'success');

  // Show "Done" button
  document.getElementById('uploadDone').style.display = 'block';
}

function finishUpload() {
  const finalKey = isEditingSubjectKey;
  hideUploadUI();
  if (finalKey) {
    selectSubject(finalKey, currentSubjectIsPrivate);
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
function selectSubject(key, isPrivate = false) {
  currentSubject = key;
  currentSubjectIsPrivate = isPrivate;
  
  const userPrivate = (loggedInUser && userDecryptedData.privateSubjects) ? userDecryptedData.privateSubjects : {};
  const targetSubj = isPrivate ? userPrivate[key] : allSubjects[key];
  
  if (!targetSubj) {
    alert('Materia selectată nu a putut fi găsită!');
    goToSubjects();
    return;
  }
  
  currentCourses = targetSubj.courses;
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('home').style.display = 'block';
  document.getElementById('subjectTitle').textContent = targetSubj.title;
  document.getElementById('subjectSub').textContent = targetSubj.sub || '';
  
  const isCloud = !!cloudSubjects[key];
  const addBtn = document.getElementById('addCoursesBtn');
  if (addBtn) {
    // Show Add Courses if it is a cloud public subject OR a private subject owned by logged user
    addBtn.style.display = (isCloud || isPrivate) ? 'block' : 'none';
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
  
  // Load stats first to populate stats.courses and stats.exams
  loadStats();
  
  const coursesProgress = stats.courses || {};
  const examsProgress = stats.exams || [];
  
  for(const [id, course] of Object.entries(currentCourses)) {
    totalQ += course.questions.length; totalC++;
    const multi = course.questions.some(q=>Array.isArray(q.correct)&&q.correct.length>1);
    
    const courseProg = coursesProgress[id] || { bestPct: 0, lastPct: 0, currentProgressPct: 0 };
    
    let scoreHtml = '';
    let progressPct = 0;
    let progressBarClass = 'course-progress-fill';
    
    if (courseProg.resumeState && Object.keys(courseProg.resumeState.answers).length > 0) {
      const totalQCount = courseProg.resumeState.currentQuestions.length;
      const answeredQCount = Object.keys(courseProg.resumeState.answers).length;
      const currentPct = totalQCount > 0 ? Math.round((answeredQCount / totalQCount) * 100) : 0;
      
      scoreHtml = `<div class="course-score" style="font-size: 0.72rem; color: var(--orange); margin-top: 4px; font-weight:700;">⏳ În derulare: ${currentPct}%</div>`;
      progressPct = currentPct;
      progressBarClass = 'course-progress-fill in-progress';
    } else if (courseProg.bestPct > 0) {
      scoreHtml = `<div class="course-score" style="font-size: 0.72rem; color: var(--accent2); margin-top: 4px; font-weight:700;">🏆 Cel mai bun scor: ${courseProg.bestPct}% ${courseProg.bestPct === 100 ? '✅' : ''}</div>`;
      progressPct = courseProg.bestPct;
    }
      
    grid.innerHTML += `<div class="course-card" onclick="startCourse('${id}')">
      <div class="course-num">Curs ${id}</div>
      <div class="course-title">${course.name}</div>
      <div class="course-count">${course.questions.length} întrebări${multi?' (inclusiv răspunsuri multiple)':''}</div>
      ${scoreHtml}
      <div class="course-progress" style="margin-top: 10px;"><div class="${progressBarClass}" style="width:${progressPct}%"></div></div>
    </div>`;
  }
  
  document.getElementById('totalQ').textContent = totalQ;
  document.getElementById('totalC').textContent = totalC;
  
  // Render exam simulation history
  const historyArea = document.getElementById('examHistoryArea');
  if (historyArea) {
    if (examsProgress.length > 0) {
      const lastExam = examsProgress[examsProgress.length - 1];
      const avgExam = Math.round(examsProgress.reduce((sum, e) => sum + e.pct, 0) / examsProgress.length);
      historyArea.innerHTML = `📝 Ultimul examen: <b>${lastExam.pct}%</b> | Media ultimelor simulări: <b>${avgExam}%</b>`;
    } else {
      historyArea.innerHTML = `Nu ai susținut nicio simulare de examen complet încă.`;
    }
  }
}

function loadStats() {
  if (currentSubject === 'recap') {
    stats.correct = stats.correct || 0;
    stats.wrong = stats.wrong || 0;
  } else if (loggedInUser) {
    const userProg = userDecryptedData.progress[currentSubject] || {};
    stats = {
      correct: userProg.correct || 0,
      wrong: userProg.wrong || 0,
      wrongQuestions: userProg.wrongQuestions || [],
      courses: userProg.courses || {},
      exams: userProg.exams || []
    };
  } else {
    try { 
      const s = JSON.parse(localStorage.getItem('qs_' + currentSubject) || '{}'); 
      stats = {
        correct: s.correct || 0,
        wrong: s.wrong || 0,
        wrongQuestions: s.wrongQuestions || [],
        courses: s.courses || {},
        exams: s.exams || []
      }; 
    } catch(e) {
      stats = { correct: 0, wrong: 0, wrongQuestions: [], courses: {}, exams: [] };
    }
  }
  updateStats();
}

async function saveStats() {
  if (currentSubject === 'recap') {
    if (loggedInUser) {
      await syncUserProgressToCloud();
    }
  } else if (loggedInUser) {
    userDecryptedData.progress[currentSubject] = {
      correct: stats.correct,
      wrong: stats.wrong,
      wrongQuestions: stats.wrongQuestions || [],
      courses: stats.courses || {},
      exams: stats.exams || []
    };
    localStorage.setItem('qs_' + currentSubject, JSON.stringify(stats));
    try {
      await syncUserProgressToCloud();
    } catch(e) {
      console.error('Failed to sync progress to cloud:', e);
    }
  } else {
    localStorage.setItem('qs_' + currentSubject, JSON.stringify(stats));
  }
  updateStats();
}

function updateStats() {
  document.getElementById('totalCorrect').textContent = stats.correct;
  document.getElementById('totalWrong').textContent = stats.wrong;
}

function startRecapitulare() {
  let wrongQs = [];
  if (loggedInUser) {
    // Collect all wrong questions from all subjects
    for (const [subId, subProg] of Object.entries(userDecryptedData.progress || {})) {
      if (subProg.wrongQuestions && subProg.wrongQuestions.length > 0) {
        // Add subjectId info to each question to know where to update it later
        subProg.wrongQuestions.forEach(q => {
          q.parentSubjectKey = subId;
          wrongQs.push(q);
        });
      }
    }
  } else {
    wrongQs = stats.wrongQuestions || [];
  }
  
  if (wrongQs.length === 0) {
    alert('Nu aveți grile greșite salvate pentru recapitulare!');
    return;
  }
  
  currentSubject = 'recap';
  currentSubjectIsPrivate = false;
  currentQuestions = [...wrongQs];
  shuffle(currentQuestions);
  currentIndex = 0;
  answers = {};
  confirmed = {};
  
  // Set stats counters to 0 for this session run
  stats.correct = 0;
  stats.wrong = 0;
  
  document.getElementById('subjectPicker').style.display = 'none';
  document.getElementById('home').style.display = 'none';
  document.getElementById('quizArea').style.display = 'block';
  
  document.getElementById('quizTitle').textContent = '🎯 Recapitulare Inteligentă';
  document.getElementById('results').style.display = 'none';
  document.getElementById('questionContainer').style.display = 'block';
  document.getElementById('navButtons').style.display = 'flex';
  
  showQuestion();
}

// ---- Quiz Logic ----
function startCourse(id) {
  currentCourseId = id;
  const courseProg = (stats.courses && stats.courses[id]) ? stats.courses[id] : null;
  
  if (courseProg && courseProg.resumeState && Object.keys(courseProg.resumeState.answers).length > 0) {
    const totalQ = courseProg.resumeState.currentQuestions.length;
    const answeredQ = Object.keys(courseProg.resumeState.answers).length;
    const progressPercent = Math.round((answeredQ / totalQ) * 100);
    
    const wantResume = confirm(`Ai un test în derulare pe acest curs (${progressPercent}% finalizat). Vrei să îl continui de unde ai rămas?`);
    if (wantResume) {
      const state = courseProg.resumeState;
      currentQuestions = state.currentQuestions;
      currentIndex = state.currentIndex;
      answers = state.answers;
      confirmed = state.confirmed;
      document.getElementById('quizTitle').textContent = currentCourses[id].name;
      showQuiz();
      showQuestion();
      return;
    }
  }
  
  currentQuestions = [...currentCourses[id].questions];
  currentIndex=0; answers={}; confirmed={};
  document.getElementById('quizTitle').textContent = currentCourses[id].name;
  showQuiz();
}

function startAll() {
  currentCourseId = 'all';
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
  saveCourseProgressState();
}

function confirmAns(qId) {
  if(confirmed[qId])return;
  const q=currentQuestions.find(x=>x.id===qId), sel=answers[qId]||[];
  if(!sel.length)return;
  confirmed[qId]=true;
  const ok=q.correct.length===sel.length&&q.correct.every(c=>sel.includes(c));
  
  if (ok) {
    stats.correct++;
    
    // Remove from wrong questions list
    if (currentSubject === 'recap') {
      if (loggedInUser && q.parentSubjectKey) {
        const subProg = userDecryptedData.progress[q.parentSubjectKey];
        if (subProg && subProg.wrongQuestions) {
          subProg.wrongQuestions = subProg.wrongQuestions.filter(x => x.id !== qId);
        }
      } else {
        stats.wrongQuestions = (stats.wrongQuestions || []).filter(x => x.id !== qId);
      }
    } else {
      stats.wrongQuestions = (stats.wrongQuestions || []).filter(x => x.id !== qId);
    }
  } else {
    stats.wrong++;
    if (!stats.wrongQuestions) stats.wrongQuestions = [];
    if (!stats.wrongQuestions.some(x => x.id === qId)) {
      const cleanQ = { ...q };
      delete cleanQ.parentSubjectKey;
      stats.wrongQuestions.push(cleanQ);
    }
  }
  
  saveStats();
  saveCourseProgressState();
  if(mode==='learn')showQuestion();
  else{document.querySelectorAll('.option').forEach(o=>{o.classList.add('disabled');if(sel.includes(o.dataset.letter))o.classList.add('selected');});document.querySelector('.confirm-btn')?.classList.remove('show');}
}

function nextQ(){if(currentIndex<currentQuestions.length-1){currentIndex++;saveCourseProgressState();showQuestion();}else showResults();}
function prevQ(){if(currentIndex>0){currentIndex--;saveCourseProgressState();showQuestion();}}

function saveCourseProgressState() {
  if (currentSubject === 'recap' || currentCourseId === 'all' || !currentCourseId) return;
  if (!stats.courses) stats.courses = {};
  if (!stats.courses[currentCourseId]) {
    stats.courses[currentCourseId] = { bestPct: 0, lastPct: 0 };
  }
  
  stats.courses[currentCourseId].resumeState = {
    currentIndex: currentIndex,
    answers: answers,
    confirmed: confirmed,
    currentQuestions: currentQuestions
  };
  
  const totalQuestions = currentQuestions.length;
  const completedQuestions = Object.keys(answers).length;
  stats.courses[currentCourseId].currentProgressPct = totalQuestions > 0 ? Math.round((completedQuestions / totalQuestions) * 100) : 0;
  
  saveStats();
}

function showResults() {
  let ok=0;
  currentQuestions.forEach(q=>{const s=answers[q.id]||[],c=q.correct;if(c.length===s.length&&c.every(x=>s.includes(x)))ok++;});
  const total=currentQuestions.length, pct=Math.round((ok/total)*100);
  
  // Enterprise Tracking: salvare scor per curs sau examen
  if (currentSubject !== 'recap') {
    if (currentCourseId === 'all') {
      if (!stats.exams) stats.exams = [];
      stats.exams.push({ date: new Date().toISOString(), pct: pct });
      if (stats.exams.length > 5) stats.exams.shift();
    } else if (currentCourseId) {
      if (!stats.courses) stats.courses = {};
      if (!stats.courses[currentCourseId]) {
        stats.courses[currentCourseId] = { bestPct: 0, lastPct: 0 };
      }
      stats.courses[currentCourseId].lastPct = pct;
      stats.courses[currentCourseId].bestPct = Math.max(stats.courses[currentCourseId].bestPct || 0, pct);
      stats.courses[currentCourseId].completed = (stats.courses[currentCourseId].bestPct === 100);
      
      // Clean up resumeState as the quiz has been completed
      delete stats.courses[currentCourseId].resumeState;
      stats.courses[currentCourseId].currentProgressPct = 0;
    }
    
    saveStats();
  }

  document.getElementById('questionContainer').style.display='none';
  document.getElementById('navButtons').style.display='none';
  document.getElementById('results').style.display='block';
  document.getElementById('scoreText').textContent=`${ok} / ${total} (${pct}%)`;
  document.getElementById('scoreDetail').textContent=pct>=90?'🏆 Excelent!':pct>=70?'👍 Bine!':pct>=50?'📖 Mai repetă!':'💪 Nu renunța!';
}

function retry(){currentIndex=0;answers={};confirmed={};shuffle(currentQuestions);
  if (currentCourseId && currentCourseId !== 'all' && currentSubject !== 'recap') {
    saveCourseProgressState();
  }
  document.getElementById('results').style.display='none';document.getElementById('navButtons').style.display='flex';
  document.getElementById('questionContainer').style.display='block';showQuestion();}

function goHome(){document.getElementById('home').style.display='block';document.getElementById('quizArea').style.display='none';}
function setMode(m){mode=m;document.getElementById('modeLearn').classList.toggle('active',m==='learn');document.getElementById('modeExam').classList.toggle('active',m==='exam');}

// Boot
init();
