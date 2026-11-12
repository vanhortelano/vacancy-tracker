// js/02-auth-boot.js — Start-up, sign in state, login screen
// ONE login system is shared by every page (auth-ui.js): the generated username + password,
// checked by Firebase Authentication. Application data is not in Firebase: it comes from the
// SQL-backed API through sqlstore.js.

/* ---------------------------- boot ---------------------------- */

function boot(){
  initializeTheme();
  if (document.body.dataset.mode === "preview"){
    if (window.__previewBooted) return;
    window.__previewBooted = true;
    currentUser = {displayName:"Preview", email:"preview@local"};
    rooms = (window.SEED_ROOMS || []).map((room, index)=>({
      id: "preview-" + index,
      ...room,
      type: "Room",
      x: 20 + (index % 6) * 150,
      y: 20 + Math.floor(index / 6) * 130,
      beds: room.beds.map(bed=>({...bed, reservedFor:null}))
    }));
    shapes = [];
    prospects = [];
    temporaryClients = [];
    startClock();
    wireStaticUI();
    showApp();
    return;
  }
  wireLoginControls();
  wirePortal();
  showPortal();
  db = SQLSTORE.db;
  SQLSTORE.setTokenProvider(()=>VecancyAuth.token());
  document.getElementById("signOutBtn").addEventListener("click", ()=>{ portalLoginActive = false; VecancyAuth.signOut(); });
  wireStaticUI();
  VecancyAuth.init({
    mount: "#authMount",
    onUser: user=>{
      if (currentUser && currentUser.uid !== user.uid) clearUserWorkspace();
      currentUser = user;
      showApp();
    },
    onSignedOut: ()=>{
      clearUserWorkspace();
      showLogin();
    }
  });
  auth = VecancyAuth.auth;
}

function clearUserWorkspace(){
  currentUser = null;
  stopClock();
  stopDataSubscriptions();
  stopViewerAccess();
  if (typeof clStop === "function") clStop();
  tenantHistory = [];
  rooms = [];
  shapes = [];
  prospects = [];
  temporaryClients = [];
  assistantDataLoaded = {rooms:false,shapes:false,prospects:false,temporaryClients:false};
  lastHistoryPurge = 0;
  processingReservations.clear();
  extendState = null;
  transferState = null;
  editingRoomId = null;
  editingRoomBaseline = null;
  editingShapeId = null;
  activeTab = "dashboard";
  selectedShapeId = null;
  calOffset = 0;
  checkoutProximity = "all";
  checkoutPickerOpen = false;
  layoutLocked = true;
  ["filterGender","filterVacancy","filterDemographic"].forEach(id=>{
    const filter = document.getElementById(id);
    if (filter) filter.value = "all";
  });
  const search = document.getElementById("filterSearch");
  if (search) search.value = "";
  document.querySelectorAll(".modal-backdrop").forEach(modal=>{
    modal.classList.remove("open");
    modal.querySelectorAll("input,textarea").forEach(input=>{
      input.value = input.type === "color" ? input.defaultValue : "";
      if (input.type === "checkbox" || input.type === "radio") input.checked = false;
    });
    modal.querySelectorAll("select").forEach(select=>{ select.selectedIndex = 0; });
  });
  document.querySelectorAll("nav.tabs button").forEach(button=>button.classList.toggle("active", button.dataset.tab==="dashboard"));
  document.querySelectorAll(".view").forEach(view=>view.classList.toggle("active", view.id==="view-dashboard"));
  if (typeof resetAssistantForUserChange === "function") resetAssistantForUserChange();
  if (document.getElementById("app").classList.contains("visible")){
    renderSharedOverview();
    renderDashboard();
    renderOverduePanel();
    renderHallway();
    renderAnalytics();
    renderMatrix();
    renderCalendar();
    renderReserve();
    renderTemporaryClients();
    renderHistory();
  }
}

function wireLoginControls(){
  ["heroThemeToggle", "mobileThemeToggle", "portalThemeToggle"].forEach(id=>{
    document.getElementById(id).addEventListener("click", toggleLoginTheme);
  });
}

function initializeTheme(){
  const darkTheme = localStorage.getItem("loginTheme") === "dark";
  document.body.classList.toggle("auth-dark", darkTheme);
  updateThemeControls(darkTheme);
  const appToggle = document.getElementById("appThemeToggle");
  if (appToggle) appToggle.addEventListener("click", toggleLoginTheme);
}

function updateThemeControls(isDark){
  document.querySelectorAll("#heroThemeToggle i, #mobileThemeToggle i, #portalThemeToggle i, #appThemeIcon").forEach(icon=>{
    icon.className = isDark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  });
  document.querySelectorAll("#heroThemeToggle, #mobileThemeToggle, #portalThemeToggle, #appThemeToggle").forEach(button=>{
    const label = isDark ? "Switch to light mode" : "Switch to dark mode";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  });
}

