// js/06-rooms.js — Add / edit / delete rooms
/* ============================= ROOM MODAL (add/edit) ============================= */

function openRoomModal(roomId){
  clearRoomError();
  editingRoomId = roomId || null;
  const room = roomId ? rooms.find(r=>r.id===roomId) : null;
  editingRoomBaseline = room ? {...room,beds:room.beds.map(bed=>({...bed}))} : null;

  document.getElementById("roomModalTitle").textContent = room ? "Edit room " + room.room : "Add room";
  document.getElementById("rmRoomNumber").value = room ? room.room : "";
  document.getElementById("rmType").value = room ? (room.type||"Room") : "Room";
  document.getElementById("rmGender").value = room ? (room.gender || "Mixed") : "Mixed";
  document.getElementById("rmAc").value = String(Boolean(room && room.ac));
  document.getElementById("rmDemographic").value = room ? (room.demographic || "Mixed") : "Mixed";
  document.getElementById("rmTenancyMode").value = room ? (room.tenancyMode || (room.type === "Room" ? "Bedspace" : "Bedspace")) : "Bedspace";
  document.getElementById("rmCapacity").value = room ? room.beds.length : 4;

  renderCapacityChips(room ? room.beds.length : 4);
  renderBedsEditor(room ? room.beds.map(b=>({
    ...b,
    residentType:b.residentType || (room.demographic === "Reviewees" ? "Reviewee" : "Student"),
    residentGender:b.residentGender || "Unspecified"
  })) : makeEmptyBeds(4));

  document.getElementById("roomModalBackdrop").classList.add("open");
}

function closeRoomModal(){
  document.getElementById("roomModalBackdrop").classList.remove("open");
  editingRoomId = null;
  editingRoomBaseline = null;
}

function roomEditBaselineMatches(current,baseline){
  if (!baseline || ["room","type","gender","demographic","tenancyMode","capacity","ac"].some(key=>(current[key]||null)!==(baseline[key]||null))) return false;
  if (!Array.isArray(current.beds) || current.beds.length!==baseline.beds.length) return false;
  const bedFields=["slot","tenant","start","end","reservedFor","residentType","residentGender","temporaryClientId"];
  return current.beds.every((bed,index)=>bedFields.every(key=>(bed[key]||null)===(baseline.beds[index][key]||null)));
}

function makeEmptyBeds(n){
  return Array.from({length:n}, (_,i)=>({slot:"Bed "+(i+1), tenant:null, start:null, end:null, reservedFor:null, residentType:"Student",residentGender:"Unspecified"}));
}

function renderCapacityChips(current){
  const wrap = document.getElementById("capacityChips");
  wrap.innerHTML = CAP_PRESETS.map(n=>`<button type="button" class="${n===current?'active':''}" onclick="setCapacity(${n})">${n}</button>`).join("")
    + `<button type="button" class="${!CAP_PRESETS.includes(current)?'active':''}" onclick="promptCustomCapacity()">Custom</button>`;
}

function promptCustomCapacity(){
  const n = parseInt(prompt("How many beds/capacity for this room?", "6"), 10);
  if (n && n > 0 && n <= 20) setCapacity(n);
}

function setCapacity(n){
  document.getElementById("rmCapacity").value = n;
  renderCapacityChips(n);
  const currentBeds = collectBedsFromEditor();
  const newBeds = Array.from({length:n}, (_,i)=> currentBeds[i] || {slot:"Bed "+(i+1), tenant:null, start:null, end:null, reservedFor:null, residentType:"Student",residentGender:"Unspecified"});
  renderBedsEditor(newBeds);
}

function renderBedsEditor(beds){
  const wrap = document.getElementById("bedsEditor");
  wrap.innerHTML = beds.map((b,i)=>`
    <div class="bed-edit-row" data-idx="${i}">
      <div class="field"><label for="beTenant${i}">${b.slot || 'Bed '+(i+1)} — Tenant name</label>
        <input type="text" id="beTenant${i}" class="be-tenant" value="${escapeHtml(b.tenant||'')}" placeholder="Leave blank if vacant"></div>
      <div class="field-row">
        <div class="field"><label for="beDemographic${i}">Resident group</label>
          <select id="beDemographic${i}" class="be-demographic"><option value="Student" ${(b.residentType||"Student")==="Student"?"selected":""}>Student</option><option value="Reviewee" ${b.residentType==="Reviewee"?"selected":""}>Reviewee</option><option value="Temporary" ${b.residentType==="Temporary"?"selected":""}>Temporary</option></select>
        </div>
        <div class="field"><label for="beGender${i}">Resident gender</label>
          <select id="beGender${i}" class="be-gender"><option value="Unspecified" ${!b.residentGender||b.residentGender==="Unspecified"?"selected":""}>Unspecified</option><option value="Male" ${b.residentGender==="Male"?"selected":""}>Male</option><option value="Female" ${b.residentGender==="Female"?"selected":""}>Female</option></select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label for="beStart${i}">Check-in</label><input type="datetime-local" id="beStart${i}" class="be-start" value="${toDateTimeInput(b.start)}"></div>
        <div class="field"><label for="beEnd${i}">Checkout</label><input type="datetime-local" id="beEnd${i}" class="be-end" value="${toDateTimeInput(b.end,true)}"></div>
      </div>
    </div>`).join("");
}

