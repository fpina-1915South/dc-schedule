/* 1915 South DC Smart Scheduler: sign-in and data layer.
   Firebase mode: email + password on field-leader-1915 (same accounts as the DC Field App).
   Demo mode: no apiKey in config.js, data lives in this browser only. */
(function () {
  const C = window.DC_CONFIG || {};
  const DOMAIN = (C.allowedDomain || "").toLowerCase();
  const OWNER = (C.ownerEmail || "").toLowerCase();
  let DEMO = !(C.firebase && C.firebase.apiKey);
  // Use the Firebase web config the Field Leader App already publishes (same project), so this repo
  // never needs its own copy. Finds the object with apiKey + projectId in that file's exports or globals.
  async function borrowConfig() {
    if (!C.borrowConfigFrom) return null;
    const pick = (o, d) => {
      if (!o || typeof o !== "object" || d > 3) return null;
      if (o.apiKey && o.projectId === (C.firebase && C.firebase.projectId)) return o;
      for (const k of Object.keys(o)) { try { const r = pick(o[k], d + 1); if (r) return r; } catch (e) {} }
      return null;
    };
    const before = new Set(Object.keys(window));
    let mod = null;
    try { mod = await import(C.borrowConfigFrom); } catch (e) {}
    let found = pick(mod, 0);
    if (!found) for (const k of Object.keys(window)) if (!before.has(k)) { found = pick(window[k], 0); if (found) break; }
    if (!found) {
      try { await new Promise((ok, bad) => { const s = document.createElement("script"); s.src = C.borrowConfigFrom; s.onload = ok; s.onerror = bad; document.head.appendChild(s); }); } catch (e) {}
      for (const k of Object.keys(window)) if (!before.has(k)) { found = pick(window[k], 0); if (found) break; }
    }
    return found;
  }
  const $ = (s) => document.querySelector(s);

  /* ---------- demo store (localStorage) ---------- */
  function demoDB() {
    const K = "dcss:";
    const mem = {};
    const get = (p) => {
      try { const v = localStorage.getItem(K + p); if (v) return JSON.parse(v); } catch (e) {}
      return mem[p] ? JSON.parse(mem[p]) : null;
    };
    const set = (p, v) => {
      const s = JSON.stringify(v); mem[p] = s;
      try { localStorage.setItem(K + p, s); } catch (e) {}
    };
    return {
      mode: "demo",
      async get(p) { return get(p); },
      async set(p, v) { set(p, v); return true; },
      async merge(p, v) { set(p, Object.assign(get(p) || {}, v)); return true; },
      async del(p) { delete mem[p]; try { localStorage.removeItem(K + p); } catch (e) {} return true; }
    };
  }

  /* ---------- firestore store ---------- */
  function fireDB(fs) {
    return {
      mode: "firebase",
      async get(p) { const d = await fs.doc(p).get(); return d.exists ? d.data() : null; },
      async set(p, v) { await fs.doc(p).set(JSON.parse(JSON.stringify(v))); return true; },
      async merge(p, v) { await fs.doc(p).set(JSON.parse(JSON.stringify(v)), { merge: true }); return true; },
      async del(p) { await fs.doc(p).delete(); return true; }
    };
  }

  function loadScript(src) {
    return new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }

  async function start() {
    if (!window.DCApp) await loadScript("app.js?v=" + encodeURIComponent(C.version || Date.now()));
    if (DEMO && C.borrowConfigFrom) {
      const fc = await borrowConfig();
      if (fc) { C.firebase = Object.assign({}, fc); DEMO = false; }
      else if (location.hostname.endsWith("github.io")) throw new Error("Could not load the Firebase settings from the Field Leader App. Check borrowConfigFrom in config.js.");
    }
    if (DEMO) {
      $("#auth").style.display = "none";
      window.DCApp.start({ db: demoDB(), user: { email: "demo@1915south.com", name: "Demo user" }, role: "admin", demo: true });
      return;
    }
    const V = "10.12.2";
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-app-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-auth-compat.js`);
    await loadScript(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore-compat.js`);
    firebase.initializeApp(C.firebase);
    const auth = firebase.auth(), fs = firebase.firestore();
    const db = fireDB(fs);

    const okDomain = (e) => !DOMAIN || e.endsWith("@" + DOMAIN);
    const msg = (t, bad) => { const m = $("#authMsg"); m.textContent = t || ""; m.className = "auth-msg" + (bad ? " bad" : ""); };
    const friendly = (e) => ({
      "auth/invalid-credential": "Email or password is not right.",
      "auth/wrong-password": "Email or password is not right.",
      "auth/user-not-found": "No account for that email. Use Create your account.",
      "auth/email-already-in-use": "That email already has an account. Sign in or use Forgot password.",
      "auth/weak-password": "Password needs at least 6 characters.",
      "auth/too-many-requests": "Too many tries. Wait a few minutes and try again."
    }[e.code] || e.message);

    async function access() {
      try { const a = await fs.doc("config/access").get(); return a.exists ? a.data() : {}; } catch (e) { return {}; }
    }
    // No emails are ever sent to sign in. Access comes from the lists an admin keeps:
    // dcAccess/{email} (Team tab leader emails), the Field Leader users list, ovApproved, or the admin list.
    // The real test is the Firestore rule itself: if this read works, the person is in.
    async function isApproved(u) {
      const em = String(u.email || "").toLowerCase();
      if ((!!OWNER && em === OWNER) || (C.admins || []).map((v) => String(v).toLowerCase()).includes(em)) return true;
      try { await fs.doc("dcTeams/redhills").get(); return true; } catch (e) { return false; }
    }
    async function roleFor(u) {
      const em = String(u.email || "").toLowerCase();
      const x = await access();
      const admins = [].concat(C.admins || [], x.admins || []).map((v) => String(v).toLowerCase());
      if (em === OWNER || admins.includes(em)) return "admin";
      try { const d = await fs.doc("users/" + em).get(); if (d.exists && d.data().role === "admin") return "admin"; } catch (e) {}
      return "leader";
    }

    let mode = "in";
    function setMode(m) {
      mode = m; msg("");
      $("#authTitle").textContent = m === "in" ? "Sign in" : m === "new" ? "Create your account" : "Reset your password";
      $("#pw2Row").style.display = m === "new" ? "" : "none";
      $("#pwRow").style.display = m === "reset" ? "none" : "";
      $("#authGo").textContent = m === "in" ? "Sign in" : m === "new" ? "Create account" : "Send reset email";
      $("#toNew").style.display = m === "in" ? "" : "none";
      $("#toIn").style.display = m === "in" ? "none" : "";
      $("#toReset").style.display = m === "in" ? "" : "none";
    }
    $("#toNew").onclick = (e) => { e.preventDefault(); setMode("new"); };
    $("#toIn").onclick = (e) => { e.preventDefault(); setMode("in"); };
    $("#toReset").onclick = (e) => { e.preventDefault(); setMode("reset"); };
    $("#authForm").onsubmit = async (e) => {
      e.preventDefault();
      const em = $("#authEmail").value.trim().toLowerCase(), p1 = $("#authPw").value, p2 = $("#authPw2").value;
      if (!okDomain(em)) return msg("Use your @" + DOMAIN + " email.", true);
      try {
        if (mode === "in") await auth.signInWithEmailAndPassword(em, p1);
        else if (mode === "new") {
          if (p1 !== p2) return msg("Passwords do not match.", true);
          await auth.createUserWithEmailAndPassword(em, p1); // no confirmation email; access comes from the admin's list
        } else {
          await auth.sendPasswordResetEmail(em, { url: C.appUrl });
          msg("Check your email for a reset link."); setMode("in");
        }
      } catch (err) { msg(friendly(err), true); }
    };
    $("#authConfirmed").onclick = async () => { await auth.currentUser.reload(); gate(auth.currentUser); };
    $("#authOut").onclick = () => auth.signOut();
    window.DCSignOut = () => auth.signOut().then(() => location.reload());

    async function gate(u) {
      if (!u) { $("#auth").style.display = ""; $("#authConfirm").style.display = "none"; $("#authForm").style.display = ""; setMode("in"); return; }
      const ok = await isApproved(u);
      if (!ok) { $("#authForm").style.display = "none"; $("#authConfirm").style.display = ""; $("#authConfirmTo").textContent = u.email; return; }
      $("#auth").style.display = "none";
      window.DCApp.start({ db, user: { email: u.email.toLowerCase(), name: u.displayName || u.email }, role: await roleFor(u), demo: false });
    }
    auth.onAuthStateChanged(gate);
  }

  window.addEventListener("DOMContentLoaded", () => start().catch((e) => {
    document.body.insertAdjacentHTML("beforeend", `<div class="fatal">Could not start: ${e.message || e}</div>`);
  }));
})();
