// js/14-canvas-tabs.js — Canvas, matrix, analytics and checkout views
let canvasDraggedBed=null;

function sharedFilterValues(){
  return {
    gender:document.getElementById("filterGender").value,
    status:document.getElementById("filterVacancy").value,
    demographic:document.getElementById("filterDemographic").value,
    search:document.getElementById("filterSearch").value.trim().toLowerCase()
  };
}

function matchesSharedBed(room,bed,filters=sharedFilterValues()){
  if (filters.gender!=="all" && room.gender!==filters.gender) return false;
  if (filters.demographic!=="all"){
    const demographic=room.demographic||"Mixed";
    if (filters.demographic==="Mixed" && ["Students","Reviewees"].includes(demographic)) return false;
    if (filters.demographic!=="Mixed" && demographic!==filters.demographic) return false;
  }
  const status=bedStatus(bed,room);
  if (filters.status==="vacant" && status!=="vacant") return false;
  if (filters.status==="occupied" && !["occupied","soon"].includes(status)) return false;
  if (filters.status==="overdue" && status!=="overdue") return false;
  if (filters.status==="reserved" && status!=="reserved") return false;
  if (filters.status==="temporary" && status!=="temporary") return false;
  if (filters.status==="full" && roomVacancy(room).vacant>0) return false;
  if (filters.search){
    const text=[room.room,room.id,bed.slot,bed.tenant].filter(Boolean).join(" ").toLowerCase();
    if (!text.includes(filters.search)) return false;
  }
  return true;
}

function filteredRoomBeds(room,filters=sharedFilterValues()){
  return room.beds.map((bed,index)=>({bed,index})).filter(({bed})=>matchesSharedBed(room,bed,filters));
}

function filteredRooms(filters=sharedFilterValues()){
  return rooms.filter(room=>filteredRoomBeds(room,filters).length>0);
}

function filteredProspects(){
  const filters=sharedFilterValues();
  return prospects.filter(prospect=>{
    if (filters.gender!=="all"&&prospect.gender!==filters.gender&&prospect.gender!=="Any") return false;
    const state=prospect.checkedIn?"occupied":prospect.reservedBed?"reserved":"vacant";
    if (filters.status==="vacant"&&state!=="vacant") return false;
    if (filters.status==="occupied"&&state!=="occupied") return false;
    if (filters.status==="reserved"&&state!=="reserved") return false;
    if (["overdue","temporary","full"].includes(filters.status)) return false;
    if (filters.demographic!=="all"){
      const demographic=prospect.demographic||"Student";
      if (filters.demographic==="Mixed") return false;
      if (filters.demographic==="Students"&&demographic!=="Student") return false;
      if (filters.demographic==="Reviewees"&&demographic!=="Reviewee") return false;
    }
    if (filters.search){
      const room=prospect.reservedBed&&rooms.find(item=>item.id===prospect.reservedBed.roomId);
      const text=[prospect.name,prospect.notes,room&&room.room,prospect.reservedBed&&prospect.reservedBed.slot]
        .filter(Boolean).join(" ").toLowerCase();
      if (!text.includes(filters.search)) return false;
    }
    return true;
  });
}

function applySharedHallwayFilters(){
  const filters=sharedFilterValues();
  document.querySelectorAll("#hallwayCanvas .room-tile").forEach(tile=>{
    const room=rooms.find(item=>item.id===tile.dataset.id);
    tile.classList.toggle("filtered-out",!room||filteredRoomBeds(room,filters).length===0);
  });
}

function renderSharedOverview(){
  updateOverdueTabBadge();
  const totalBeds=rooms.reduce((sum,room)=>sum+room.beds.length,0);
  const counts={vacant:0,occupied:0,overdue:0,reserved:0,temporary:0,soon:0};
  rooms.forEach(room=>room.beds.forEach(bed=>{
    const status=bedStatus(bed,room);
    if (Object.prototype.hasOwnProperty.call(counts,status)) counts[status]++;
  }));
  const occupied=counts.occupied+counts.soon+counts.temporary;
  const occupancy=totalBeds?Math.round((occupied+counts.overdue)/totalBeds*100):0;
  document.getElementById("statStrip").innerHTML=`
    <div class="stat-box"><div class="stat-num">${rooms.length}</div><div class="stat-label">Total rooms</div></div>
    <div class="stat-box"><div class="stat-num">${totalBeds}</div><div class="stat-label">Bed capacity</div></div>
    <div class="stat-box accent"><div class="stat-num">${counts.vacant}</div><div class="stat-label">Vacant</div></div>
    <div class="stat-box"><div class="stat-num">${occupied}</div><div class="stat-label">Occupied</div></div>
    <div class="stat-box"><div class="stat-num">${counts.overdue}</div><div class="stat-label">Overdue</div></div>
    <div class="stat-box"><div class="stat-num">${occupancy}%</div><div class="stat-label">Occupancy</div></div>`;
}