function toggleLoginTheme(){
  const isDark = !document.body.classList.contains("auth-dark");
  document.body.classList.toggle("auth-dark", isDark);
  localStorage.setItem("loginTheme", isDark ? "dark" : "light");
  updateThemeControls(isDark);
}

function showLogin(){
  document.getElementById("app").classList.remove("visible");
  if (portalLoginActive){
    document.getElementById("loginScreen").style.display = "flex";
    const roles = document.getElementById("roleScreen");
    if (roles) roles.hidden = true;
  } else if (document.getElementById("roleScreen") && document.getElementById("roleScreen").hidden){
    showPortal();
  }
}

function showApp(){
  const loginScreen = document.getElementById("loginScreen");
  if (loginScreen) loginScreen.style.display = "none";
  const roleScreen = document.getElementById("roleScreen");
  if (roleScreen) roleScreen.hidden = true;
  document.getElementById("app").classList.add("visible");
  startClock();
  document.getElementById("userName").textContent = currentUser.displayName || currentUser.email;
  const photo = document.getElementById("userPhoto");
if (photo) photo.src = currentUser.photoURL || "";
  if (db) subscribeData();
  if (typeof clStart === "function") clStart();
  renderActive();
}


/* ------------------- role selection portal -------------------
   The portal only decides WHICH sign-in appears. It never grants access:
   Branch Admin still goes through the one shared sign-in (username + password), and the
   Dormitory Viewer still needs its own access code + password on viewer.html. */

let portalLoginActive = false;
let portalTrail = ["role"];

const PORTAL_LABELS = {
  role:"Role", admin:"Admin", viewer:"Viewer"
};

const PORTAL_SOON = {
  "marketing-viewer":{
    text:"The Marketing Viewer directory needs the central server to collect each branch's approved vacancy summary, and that isn't connected yet. To check one dormitory today, use Dormitory Viewer.",
    viewer:true
  }
};

function showPortal(step){
  const roles = document.getElementById("roleScreen");
  if (!roles) return;
  portalLoginActive = false;
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("app").classList.remove("visible");
  roles.hidden = false;
  portalTrail = [step || "role"];
  renderPortal(false);
}

function portalGo(step){
  portalTrail.push(step);
  renderPortal(true);
}

function portalBack(){
  if (portalTrail.length > 1) portalTrail.pop();
  renderPortal(true);
}

function renderPortal(moveFocus){
  const current = portalTrail[portalTrail.length - 1];
  const isSoon = current.indexOf("soon:") === 0;
  const stepName = isSoon ? "soon" : current;
  document.querySelectorAll("#roleScreen .portal-step").forEach(section=>{
    section.hidden = section.dataset.step !== stepName;
  });
  document.getElementById("portalBack").hidden = portalTrail.length < 2;
  document.getElementById("portalCrumbs").innerHTML = portalTrail.length < 2 ? "" :
    portalTrail.map(s=>"<li>" + (PORTAL_LABELS[s] || s) + "</li>").join("");
  if (isSoon){
    const info = PORTAL_SOON[current.slice(5)];
    document.getElementById("portalSoonText").textContent = info.text;
    document.getElementById("portalSoonBranch").hidden = !info.branch;
    document.getElementById("portalSoonViewer").hidden = !info.viewer;
  }
  if (moveFocus){
    const heading = document.querySelector('#roleScreen .portal-step[data-step="' + stepName + '"] h1');
    if (heading) heading.focus();
  }
}

function portalChoose(action){
  if (action === "branch-admin"){
    portalLoginActive = true;
    document.getElementById("roleScreen").hidden = true;
    document.getElementById("loginScreen").style.display = "flex";
    const username = document.getElementById("vtUser");
    if (username) username.focus();
  } else if (action === "marketing-viewer"){
    location.href = "marketing.html";
  } else if (action === "super-admin"){
    location.href = "superadmin.html";
  } else if (action === "dormitory-viewer"){
    location.href = "viewer.html";
  }
}

function wirePortal(){
  const roles = document.getElementById("roleScreen");
  if (!roles) return;
  roles.addEventListener("click", event=>{
    const target = event.target.closest("[data-go],[data-action]");
    if (!target) return;
    if (target.dataset.go) portalGo(target.dataset.go);
    else portalChoose(target.dataset.action);
  });
  document.getElementById("portalBack").addEventListener("click", portalBack);
  document.getElementById("portalSoonBranch").addEventListener("click", ()=>portalChoose("branch-admin"));
  document.getElementById("portalSoonViewer").addEventListener("click", ()=>portalChoose("dormitory-viewer"));
  document.getElementById("backToRolesBtn").addEventListener("click", ()=>showPortal("role"));
  document.addEventListener("keydown", event=>{
    if (event.key === "Escape" && !roles.hidden && portalTrail.length > 1) portalBack();
  });
}
