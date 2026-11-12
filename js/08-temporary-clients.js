// js/08-temporary-clients.js — Bed pickers and temporary dorm clients
function refreshBedTargetSelectors(){
  const prospectGender = document.getElementById("pGender").value;
  const prospectType = document.getElementById("pDemographic").value;
  const checkIn = isoLocalDateTime(document.getElementById("pCheckIn").value);
  const prospectTargets = availableBedOptions(prospectGender,prospectType,true,checkIn);
  const prospectSelect = document.getElementById("pDesiredBed");
  const previousProspect = prospectSelect.value;
  prospectSelect.innerHTML = '<option value="">Choose the bed later (you decide)</option>' +
    prospectTargets.map(({room,index,bed})=>{
      const note = checkIn ? bedTimingNote(bed,checkIn) : "";
      return `<option value="${escapeHtml(JSON.stringify([room.id,index]))}">Room ${escapeHtml(room.room)} · ${escapeHtml(bed.slot)} · ${escapeHtml(bed.tenant)} leaves ${fmtDate(bed.end)}${note?" ("+escapeHtml(note)+")":""}</option>`;
    }).join("");
  if (Array.from(prospectSelect.options).some(option=>option.value===previousProspect)) prospectSelect.value=previousProspect;

  const tempGender = document.getElementById("tGender").value;
  const tempTargets = availableBedOptions(tempGender,"Temporary");
  const tempSelect = document.getElementById("tTargetBed");
  const previousTemp = tempSelect.value;
  tempSelect.innerHTML = '<option value="">Select a compatible vacant bed</option>' +
    tempTargets.map(({room,index,bed})=>`<option value="${escapeHtml(JSON.stringify([room.id,index]))}">Room ${escapeHtml(room.room)} · ${escapeHtml(bed.slot)} · ${escapeHtml(room.gender)}</option>`).join("");
  if (Array.from(tempSelect.options).some(option=>option.value===previousTemp)) tempSelect.value=previousTemp;
}

async function addTemporaryClient(){
  const name = document.getElementById("tName").value.trim();
  const gender = document.getElementById("tGender").value;
  const start = isoLocalDateTime(document.getElementById("tStart").value);
  const end = isoLocalDateTime(document.getElementById("tEnd").value);
  const notes = document.getElementById("tNotes").value.trim();
  const selectedTarget = document.getElementById("tTargetBed").value;
  if (!name || !start || !end || !selectedTarget){
    alert("Enter the client name, check-in and checkout times, and select a vacant bed.");
    return;
  }
  if (parseScheduleDate(end,true) <= parseScheduleDate(start)){
    alert("Checkout must be later than check-in.");
    return;
  }
  const [roomId,bedIndex] = JSON.parse(selectedTarget);
  const roomRef = userCollection("rooms").doc(roomId);
  const clientRef = userCollection("temporary_dorm_clients").doc();
  try{
    await db.runTransaction(async transaction=>{
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists) throw new Error("The selected room no longer exists.");
      const room = {id:roomSnap.id,...roomSnap.data()};
      const bed = room.beds[bedIndex];
      if (!bed || !bedCanHost(room,bed,"Temporary",gender)) throw new Error("That bed is no longer available for this guest.");
      const client = {
        name,gender,start,end,notes:notes||null,
        roomId,room:room.room,slot:bed.slot,
        status:"Active",createdAt:sqlServerTimestamp()
      };
      const beds = room.beds.slice();
      beds[bedIndex] = {...bed,tenant:name,start,end,reservedFor:null,residentType:"Temporary",residentGender:gender,temporaryClientId:clientRef.id};
      transaction.update(roomRef,{beds});
      transaction.set(clientRef,client);
    });
    document.getElementById("tName").value="";
    document.getElementById("tStart").value="";
    document.getElementById("tEnd").value="";
    document.getElementById("tNotes").value="";
  }catch(error){
    console.error("Temporary client assignment failed",error);
    alert("Could not assign temporary client: " + error.message);
  }
}

function renderTemporaryClients(){
  refreshBedTargetSelectors();
  const list = document.getElementById("temporaryList");
  if (!temporaryClients.length){
    list.innerHTML='<div class="empty-note">No temporary dorm clients yet.</div>';
    return;
  }
  list.innerHTML=temporaryClients.map(client=>{
    const currentRoom=rooms.find(room=>room.id===client.roomId);
    return `
  <div class="prospect-card">
    <div class="top"><div><div class="pname">${escapeHtml(client.name)}</div>
      <div class="pmeta">${escapeHtml(client.gender)} · Room ${escapeHtml(currentRoom?currentRoom.room:(client.room||"?"))} ${escapeHtml(client.slot||"")} · ${fmtDate(client.start)} → ${fmtDate(client.end)}</div></div>
      <div style="display:flex;align-items:center;gap:8px"><span class="status-tag ${client.status==="Checked out"?"matched":"searching"}">${escapeHtml(client.status||"Active")}</span>
        ${client.status!=="Checked out"?`<button class="btn btn-outline btn-sm" type="button" onclick="checkoutTemporaryClient('${client.id}')">Check out</button>`:""}
      </div>
    </div>${client.notes?`<div class="pmeta" style="margin-top:6px">${escapeHtml(client.notes)}</div>`:""}
  </div>`;
  }).join("");
}

async function checkoutTemporaryClient(clientId){
  const client=temporaryClients.find(item=>item.id===clientId);
  if (!client || client.status==="Checked out") return;
  const clientRef=userCollection("temporary_dorm_clients").doc(clientId);
  const roomRef=userCollection("rooms").doc(client.roomId);
  try{
    await db.runTransaction(async transaction=>{
      const [clientSnap,roomSnap]=await Promise.all([transaction.get(clientRef),transaction.get(roomRef)]);
      if (!clientSnap.exists) throw new Error("Temporary client record no longer exists.");
      const latest=clientSnap.data();
      if (latest.status==="Checked out") return;
      if (!roomSnap.exists) throw new Error("Assigned room no longer exists; the client record remains available.");
      const room={id:roomSnap.id,...roomSnap.data()};
      const index=room.beds.findIndex(b=>b.temporaryClientId===clientId);
      if (index>=0){
        const bed=room.beds[index];
        const beds=room.beds.slice();
        beds[index]={...bed,tenant:null,start:null,end:null,reservedFor:null,residentType:"Student",residentGender:"Unspecified",temporaryClientId:null};
        transaction.update(roomRef,{beds});
      }
      transaction.update(clientRef,{status:"Checked out",checkedOutAt:sqlServerTimestamp()});
    });
  }catch(error){
    console.error("Temporary client checkout failed",error);
    alert("Checkout failed: " + error.message);
  }
}