function renderDashboard(){
  const filters=sharedFilterValues();
  const matching=filteredRooms(filters);
  const host=document.getElementById("roomGrid");
  host.classList.add("canvas-room-grid");
  if (!matching.length){
    host.innerHTML=`<div class="empty-note">No rooms match the shared filters.</div>`;
    return;
  }
  host.innerHTML=matching.map(room=>{
    const {total,vacant,occupied,reserved}=roomVacancy(room);
    const overdue=room.beds.filter(bed=>bedStatus(bed,room)==="overdue").length;
    const filled=total-vacant-reserved;
    const beds=filteredRoomBeds(room,filters).map(({bed,index})=>{
      const state=bedStatus(bed,room);
      const prospect=bed.reservedFor?prospects.find(item=>item.id===bed.reservedFor):null;
      const labels={vacant:"Vacant",reserved:"Reserved",temporary:"Temporary occupied",overdue:"Overdue",soon:"Checkout ≤48h",occupied:"Occupied"};
      const checkout=bed.temporaryClientId
        ? `<button class="btn btn-outline btn-sm" data-canvas-action="temporary-checkout" data-client="${escapeHtml(bed.temporaryClientId)}">Check out</button>`
        : bed.tenant
          ? `<button class="btn btn-outline btn-sm" data-canvas-action="checkout" data-bed="${escapeHtml(JSON.stringify([room.id,index]))}">Check out</button>`
          : "";
      const move=bed.tenant&&!bed.reservedFor
        ? `<button class="btn btn-outline btn-sm" data-canvas-action="move" data-bed="${escapeHtml(JSON.stringify([room.id,index]))}">Move</button>`
        : "";
      const dragSource=bed.tenant&&!bed.reservedFor?`draggable="true" data-canvas-drag="${escapeHtml(JSON.stringify([room.id,index]))}"`:"";
      const dropTarget=state==="vacant"?`data-canvas-drop="${escapeHtml(JSON.stringify([room.id,index]))}"`:"";
      return `<article class="canvas-bed status-${state}" ${dragSource} ${dropTarget}>
        <div class="canvas-bed-head"><strong>${escapeHtml(bed.slot||"Bed "+(index+1))}</strong><span class="status-pill ${state}">${labels[state]||"Occupied"}</span><span class="spacer"></span>${checkout}${move}<button class="btn btn-outline btn-sm" data-canvas-action="edit-room" data-room="${escapeHtml(room.id)}">${bed.tenant?"Edit":"Check in"}</button></div>
        <div class="canvas-bed-name">${bed.tenant?escapeHtml(bed.tenant):"Vacant"}</div>
        ${state==="vacant"&&!bed.tenant&&!bed.reservedFor&&!bed.temporaryClientId?`<button class="btn btn-outline btn-sm" type="button" onclick="removeBed('${room.id}','${escapeHtml(bed.slot)}')">Remove bed</button>`:""}
        ${bed.tenant?`<div class="canvas-bed-meta">${escapeHtml(bed.residentType||"Student")} · ${escapeHtml(residentGenderForBed(room,bed))}</div><div class="canvas-bed-meta">${fmtDate(bed.start)} → ${fmtDate(bed.end)}</div>`:""}
        ${prospect?`<div class="canvas-bed-meta">Reserved for ${escapeHtml(prospect.name)} · ${fmtDate(prospect.checkIn)}</div>`:""}
      </article>`;
    }).join("");
    const occupancyPercent=total?Math.round((filled+overdue)/total*100):0;
    return `<article class="canvas-room">
      <header class="canvas-room-head"><div><h3>ROOM ${escapeHtml(room.room)}</h3><div class="canvas-room-meta">${escapeHtml(room.gender||"Mixed")} · ${escapeHtml(room.demographic||"Mixed")} · ${escapeHtml(room.type||"Room")} · ${room.ac?"AC":"Non-AC"} · ${total} beds</div></div><span class="spacer"></span><span class="vacancy-pill ${vacant?"has":"full"}">${vacant} vacant</span><button class="icon-btn" type="button" title="Edit room" data-canvas-action="edit-room" data-room="${escapeHtml(room.id)}">✎</button><button class="icon-btn icon-btn-danger" type="button" title="Delete room" aria-label="Delete room ${escapeHtml(room.room)}" data-canvas-action="delete-room" data-room="${escapeHtml(room.id)}"><i class="fa-solid fa-trash-can" aria-hidden="true"></i></button></header>
      <div class="canvas-progress"><span style="width:${occupancyPercent}%"></span></div>
      <div class="canvas-beds">${beds}</div>
    </article>`;
  }).join("");
}

