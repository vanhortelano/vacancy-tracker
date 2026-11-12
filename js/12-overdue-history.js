// js/12-overdue-history.js — Overdue reminders, check-out, extend stay, tenant history
/* ============================= OVERDUE REMINDERS / CHECKOUT / EXTEND ============================= */

function updateOverdueTabBadge(){
  const badge=document.getElementById("overdueTabBadge");
  if (!badge) return;
  const overdueCount=rooms.reduce((sum,room)=>sum+room.beds.filter(bed=>bedStatus(bed,room)==="overdue").length,0);
  badge.hidden=overdueCount===0;
  badge.textContent=overdueCount?`! ${overdueCount}`:"";
  badge.setAttribute("aria-label",overdueCount?`${overdueCount} overdue tenant${overdueCount===1?"":"s"}`:"No overdue tenants");
  const tab=badge.closest("button");
  if (tab) tab.classList.toggle("has-overdue",overdueCount>0);
}

function renderOverduePanel(){
  const host = document.getElementById("overduePanel");
  if (!host) return;
  const items = [];
  rooms.forEach(room=>room.beds.forEach((bed,index)=>{
    if (bedStatus(bed,room)!=="overdue") return;
    if (typeof matchesSharedBed==="function"&&!matchesSharedBed(room,bed)) return;
    items.push({room,bed,index});
  }));
  const overdueCount=rooms.reduce((sum,room)=>sum+room.beds.filter(bed=>bedStatus(bed,room)==="overdue").length,0);
  updateOverdueTabBadge();
  if (!items.length){
    host.hidden = false;
    host.innerHTML = `<div class="empty-note">${overdueCount?"No overdue tenants match the shared filters.":"No tenants are past their checkout date."}</div>`;
    return;
  }
  items.sort((a,b)=>parseScheduleDate(a.bed.end,true) - parseScheduleDate(b.bed.end,true));
  const today = dayStart(new Date());
  const rows = items.map(({room,bed,index})=>{
    const daysLate = Math.max(0, Math.round((today - dayStart(parseScheduleDate(bed.end,true))) / DAY_MS));
    const lateText = daysLate === 0 ? "today" : daysLate + " day" + (daysLate===1?"":"s") + " overdue";
    const incoming = bed.reservedFor ? prospects.find(p=>p.id===bed.reservedFor) : null;
    const incomingText = incoming
      ? "Next: " + escapeHtml(incoming.name) + " arrives " + fmtDate(incoming.checkIn)
      : "No one reserved";
    const actions = bed.temporaryClientId
      ? `<span class="sub">Temporary stay — use the Temporary Dorm Clients tab</span>`
      : `<button class="btn btn-outline btn-sm" type="button" onclick="openExtendModal('${room.id}',${index})">Extend</button>
         <button class="btn btn-primary btn-sm" type="button" onclick="checkoutBed('${room.id}',${index})">Check out</button>`;
    return `<div class="overdue-row">
      <div><div class="who">Room ${escapeHtml(room.room)} · ${escapeHtml(bed.slot)}</div><div class="sub">${escapeHtml(room.gender||"Mixed")}</div></div>
      <div><div class="who">${escapeHtml(bed.tenant)}</div><div class="sub">ended ${fmtDate(bed.end)} · <span class="late">${lateText}</span></div></div>
      <div class="sub">${incomingText}</div>
      <div class="overdue-actions">${actions}</div>
    </div>`;
  }).join("");
  host.hidden = false;
  host.innerHTML = `<div class="overdue-head"><strong>⚠ Reminder: ${items.length} tenant${items.length===1?" is":"s are"} past their checkout date</strong>
    <span>Check them out or extend their stay. Their beds stay marked Overdue until you do.</span></div>${rows}`;
}

