/* Viewer page: shared sign-in -> dorm code + password -> read-only views. */
(function(){
  const $ = id => document.getElementById(id);
  const SECTIONS = ["vConfigWarning","vSignIn","vJoin","vMessage","vBoard"];
  function show(name){
    SECTIONS.forEach(id=>{ $(id).hidden = id !== name; });
    $("vAuthShell").hidden = name !== "vSignIn" && name !== "vJoin";
  }
  function applyTheme(dark){
    document.body.classList.toggle("v-dark", dark);
    const label = dark ? "Switch to light mode" : "Switch to dark mode";
    $("vThemeToggle").setAttribute("aria-label", label);
    $("vThemeToggle").title = label;
    $("vThemeIcon").className = dark ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
  try{ applyTheme(localStorage.getItem("loginTheme") === "dark"); }
  catch(error){ applyTheme(false); }
  $("vThemeToggle").addEventListener("click", ()=>{
    const dark = !document.body.classList.contains("v-dark");
    applyTheme(dark);
    try{ localStorage.setItem("loginTheme", dark ? "dark" : "light"); }
    catch(error){ console.error("Could not save viewer theme", error); }
  });
  $("vPasswordToggle").addEventListener("click", ()=>{
    const input = $("vPassword");
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    $("vPasswordToggle").setAttribute("aria-label", visible ? "Hide password" : "Show password");
    $("vPasswordToggle").innerHTML = `<i class="fa-regular ${visible ? "fa-eye-slash" : "fa-eye"}"></i>`;
  });
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || cfg.apiKey === "YOUR_API_KEY"){ show("vConfigWarning"); return; }
  // Same app + tab-session storage as marketing.html, so a marketing viewer is already signed in here.
  const viaMarketing = new URLSearchParams(location.search).get("via") === "marketing";
  // One shared sign-in for every page (auth-ui.js); data comes from the SQL-backed API.
  let auth = null;
  const db = SQLSTORE.db;
  SQLSTORE.setTokenProvider(()=>VecancyAuth.token());
  if (viaMarketing){ $("vSignOut").hidden = true; $("vBackViewers").hidden = false; }

  let unsubViewerDoc = null, unsubVacancy = null, unsubLayout = null;
  let vacancyRooms = [];
  let hallwayShapes = [];
  let currentUser = null;
  let authStateGeneration = 0;

  function stopListening(){
    if (unsubViewerDoc) unsubViewerDoc();
    if (unsubVacancy) unsubVacancy();
    if (unsubLayout) unsubLayout();
    unsubViewerDoc = null;
    unsubVacancy = null;
    unsubLayout = null;
    vacancyRooms = [];
    hallwayShapes = [];
  }

  function showEnded(title, text){
    stopListening();
    $("vMessageTitle").textContent = title;
    $("vMessageText").textContent = text;
    show("vMessage");
  }

  /* ---------------- sign in (shared login, see auth-ui.js) ---------------- */
  $("vSignOut").addEventListener("click", ()=>VecancyAuth.signOut());
  $("vSwitchServer").addEventListener("click",()=>{
    stopListening();
    $("vCode").value = "";
    $("vPassword").value = "";
    $("vJoinError").textContent = "";
    $("vJoin").querySelector("h2").textContent = "Switch server";
    $("vJoin").querySelector(":scope > p").textContent = "Enter the dorm code and password for another server you have access to.";
    show("vJoin");
    $("vCode").focus();
  });
  $("vBackToSignIn").addEventListener("click", ()=>VecancyAuth.signOut());
  $("vTryAgainBtn").addEventListener("click", ()=>{
    $("vJoinError").textContent = "";
    show("vJoin");
  });
  ["vCode","vPassword"].forEach(id=>{
    $(id).addEventListener("keydown", event=>{
      if (event.key === "Enter") $("vJoinBtn").click();
    });
  });

  VecancyAuth.init({
    mount: "#authMount",
    onSignedOut: ()=>{
      ++authStateGeneration;
      stopListening();
      currentUser = null;
      $("vUser").hidden = true;
      $("vSwitchServer").hidden = true;
      show("vSignIn");
    },
    onUser: user=>{
      const generation = ++authStateGeneration;
      stopListening();
      currentUser = user;
      $("vUser").hidden = false;
      $("vSwitchServer").hidden = false;
      $("vUserName").textContent = user.displayName || user.email || "";
      if (generation === authStateGeneration && auth && auth.currentUser && auth.currentUser.uid === user.uid) show("vJoin");
      if (viaMarketing) $("vSignOut").hidden = true;
      // Coming from the marketing page: its pop-up already collected the dorm code + password.
      let pending = null;
      try{ pending = JSON.parse(sessionStorage.getItem("dormJoin") || "null"); sessionStorage.removeItem("dormJoin"); }catch(e){}
      if (viaMarketing && pending && pending.code && pending.password){
        $("vCode").value = pending.code; $("vPassword").value = pending.password;
        $("vJoinBtn").click();
      }
    }
  });
  auth = VecancyAuth.auth;

  /* ---------------- join ---------------- */
  $("vJoinBtn").addEventListener("click", async ()=>{
    const user = auth.currentUser;
    const error = $("vJoinError");
    error.textContent = "";
    if (!user) return;
    const code = normalizeDormCode($("vCode").value);
    const password = $("vPassword").value;
    if (!isValidDormCode(code) || !password){
      error.textContent = !code || !password
        ? "Enter the dorm code and password."
        : "Dorm codes must be 4–30 characters using letters, numbers, and dashes.";
      return;
    }
    const button = $("vJoinBtn");
    button.disabled = true;
    try{
      const viewerRef = db.collection("dorms").doc(code).collection("viewers").doc(user.uid);
      const proof = await viewerProof(code, password);
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      const existing = await viewerRef.get();
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      if (existing.exists && existing.data().proof !== proof){
        error.textContent = "That dorm code and password do not match. Check them with your administrator.";
        return;
      }
      if (!existing || !existing.exists){
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
        await viewerRef.set({
          proof,
          name: user.displayName || "",
          email: user.email || "",
          joinedAt: sqlServerTimestamp()
        });
      }
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      $("vPassword").value = "";
      $("vJoin").querySelector("h2").textContent = "Enter your dorm details";
      $("vJoin").querySelector(":scope > p").textContent = "Use the exact code and password shared by your dorm administrator.";
      startBoard(user, code);
    }catch(err){
      if (err.code === "permission-denied"){
        // Not a dorm code: it may be a Super Admin server code. Join it and open the directory.
        try{
          const proof2 = await viewerProof(code, password);
          const ref = db.collection("centralAccess").doc(code).collection("viewers").doc(user.uid);
          const ex = await ref.get();
          if (!(ex.exists && ex.data().proof === proof2)){
            await ref.set({proof:proof2, name:user.displayName||"", email:user.email||"", joinedAt:sqlServerTimestamp()});
          }
          sessionStorage.setItem("centralCode", code);
          location.href = "marketing.html";
          return;
        }catch(e2){ /* wrong code/password for both server types */ }
      }
      console.error("Join failed", err);
      error.textContent = err.code === "permission-denied"
        ? "Could not join with those details. Check the code and password, or ask your admin if viewer access is enabled."
        : "Could not join: " + err.message;
    }finally{
      button.disabled = false;
    }
  });

  /* ---------------- vacancy board ---------------- */
  function startBoard(user, code){
    stopListening();
    show("vBoard");
    const hallwayTab = document.querySelector('[data-v-view="hallway"]');
    if (hallwayTab) hallwayTab.click();   // land on the hallway map
    const dorm = db.collection("dorms").doc(code);
    unsubViewerDoc = dorm.collection("viewers").doc(user.uid).onSnapshot(snap=>{
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      if (!snap.exists) showEnded("Access ended", "The admin removed your access. Ask them if you think this is a mistake.");
    }, ()=>{
      if (auth.currentUser && auth.currentUser.uid === user.uid) showEnded("Access ended", "You no longer have access to this dorm.");
    });
    unsubVacancy = dorm.collection("vacancy").onSnapshot(snap=>{
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      vacancyRooms = snap.docs.map(d=>({id:d.id, ...d.data()}));
      renderBoard();
    }, err=>{
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      if (err.code === "permission-denied") showEnded("Access ended", "The admin turned off viewer access or removed you.");
      else console.error("Vacancy listener failed", err);
    });
    unsubLayout = dorm.collection("layout").doc("public").onSnapshot(snap=>{
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      hallwayShapes = snap.exists && Array.isArray(snap.data().shapes) ? snap.data().shapes : [];
      renderHallway();
    }, err=>{
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
      if (err.code === "permission-denied") showEnded("Access ended", "The admin turned off viewer access or removed you.");
      else console.error("Hallway layout listener failed", err);
    });
  }

  function filteredRooms(){
    const statusFilter = $("vFilterStatus").value;
    const genderFilter = $("vFilterGender").value;
    const demographicFilter = $("vFilterDemographic").value;
    const search = $("vFilterSearch").value.trim().toLowerCase();
    return vacancyRooms.slice()
      .sort((a,b)=>String(a.room).localeCompare(String(b.room), undefined, {numeric:true}))
      .filter(room=>
        (statusFilter==="all" || (statusFilter==="vacant" ? room.vacant>0 : room.vacant===0)) &&
        (genderFilter==="all" || room.gender===genderFilter) &&
        (demographicFilter==="all" || room.demographic===demographicFilter) &&
        (!search || String(room.room).toLowerCase().includes(search))
      );
  }

  function renderBoard(){
    const sorted = vacancyRooms.slice().sort((a,b)=>String(a.room).localeCompare(String(b.room), undefined, {numeric:true}));
    const vacantRooms = sorted.filter(r=>r.vacant > 0).length;
    const vacantBeds = sorted.reduce((sum,r)=>sum + (r.vacant||0), 0);
    const totalBeds = sorted.reduce((sum,r)=>sum + (r.total||0), 0);
    const occupiedBeds = sorted.reduce((sum,r)=>sum + Math.max(0,(r.total||0)-(r.vacant||0)-(r.reserved||0)), 0);
    $("vSummary").innerHTML =
      `<div class="v-stat good"><b>${vacantBeds}</b><span>Vacant beds</span></div>` +
      `<div class="v-stat good"><b>${vacantRooms}</b><span>Rooms with space</span></div>` +
      `<div class="v-stat"><b>${sorted.length - vacantRooms}</b><span>Full rooms</span></div>`;
    const list = filteredRooms();
    $("vGrid").innerHTML = list.length ? list.map(r=>{
      const full = !(r.vacant > 0);
      return `<div class="v-room ${esc(r.gender)}">
        <h3>Room ${esc(r.room)}</h3>
        <div class="v-meta">${esc(r.gender||"Mixed")} · ${esc(r.demographic||"Mixed")} · ${r.total||0} bed${r.total===1?"":"s"}</div>
        <span class="v-pill ${full?"full":"vacant"}">${full ? "Full" : r.vacant + " vacant"}</span>
      </div>`;
    }).join("") : `<div class="v-empty">${vacancyRooms.length ? "No rooms match this filter." : "The admin hasn't published any rooms yet."}</div>`;
    renderHallway();
    renderAnalytics(sorted, totalBeds, occupiedBeds, vacantBeds);
    $("vUpdated").textContent = "Live — updates automatically when the admin changes a room.";
  }

  function renderHallway(){
    // Same geometry as the branch admin map: 118x70 tiles, all rooms shown (list filters don't hide map tiles).
    const canvas = $("vHallwayCanvas");
    const rooms = vacancyRooms.slice();
    const shown = new Set(filteredRooms());
    const roomWidth = 118, roomHeight = 70;
    const shapes = hallwayShapes.filter(shape=>shape && typeof shape.label === "string").map(shape=>{
      const geometry = ["rectangle","circle","triangle"].includes(shape.geometry) ? shape.geometry : "rectangle";
      let w = safeSize(shape.width,160), h = safeSize(shape.height,100);
      if (geometry === "circle") w = h = Math.max(w,h);
      return {...shape, geometry, w, h};
    });
    const maxX = Math.max(800,...rooms.map(r=>safePosition(r.x)+roomWidth+24),...shapes.map(s=>safePosition(s.x)+s.w+24));
    const maxY = Math.max(420,...rooms.map(r=>safePosition(r.y)+roomHeight+24),...shapes.map(s=>safePosition(s.y)+s.h+24));
    canvas.style.width = `${Math.min(maxX,5000)}px`;
    canvas.style.height = `${Math.min(maxY,3000)}px`;
    const okDot = ["occupied","vacant","reserved","temporary","overdue","soon"];
    const roomTiles = rooms.map(room=>{
      const vacant = safeCount(room.vacant);
      const dots = (Array.isArray(room.beds) ? room.beds : []).map(st=>`<span class="${okDot.includes(st) ? st : ""}"></span>`).join("");
      return `<div class="v-hall-room ${vacant ? "has-vacancy" : "is-full"}${shown.has(room) ? "" : " filtered-out"}" style="left:${safePosition(room.x)}px;top:${safePosition(room.y)}px" aria-label="Room ${esc(room.room)}, ${vacant} vacant">
        <strong>${esc(room.room)}</strong>
        <em>${esc(room.gender||"Mixed")} · ${vacant} vacant</em>
        <div class="v-hall-dots">${dots}</div>
      </div>`;
    }).join("");
    const shapeTiles = shapes.map(shape=>{
      const kind = shape.kind === "walkway" ? "walkway" : "facility";
      const color = /^#[0-9a-f]{6}$/i.test(shape.color||"") ? shape.color : "#dce8e4";
      const rotation = Number.isFinite(Number(shape.labelRotation)) ? Number(shape.labelRotation) : 0;
      return `<div class="v-hall-shape ${kind} geometry-${shape.geometry}" style="left:${safePosition(shape.x)}px;top:${safePosition(shape.y)}px;width:${shape.w}px;height:${shape.h}px;--shape-color:${color}" aria-label="${esc(shape.label)}"><span style="transform:rotate(${rotation}deg)">${esc(shape.label)}</span></div>`;
    }).join("");
    canvas.innerHTML = roomTiles + shapeTiles || `<p class="v-empty">The admin hasn't published a hallway layout yet.</p>`;
  }

  function renderAnalytics(rooms, totalBeds, occupiedBeds, vacantBeds){
    const reservedBeds = rooms.reduce((sum,room)=>sum+safeCount(room.reserved),0);
    const occupancy = totalBeds ? Math.round((occupiedBeds/totalBeds)*100) : 0;
    $("vAnalyticsStats").innerHTML =
      `<div class="v-stat"><b>${occupancy}%</b><span>Occupancy rate</span></div>`+
      `<div class="v-stat"><b>${totalBeds}</b><span>Total beds</span></div>`+
      `<div class="v-stat good"><b>${vacantBeds}</b><span>Vacant beds</span></div>`+
      `<div class="v-stat"><b>${reservedBeds}</b><span>Reserved beds</span></div>`;
    const vacancyByRoom = rooms.filter(room=>safeCount(room.vacant)>0)
      .sort((a,b)=>safeCount(b.vacant)-safeCount(a.vacant));
    const maxVacancy = Math.max(1,...vacancyByRoom.map(room=>safeCount(room.vacant)));
    $("vVacancyBars").innerHTML = vacancyByRoom.length
      ? vacancyByRoom.map(room=>`<div class="v-bar-row"><span>Room ${esc(room.room)}</span><div><i style="width:${safeCount(room.vacant)/maxVacancy*100}%"></i></div><b>${safeCount(room.vacant)}</b></div>`).join("")
      : `<p class="v-empty">No vacant beds right now.</p>`;
    const byGender = {};
    const byGroup = {};
    rooms.forEach(room=>{
      const gender = room.gender || "Mixed";
      byGender[gender] = (byGender[gender]||0) + safeCount(room.total);
      const group = room.demographic || "Mixed";
      byGroup[group] = (byGroup[group]||0) + safeCount(room.total);
    });
    const maxGender = Math.max(1,...Object.values(byGender));
    const maxGroup = Math.max(1,...Object.values(byGroup));
    $("vGenderBars").innerHTML = Object.keys(byGender).length
      ? Object.entries(byGender).map(([gender,count])=>`<div class="v-bar-row"><span>${esc(gender)}</span><div><i style="width:${count/maxGender*100}%"></i></div><b>${count}</b></div>`).join("")
      : `<p class="v-empty">No published rooms yet.</p>`;
    $("vDemographicBars").innerHTML = Object.keys(byGroup).length
      ? Object.entries(byGroup).map(([group,count])=>`<div class="v-bar-row"><span>${esc(group)}</span><div><i style="width:${count/maxGroup*100}%"></i></div><b>${count}</b></div>`).join("")
      : `<p class="v-empty">No published rooms yet.</p>`;
  }

  function safePosition(value){
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0,Math.min(5000,number)) : 20;
  }

  function safeSize(value,fallback){
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(36,Math.min(2000,number)) : fallback;
  }

  function safeCount(value){
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0,number) : 0;
  }

  function esc(value){
    return String(value==null?"":value).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  ["vFilterStatus","vFilterGender","vFilterDemographic"].forEach(id=>$(id).addEventListener("change",renderBoard));
  $("vFilterSearch").addEventListener("input",renderBoard);
  document.querySelectorAll("[data-v-view]").forEach(button=>button.addEventListener("click",()=>{
    const view = button.dataset.vView;
    document.querySelectorAll("[data-v-view]").forEach(tab=>{
      const active = tab === button;
      tab.classList.toggle("active",active);
      tab.setAttribute("aria-pressed",String(active));
    });
    $("vVacanciesView").hidden = view !== "vacancies";
    $("vHallwayView").hidden = view !== "hallway";
    $("vAnalyticsView").hidden = view !== "analytics";
    $("vFilterStatus").hidden = view === "analytics";
    $("vFilterGender").hidden = view === "analytics";
    $("vFilterDemographic").hidden = view === "analytics";
    $("vFilterSearch").hidden = view === "analytics";
  }));
})();