function renderMatrix(){
  const filters=sharedFilterValues();
  const rows=filteredRooms(filters).flatMap(room=>filteredRoomBeds(room,filters).map(({bed,index})=>({room,bed,index})));
  const body=rows.map(({room,bed,index})=>{
    const status=bedStatus(bed,room);
    const label={vacant:"Vacant",reserved:"Reserved",temporary:"Temporary occupied",overdue:"Overdue",soon:"Checkout ≤48h",occupied:"Occupied"}[status];
    return `<tr><td>Room ${escapeHtml(room.room)}</td><td>${escapeHtml(bed.slot||"Bed "+(index+1))}</td><td>${escapeHtml(room.gender||"Mixed")}</td><td>${escapeHtml(bed.tenant||"—")}</td><td>${bed.tenant?fmtDate(bed.start):"—"}</td><td>${bed.tenant?fmtDate(bed.end):"—"}</td><td>${label}</td><td>${room.ac?"AC":"Non-AC"}</td><td><button class="btn btn-outline btn-sm" data-canvas-action="edit-room" data-room="${escapeHtml(room.id)}">${bed.tenant?"Edit":"Check in"}</button>${bed.tenant&&!bed.reservedFor?` <button class="btn btn-outline btn-sm" data-canvas-action="move" data-bed="${escapeHtml(JSON.stringify([room.id,index]))}">Move</button>`:""}</td></tr>`;
  }).join("");
  const table=document.getElementById("matrixTable");
  table.classList.add("canvas-matrix");
  table.innerHTML=`<thead><tr><th>Room</th><th>Bed</th><th>Gender</th><th>Tenant</th><th>Contract start</th><th>Contract end</th><th>Status</th><th>AC</th><th>Actions</th></tr></thead><tbody>${body||'<tr><td colspan="9" class="empty-note">No beds match the shared filters.</td></tr>'}</tbody>`;
}

function renderAnalytics(){
  const filters=sharedFilterValues();
  const selected=filteredRooms(filters);
  const beds=selected.flatMap(room=>filteredRoomBeds(room,filters).map(({bed})=>({room,bed})));
  const counts={vacant:0,occupied:0,overdue:0,reserved:0,temporary:0,soon:0};
  beds.forEach(({room,bed})=>{
    const state=bedStatus(bed,room);
    if (Object.prototype.hasOwnProperty.call(counts,state)) counts[state]++;
  });
  const cap=beds.length,occupied=counts.occupied+counts.soon+counts.temporary;
  const pOccupied=cap?(occupied/cap)*100:0,pOverdue=cap?((occupied+counts.overdue)/cap)*100:0;
  const roomsHtml=selected.map(room=>{
    const matching=filteredRoomBeds(room,filters);
    const vacancy=matching.filter(({bed})=>bedStatus(bed,room)==="vacant").length;
    const occupiedCount=matching.filter(({bed})=>["occupied","soon","temporary","overdue"].includes(bedStatus(bed,room))).length;
    return `<div class="analytics-room"><div><strong>ROOM ${escapeHtml(room.room)}</strong><small>${escapeHtml(room.gender||"Mixed")} · ${matching.length} beds</small></div><span>${vacancy?vacancy+" vacant":"Full"}</span><div class="canvas-progress"><span style="width:${matching.length?Math.round(occupiedCount/matching.length*100):0}%"></span></div></div>`;
  }).join("");
  document.getElementById("analyticsContent").innerHTML=`<div class="analytics-canvas-grid">
    <section class="panel"><h3>Bed occupancy distribution</h3><div class="canvas-donut" style="background:conic-gradient(var(--occupied) 0 ${pOccupied}%,var(--overdue) ${pOccupied}% ${pOverdue}%,var(--vacant) ${pOverdue}% 100%)"><div>${cap}</div></div><div class="analytics-legend"><span>Vacant ${counts.vacant}</span><span>Occupied ${occupied}</span><span>Overdue ${counts.overdue}</span><span>Reserved ${counts.reserved}</span></div></section>
    <section class="panel"><h3>Room capacities &amp; vacancies</h3>${roomsHtml||'<div class="empty-note">No rooms match the shared filters.</div>'}</section>
  </div>`;
}