async function checkoutBed(roomId, index){
  const room = rooms.find(r=>r.id===roomId);
  const bed = room && room.beds[index];
  if (!room || !bed || !bed.tenant) return;
  if (bed.temporaryClientId){
    alert("This is a temporary client. Check them out from the Temporary Dorm Clients tab.");
    return;
  }
  const reservedNote = bed.reservedFor ? " The reserved client will still move in on their check-in date." : "";
  if (!confirm("Check out " + bed.tenant + " from Room " + room.room + ", " + bed.slot + "?\n\nThe bed becomes vacant." + reservedNote +
    " Their record stays in Tenant History for " + HISTORY_DAYS + " days.")) return;
  const roomRef = userCollection("rooms").doc(roomId);
  try{
    await db.runTransaction(async transaction=>{
      const snap = await transaction.get(roomRef);
      if (!snap.exists) throw new Error("The room no longer exists.");
      const current = {id:snap.id,...snap.data()};
      const latest = current.beds[index];
      if (!latest || latest.tenant!==bed.tenant) throw new Error("This bed changed. Refresh and try again.");
      if (latest.temporaryClientId) throw new Error("This is a temporary client. Use the Temporary Dorm Clients tab.");
      const linked=prospects.find(item=>item.checkedIn&&!item.checkedOut&&item.reservedBed&&
        item.reservedBed.roomId===roomId&&item.reservedBed.slot===latest.slot);
      const linkedRef=linked?userCollection("prospects").doc(linked.id):null;
      const linkedSnap=linkedRef?await transaction.get(linkedRef):null;
      const beds = current.beds.slice();
      // reservedFor is kept on purpose so an incoming client still holds the bed.
      beds[index] = {...latest,tenant:null,start:null,end:null,residentType:"Student",residentGender:"Unspecified",temporaryClientId:null};
      transaction.update(roomRef,{beds});
      transaction.set(userCollection("tenant_history").doc(),makeHistoryEntry(current,latest,"Checked out"));
      if (linkedRef&&linkedSnap&&linkedSnap.exists&&linkedSnap.data().checkedIn&&!linkedSnap.data().checkedOut){
        transaction.update(linkedRef,{checkedOut:true,checkedOutAt:sqlServerTimestamp()});
      }
    });
  }catch(error){
    console.error("Bed checkout failed",error);
    alert("Checkout failed: " + error.message);
  }
}

function openExtendModal(roomId, index){
  const room = rooms.find(r=>r.id===roomId);
  const bed = room && room.beds[index];
  if (!room || !bed || !bed.tenant) return;
  if (bed.temporaryClientId){
    alert("Temporary stays are managed in the Temporary Dorm Clients tab.");
    return;
  }
  extendState = {roomId,index,tenant:bed.tenant};
  document.getElementById("extendSummary").textContent =
    bed.tenant + " · Room " + room.room + ", " + bed.slot + " · current checkout " + fmtDate(bed.end);
  document.getElementById("extendNewEnd").value = "";
  const box = document.getElementById("extendReservationBox");
  const check = document.getElementById("extendCancelReservation");
  check.checked = false;
  if (bed.reservedFor){
    const p = prospects.find(item=>item.id===bed.reservedFor);
    document.getElementById("extendReservationText").textContent =
      "⚠ " + (p ? p.name : "A client") + " is reserved for this bed" + (p ? " and arrives " + fmtDate(p.checkIn) : "") +
      ". If " + bed.tenant + " stays longer, that reservation has to be cancelled. The client goes back to “Searching” on the Reserve Clients tab so you can choose another bed.";
    box.hidden = false;
  } else {
    box.hidden = true;
  }
  document.getElementById("extendModalBackdrop").classList.add("open");
}

function closeExtendModal(){
  document.getElementById("extendModalBackdrop").classList.remove("open");
  extendState = null;
}

