// js/11-reservations.js — Reserve Clients tab: choosing beds, confirming, auto check-in
/* ============================= RENDER: RESERVE / PROSPECTS ============================= */

// Every bed the admin could reserve for this client. The admin chooses; the app only lists and labels them.
function reservationCandidates(p){
  if (p.reservedBed || p.checkedIn) return [];
  const list = [];
  rooms.forEach(r=>r.beds.forEach((b,i)=>{
    if (b.reservedFor || b.temporaryClientId) return;
    if (!roomAllowsResident(r,p.demographic||"Student") || !genderMatches(r.gender,p.gender)) return;
    if (r.tenancyMode==="Whole Room" && r.beds.some((other,j)=>j!==i && (other.tenant||other.reservedFor))) return;
    if (!b.tenant && !bedCanHost(r,b,p.demographic||"Student",p.gender)) return;
    if (b.tenant && !b.end) return;
    const gap = b.tenant?checkoutGapDays(b,p.checkIn):0;
    list.push({room:r,bed:b,index:i,gap:gap===null?-9999:gap});
  }));
  // Beds that free up before arrival first (closest first), then beds that free up later.
  list.sort((x,y)=>{
    const xOk = x.gap>=0, yOk = y.gap>=0;
    if (xOk!==yOk) return xOk ? -1 : 1;
    return xOk ? x.gap-y.gap : y.gap-x.gap;
  });
  return list;
}

async function confirmChosenBed(prospectId){
  const p = prospects.find(item=>item.id===prospectId);
  const select = document.getElementById("pick-"+prospectId);
  if (!p || !select) return;
  if (!select.value){ alert("Choose a bed from the list first."); return; }
  const [roomId,slot] = JSON.parse(select.value);
  const room = rooms.find(r=>r.id===roomId);
  const bed = room && room.beds.find(item=>item.slot===slot);
  if (!room || !bed) return;
  const gap = checkoutGapDays(bed,p.checkIn);
  if (gap !== null && gap < 0){
    const days = -gap;
    if (!confirm(bed.tenant + " is scheduled to stay " + days + " day" + (days===1?"":"s") + " after " + p.name + " arrives.\n\n" +
      p.name + " will only be moved in after " + bed.tenant + "'s checkout passes. Reserve this bed anyway?")) return;
  }
  await confirmReservation(prospectId,roomId,slot);
}

