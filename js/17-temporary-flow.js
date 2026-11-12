// js/17-temporary-flow.js — Temporary clients: Single/Group, gender-only room scan, transfer step, red reminder
let tempMode = "single", tempPicks = [], transferPick = null, tempFree = null;
const $t = id => document.getElementById(id);
const padN = n => String(n).padStart(2,"0");
const nowLocalIso = () => { const d = new Date(); return isoLocalDateTime(`${d.getFullYear()}-${padN(d.getMonth()+1)}-${padN(d.getDate())}T${padN(d.getHours())}:${padN(d.getMinutes())}`); };

function tempNames(){ return tempMode === "single" ? [$t("tName").value.trim()] : Array.from(document.querySelectorAll("#tGroupNames input")).map(i=>i.value.trim()); }
function tempNeed(){ return tempMode === "group" ? Math.max(2, parseInt($t("tGroupSize").value,10) || 2) : 1; }
function drawTempNames(){
  const n = tempNeed(), host = $t("tGroupNames"), old = Array.from(host.querySelectorAll("input")).map(i=>i.value);
  host.innerHTML = Array.from({length:n},(_,i)=>`<input type="text" placeholder="Member ${i+1} full name" aria-label="Member ${i+1} name" value="${escapeHtml(old[i]||"")}">`).join("");
}
function resetTempSteps(){
  tempPicks = []; transferPick = null; tempFree = null;
  ["tScan","tTransferScan"].forEach(id=>$t(id).innerHTML = "");
  $t("tStep2").hidden = true; $t("tStep3").hidden = true; $t("addTemporaryBtn").hidden = true;
}
function setTempMode(mode){
  tempMode = mode; resetTempSteps();
  document.querySelectorAll("#tMode button").forEach(b=>b.classList.toggle("on", b.dataset.mode === mode));
  $t("tGroupWrap").hidden = mode !== "group"; $t("tNameField").hidden = mode === "group";
  if (mode === "group") drawTempNames();
}

// Gender is the ONLY rule. Room type, bedspacer/whole-room and student/reviewee are ignored.
function scanTemporaryRooms(){
  const gender = $t("tGender").value, start = isoLocalDateTime($t("tStart").value), need = tempNeed(), host = $t("tScan");
  resetTempSteps();
  if (!start){ host.innerHTML = '<p class="empty-note">Enter the check-in date first.</p>'; return; }
  const rows = [];
  rooms.forEach(room=>{
    if (!genderMatches(room.gender, gender)) return;
    const free = room.beds.filter(b=>!b.tenant && !b.reservedFor && !b.temporaryClientId).map(b=>b.slot);
    if (free.length) rows.push({room, free, score:(room.gender === gender ? 0 : 1)});
  });
  rows.sort((a,b)=>a.score-b.score || b.free.length-a.free.length);
  if (!rows.length){ host.innerHTML = '<p class="empty-note">No room with a free bed accepts this gender. (Beds still occupied at the check-in time are not offered.)</p>'; return; }
  host.innerHTML = `<strong>${rows.length} room${rows.length===1?"":"s"} with vacancy</strong>` + (need > 1 ? `<p class="det">Group of ${need}: choose how many go in each room (total ${need}). <span id="tTotal">0</span>/${need}</p>` : "") +
    rows.map(r=> need > 1
      ? `<div class="scan-opt"><div><strong>Room ${escapeHtml(r.room.room)}</strong><small>${escapeHtml(r.room.gender||"Mixed")} · ${r.free.length} free bed${r.free.length===1?"":"s"}</small></div><span class="spacer"></span><input type="number" min="0" max="${r.free.length}" value="0" style="width:64px" data-troom="${escapeHtml(r.room.id)}" data-tslots='${escapeHtml(JSON.stringify(r.free))}' aria-label="Beds in room ${escapeHtml(r.room.room)}"></div>`
      : `<div class="scan-opt" data-troom="${escapeHtml(r.room.id)}" data-tslots='${escapeHtml(JSON.stringify(r.free))}'><div><strong>Room ${escapeHtml(r.room.room)}</strong><small>${escapeHtml(r.room.gender||"Mixed")} · ${r.free.length} free bed${r.free.length===1?"":"s"}</small></div></div>`).join("");
}
function collectTempPicks(){
  const need = tempNeed(); let picks = [];
  if (need === 1){ const on = document.querySelector("#tScan .scan-opt.on"); if (on) picks = [{roomId:on.dataset.troom, slot:JSON.parse(on.dataset.tslots)[0]}]; }
  else document.querySelectorAll("#tScan input[data-troom]").forEach(i=>{ const q = Math.max(0, Math.min(+i.max, parseInt(i.value,10)||0)); JSON.parse(i.dataset.tslots).slice(0,q).forEach(slot=>picks.push({roomId:i.dataset.troom, slot})); });
  tempPicks = picks;
  const t = $t("tTotal"); if (t) t.textContent = picks.length;
  const ready = picks.length === need;
  $t("tStep2").hidden = !ready; if (!ready){ $t("tStep3").hidden = true; $t("addTemporaryBtn").hidden = true; }
}

