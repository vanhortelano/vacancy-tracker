// js/16-reserve-group.js — Reservations: Single / Group, "Scan for vacancies", reliable delete
let reserveMode = "single";
let reserveChoice = null;   // {roomId, slots:[...]} picked from the scan

function reserveNames(){
  if (reserveMode === "single") return [document.getElementById("pName").value.trim()];
  return Array.from(document.querySelectorAll("#pGroupNames input")).map(i=>i.value.trim());
}
function drawGroupNames(){
  const n = Math.max(2, Math.min(12, parseInt(document.getElementById("pGroupSize").value,10) || 2));
  const host = document.getElementById("pGroupNames");
  const old = Array.from(host.querySelectorAll("input")).map(i=>i.value);
  host.innerHTML = Array.from({length:n},(_,i)=>`<input type="text" placeholder="Member ${i+1} full name" aria-label="Member ${i+1} name" value="${escapeHtml(old[i]||"")}">`).join("");
}
function setReserveMode(mode){
  reserveMode = mode; reserveChoice = null;
  document.querySelectorAll("#pMode button").forEach(b=>b.classList.toggle("on", b.dataset.mode === mode));
  document.getElementById("pGroupWrap").hidden = mode !== "group";
  document.getElementById("pNameField").hidden = mode === "group";
  document.getElementById("prospectScanResults").innerHTML = "";
  if (mode === "group") drawGroupNames();
}
document.addEventListener("click", e=>{
  const m = e.target.closest("#pMode button"); if (m) setReserveMode(m.dataset.mode);
  const o = e.target.closest(".scan-opt[data-room]");
  if (o){
    reserveChoice = {roomId:o.dataset.room, slots:JSON.parse(o.dataset.slots)};
    document.querySelectorAll(".scan-opt").forEach(x=>x.classList.toggle("on", x===o));
  }
});
document.addEventListener("input", e=>{ if (e.target.id === "pGroupSize") drawGroupNames(); });

// Only beds that are FREE at the check-in date and fit the details. Reserved beds/rooms are never offered.
function scanReserveVacancies(){
  const host = document.getElementById("prospectScanResults");
  const gender = document.getElementById("pGender").value;
  const demographic = document.getElementById("pDemographic").value;
  const checkIn = isoLocalDateTime(document.getElementById("pCheckIn").value);
  const checkOut = isoLocalDateTime(document.getElementById("pCheckOut").value);
  const need = reserveMode === "group" ? Math.max(2, parseInt(document.getElementById("pGroupSize").value,10) || 2) : 1;
  reserveChoice = null;
  if (!checkIn){ host.innerHTML = '<p class="empty-note">Enter the target check-in date first.</p>'; return; }
  if (checkOut && parseScheduleDate(checkOut,true) <= parseScheduleDate(checkIn)){ host.innerHTML = '<p class="empty-note">Target check-out must be later than check-in.</p>'; return; }
  const free = reservationCandidates({gender,demographic,checkIn}).filter(o=>!o.bed.tenant || o.gap >= 0);
  const byRoom = new Map();
  free.forEach(o=>{ if (!byRoom.has(o.room.id)) byRoom.set(o.room.id,{room:o.room,beds:[]}); byRoom.get(o.room.id).beds.push(o); });
  const score = r => (r.gender === gender ? 0 : 1) + ((r.demographic||"").startsWith(demographic) ? 0 : 1);
  const rows = Array.from(byRoom.values()).filter(g=>g.beds.length >= need && (g.room.tenancyMode !== "Whole Room" || need === 1 || g.beds.length >= need))
    .map(g=>{ g.beds.sort((a,b)=>a.gap-b.gap); const pick = g.beds.slice(0,need); return {room:g.room,pick,wait:Math.max(0,...pick.map(p=>p.bed.tenant?p.gap:0)),score:score(g.room),free:g.beds.length}; })
    .sort((a,b)=>a.wait-b.wait || a.score-b.score);   // nearest availability first, then best match
  if (!rows.length){ host.innerHTML = `<p class="empty-note">No free ${need>1?"room with "+need+" fitting beds":"bed"} at that check-in date.</p>`; return; }
  host.innerHTML = `<strong>${rows.length} match${rows.length===1?"":"es"} — pick one</strong>` + rows.map(r=>{
    const slots = r.pick.map(p=>p.bed.slot);
    const when = r.wait ? `free in ${r.wait} day${r.wait===1?"":"s"}` : "free now";
    return `<div class="scan-opt" data-room="${escapeHtml(r.room.id)}" data-slots='${escapeHtml(JSON.stringify(slots))}'><div><strong>Room ${escapeHtml(r.room.room)}</strong> · ${escapeHtml(slots.join(", "))}<small>${escapeHtml(r.room.gender||"Mixed")} · ${escapeHtml(r.room.demographic||"Mixed")} · ${when} · ${r.free} free bed${r.free===1?"":"s"}</small></div></div>`;
  }).join("");
}

async function addProspect(){
  const names = reserveNames();
  const gender = document.getElementById("pGender").value;
  const demographic = document.getElementById("pDemographic").value;
  const checkIn = isoLocalDateTime(document.getElementById("pCheckIn").value);
  const checkOut = isoLocalDateTime(document.getElementById("pCheckOut").value);
  const notes = document.getElementById("pNotes").value.trim();
  if (names.some(n=>!n) || !names.length || !checkIn){ alert(reserveMode==="group" ? "Enter every member's name and the target check-in date." : "Please enter a name and target check-in date."); return; }
  if (checkOut && parseScheduleDate(checkOut,true) <= parseScheduleDate(checkIn)){ alert("Target checkout must be later than check-in."); return; }
  const groupId = names.length > 1 ? "g" + Date.now().toString(36) : null;
  try{
    for (let i = 0; i < names.length; i++){
      const ref = await userCollection("prospects").add({name:names[i],gender,demographic,checkIn,checkOut:checkOut||null,notes:notes||null,reservedBed:null,desiredBed:null,groupId,groupSize:names.length});
      if (reserveChoice && reserveChoice.slots[i]) await confirmReservation(ref.id, reserveChoice.roomId, reserveChoice.slots[i]);
    }
  }catch(error){
    console.error("Prospect creation failed",error);
    alert("Could not add reserve client: " + error.message);
    return;
  }
  ["pName","pCheckIn","pCheckOut","pNotes"].forEach(id=>document.getElementById(id).value = "");
  document.getElementById("prospectScanResults").innerHTML = "";
  reserveChoice = null;
  if (reserveMode === "group") drawGroupNames();
}

// Simple delete: frees any bed lock, then removes the reservation. No check-out date rules involved.
async function deleteProspect(id){
  const p = prospects.find(item=>item.id===id);
  if (!p) return;
  if (!confirm("Delete the reservation for " + p.name + "?")) return;
  try{
    for (const r of rooms){
      if (r.beds.some(b=>b.reservedFor === id)){
        await userCollection("rooms").doc(r.id).update({beds:r.beds.map(b=>b.reservedFor === id ? {...b,reservedFor:null} : b)});
      }
    }
    await userCollection("prospects").doc(id).delete();
  }catch(error){
    console.error("Reserve client deletion failed",error);
    alert("Could not delete the reservation: " + error.message);
  }
}
