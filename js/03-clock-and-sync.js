// js/03-clock-and-sync.js — Live clock and live data refresh (per-user tables in SQL)
/* ---------------------------- live clock ---------------------------- */

let clockTickTimer = null;
let clockRefreshTimer = null;

function startClock(){
  if (clockTickTimer || clockRefreshTimer) return;
  const tick = ()=>{
    const now = new Date();
    const timeEl = document.getElementById("clockTime");
    const dateEl = document.getElementById("clockDate");
    if (timeEl) timeEl.textContent = now.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
    if (dateEl) dateEl.textContent = now.toLocaleDateString([], {weekday:'short', year:'numeric', month:'short', day:'numeric'});
  };
  tick();
  clockTickTimer = setInterval(tick, 1000);
  // Re-render time-sensitive views once a minute so statuses/countdowns stay fresh
  clockRefreshTimer = setInterval(()=>{
    if (activeTab) renderActive();
    processDueReservations().catch(err=>console.error("Reservation check-in processing failed",err));
  }, 60000);
}

function stopClock(){
  if (clockTickTimer) clearInterval(clockTickTimer);
  if (clockRefreshTimer) clearInterval(clockRefreshTimer);
  clockTickTimer = null;
  clockRefreshTimer = null;
}

/* ---------------------------- live data sync ---------------------------- */

function stopDataSubscriptions(){
  [unsubRooms,unsubShapes,unsubProspects,unsubTemporaryClients,unsubHistory].forEach(unsubscribe=>{
    if (unsubscribe) unsubscribe();
  });
  unsubRooms = null;
  unsubShapes = null;
  unsubProspects = null;
  unsubTemporaryClients = null;
  unsubHistory = null;
}

function subscribeData(){
  stopDataSubscriptions();
  const listeningUid = currentUser.uid;
  assistantDataLoaded = {rooms:false,shapes:false,prospects:false,temporaryClients:false};
  unsubRooms = userCollection("rooms").orderBy("room").onSnapshot(snap=>{
    if (!currentUser || currentUser.uid !== listeningUid) return;
    rooms = snap.docs.map(d=>({id:d.id, ...d.data()}));
      assistantDataLoaded.rooms = true;
    renderActive();
    cleanupDuplicateRooms().catch(err=>console.error("Duplicate room cleanup failed",err));
    scheduleVacancySync();
    processDueReservations().catch(err=>console.error("Reservation check-in processing failed",err));
  }, err=>{ if (currentUser && currentUser.uid === listeningUid) console.error(err); });

  unsubShapes = userCollection("shapes").onSnapshot(snap=>{
    if (!currentUser || currentUser.uid !== listeningUid) return;
    shapes = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.shapes = true;
    renderActive();
    scheduleVacancySync();
  }, err=>{ if (currentUser && currentUser.uid === listeningUid) console.error(err); });

  unsubProspects = userCollection("prospects").orderBy("checkIn").onSnapshot(snap=>{
    if (!currentUser || currentUser.uid !== listeningUid) return;
    prospects = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.prospects = true;
    renderActive();
    processDueReservations().catch(err=>console.error("Reservation check-in processing failed",err));
  }, err=>{ if (currentUser && currentUser.uid === listeningUid) console.error(err); });

  unsubTemporaryClients = userCollection("temporary_dorm_clients").orderBy("createdAt", "desc").onSnapshot(snap=>{
    if (!currentUser || currentUser.uid !== listeningUid) return;
    temporaryClients = snap.docs.map(d=>({id:d.id, ...d.data()}));
    assistantDataLoaded.temporaryClients = true;
    renderActive();
  }, err=>{ if (currentUser && currentUser.uid === listeningUid) console.error(err); });

  unsubHistory = userCollection("tenant_history").orderBy("leftAt","desc").limit(300).onSnapshot(snap=>{
    if (!currentUser || currentUser.uid !== listeningUid) return;
    tenantHistory = snap.docs.map(d=>({id:d.id, ...d.data()}));
    renderActive();
    purgeExpiredHistory().catch(err=>console.error("History cleanup failed",err));
  }, err=>{ if (currentUser && currentUser.uid === listeningUid) console.error(err); });

  startViewerAccess();
}

function userCollection(name){
  if (!currentUser || !currentUser.uid) throw new Error("A signed-in user is required to access data.");
  return db.collection("users").doc(currentUser.uid).collection(name);
}

async function importSeedData(){
  if (!Array.isArray(window.SEED_ROOMS)){
    alert("The sample-room import is only available when you run the app from your own computer.");
    return;
  }
  if (rooms.length){
    if (!confirm("You already have " + rooms.length + " rooms saved. Import the sample data anyway (it will add alongside, skipping room numbers that already exist)?")) return;
  }
  const existingNumbers = new Set(rooms.map(r=>r.room));
  const batch = db.batch();
  let added = 0;
  window.SEED_ROOMS.forEach((r, i)=>{
    if (existingNumbers.has(r.room)) return;
    const ref = userCollection("rooms").doc();
    batch.set(ref, {
      room: r.room,
      type: "Room",
      demographic: "Mixed",
      tenancyMode: "Bedspace",
      capacity: r.capacity,
      gender: r.gender,
      x: 20 + (i % 6) * 150,
      y: 20 + Math.floor(i / 6) * 130,
      beds: r.beds.map(b=>({slot:b.slot, tenant:b.tenant, start:b.start, end:b.end, reservedFor:null, residentType:"Student", residentGender:"Unspecified"}))
    });
    added++;
  });
  await batch.commit();
  alert("Imported " + added + " rooms.");
}