function checkoutItems(){
  const filters=sharedFilterValues();
  return rooms.flatMap(room=>filteredRoomBeds(room,filters)
    .filter(({bed})=>Boolean(bed.tenant&&bed.end))
    .map(({bed,index})=>({room,bed,index,date:parseScheduleDate(bed.end,true)})))
    .filter(item=>item.date)
    .sort((a,b)=>a.date-b.date);
}

function checkoutProximityFor(date){
  const days=Math.ceil((date.getTime()-Date.now())/DAY_MS);
  return {days,key:days<=3?"near":days<=10?"moderate":"far"};
}

function renderCalendar(){
  const items=checkoutItems();
  const counts={near:0,moderate:0,far:0};
  items.forEach(item=>counts[checkoutProximityFor(item.date).key]++);
  const base=new Date();
  const start=new Date(base.getFullYear(),base.getMonth()+calOffset,1);
  const months=Array.from({length:3},(_,i)=>new Date(start.getFullYear(),start.getMonth()+i,1));
  const filtered=items.filter(item=>checkoutProximity==="all"||checkoutProximityFor(item.date).key===checkoutProximity);
  const monthCards=months.map(month=>{
    const monthItems=filtered.filter(item=>item.date.getFullYear()===month.getFullYear()&&item.date.getMonth()===month.getMonth());
    const current=month.getFullYear()===base.getFullYear()&&month.getMonth()===base.getMonth();
    return `<section class="checkout-month ${current?"current":""}"><header><div><h3>${month.toLocaleDateString([],{month:"long",year:"numeric"})}</h3><small>${monthItems.length} checkout${monthItems.length===1?"":"s"} scheduled</small></div><span class="checkout-count">${monthItems.length}</span></header>
      <div class="checkout-month-list">${monthItems.length?monthItems.map(item=>{
        const proximity=checkoutProximityFor(item.date);
        const overdue=bedStatus(item.bed,item.room)==="overdue";
        const urgency=proximity.key==="near"?(overdue?"OVERDUE":`${Math.max(0,proximity.days)} DAY${proximity.days===1?"":"S"} LEFT`):proximity.key==="moderate"?`Approaching · ${proximity.days} days`:"Future";
        return `<article class="checkout-card ${proximity.key}"><div class="checkout-card-top"><strong>${escapeHtml(item.bed.tenant)}</strong><span class="checkout-badge">${urgency}</span></div><div class="canvas-bed-meta">Bed ${escapeHtml(item.bed.slot)} · Room ${escapeHtml(item.room.room)} · ${escapeHtml(residentGenderForBed(item.room,item.bed))}</div><div class="canvas-bed-meta">${fmtDate(item.bed.end)}</div><div class="checkout-actions"><button class="btn btn-outline btn-sm" data-canvas-action="edit-room" data-room="${escapeHtml(item.room.id)}">Edit</button><button class="btn btn-outline btn-sm" data-canvas-action="extend" data-bed="${escapeHtml(JSON.stringify([item.room.id,item.index]))}">Extend</button><button class="btn btn-outline btn-sm" data-canvas-action="checkout" data-bed="${escapeHtml(JSON.stringify([item.room.id,item.index]))}">Check out</button><button class="btn btn-outline btn-sm" data-canvas-action="inspect" data-room="${escapeHtml(item.room.id)}">Inspect</button></div></article>`;
      }).join(""):'<div class="empty-note">No checkouts scheduled for this month.</div>'}</div></section>`;
  }).join("");
  const strip=Array.from({length:37},(_,i)=>{const off=i-12,d=new Date(base.getFullYear(),base.getMonth()+off,1);return `<button type="button" class="${off===calOffset?"on":""}" data-canvas-action="checkout-goto" data-offset="${off}">${d.toLocaleDateString([],{month:"short"})}<small>${String(d.getFullYear()).slice(2)}</small></button>`;}).join("");
  const picker=checkoutPickerOpen?`<div class="checkout-picker cal-strip" aria-label="Scroll sideways to choose a month">${strip}</div>`:"";
  const glass=checkoutGlassCal(start,items);
  document.getElementById("checkoutList").innerHTML=`<section class="checkout-controls panel">
    <div class="checkout-controls-top"><div><h3>Checkout Schedule</h3><small>Upcoming tenant departures across your rooms</small></div><span class="spacer"></span><button class="btn btn-outline btn-sm" data-canvas-action="checkout-nav" data-delta="-1">‹</button><button class="btn btn-outline btn-sm" data-canvas-action="checkout-active">Jump to Active</button><button class="btn btn-outline btn-sm" data-canvas-action="checkout-nav" data-delta="1">›</button><span class="checkout-calendar-control"><button class="btn btn-outline btn-sm" data-canvas-action="checkout-picker" aria-expanded="${checkoutPickerOpen}">📅 Calendar</button>${picker}</span></div>
    <div class="checkout-proximity"><strong>${items.length} scheduled checkouts</strong><span class="spacer"></span>${[["all","All"],["near",`Near (${counts.near})`],["moderate",`Moderate (${counts.moderate})`],["far",`Far (${counts.far})`]].map(([key,label])=>`<button class="btn btn-outline btn-sm ${checkoutProximity===key?"active":""}" data-canvas-action="checkout-filter" data-filter="${key}">${label}</button>`).join("")}</div>
    <div class="checkout-scale"><span>Near: overdue / 0–3 days</span><span>Moderate: 4–10 days</span><span>Far: 11+ days</span></div>
  </section>${glass}<div class="checkout-scroll"><div class="checkout-month-row">${monthCards}</div></div>`;
}