// Where will they move? Like the reservation scan, but the check-in date is ignored: occupied beds are shown with their free-up date.
function scanTransferRooms(){
  const gender = $t("tGender").value, demographic = $t("tDemo").value, need = tempNeed(), host = $t("tTransferScan");
  transferPick = null; $t("tStep3").hidden = true; $t("addTemporaryBtn").hidden = true;
  const now = nowLocalIso();
  const cands = reservationCandidates({gender:gender === "Mixed" ? "Any" : gender, demographic, checkIn:now});
  const byRoom = new Map();
  cands.forEach(o=>{ if (!byRoom.has(o.room.id)) byRoom.set(o.room.id,{room:o.room,beds:[]}); byRoom.get(o.room.id).beds.push(o); });
  const rows = Array.from(byRoom.values()).filter(g=>g.beds.length >= need).map(g=>{
    const pick = g.beds.slice().sort((a,b)=>Math.max(0,-a.gap)-Math.max(0,-b.gap)).slice(0,need);
    const wait = Math.max(0,...pick.map(p=>p.bed.tenant ? Math.max(0,-p.gap) : 0));
    return {room:g.room, pick, wait, score:(g.room.gender === gender ? 0 : 1) + ((g.room.demographic||"").startsWith(demographic) ? 0 : 1)};
  }).sort((a,b)=>a.wait-b.wait || a.score-b.score);
  if (!rows.length){ host.innerHTML = `<p class="empty-note">No permanent room has ${need>1?need+" beds":"a bed"} that will be free for this client.</p>`; return; }
  host.innerHTML = `<strong>${rows.length} permanent room${rows.length===1?"":"s"} — pick one</strong>` + rows.map(r=>{
    const slots = r.pick.map(p=>p.bed.slot);
    return `<div class="scan-opt" data-xroom="${escapeHtml(r.room.id)}" data-xslots='${escapeHtml(JSON.stringify(slots))}' data-xwait="${r.wait}" data-xfree='${escapeHtml(JSON.stringify(r.pick.map(p=>p.bed.tenant?p.bed.end:now)))}'><div><strong>Room ${escapeHtml(r.room.room)}</strong> · ${escapeHtml(slots.join(", "))}<small>${escapeHtml(r.room.gender||"Mixed")} · ${escapeHtml(r.room.demographic||"Mixed")} · ${r.wait ? "free in "+r.wait+" day"+(r.wait===1?"":"s") : "free now"}</small></div></div>`;
  }).join("");
}

document.addEventListener("click", e=>{
  const m = e.target.closest("#tMode button"); if (m) return setTempMode(m.dataset.mode);
  if (e.target.closest("#tScanBtn")) return scanTemporaryRooms();
  if (e.target.closest("#tTransferBtn")) return scanTransferRooms();
  const o = e.target.closest("#tScan .scan-opt[data-troom]");
  if (o && tempMode === "single"){ document.querySelectorAll("#tScan .scan-opt").forEach(x=>x.classList.toggle("on", x===o)); collectTempPicks(); return; }
  const x = e.target.closest("#tTransferScan .scan-opt[data-xroom]");
  if (x){
    document.querySelectorAll("#tTransferScan .scan-opt").forEach(y=>y.classList.toggle("on", y===x));
    const frees = JSON.parse(x.dataset.xfree).map(v=>parseScheduleDate(v,true)).filter(Boolean);
    const latest = new Date(Math.max(...frees.map(d=>d.getTime())));
    const iso = isoLocalDateTime(`${latest.getFullYear()}-${padN(latest.getMonth()+1)}-${padN(latest.getDate())}T${padN(latest.getHours())}:${padN(latest.getMinutes())}`);
    transferPick = {roomId:x.dataset.xroom, slots:JSON.parse(x.dataset.xslots)}; tempFree = iso;
    $t("tFreeDate").textContent = fmtDate(iso) + " — this becomes the temporary check-out date.";
    $t("tStep3").hidden = false; $t("addTemporaryBtn").hidden = false;
  }
});
document.addEventListener("input", e=>{
  if (e.target.id === "tGroupSize") { drawTempNames(); resetTempSteps(); }
  if (e.target.matches("#tScan input[data-troom]")) collectTempPicks();
});

