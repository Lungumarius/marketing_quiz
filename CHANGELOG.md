# Changelog - Quiz Universitar

Toate modificările structurale, funcționalitățile adăugate și problemele rezolvate pentru această aplicație de grile.

## [1.2.0] - 2026-06-22

### Adăugat
- **Autentificare E2EE (Zero-Knowledge) Student**:
  - Sign Up și Sign In client-side securizate.
  - Derivare cheie de decriptare cu PBKDF2 (100k iterații, salt unic).
  - Criptare AES-GCM 256-bit pentru datele trimise în JSONBin.
  - Sesiune utilizator memorată securizat.
  - **Forțare Conectare (Enforced Login)**: Aplicația forțează autentificarea la pornire și după deconectare, blocând accesul la dashboard până când utilizatorul este logat ca student sau admin.
- **Mape private de materii**: Opțiune pentru studenții conectați să uploadeze materii în cloud securizat, vizibile doar în contul lor propriu.
- **Recapitulare Inteligentă**: Card dedicat recapitulării întrebărilor greșite, care se actualizează automat pe baza răspunsurilor oferite în teste.
- **Tracking Enterprise pe Curs & Examen & Salvare Stare**:
  - **Salvare stare test curent & Resume**: Fiecare opțiune selectată sau confirmare de răspuns este salvată securizat sub nodul `resumeState` din cloud. La redeschiderea unui curs neterminat, studentul este întrebat dacă dorește reluarea testului de unde a rămas.
  - Cel mai bun scor obținut per curs randat ca badge discret (🏆) și bară de progres aferentă pe fiecare card de curs. Pentru testele în derulare, bara de progres devine portocalie și indică procentul de progres curent.
  - Istoric simulări de examen cu reținerea ultimelor 5 examene susținute și calculul mediei generale.

## [1.1.0] - 2026-06-22
- **Autentificare Admin persistentă**: Parola admin se salvează acum securizat în `sessionStorage` pentru a asigura auto-login-ul la refresh-ul paginii în același tab.
- **Management Materii din Cloud**:
  - Buton roșu de ștergere (🗑️) pe cardurile din meniul principal pentru toate materiile create prin cloud.
  - Buton discret de adăugare cursuri noi (`➕ Adaugă Cursuri`) vizibil pe toate materiile din cloud.
  - Formularul de upload se adaptează dinamic în mod editare (numele materiei devine blocat) când se adaugă fișiere adiționale la o materie existentă.
- **Ignorare fișiere locale**: Fișierul `.gitignore` creat pentru a curăța repository-ul de metadate specifice macOS (`.DS_Store`).
- **Sanitizare JSON (Control Characters Fix)**: Creat parser-ul client-side `sanitizeJsonString` care curăță newlines fizice și caractere de control nepermise în string-urile JSON din răspunsul Gemini, rezolvând eroarea "Bad control character in string literal".
- **Retry extins la trafic intens (503/500/Overload)**: Extinsă logica de exponential backoff la 5 încercări pentru a acoperi și erorile de tip "High traffic for this model", "Service Unavailable" (503) sau "Internal Server Error" (500).

### Modificat
- **Configurare Vercel simplificată**: Actualizat `vercel.json` pentru a elimina rewrite-ul către vechiul `quiz.html` (care a fost șters) și a lăsa Vercel să servească implicit `index.html`.
- **Logica de upload & incremental index**: Cursurile noi adăugate la o materie existentă continuă numerotarea automată de la cursul la care s-a rămas (ex: dacă materia avea deja 3 cursuri, noile fișiere vor deveni automat Curs 4, Curs 5 etc.).
- **Actualizare UI Instant**: Elementele de control admin (coșul de gunoi și butonul de adăugare cursuri) apar instant pe ecran imediat după confirmarea parolei în modal, fără a mai fi necesară navigarea manuală înapoi/înainte.

---

## [1.0.0] - 2026-06-22

### Adăugat
- **Interfață UI Premium**: Layout modern cu suport pentru temă dark-mode, carduri interactive, bare de progres și moduri duale de studiu ("Învățare" și "Examen").
- **Extracție text în browser**: Integrare client-side pentru `pdf.js` (pentru PDF) și `JSZip` (pentru PPTX) pentru a citi conținutul cursurilor direct din browser.
- **Generare Grile cu Gemini API**: Apel direct la Gemini Flash pentru a converti materialul cursului în 15 întrebări grilă (inclusiv suport pentru răspunsuri multiple și explicații).
- **Retry & Backoff pentru 429**: Tratarea inteligentă a erorilor de limită de rată de la Google Gemini cu exponential backoff (retry automat după 10s, 20s, 40s).
- **Securizare Chei API**: Integrare Web Crypto API (PBKDF2 + XOR) pentru decriptarea cheilor API Gemini și JSONBin în memorie, pe baza parolei introduse.
- **Cloud Sync cu JSONBin.io**: Salvarea datelor generate într-un storage JSONBin pentru ca toate modificările să fie sincronizate automat între utilizatori.