function scanReserveVacancies(){
  const name=document.getElementById("pName").value.trim();
  const gender=document.getElementById("pGender").value;
  const demographic=document.getElementById("pDemographic").value;
  const checkIn=isoLocalDateTime(document.getElementById("pCheckIn").value);
  const checkOut=isoLocalDateTime(document.getElementById("pCheckOut").value);
  const notes=document.getElementById("pNotes").value.trim();
  const host=document.getElementById("prospectScanResults");
  if (!name||!checkIn){host.innerHTML='<p class="empty-note">Enter a name and check-in date before scanning.</p>';return;}
  if (checkOut&&parseScheduleDate(checkOut,true)<=parseScheduleDate(checkIn)){
    host.innerHTML='<p class="empty-note">Target checkout must be later than check-in.</p>';return;
  }
  const prospect={name,gender,demographic,checkIn,checkOut,notes};
  const checkInDate=parseScheduleDate(checkIn);
  const vacant=availableBedOptions(gender,demographic,false,checkIn);
  const scheduled=reservationCandidates(prospect).filter(option=>option.bed.tenant);
  const resultRows=[
    ...vacant.map(({room,index,bed})=>({room,index,bed,kind:"vacant"})),
    ...scheduled.map(({room,index,bed})=>({room,index,bed,kind:"scheduled"}))
  ];
  if (!resultRows.length){
    host.innerHTML='<p class="empty-note">No compatible vacant bed or scheduled checkout was found for this client.</p>';return;
  }
  host.innerHTML=`<strong>${resultRows.length} compatible option${resultRows.length===1?"":"s"}</strong>${resultRows.map(({room,index,bed,kind})=>`<div class="reserve-scan-option"><span>Room ${escapeHtml(room.room)} · ${escapeHtml(bed.slot)} · ${kind==="vacant"?"Vacant now":`Checkout ${fmtDate(bed.end)}`}</span>${kind==="vacant"&&checkInDate&&checkInDate.getTime()<=Date.now()&&["Male","Female"].includes(gender)?`<button class="btn btn-primary btn-sm" data-canvas-action="scan-checkin" data-room="${escapeHtml(room.id)}" data-index="${index}">Check in now</button>`:`<button class="btn btn-outline btn-sm" data-canvas-action="scan-reserve" data-target="${escapeHtml(JSON.stringify([room.id,index]))}">Select to reserve</button>`}</div>`).join("")}`;
}