async function addTemporaryClient(){
  const names = tempNames(), gender = $t("tGender").value, start = isoLocalDateTime($t("tStart").value);
  const afterOut = isoLocalDateTime($t("tAfterOut").value), notes = $t("tNotes").value.trim(), demographic = $t("tDemo").value;
  if (names.some(n=>!n) || !start || tempPicks.length !== names.length || !transferPick){ alert("Enter every name and the check-in, choose the temporary room(s), then the permanent room to move to."); return; }
  if (afterOut && parseScheduleDate(afterOut,true) <= parseScheduleDate(tempFree,true)){ alert("The check-out after the transfer must be later than the transfer date."); return; }
  try{
    for (let i = 0; i < names.length; i++){
      const pick = tempPicks[i], name = names[i];
      const roomRef = userCollection("rooms").doc(pick.roomId), clientRef = userCollection("temporary_dorm_clients").doc();
      await db.runTransaction(async tx=>{
        const snap = await tx.get(roomRef); if (!snap.exists) throw new Error("The selected room no longer exists.");
        const room = {id:snap.id, ...snap.data()}, idx = room.beds.findIndex(b=>b.slot === pick.slot), bed = room.beds[idx];
        if (!bed || bed.tenant || bed.reservedFor || bed.temporaryClientId) throw new Error("A selected bed is no longer free.");
        const beds = room.beds.slice();
        beds[idx] = {...bed, tenant:name, start, end:tempFree, reservedFor:null, residentType:"Temporary", residentGender:gender, temporaryClientId:clientRef.id};
        tx.update(roomRef, {beds});
        tx.set(clientRef, {name, gender, start, end:tempFree, afterCheckOut:afterOut||null, notes:notes||null, roomId:pick.roomId, room:room.room, slot:bed.slot,
          transferTo:{roomId:transferPick.roomId, slot:transferPick.slots[i]}, status:"Active", createdAt:sqlServerTimestamp()});
      });
      // lock the permanent bed with a reservation that starts when it becomes free
      const ref = await userCollection("prospects").add({name, gender:gender==="Mixed"?"Any":gender, demographic, checkIn:tempFree, checkOut:afterOut||null, notes:"Transfer from temporary room", reservedBed:null, desiredBed:null, temporaryClientId:clientRef.id});
      await confirmReservation(ref.id, transferPick.roomId, transferPick.slots[i]);
    }
    ["tName","tStart","tAfterOut","tNotes"].forEach(id=>$t(id).value = "");
    if (tempMode === "group") drawTempNames();
    resetTempSteps();
  }catch(error){
    console.error("Temporary client assignment failed", error);
    alert("Could not assign temporary client: " + error.message);
  }
}

/* ---- Reminder: a reached temporary check-out turns the tab transparent red and asks for confirmation ---- */
const tempDue = () => (typeof temporaryClients === "undefined" ? [] : temporaryClients).filter(c=>c.status !== "Checked out" && c.end && parseScheduleDate(c.end,true) && parseScheduleDate(c.end,true).getTime() <= Date.now() && (!c.remindAfter || c.remindAfter <= Date.now()));
function refreshTempDue(){
  const due = tempDue(), n = due.length;
  // red count on the Temporary Dorm Clients tab, the Reminders sub-tab, and the menu button (like an unread-mail badge)
  const tab = document.querySelector('nav.tabs [data-tab="temporary"]');
  if (tab){ tab.classList.toggle("temp-due", n > 0); let pill = tab.querySelector(".cnt-pill"); if (n && !pill){ pill = document.createElement("span"); pill.className = "cnt-pill"; pill.style.marginLeft = "8px"; tab.appendChild(pill); } if (pill){ pill.textContent = n; pill.hidden = !n; } }
  const rt = $t("tempRemTab"), rc = $t("tempRemCount"); if (rt) rt.classList.toggle("temp-due", n > 0); if (rc){ rc.textContent = n; rc.hidden = !n; }
  document.querySelectorAll("#app .menu-btn[data-menu-toggle]").forEach(b=>{ b.dataset.count = n ? (n > 9 ? "9+" : n) : ""; });
  const box = $t("tempRemBox"); if (!box) return;
  box.innerHTML = n ? due.map(c=>`<div class="temp-due-card"><div><strong>${escapeHtml(c.name)}</strong> — temporary check-out reached (${fmtDate(c.end)})<br><span>Has the tenant already transferred?</span></div><div class="temp-due-actions"><button class="btn btn-primary btn-sm" type="button" onclick="tempTransferred('${c.id}')">Yes, transferred</button><button class="btn btn-outline btn-sm" type="button" onclick="tempNotYet('${c.id}')">Not yet</button></div></div>`).join("") : '<p class="empty-note">No reminders. Temporary clients show up here when their check-out is reached.</p>';
}
document.addEventListener("click", e=>{
  const t = e.target.closest("[data-tsub]"); if (!t) return;
  document.querySelectorAll("[data-tsub]").forEach(x=>x.classList.toggle("active", x === t));
  $t("temporaryList").hidden = t.dataset.tsub !== "clients"; $t("tempRemBox").hidden = t.dataset.tsub !== "rem";
});
async function tempTransferred(id){ await checkoutTemporaryClient(id); refreshTempDue(); }
async function tempNotYet(id){ await userCollection("temporary_dorm_clients").doc(id).update({remindAfter:Date.now()+24*3600*1000}).catch(e=>alert(e.message)); }
setInterval(refreshTempDue, 15000); document.addEventListener("click", ()=>setTimeout(refreshTempDue, 50));