function collectBedsFromEditor(){
  return Array.from(document.querySelectorAll("#bedsEditor .bed-edit-row")).map((row,i)=>{
    const tenant = row.querySelector(".be-tenant").value.trim();
    return {
      slot: "Bed " + (i+1),
      tenant: tenant || null,
      residentType: row.querySelector(".be-demographic").value,
      residentGender:row.querySelector(".be-gender").value,
      start: tenant ? isoLocalDateTime(row.querySelector(".be-start").value) : null,
      end: tenant ? isoLocalDateTime(row.querySelector(".be-end").value) : null,
      reservedFor: null
    };
  });
}

async function saveRoom(){
  const roomNumber = document.getElementById("rmRoomNumber").value.trim();
    if (!roomNumber){ showRoomError("Please enter a room number/name."); return; }
  const duplicateRoom = findDuplicateRoom(roomNumber, editingRoomId);
  if (duplicateRoom){
    showRoomError("Room \"" + duplicateRoom.room + "\" already exists. Choose a different room name or number.");
    return;
  }
  const type = document.getElementById("rmType").value;
  const gender = document.getElementById("rmGender").value;
  const ac = document.getElementById("rmAc").value === "true";
  const demographic = document.getElementById("rmDemographic").value;
  const tenancyMode = document.getElementById("rmTenancyMode").value;
  const existingRoom = editingRoomId ? rooms.find(r=>r.id===editingRoomId) : null;
  const oldBeds = editingRoomBaseline ? editingRoomBaseline.beds : [];
  const beds = collectBedsFromEditor().map((b,i)=>({
    ...b,
    reservedFor:oldBeds[i]?oldBeds[i].reservedFor||null:null,
    temporaryClientId:oldBeds[i]&&oldBeds[i].tenant===b.tenant?oldBeds[i].temporaryClientId||null:null
  }));

  if (oldBeds.slice(beds.length).some(b=>b.tenant || b.reservedFor || b.temporaryClientId)){
    alert("Capacity cannot be reduced while removed beds have residents, reservations, or temporary-client records.");
    return;
  }
  for (let i=0;i<oldBeds.length;i++){
    const previous=oldBeds[i], next=beds[i];
    if (previous.reservedFor && (!next || next.tenant!==previous.tenant ||
        !sameEditorDateTime(next.start,previous.start) || !sameEditorDateTime(next.end,previous.end,true))){
      alert("A bed with a confirmed reservation cannot be changed. Undo its reservation first.");
      return;
    }
    if (previous.temporaryClientId && (!next || next.tenant!==previous.tenant ||
        next.residentType!=="Temporary" || next.residentGender!==previous.residentGender ||
        !sameEditorDateTime(next.start,previous.start) || !sameEditorDateTime(next.end,previous.end,true))){
      alert("A temporary client's assigned bed must be checked out before its resident details are changed.");
      return;
    }
  }
  if (demographic !== "Mixed" && beds.some(b=>b.tenant && b.residentType !== "Temporary" &&
      b.residentType !== demographic.slice(0,-1))){
    alert("This room's resident group conflicts with one or more assigned beds.");
    return;
  }
  if (gender !== "Mixed" && beds.some((b,index)=>{
    if (!b.tenant) return false;
    const previous=oldBeds[index];
    let assignedGender=b.residentGender;
    if (!assignedGender || assignedGender==="Unspecified"){
      assignedGender=previous && previous.tenant===b.tenant
        ? (previous.residentGender && previous.residentGender!=="Unspecified" ? previous.residentGender : (existingRoom.gender || "Mixed"))
        : gender;
    }
    return assignedGender==="Mixed" ? Boolean(previous && previous.tenant===b.tenant) : assignedGender!==gender;
  })){
    alert("This room's gender assignment conflicts with one or more assigned beds. Set unspecified resident genders before assigning a single-gender room.");
    return;
  }
  if (beds.some(b=>{
    if (!b.reservedFor) return false;
    const prospect=prospects.find(p=>p.id===b.reservedFor);
    return prospect && (!genderMatches(gender,prospect.gender) || !roomAllowsResident({demographic},prospect.demographic||"Student"));
  })){
    alert("This room's zoning conflicts with a confirmed reservation.");
    return;
  }
  if (tenancyMode === "Whole Room" &&
      (beds.filter(b=>b.tenant).length > 1 || new Set(beds.map(b=>b.reservedFor).filter(Boolean)).size > 1)){
    alert("Whole Room mode allows only one assigned resident and one reservation.");
    return;
  }
  if (beds.some(b=>{
    const start = parseScheduleDate(b.start);
    const end = parseScheduleDate(b.end,true);
    return start && end && end <= start;
  })){
    alert("Each checkout must be later than its check-in.");
    return;
  }
  const payload = { room: roomNumber, type, gender, ac, demographic, tenancyMode, capacity: beds.length, beds };
  const departed = [];
  if (editingRoomId && editingRoomBaseline){
    oldBeds.forEach((previous,i)=>{
      const next = beds[i];
      if (previous.tenant && !previous.temporaryClientId && (!next || next.tenant!==previous.tenant)){
        departed.push(makeHistoryEntry({id:editingRoomId,room:editingRoomBaseline.room||roomNumber},previous,
          next && next.tenant ? "Replaced by " + next.tenant : "Removed from bed"));
      }
    });
  }

  try{
    if (editingRoomId){
      const roomRef=userCollection("rooms").doc(editingRoomId);
      const temporaryIds=[...new Set(beds.map(b=>b.temporaryClientId).filter(Boolean))];
      await db.runTransaction(async transaction=>{
        const roomSnap=await transaction.get(roomRef);
        if (!roomSnap.exists) throw new Error("The room no longer exists.");
        const current=roomSnap.data();
        if (!roomEditBaselineMatches(current,editingRoomBaseline)){
          throw new Error("This room changed while the editor was open. Close and reopen it before saving.");
        }
        const clientRefs=roomNumber!==(editingRoomBaseline.room||"")
          ? temporaryIds.map(id=>userCollection("temporary_dorm_clients").doc(id))
          : [];
        const clientSnaps=await Promise.all(clientRefs.map(ref=>transaction.get(ref)));
        if (clientSnaps.some(snap=>!snap.exists)) throw new Error("A linked temporary-client record no longer exists.");
        transaction.update(roomRef,payload);
        departed.forEach(entry=>transaction.set(userCollection("tenant_history").doc(),entry));
        clientRefs.forEach(ref=>transaction.update(ref,{room:roomNumber}));
      });
    } else {
      const idx = rooms.length;
      payload.x = 20 + (idx % 6) * 150;
      payload.y = 20 + Math.floor(idx / 6) * 130;
      await userCollection("rooms").add(payload);
    }
  }catch(error){
    console.error("Room save failed",error);
    alert("Could not save the room: " + error.message);
    return;
  }
  closeRoomModal();
}