async function checkInScannedProspect(roomId,index){
  const name=document.getElementById("pName").value.trim();
  const gender=document.getElementById("pGender").value;
  const demographic=document.getElementById("pDemographic").value;
  const checkIn=isoLocalDateTime(document.getElementById("pCheckIn").value);
  const checkOut=isoLocalDateTime(document.getElementById("pCheckOut").value);
  const notes=document.getElementById("pNotes").value.trim();
  const start=parseScheduleDate(checkIn),end=parseScheduleDate(checkOut,true);
  if (!name||!start||start.getTime()>Date.now()){alert("For immediate check-in, enter a name and a check-in time that is now or earlier.");return;}
  if (checkOut&&(!end||end<=start)){alert("Target checkout must be later than check-in.");return;}
  if (!["Male","Female"].includes(gender)){alert("Choose the client's gender before checking in.");return;}
  const roomRef=userCollection("rooms").doc(roomId);
  const prospectRef=userCollection("prospects").doc();
  try{
    await db.runTransaction(async transaction=>{
      const roomSnap=await transaction.get(roomRef);
      if (!roomSnap.exists) throw new Error("The selected room no longer exists.");
      const room={id:roomSnap.id,...roomSnap.data()};
      const bed=room.beds[index];
      if (!bed||!bedCanHost(room,bed,demographic,gender)) throw new Error("That bed is no longer vacant or compatible.");
      const beds=room.beds.slice();
      beds[index]={...bed,tenant:name,start:checkIn,end:checkOut||null,residentType:demographic,residentGender:gender,reservedFor:null,temporaryClientId:null};
      transaction.update(roomRef,{beds});
      transaction.set(prospectRef,{name,gender,demographic,checkIn,checkOut:checkOut||null,notes:notes||null,reservedBed:{roomId,slot:bed.slot},checkedIn:true,checkedInAt:sqlServerTimestamp()});
    });
    document.getElementById("pName").value="";
    document.getElementById("pCheckIn").value="";
    document.getElementById("pCheckOut").value="";
    document.getElementById("pNotes").value="";
    document.getElementById("prospectScanResults").innerHTML="";
  }catch(error){
    console.error("Scanned client check-in failed",error);
    alert("Could not check in client: "+error.message);
  }
}

["filterGender","filterVacancy","filterDemographic","filterSearch"].forEach(id=>{
  const el=document.getElementById(id);
  if (el) ["change","input"].forEach(ev=>el.addEventListener(ev,()=>{ if (activeTab==="hallway") applySharedHallwayFilters(); }));
});

/* Glass-style month calendar: a dot on every day that has a checkout; tap a day to see who leaves. */
let calSel=null;
function checkoutGlassCal(start,items){
  const pad=n=>String(n).padStart(2,"0"),key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const by={};items.forEach(it=>{(by[key(it.date)]=by[key(it.date)]||[]).push(it);});
  const y=start.getFullYear(),m=start.getMonth(),lead=(new Date(y,m,1).getDay()+6)%7,days=new Date(y,m+1,0).getDate();
  const todayKey=key(new Date());
  if(!calSel||calSel.slice(0,7)!==`${y}-${pad(m+1)}`){const first=Object.keys(by).sort().find(k=>k.slice(0,7)===`${y}-${pad(m+1)}`);calSel=first||(todayKey.slice(0,7)===`${y}-${pad(m+1)}`?todayKey:`${y}-${pad(m+1)}-01`);}
  let cells="";for(let i=0;i<lead;i++)cells+="<i></i>";
  for(let d=1;d<=days;d++){const k=`${y}-${pad(m+1)}-${pad(d)}`;cells+=`<button type="button" class="${k===calSel?"sel":""} ${k===todayKey?"today":""}" data-canvas-action="cal-day" data-key="${k}">${d}${by[k]?`<b>${by[k].length>1?by[k].length:""}</b>`:""}</button>`;}
  const list=(by[calSel]||[]).map(it=>`<div class="gcal-item"><span></span><strong>${escapeHtml(it.bed.tenant)}</strong><em>Room ${escapeHtml(it.room.room)} · ${escapeHtml(it.bed.slot||"")}</em><time>${fmtDate(it.bed.end)}</time></div>`).join("")||'<div class="gcal-none">No checkouts on this day</div>';
  return `<section class="gcal"><header><button type="button" data-canvas-action="checkout-nav" data-delta="-1" aria-label="Previous month">‹</button><h3>${start.toLocaleDateString([],{month:"long"})}</h3><button type="button" data-canvas-action="checkout-nav" data-delta="1" aria-label="Next month">›</button><span class="spacer"></span><small>${y}</small></header>
  <div class="gcal-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="gcal-grid">${cells}</div>
  <div class="gcal-list">${list}</div></section>`;
}