function renderReserve(){
  refreshBedTargetSelectors();
  const list = document.getElementById("prospectList");
  const visibleProspects=filteredProspects();
  if (!visibleProspects.length){
    list.innerHTML = prospects.length
      ? `<div class="empty-note">No reserve clients match the shared filters.</div>`
      : `<div class="empty-note">No reserve clients yet. Add one on the left.</div>`;
    return;
  }
  list.innerHTML = visibleProspects.map(p=>{
    let matchHtml;
    if (p.checkedOut && p.reservedBed){
      const r=rooms.find(room=>room.id===p.reservedBed.roomId);
      matchHtml=`<div class="match-box"><div class="mtxt">Checked out · Last bed: Room ${escapeHtml(r?r.room:"?")}, ${escapeHtml(p.reservedBed.slot)}</div></div>`;
    } else if (p.checkedIn && p.reservedBed){
      const r=rooms.find(room=>room.id===p.reservedBed.roomId);
      matchHtml=`<div class="match-box"><div class="mtxt">Checked in → Room ${escapeHtml(r?r.room:"?")}, ${escapeHtml(p.reservedBed.slot)}</div></div>`;
    } else if (p.reservedBed){
      const r = rooms.find(rm=>rm.id===p.reservedBed.roomId);
      matchHtml = `<div class="match-box">
        <div class="mtxt">Confirmed → Room ${escapeHtml(r?r.room:'?')}, ${escapeHtml(p.reservedBed.slot)}</div>
        <button class="btn btn-outline btn-sm" onclick="cancelReservation('${p.id}')">Undo</button>
      </div>`;
    } else {
      const options = reservationCandidates(p);
      if (options.length){
        const wanted = p.desiredBed ? JSON.stringify([p.desiredBed.roomId,p.desiredBed.slot]) : null;
        matchHtml = `<div class="match-box choose">
          <div class="mtxt"><label for="pick-${p.id}">You decide — choose which bed to reserve:</label>
            <select id="pick-${p.id}" class="reserve-pick">
              <option value="">— choose a bed —</option>
              ${options.map(o=>{
                const value = JSON.stringify([o.room.id,o.bed.slot]);
                const note = bedTimingNote(o.bed,p.checkIn);
                const availability=o.bed.tenant
                  ? `${escapeHtml(o.bed.tenant)} leaves ${fmtDate(o.bed.end)}${note?" — "+escapeHtml(note):""}`
                  : "Vacant now";
                return `<option value="${escapeHtml(value)}"${value===wanted?" selected":""}>Room ${escapeHtml(o.room.room)} · ${escapeHtml(o.bed.slot)} · ${availability}</option>`;
              }).join("")}
            </select></div>
          <button class="btn btn-primary btn-sm" type="button" onclick="confirmChosenBed('${p.id}')">Reserve this bed</button>
        </div>`;
      } else {
        matchHtml = `<div class="match-box none"><div class="mtxt">No compatible vacant bed or scheduled checkout is available in a room that accepts this client's gender and resident group.</div></div>`;
      }
    }
    return `<div class="prospect-card">
      <div class="top">
        <div><div class="pname">${escapeHtml(p.name)}</div><div class="pmeta">${escapeHtml(p.gender)} · ${escapeHtml(p.demographic||"Student")} · wants in ${fmtDate(p.checkIn)}${p.checkOut?(' → out '+fmtDate(p.checkOut)):''}</div></div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="status-tag ${p.checkedIn||p.reservedBed?'matched':'searching'}">${p.checkedOut?'Checked out':p.checkedIn?'Checked in':p.reservedBed?'Reserved':'Searching'}</span>
          <button class="icon-btn" title="Delete" onclick="deleteProspect('${p.id}')">🗑</button>
        </div>
      </div>
      ${p.notes ? `<div class="pmeta" style="margin-top:6px;">${escapeHtml(p.notes)}</div>` : ''}
      ${matchHtml}
    </div>`;
  }).join("");
}

async function addProspect(){
  const name = document.getElementById("pName").value.trim();
  const gender = document.getElementById("pGender").value;
  const demographic=document.getElementById("pDemographic").value;
  const checkIn = isoLocalDateTime(document.getElementById("pCheckIn").value);
  const checkOut = isoLocalDateTime(document.getElementById("pCheckOut").value);
  const notes = document.getElementById("pNotes").value.trim();
  if (!name || !checkIn){ alert("Please enter a name and target check-in date."); return; }
  if (checkOut && parseScheduleDate(checkOut,true)<=parseScheduleDate(checkIn)){
    alert("Target checkout must be later than check-in.");
    return;
  }
  let desiredBed=null;
  if (document.getElementById("pDesiredBed").value){
    const [roomId,index]=JSON.parse(document.getElementById("pDesiredBed").value);
    const room=rooms.find(item=>item.id===roomId);
    desiredBed={roomId,index,slot:room&&room.beds[index]?room.beds[index].slot:null};
  }
  try{
    const reference=await userCollection("prospects").add({name,gender,demographic,checkIn,checkOut:checkOut||null,notes:notes||null,reservedBed:null,desiredBed});
    if (desiredBed) await confirmReservation(reference.id,desiredBed.roomId,desiredBed.slot);
  }catch(error){
    console.error("Prospect creation failed",error);
    alert("Could not add reserve client: " + error.message);
    return;
  }
  document.getElementById("pName").value = "";
  document.getElementById("pCheckIn").value = "";
  document.getElementById("pCheckOut").value = "";
  document.getElementById("pNotes").value = "";
  document.getElementById("pDesiredBed").value="";
}

