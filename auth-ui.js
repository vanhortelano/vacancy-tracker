/* auth-ui.js — ONE login system for every page (Admin, Viewer, Super Admin, Marketing Viewer).

   People sign in with a generated username  name@vecancy.tracker  + a password. Firebase
   Authentication holds only that login. To create or recover an account, the person proves who
   they are with their Google account or an emailed link (we never see a Google password), and the
   server does the rest. Pages call VecancyAuth.init({mount, onUser, onSignedOut}); onUser fires
   only for a fully signed-in, registered account.                                                 */
(function(){
"use strict";
var DOMAIN = "@vecancy.tracker";
var A = {auth: null, user: null, proof: null, mode: "signin", hold: false, cfg: null, opts: null, root: null, nameTimer: 0};

function $(sel){ return A.root.querySelector(sel); }
function mode(){ try{ return sessionStorage.getItem("vtMode") || "create"; }catch(e){ return "create"; } }

/* ---------------------------------------------------------------- server calls */
function api(path, token, body, method){
  return fetch("/api" + path, {
    method: method || "POST",
    headers: Object.assign({"Content-Type": "application/json"}, token ? {Authorization: "Bearer " + token} : {}),
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  }).then(function(res){
    return res.json().catch(function(){ return {}; }).then(function(j){
      if (!res.ok){ var e = new Error(j.message || "Something went wrong."); e.code = j.error || "error"; e.status = res.status; throw e; }
      return j;
    });
  });
}
function proofToken(){ return A.auth.currentUser.getIdToken(true); }

function friendly(err){
  var c = err && err.code;
  if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "";
  var map = {
    "auth/invalid-email": "Enter a valid email address.",
    "auth/user-not-found": "The username or password is incorrect.",
    "auth/wrong-password": "The username or password is incorrect.",
    "auth/invalid-credential": "The username or password is incorrect.",
    "auth/user-disabled": "This account is disabled.",
    "auth/too-many-requests": "Too many attempts. Wait a little while, then try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/unauthorized-domain": "This site is not authorized in Firebase Authentication settings.",
    "auth/operation-not-allowed": "This sign-in method is turned off in Firebase Authentication settings.",
    "auth/account-exists-with-different-credential": "That email is already used another way. Use “Email me a link” instead.",
    "auth/invalid-action-code": "That link has expired or was already used. Request a new one.",
    "auth/expired-action-code": "That link has expired. Request a new one."
  };
  return map[c] || (err && err.status ? err.message : "Something went wrong. Please try again.");
}

/* ---------------------------------------------------------------- UI */
var GOOGLE_SVG = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>';

function build(){
  A.root.innerHTML =
  '<div class="vt-auth">' +
  '<div class="vt-tabs" role="tablist" aria-label="Account">' +
    '<button type="button" class="vt-tab" role="tab" data-mode="signin">Sign in</button>' +
    '<button type="button" class="vt-tab" role="tab" data-mode="create">Create account</button>' +
    '<button type="button" class="vt-tab" role="tab" data-mode="update">Update account</button></div>' +

  '<form class="vt-pane" data-pane="signin" novalidate>' +
    '<h2 class="vt-h">Welcome back</h2><p class="vt-sub">Sign in with your Vecancy username and password.</p>' +
    '<div class="vt-field"><label for="vtUser">Username</label><div class="vt-input"><input id="vtUser" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="yourname@vecancy.tracker"></div></div>' +
    '<div class="vt-field"><label for="vtPass">Password</label><div class="vt-input"><input id="vtPass" type="password" autocomplete="current-password" placeholder="Your password"><button type="button" class="vt-eye" data-eye="vtPass" aria-label="Show password">Show</button></div></div>' +
    '<button class="vt-btn vt-primary" type="submit" data-act="signin">Sign in</button>' +
    '<p class="vt-msg" data-msg="signin" role="status" aria-live="polite"></p>' +
    '<p class="vt-note">Forgot your password? Open <button type="button" class="vt-link" data-go="update">Update account</button> to verify it\'s you and set a new one.</p>' +
  '</form>' +

  '<div class="vt-pane" data-pane="verify" hidden>' +
    '<h2 class="vt-h" data-verify-title>Create your account</h2>' +
    '<p class="vt-sub" data-verify-sub>First, verify it\'s you with your Google account or email. We never see your Google password.</p>' +
    '<button type="button" class="vt-btn" data-act="google">' + GOOGLE_SVG + '<span>Continue with Google</span></button>' +
    '<div class="vt-or">or</div>' +
    '<div class="vt-field"><label for="vtMail">Email address</label><div class="vt-input"><input id="vtMail" type="email" autocomplete="email" placeholder="name@example.com"></div></div>' +
    '<button type="button" class="vt-btn" data-act="emaillink">Email me a verification link</button>' +
    '<p class="vt-msg" data-msg="verify" role="status" aria-live="polite"></p>' +
  '</div>' +

  '<form class="vt-pane" data-pane="create" hidden novalidate>' +
    '<h2 class="vt-h">Choose your username</h2>' +
    '<div class="vt-who"><span>Verified as <b data-who></b></span><button type="button" class="vt-link" data-act="other">Use a different account</button></div>' +
    '<div class="vt-field"><label for="vtName">Your name</label><div class="vt-input"><input id="vtName" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="30" placeholder="yourname"><span class="vt-suffix">' + DOMAIN + '</span></div>' +
      '<p class="vt-hint" data-hint role="status" aria-live="polite"></p></div>' +
    '<div class="vt-field"><label for="vtNew">Create a password</label><div class="vt-input"><input id="vtNew" type="password" autocomplete="new-password" placeholder="At least 8 characters"><button type="button" class="vt-eye" data-eye="vtNew" aria-label="Show password">Show</button></div></div>' +
    '<div class="vt-field"><label for="vtNew2">Repeat password</label><div class="vt-input"><input id="vtNew2" type="password" autocomplete="new-password"></div></div>' +
    '<button class="vt-btn vt-primary" type="submit" data-act="create">Create account</button>' +
    '<p class="vt-msg" data-msg="create" role="status" aria-live="polite"></p>' +
    '<p class="vt-note">Your username and password become your login everywhere. Your Google or email is only used to verify and recover your account.</p>' +
  '</form>' +

  '<div class="vt-pane" data-pane="update" hidden>' +
    '<h2 class="vt-h">Your account</h2>' +
    '<div class="vt-who"><span>Verified as <b data-who></b></span><button type="button" class="vt-link" data-act="other">Use a different account</button></div>' +
    '<p class="vt-sub">Your username:</p>' +
    '<div class="vt-userbox"><code data-username></code><button type="button" class="vt-link" data-act="copy">Copy</button></div>' +
    '<button type="button" class="vt-btn" data-act="showchange">Change password</button>' +
    '<form data-changebox hidden novalidate style="margin-top:14px">' +
      '<div class="vt-field"><label for="vtChg">New password</label><div class="vt-input"><input id="vtChg" type="password" autocomplete="new-password" placeholder="At least 8 characters"><button type="button" class="vt-eye" data-eye="vtChg" aria-label="Show password">Show</button></div></div>' +
      '<div class="vt-field"><label for="vtChg2">Repeat new password</label><div class="vt-input"><input id="vtChg2" type="password" autocomplete="new-password"></div></div>' +
      '<button class="vt-btn vt-primary" type="submit" data-act="savepw">Save new password</button></form>' +
    '<p class="vt-msg" data-msg="update" role="status" aria-live="polite"></p>' +
  '</div>' +

  '<div class="vt-pane" data-pane="done" hidden>' +
    '<h2 class="vt-h">Account created</h2><p class="vt-sub">This is your username. You will use it to sign in:</p>' +
    '<div class="vt-userbox"><code data-username></code><button type="button" class="vt-link" data-act="copy">Copy</button></div>' +
    '<button type="button" class="vt-btn vt-primary" data-act="continue">Continue</button>' +
  '</div></div>';
}

function say(which, text, kind){
  var el = $('[data-msg="' + which + '"]');
  if (!el) return;
  el.textContent = text || "";
  el.className = "vt-msg" + (kind === "bad" ? " vt-bad" : kind === "good" ? " vt-good" : "");
}
function busy(btn, on){ if (btn) btn.disabled = !!on; }

function show(pane){
  Array.prototype.forEach.call(A.root.querySelectorAll(".vt-pane"), function(p){ p.hidden = p.getAttribute("data-pane") !== pane; });
}

function render(){
  var tabsOn = A.mode !== "done";
  $(".vt-tabs").hidden = !tabsOn;
  Array.prototype.forEach.call(A.root.querySelectorAll(".vt-tab"), function(t){ t.setAttribute("aria-selected", String(t.getAttribute("data-mode") === A.mode)); });
  if (A.mode === "signin") return show("signin");
  if (A.mode === "done") return show("done");
  if (!A.proof){
    $("[data-verify-title]").textContent = A.mode === "create" ? "Create your account" : "Update your account";
    $("[data-verify-sub]").textContent = A.mode === "create"
      ? "First, verify it's you with your Google account or email. We never see your Google password."
      : "Verify it's you with the Google account or email you used to register, to see your username or set a new password.";
    return show("verify");
  }
  Array.prototype.forEach.call(A.root.querySelectorAll("[data-who]"), function(b){ b.textContent = A.proof.email || ""; });
  if (A.mode === "create"){ show("create"); }
  else { show("update"); lookup(); }
}

function setMode(m){
  A.mode = m;
  try{ if (m === "create" || m === "update") sessionStorage.setItem("vtMode", m); }catch(e){}
  Array.prototype.forEach.call(A.root.querySelectorAll(".vt-msg,.vt-hint"), function(x){ x.textContent = ""; x.className = x.className.replace(/ ?vt-(bad|good)/g, ""); });
  render();
}

/* ---------------------------------------------------------------- flows */
function normalizeUsername(v){
  v = String(v || "").trim().toLowerCase();
  if (!v) return "";
  if (v.indexOf("@") === -1) return v + DOMAIN;
  return v;
}

function doSignIn(btn){
  var user = normalizeUsername($("#vtUser").value), pw = $("#vtPass").value;
  if (!user || !pw) return say("signin", "Enter your username and password.", "bad");
  if (user.slice(-DOMAIN.length) !== DOMAIN) return say("signin", "Sign in with your Vecancy username (name" + DOMAIN + "), not your Google email. New here? Use Create account.", "bad");
  busy(btn, true); say("signin", "Signing in…");
  A.auth.signInWithEmailAndPassword(user, pw).then(function(){ say("signin", ""); })
    .catch(function(e){ say("signin", friendly(e), "bad"); })
    .then(function(){ busy(btn, false); });
}

function googleProof(){
  var provider = new firebase.auth.GoogleAuthProvider();
  say("verify", "Opening Google…");
  A.auth.signInWithPopup(provider).then(function(){ say("verify", ""); }).catch(function(e){
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment"){
      return A.auth.signInWithRedirect(provider);
    }
    say("verify", friendly(e), e && e.code ? "bad" : "");
  });
}

function emailLink(btn){
  var email = $("#vtMail").value.trim();
  if (!email) return say("verify", "Enter your email address.", "bad");
  busy(btn, true); say("verify", "Sending…");
  A.auth.sendSignInLinkToEmail(email, {url: location.origin + location.pathname, handleCodeInApp: true}).then(function(){
    try{ localStorage.setItem("vtEmail", email); }catch(e){}
    say("verify", "Check your inbox for the link, then open it in this browser to continue.", "good");
  }).catch(function(e){ say("verify", friendly(e), "bad"); }).then(function(){ busy(btn, false); });
}

function checkName(){
  var raw = $("#vtName").value, hint = $("[data-hint]");
  clearTimeout(A.nameTimer);
  hint.className = "vt-hint";
  if (!raw.trim()){ hint.textContent = ""; return; }
  hint.textContent = "Your username will be " + raw.trim().toLowerCase() + DOMAIN;
  A.nameTimer = setTimeout(function(){
    proofToken().then(function(t){ return api("/account/check-name", t, {username: raw}); }).then(function(r){
      if ($("#vtName").value !== raw) return;
      hint.className = "vt-hint " + (r.available ? "vt-good" : "vt-bad");
      hint.textContent = r.available ? "✓ " + r.username + " is available" : "This name was taken. Please choose another.";
    }).catch(function(e){
      if ($("#vtName").value !== raw) return;
      hint.className = "vt-hint vt-bad"; hint.textContent = e.code === "bad_username" ? e.message : "";
    });
  }, 400);
}

function doCreate(btn){
  var name = $("#vtName").value, pw = $("#vtNew").value;
  if (!name.trim()) return say("create", "Choose your name first.", "bad");
  if (pw.length < 8) return say("create", "Use a password of at least 8 characters.", "bad");
  if (pw !== $("#vtNew2").value) return say("create", "The two passwords do not match.", "bad");
  busy(btn, true); say("create", "Creating your account…");
  var username;
  A.hold = true;
  proofToken().then(function(t){ return api("/account/register", t, {username: name, password: pw}); }).then(function(r){
    username = r.username;
    Array.prototype.forEach.call(A.root.querySelectorAll("[data-username]"), function(c){ c.textContent = username; });
    A.proof = null; A.mode = "done"; render();       // show the new username first
    return A.auth.signOut();                         // end the temporary verification session
  }).then(function(){
    return A.auth.signInWithEmailAndPassword(username, pw);
  }).catch(function(e){
    A.hold = false;
    if (e.code === "name_taken"){
      var hint = $("[data-hint]"); hint.className = "vt-hint vt-bad"; hint.textContent = e.message;
      say("create", e.message, "bad"); $("#vtName").focus();
    } else if (e.code === "reauth"){
      say("create", e.message, "bad"); A.auth.signOut();
    } else say("create", friendly(e), "bad");
  }).then(function(){ busy(btn, false); });
}

var looked = null;
function lookup(){
  if (looked === A.proof.uid) return;
  say("update", "Looking up your account…");
  proofToken().then(function(t){ return api("/account/lookup", t, {}); }).then(function(r){
    looked = A.proof.uid;
    $('[data-pane="update"] [data-username]').textContent = r.username;
    say("update", "");
  }).catch(function(e){
    $('[data-pane="update"] [data-username]').textContent = "";
    say("update", e.code === "no_account" ? e.message : friendly(e), "bad");
  });
}

function savePassword(btn){
  var pw = $("#vtChg").value;
  if (pw.length < 8) return say("update", "Use a password of at least 8 characters.", "bad");
  if (pw !== $("#vtChg2").value) return say("update", "The two passwords do not match.", "bad");
  busy(btn, true); say("update", "Saving…");
  proofToken().then(function(t){ return api("/account/password", t, {newPassword: pw}); }).then(function(r){
    A.proof = null; looked = null;
    return A.auth.signOut().then(function(){
      A.mode = "signin"; render();
      $("#vtUser").value = r.username; $("#vtPass").value = ""; $("#vtPass").focus();
      say("signin", "Password changed. Sign in with your username and new password.", "good");
    });
  }).catch(function(e){ say("update", e.code === "reauth" ? e.message : friendly(e), "bad"); })
    .then(function(){ busy(btn, false); });
}

/* ---------------------------------------------------------------- auth state */
function handle(u){
  if (!u){
    A.user = null; A.proof = null; looked = null;
    if (A.opts.onSignedOut) A.opts.onSignedOut();
    if (A.mode !== "create" && A.mode !== "update" && A.mode !== "done") A.mode = "signin";
    return render();
  }
  if ((u.email || "").toLowerCase().slice(-DOMAIN.length) === DOMAIN){
    u.getIdToken().then(function(t){ return api("/session", t, null, "GET"); }).then(function(sess){
      A.user = u; A.proof = null;
      if (A.hold) return;                               // let the person see their new username first
      A.opts.onUser(u, sess);
    }).catch(function(e){
      A.auth.signOut();
      A.mode = "signin"; render();
      say("signin", e.code === "account_required" ? e.message : "Could not sign you in. Please try again.", "bad");
    });
  } else {
    // signed in with Google / an emailed link: this is only a proof of identity, not a session
    A.user = null; A.proof = u;
    if (A.opts.onSignedOut) A.opts.onSignedOut();
    if (A.mode === "signin" || A.mode === "done") A.mode = mode();
    render();
  }
}

function init(opts){
  A.opts = opts;
  A.root = typeof opts.mount === "string" ? document.querySelector(opts.mount) : opts.mount;
  A.cfg = window.FIREBASE_CONFIG;
  build();
  A.root.addEventListener("click", function(ev){
    var t = ev.target.closest("[data-mode],[data-act],[data-go],[data-eye]");
    if (!t) return;
    if (t.hasAttribute("data-mode")) return setMode(t.getAttribute("data-mode"));
    if (t.hasAttribute("data-go")) return setMode(t.getAttribute("data-go"));
    if (t.hasAttribute("data-eye")){ var i = $("#" + t.getAttribute("data-eye")); var on = i.type === "password"; i.type = on ? "text" : "password"; t.textContent = on ? "Hide" : "Show"; return; }
    var act = t.getAttribute("data-act");
    if (act === "google") googleProof();
    else if (act === "emaillink") emailLink(t);
    else if (act === "other"){ A.auth.signOut(); }
    else if (act === "showchange"){ $("[data-changebox]").hidden = false; $("#vtChg").focus(); }
    else if (act === "copy"){ var code = t.parentNode.querySelector("code"); if (navigator.clipboard && code) navigator.clipboard.writeText(code.textContent).then(function(){ t.textContent = "Copied"; }); }
    else if (act === "continue"){ A.hold = false; A.mode = "signin"; if (A.user) A.opts.onUser(A.user, {}); }
  });
  A.root.addEventListener("submit", function(ev){
    ev.preventDefault();
    var f = ev.target, pane = f.getAttribute("data-pane") || "";
    if (pane === "signin") doSignIn(f.querySelector('[data-act="signin"]'));
    else if (pane === "create") doCreate(f.querySelector('[data-act="create"]'));
    else if (f.hasAttribute("data-changebox")) savePassword(f.querySelector('[data-act="savepw"]'));
  });
  A.root.addEventListener("input", function(ev){ if (ev.target.id === "vtName") checkName(); });

  if (!A.cfg || A.cfg.apiKey === "YOUR_API_KEY"){
    A.root.innerHTML = '<div class="vt-auth"><h2 class="vt-h">Setup needed</h2><p class="vt-sub">Firebase Authentication is not configured yet. Check <code>firebase-config.js</code> and <code>SETUP-GUIDE.md</code>.</p></div>';
    return;
  }
  firebase.initializeApp(A.cfg);
  A.auth = firebase.auth();
  VecancyAuth.auth = A.auth;
  A.mode = "signin";
  A.auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).then(function(){
    // finish an emailed-link verification if this page was opened from one
    if (A.auth.isSignInWithEmailLink(location.href)){
      var email = null;
      try{ email = localStorage.getItem("vtEmail"); }catch(e){}
      if (!email) email = window.prompt("Confirm the email address you used:");
      A.mode = mode();
      if (email){
        return A.auth.signInWithEmailLink(email, location.href).then(function(){
          try{ localStorage.removeItem("vtEmail"); }catch(e){}
          history.replaceState(null, "", location.pathname);
        }).catch(function(e){ render(); say("verify", friendly(e), "bad"); });
      }
    }
    if (location.protocol !== "file:") return A.auth.getRedirectResult().catch(function(e){ A.mode = mode(); render(); say("verify", friendly(e), "bad"); });
  }).then(function(){
    A.auth.onAuthStateChanged(handle);
  });
}

window.VecancyAuth = {
  init: init,
  auth: null,
  token: function(){
    var u = A.auth && A.auth.currentUser;
    if (!u || (u.email || "").slice(-DOMAIN.length) !== DOMAIN) return Promise.reject(Object.assign(new Error("Please sign in."), {code: "unauthenticated"}));
    return u.getIdToken();
  },
  signOut: function(){ return A.auth ? A.auth.signOut() : Promise.resolve(); },
  DOMAIN: DOMAIN
};
})();