async function deleteRoom(id){
  const r = rooms.find(x=>x.id===id);
  if (!r) return;
  if (r.beds.some(b=>b.tenant || b.reservedFor || b.temporaryClientId)){
    alert("Transfer or check out all residents and cancel reservations before deleting this room.");
    return;
  }
  if (!confirm("Delete room " + (r?r.room:"") + " and all its bed records? This cannot be undone.")) return;
  try{
    const roomRef=userCollection("rooms").doc(id);
    await db.runTransaction(async transaction=>{
      const roomSnap=await transaction.get(roomRef);
      if (!roomSnap.exists) return;
      const latest=roomSnap.data();
      if (latest.beds.some(b=>b.tenant || b.reservedFor || b.temporaryClientId)){
        throw new Error("The room now has residents or reservations; refresh and try again after clearing them.");
      }
      transaction.delete(roomRef);
    });
  }catch(error){
    console.error("Room deletion failed",error);
    alert("Could not delete the room: " + error.message);
  }
}

/* Remove a vacant bed: lowers the room's capacity (bedspacer count). Occupied, reserved or temporary beds can't be removed. */
async function removeBed(roomId, slot){
  const room = rooms.find(r=>r.id===roomId);
  if (!room) return;
  if (room.beds.length <= 1){ alert("A room needs at least one bed. Delete the room instead."); return; }
  if (!confirm("Remove " + slot + " from Room " + room.room + "?\n\nThe room's capacity goes from " + room.beds.length + " to " + (room.beds.length-1) + ".")) return;
  const ref = userCollection("rooms").doc(roomId);
  try{
    await db.runTransaction(async tx=>{
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("The room no longer exists.");
      const data = snap.data();
      const bed = data.beds.find(b=>b.slot===slot);
      if (!bed) throw new Error("That bed no longer exists.");
      if (bed.tenant || bed.reservedFor || bed.temporaryClientId) throw new Error("Only vacant beds can be removed.");
      const beds = data.beds.filter(b=>b.slot!==slot);
      tx.update(ref,{beds, capacity:beds.length});
    });
  }catch(error){
    console.error("Remove bed failed",error);
    alert("Could not remove the bed: " + error.message);
  }
}
