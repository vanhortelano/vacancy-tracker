// js/07-transfers.js — Transferring a resident to another bed
function openTransferModal(roomId,bedIndex){
  const room = rooms.find(item=>item.id===roomId);
  const bed = room && room.beds[bedIndex];
  if (!room || !bed || !bed.tenant) return;
  const residentType = bed.residentType || (room.demographic === "Reviewees" ? "Reviewee" : "Student");
  const gender = residentGenderForBed(room,bed);
  const options = [];
  rooms.forEach(target=>target.beds.forEach((candidate,index)=>{
    if (target.id===room.id) return;
    if (target.tenancyMode==="Whole Room" && index>0) return;
    if (!bedCanHost(target,candidate,residentType,gender)) return;
    options.push(`<option value="${escapeHtml(JSON.stringify([target.id,index]))}">Room ${escapeHtml(target.room)} · ${escapeHtml(candidate.slot)} · ${escapeHtml(target.gender)} · ${escapeHtml(target.demographic||"Mixed")}</option>`);
  }));
  if (!options.length){
    alert("No vacant bed matches this resident's gender and resident group.");
    return;
  }
  transferState = {roomId,bedIndex,tenant:bed.tenant};
  document.getElementById("transferSourceSummary").textContent =
    `${bed.tenant} · Room ${room.room}, ${bed.slot} · ${residentType} · ${gender}`;
  document.getElementById("transferTarget").innerHTML = options.join("");
  document.getElementById("transferModalBackdrop").classList.add("open");
}

function closeTransferModal(){
  document.getElementById("transferModalBackdrop").classList.remove("open");
  transferState = null;
}

async function confirmBedTransfer(){
  if (!transferState) return;
  const [targetRoomId,targetIndex] = JSON.parse(document.getElementById("transferTarget").value);
  const sourceState = transferState;
  const sourceRef = userCollection("rooms").doc(sourceState.roomId);
  const targetRef = userCollection("rooms").doc(targetRoomId);
  const historyRef = userCollection("bed_transfers").doc();
  try{
    await db.runTransaction(async transaction=>{
      const [sourceSnap,targetSnap] = await Promise.all([transaction.get(sourceRef),transaction.get(targetRef)]);
      if (!sourceSnap.exists || !targetSnap.exists) throw new Error("The source or target room no longer exists.");
      const sourceRoom = {id:sourceSnap.id,...sourceSnap.data()};
      const targetRoom = {id:targetSnap.id,...targetSnap.data()};
      const sourceBed = sourceRoom.beds[sourceState.bedIndex];
      const targetBed = targetRoom.beds[targetIndex];
      if (!sourceBed || sourceBed.tenant !== sourceState.tenant) throw new Error("The resident's source bed changed. Refresh and try again.");
      if (sourceBed.reservedFor) throw new Error("This bed has a future reservation and cannot be transferred.");
      if (sourceRoom.id===targetRoom.id || !targetBed || !bedCanHost(targetRoom,targetBed,sourceBed.residentType || (sourceRoom.demographic==="Reviewees"?"Reviewee":"Student"),residentGenderForBed(sourceRoom,sourceBed))){
        throw new Error("The target bed is no longer available or is incompatible.");
      }
      let temporaryRef=null,temporarySnap=null;
      if (sourceBed.temporaryClientId){
        temporaryRef=userCollection("temporary_dorm_clients").doc(sourceBed.temporaryClientId);
        temporarySnap=await transaction.get(temporaryRef);
      }
      const linked=prospects.find(item=>item.checkedIn&&!item.checkedOut&&item.reservedBed&&
        item.reservedBed.roomId===sourceRoom.id&&item.reservedBed.slot===sourceBed.slot);
      const linkedRef=linked?userCollection("prospects").doc(linked.id):null;
      const linkedSnap=linkedRef?await transaction.get(linkedRef):null;
      const sourceBeds = sourceRoom.beds.slice();
      sourceBeds[sourceState.bedIndex] = {
        ...sourceBed,tenant:null,start:null,end:null,reservedFor:null,residentType:"Student",
        residentGender:"Unspecified",temporaryClientId:null
      };
      const movedBed = {...sourceBed,slot:targetBed.slot,reservedFor:null};
      const targetBeds = targetRoom.beds.slice();
      targetBeds[targetIndex] = movedBed;
      transaction.update(sourceRef,{beds:sourceBeds});
      transaction.update(targetRef,{beds:targetBeds});
      if (temporaryRef && temporarySnap && temporarySnap.exists){
        transaction.update(temporaryRef,{roomId:targetRoom.id,room:targetRoom.room,slot:targetBed.slot});
      }
      if (linkedRef&&linkedSnap&&linkedSnap.exists){
        const prospect=linkedSnap.data();
        if (prospect.checkedIn&&!prospect.checkedOut&&prospect.reservedBed&&
            prospect.reservedBed.roomId===sourceRoom.id&&prospect.reservedBed.slot===sourceBed.slot){
          transaction.update(linkedRef,{reservedBed:{roomId:targetRoom.id,slot:targetBed.slot}});
        }
      }
      transaction.set(historyRef,{
        tenant:sourceBed.tenant,
        from:{roomId:sourceRoom.id,room:sourceRoom.room,slot:sourceBed.slot},
        to:{roomId:targetRoom.id,room:targetRoom.room,slot:targetBed.slot},
        residentType:sourceBed.residentType || "Student",
        transferredAt:sqlServerTimestamp()
      });
    });
    closeTransferModal();
  }catch(error){
    console.error("Resident transfer failed",error);
    alert("Transfer failed: " + error.message);
  }
}