async function saveExtend(){
  if (!extendState) return;
  const state = extendState;
  const room = rooms.find(r=>r.id===state.roomId);
  const bed = room && room.beds[state.index];
  if (!room || !bed || bed.tenant!==state.tenant){ alert("This bed changed. Close this window and try again."); return; }
  const newEnd = isoLocalDateTime(document.getElementById("extendNewEnd").value);
  if (!newEnd){ alert("Choose the new checkout date and time."); return; }
  const oldEndDate = parseScheduleDate(bed.end,true);
  if (oldEndDate && parseScheduleDate(newEnd) <= oldEndDate){
    alert("The new checkout must be later than the current checkout (" + fmtDate(bed.end) + ").");
    return;
  }
  const cancelReservation = document.getElementById("extendCancelReservation").checked;
  if (bed.reservedFor && !cancelReservation){
    alert("This bed has a reservation. Tick the box to cancel it, or close this window to keep the current checkout.");
    return;
  }
  const roomRef = userCollection("rooms").doc(state.roomId);
  try{
    await db.runTransaction(async transaction=>{
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists) throw new Error("The room no longer exists.");
      const current = roomSnap.data();
      const latest = current.beds[state.index];
      if (!latest || latest.tenant!==state.tenant) throw new Error("This bed changed. Close this window and try again.");
      if (latest.temporaryClientId) throw new Error("This is a temporary client. Use the Temporary Dorm Clients tab.");
      const reservedId = latest.reservedFor || null;
      if (reservedId && !cancelReservation) throw new Error("A reservation was added to this bed while this window was open. Try again.");
      let prospectRef = null, prospectSnap = null;
      if (reservedId){
        prospectRef = userCollection("prospects").doc(reservedId);
        prospectSnap = await transaction.get(prospectRef);
      }
      let beds = current.beds.map((b,i)=>i===state.index ? {...b,end:newEnd} : b);
      if (reservedId) beds = beds.map(b=>b.reservedFor===reservedId ? {...b,reservedFor:null} : b);
      transaction.update(roomRef,{beds});
      if (prospectSnap && prospectSnap.exists) transaction.update(prospectRef,{reservedBed:null});
    });
    closeExtendModal();
  }catch(error){
    console.error("Extend stay failed",error);
    alert("Could not extend the stay: " + error.message);
  }
}

/* ============================= TENANT HISTORY (kept 30 days) ============================= */

function renderHistory(){
  const host = document.getElementById("historyList");
  if (!host) return;
  if (!tenantHistory.length){
    host.innerHTML = `<div class="empty-note">No tenants have left in the last ${HISTORY_DAYS} days.</div>`;
    return;
  }
  const toDate = value => value && typeof value.toDate === "function" ? value.toDate() : null;
  const rows = tenantHistory.map(item=>{
    const left = toDate(item.leftAt);
    const expires = toDate(item.expireAt);
    const daysLeft = expires ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / DAY_MS)) : null;
    return `<tr>
      <td><strong>${escapeHtml(item.tenant)}</strong></td>
      <td>Room ${escapeHtml(item.room)} · ${escapeHtml(item.slot)}</td>
      <td>${fmtDate(item.start)} → ${fmtDate(item.end)}</td>
      <td>${left ? left.toLocaleString([], {month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit"}) : "just now"}</td>
      <td>${escapeHtml(item.reason||"")}</td>
      <td>${daysLeft===null ? "—" : daysLeft + " day" + (daysLeft===1?"":"s")}</td>
    </tr>`;
  }).join("");
  host.innerHTML = `<div class="matrix-scroll"><table class="history-table">
    <thead><tr><th>Tenant</th><th>Room · Bed</th><th>Stay</th><th>Left on</th><th>What happened</th><th>Deleted in</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// Deletes history older than 30 days. Runs at most once an hour while the app is open.
async function purgeExpiredHistory(){
  if (!db || !currentUser || !currentUser.uid) return;
  if (Date.now() - lastHistoryPurge < 3600000) return;
  lastHistoryPurge = Date.now();
  const snap = await userCollection("tenant_history")
    .where("expireAt","<=",sqlTimestamp.now()).limit(200).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach(doc=>batch.delete(doc.ref));
  await batch.commit();
}