async function deleteProspect(id){
  const p=prospects.find(item=>item.id===id);
  if (p && p.checkedIn){
    alert("A checked-in prospect cannot be deleted. Update or check out the resident from the room instead.");
    return;
  }
  const prospectRef=userCollection("prospects").doc(id);
  try{
    await db.runTransaction(async transaction=>{
      const prospectSnap=await transaction.get(prospectRef);
      if (!prospectSnap.exists) return;
      const current=prospectSnap.data();
      if (current.checkedIn) throw new Error("A checked-in prospect cannot be deleted.");
      if (current.reservedBed){
        const roomRef=userCollection("rooms").doc(current.reservedBed.roomId);
        const roomSnap=await transaction.get(roomRef);
        if (roomSnap.exists){
          transaction.update(roomRef,{beds:roomSnap.data().beds.map(b=>b.reservedFor===id?{...b,reservedFor:null}:b)});
        }
      }
      transaction.delete(prospectRef);
    });
  }catch(error){
    console.error("Reserve client deletion failed",error);
    alert("Could not delete reserve client: " + error.message);
  }
}

async function confirmReservation(prospectId, roomId, slot){
  const roomRef=userCollection("rooms").doc(roomId);
  const prospectRef=userCollection("prospects").doc(prospectId);
  try{
    await db.runTransaction(async transaction=>{
    const [roomSnap,prospectSnap]=await Promise.all([transaction.get(roomRef),transaction.get(prospectRef)]);
    if (!roomSnap.exists || !prospectSnap.exists) throw new Error("The room or prospect record no longer exists.");
    const currentRoom={id:roomSnap.id,...roomSnap.data()};
    const currentProspect={id:prospectSnap.id,...prospectSnap.data()};
    if (currentProspect.reservedBed || currentProspect.checkedIn) throw new Error("This prospect already has a reservation.");
    const index=currentRoom.beds.findIndex(item=>item.slot===slot);
    const currentBed=currentRoom.beds[index];
    if (index<0 || !currentBed || currentBed.reservedFor || currentBed.temporaryClientId ||
        (currentBed.tenant && !currentBed.end) ||
        (!currentBed.tenant && !bedCanHost(currentRoom,currentBed,currentProspect.demographic||"Student",currentProspect.gender)) ||
        !roomAllowsResident(currentRoom,currentProspect.demographic||"Student") ||
        !genderMatches(currentRoom.gender,currentProspect.gender)) throw new Error("The bed is no longer eligible.");
    if (currentRoom.tenancyMode==="Whole Room" &&
        currentRoom.beds.some((item,i)=>i!==index && (item.tenant||item.reservedFor))){
      throw new Error("The whole-room booking is no longer available.");
    }
    const checkIn=parseScheduleDate(currentProspect.checkIn);
    const checkout=currentBed.tenant?parseScheduleDate(currentBed.end,true):null;
    if (!checkIn || (currentBed.tenant&&!checkout)) throw new Error("The bed needs a scheduled checkout date and the client needs a check-in date.");
    const beds=currentRoom.beds.map(item=>
      currentRoom.tenancyMode==="Whole Room" && item.tenant ? {...item,reservedFor:prospectId} :
      item.slot===slot ? {...item,reservedFor:prospectId} : item
    );
    transaction.update(roomRef,{beds});
    transaction.update(prospectRef,{reservedBed:{roomId,slot}});
    });
    return true;
  }catch(error){
    console.error("Bed reservation failed",error);
    alert("Could not reserve the bed: " + error.message);
    return false;
  }
}

