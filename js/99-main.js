// js/99-main.js — Tabs, button wiring and the final boot() call (must load last)
/* ============================= TAB / NAV WIRING ============================= */

function updateTopbarTitle(){
  const title = document.getElementById("topbarTitle");
  const tab = document.querySelector('nav.tabs button[data-tab="' + activeTab + '"]');
  if (!title || !tab) return;
  // Use only the button's own text so badges ("! 3", counters) are not included
  const label = Array.from(tab.childNodes)
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent)
    .join("").trim();
  if (label && title.textContent !== label){
    title.textContent = label;
    document.title = label + " · Vacancy Tracker";
  }
}

function renderActive(){
  updateTopbarTitle();
  renderSharedOverview();
  switch(activeTab){
    case "dashboard": renderDashboard(); break;
    case "reminders": renderOverduePanel(); break;
    case "hallway": renderHallway(); applySharedHallwayFilters(); break;
    case "analytics": renderAnalytics(); break;
    case "matrix": renderMatrix(); break;
    case "calendar": renderCalendar(); break;
    case "reserve": renderReserve(); break;
    case "temporary": renderTemporaryClients(); break;
    case "history": renderHistory(); break;
    case "viewers": renderViewerAccess(); break;
    case "central": renderCentralLink(); break;
  }
}

function switchTab(tab){
  activeTab = tab;
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("active", b.dataset.tab===tab));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active", v.id==="view-"+tab));
  renderActive();
}