async function cancelReservation(prospectId){
  const p = prospects.find(x=>x.id===prospectId);
  if (!p || !p.reservedBed) return;
  if (p.checkedIn) return;
  const roomRef=userCollection("rooms").doc(p.reservedBed.roomId);
  const prospectRef=userCollection("prospects").doc(prospectId);
  try{
    await db.runTransaction(async transaction=>{
      const [roomSnap,prospectSnap]=await Promise.all([transaction.get(roomRef),transaction.get(prospectRef)]);
      if (!roomSnap.exists || !prospectSnap.exists) throw new Error("Reservation records no longer exist.");
      const currentRoom=roomSnap.data();
      const currentProspect=prospectSnap.data();
      if (currentProspect.checkedIn) throw new Error("A checked-in client cannot have the reservation undone.");
      if (!currentProspect.reservedBed || currentProspect.reservedBed.roomId!==p.reservedBed.roomId){
        throw new Error("The reservation changed. Refresh and try again.");
      }
      transaction.update(roomRef,{beds:currentRoom.beds.map(b=>b.reservedFor===prospectId?{...b,reservedFor:null}:b)});
      transaction.update(prospectRef,{reservedBed:null});
    });
  }catch(error){
    console.error("Reservation cancellation failed",error);
    alert("Could not undo the reservation: " + error.message);
  }
}

async function processDueReservations(){
  if (!db || !currentUser || !currentUser.uid) return;
  const now=Date.now();
  const due=prospects.filter(p=>p.reservedBed && !p.checkedIn &&
    parseScheduleDate(p.checkIn) && parseScheduleDate(p.checkIn).getTime()<=now &&
    !processingReservations.has(p.id));
  for (const prospect of due){
    processingReservations.add(prospect.id);
    const prospectRef=userCollection("prospects").doc(prospect.id);
    const roomRef=userCollection("rooms").doc(prospect.reservedBed.roomId);
    let didCheckIn=false;
    try{
      await db.runTransaction(async transaction=>{
        didCheckIn=false;
        const [prospectSnap,roomSnap]=await Promise.all([transaction.get(prospectRef),transaction.get(roomRef)]);
        if (!prospectSnap.exists || !roomSnap.exists) throw new Error("A reserved client or assigned room no longer exists.");
        const current=prospectSnap.data();
        if (current.checkedIn || !current.reservedBed) return;
        const room={id:roomSnap.id,...roomSnap.data()};
        const targetIndex=room.beds.findIndex(b=>b.slot===current.reservedBed.slot);
        const target=room.beds[targetIndex];
        if (!target || target.reservedFor!==prospect.id) throw new Error("The reserved bed no longer has this reservation lock.");
        if (!roomAllowsResident(room,current.demographic||"Student") || !genderMatches(room.gender,current.gender)) return;
        const targetCheckIn=parseScheduleDate(current.checkIn);
        if (!targetCheckIn || targetCheckIn.getTime()>Date.now()) return;
        const currentCheckout=parseScheduleDate(target.end,true);
        if (target.tenant && (!currentCheckout || currentCheckout.getTime()>Date.now())) return;
        if (room.tenancyMode==="Whole Room" &&
            room.beds.some((b,index)=>index!==targetIndex && (b.tenant || (b.reservedFor && b.reservedFor!==prospect.id)))){
          return;
        }
        const beds=room.beds.map((b,index)=>{
          const cleared=b.reservedFor===prospect.id?{...b,reservedFor:null}:b;
          if (index!==targetIndex) return cleared;
          return {
            ...cleared,tenant:current.name,start:current.checkIn,end:current.checkOut||null,
            residentType:current.demographic||"Student",residentGender:current.gender,
            temporaryClientId:null
          };
        });
        if (target.tenant && !target.temporaryClientId){
          transaction.set(userCollection("tenant_history").doc(),makeHistoryEntry(room,target,"Replaced by "+current.name));
        }
        transaction.update(roomRef,{beds});
        transaction.update(prospectRef,{checkedIn:true,checkedInAt:sqlServerTimestamp()});
        didCheckIn=true;
      });
      // The client is now a tenant: clear them from the Reserved list automatically.
      if (didCheckIn) await prospectRef.delete();
    }catch(error){
      console.error("Automatic reservation check-in failed for "+prospect.id,error);
    }finally{
      processingReservations.delete(prospect.id);
    }
  }
}