function wireStaticUI(){
  initializeAssistantWidget();

  document.querySelectorAll("nav.tabs button").forEach(b=>{
    b.addEventListener("click", ()=>switchTab(b.dataset.tab));
  });

  document.getElementById("addRoomBtn").addEventListener("click", ()=>openRoomModal(null));
  document.getElementById("addRoomBtn2").addEventListener("click", ()=>openRoomModal(null));
  document.getElementById("layoutLockBtn").addEventListener("click", ()=>{
    layoutLocked = !layoutLocked;
    renderHallway();
  });
  document.getElementById("addShapeBtn").addEventListener("click", ()=>openShapeModal(null));
  document.getElementById("editShapeBtn").addEventListener("click", ()=>{
    if (selectedShapeId) openShapeModal(selectedShapeId);
  });
  document.getElementById("closeShapeModal").addEventListener("click", closeShapeModal);
  document.getElementById("cancelShapeModal").addEventListener("click", closeShapeModal);
  document.getElementById("saveShapeBtn").addEventListener("click", saveShape);
  document.getElementById("deleteShapeBtn").addEventListener("click", deleteShape);
  document.getElementById("shapeModalBackdrop").addEventListener("click", e=>{ if (e.target.id==="shapeModalBackdrop") closeShapeModal(); });
  document.getElementById("importSeedBtn").addEventListener("click", importSeedData);
  if (!Array.isArray(window.SEED_ROOMS)) document.getElementById("importSeedBtn").style.display = "none";
  document.getElementById("closeExtendModal").addEventListener("click", closeExtendModal);
  document.getElementById("cancelExtendModal").addEventListener("click", closeExtendModal);
  document.getElementById("saveExtendBtn").addEventListener("click", saveExtend);
  document.getElementById("extendModalBackdrop").addEventListener("click", e=>{ if (e.target.id==="extendModalBackdrop") closeExtendModal(); });
  document.getElementById("closeRoomModal").addEventListener("click", closeRoomModal);
  document.getElementById("cancelRoomModal").addEventListener("click", closeRoomModal);
  document.getElementById("saveRoomBtn").addEventListener("click", saveRoom);
  document.getElementById("roomModalBackdrop").addEventListener("click", e=>{ if (e.target.id==="roomModalBackdrop") closeRoomModal(); });
  document.getElementById("closeTransferModal").addEventListener("click",closeTransferModal);
  document.getElementById("cancelTransferModal").addEventListener("click",closeTransferModal);
  document.getElementById("confirmTransferBtn").addEventListener("click",confirmBedTransfer);
  document.getElementById("transferModalBackdrop").addEventListener("click",e=>{if(e.target.id==="transferModalBackdrop")closeTransferModal();});

  ["filterGender","filterVacancy","filterDemographic"].forEach(id=>document.getElementById(id).addEventListener("change", renderActive));
  document.getElementById("filterSearch").addEventListener("input", renderActive);

  document.getElementById("addProspectBtn").addEventListener("click", addProspect);
  document.getElementById("scanProspectsBtn").addEventListener("click", scanReserveVacancies);
  ["pGender","pDemographic","pCheckIn"].forEach(id=>document.getElementById(id).addEventListener("input",refreshBedTargetSelectors));
  ["pGender","pDemographic"].forEach(id=>document.getElementById(id).addEventListener("change",refreshBedTargetSelectors));
  document.getElementById("tGender").addEventListener("change",refreshBedTargetSelectors);
  document.getElementById("addTemporaryBtn").addEventListener("click",addTemporaryClient);

  document.addEventListener("click", event=>{
    const button=event.target.closest("[data-canvas-action]");
    if (!button) return;
    const action=button.dataset.canvasAction;
    if (action==="edit-room"){
      openRoomModal(button.dataset.room);
    } else if (action==="move" || action==="checkout" || action==="extend"){
      const [roomId,index]=JSON.parse(button.dataset.bed);
      if (action==="move") openTransferModal(roomId,index);
      else if (action==="extend") openExtendModal(roomId,index);
      else {
        const room=rooms.find(item=>item.id===roomId);
        const bed=room&&room.beds[index];
        if (bed&&bed.temporaryClientId) checkoutTemporaryClient(bed.temporaryClientId);
        else checkoutBed(roomId,index);
      }
    } else if (action==="temporary-checkout"){
      checkoutTemporaryClient(button.dataset.client);
    } else if (action==="inspect"){
      const room=rooms.find(item=>item.id===button.dataset.room);
      document.getElementById("filterSearch").value=room?room.room:"";
      switchTab("dashboard");
      window.scrollTo({top:0,behavior:"smooth"});
    } else if (action==="checkout-goto"){
      calOffset=Number(button.dataset.offset);
      checkoutPickerOpen=false;
      renderCalendar();
    } else if (action==="cal-day"){
      calSel=button.dataset.key;
      renderCalendar();
    } else if (action==="checkout-nav"){
      calOffset+=Number(button.dataset.delta);
      checkoutPickerOpen=false;
      renderCalendar();
    } else if (action==="checkout-active"){
      const first=checkoutItems().find(item=>item.date>=new Date(new Date().getFullYear(),new Date().getMonth(),1));
      const date=first?first.date:new Date();
      calOffset=(date.getFullYear()-new Date().getFullYear())*12+date.getMonth()-new Date().getMonth();
      checkoutPickerOpen=false;
      renderCalendar();
    } else if (action==="checkout-picker"){
      checkoutPickerOpen=!checkoutPickerOpen;
      renderCalendar();
    } else if (action==="checkout-filter"){
      checkoutProximity=button.dataset.filter;
      renderCalendar();
    } else if (action==="scan-reserve"){
      document.getElementById("pDesiredBed").value=button.dataset.target;
      button.textContent="Selected";
      button.disabled=true;
    } else if (action==="scan-checkin"){
      checkInScannedProspect(button.dataset.room,Number(button.dataset.index));
    }
  });
  document.addEventListener("change", event=>{
    if (event.target.id==="checkoutMonthPicker"&&event.target.value){
      const [year,month]=event.target.value.split("-").map(Number);
      const now=new Date();
      calOffset=(year-now.getFullYear())*12+(month-1)-now.getMonth();
      checkoutPickerOpen=false;
      renderCalendar();
    }
  });
  document.addEventListener("dragstart", event=>{
    const source=event.target.closest("[data-canvas-drag]");
    if (!source||event.target.closest("button")) return;
    canvasDraggedBed=JSON.parse(source.dataset.canvasDrag);
    event.dataTransfer.effectAllowed="move";
    event.dataTransfer.setData("text/plain",source.dataset.canvasDrag);
  });
  document.addEventListener("dragover", event=>{
    const target=event.target.closest("[data-canvas-drop]");
    if (!target||!canvasDraggedBed) return;
    event.preventDefault();
    target.classList.add("dragover");
  });
  document.addEventListener("dragleave", event=>{
    const target=event.target.closest("[data-canvas-drop]");
    if (target&&!target.contains(event.relatedTarget)) target.classList.remove("dragover");
  });
  document.addEventListener("drop", event=>{
    const target=event.target.closest("[data-canvas-drop]");
    if (!target||!canvasDraggedBed) return;
    event.preventDefault();
    const [targetRoomId,targetIndex]=JSON.parse(target.dataset.canvasDrop);
    const [sourceRoomId,sourceIndex]=canvasDraggedBed;
    const sourceRoom=rooms.find(room=>room.id===sourceRoomId);
    const targetRoom=rooms.find(room=>room.id===targetRoomId);
    const sourceBed=sourceRoom&&sourceRoom.beds[sourceIndex];
    const targetBed=targetRoom&&targetRoom.beds[targetIndex];
    if (sourceRoom&&targetRoom&&sourceBed&&targetBed&&targetRoom.id!==sourceRoom.id&&
        !sourceBed.reservedFor&&bedCanHost(targetRoom,targetBed,sourceBed.residentType||
        (sourceRoom.demographic==="Reviewees"?"Reviewee":"Student"),residentGenderForBed(sourceRoom,sourceBed))){
      openTransferModal(sourceRoomId,sourceIndex);
      const targetSelect=document.getElementById("transferTarget");
      const value=JSON.stringify([targetRoomId,targetIndex]);
      if (Array.from(targetSelect.options).some(option=>option.value===value)) targetSelect.value=value;
      else closeTransferModal();
    }
    target.classList.remove("dragover");
    canvasDraggedBed=null;
  });
  document.addEventListener("dragend",()=>{
    canvasDraggedBed=null;
    document.querySelectorAll(".canvas-bed.dragover").forEach(target=>target.classList.remove("dragover"));
  });
  const hallwayFilterObserver=new MutationObserver(()=>{
    if (activeTab==="hallway") applySharedHallwayFilters();
  });
  hallwayFilterObserver.observe(document.getElementById("hallwayCanvas"),{childList:true});

document.getElementById("addRoomBtn").addEventListener("click", ()=>{ editingRoomId = null; editingRoomBaseline = null; openRoomModal(null); });
document.getElementById("addRoomBtn2").addEventListener("click", ()=>{ editingRoomId = null; editingRoomBaseline = null; openRoomModal(null); });
}

boot();
