const ASSISTANT_ENDPOINT = "/api/assistant";

let assistantPendingAction = null;
let assistantBusy = false;
let assistantRequestController = null;

function resetAssistantForUserChange(){
  if (assistantRequestController) assistantRequestController.abort();
  assistantRequestController = null;
  assistantPendingAction = null;
  assistantBusy = false;
  const messages = document.getElementById("assistantMessages");
  if (messages){
    const greeting = messages.querySelector(".assistant-message:not(.user)");
    messages.querySelectorAll(".assistant-message,.assistant-action").forEach(message=>{
      if (message !== greeting) message.remove();
    });
  }
  const input = document.getElementById("assistantInput");
  if (input){
    input.value = "";
    input.disabled = false;
  }
  const sendButton = document.getElementById("assistantSendBtn");
  if (sendButton){
    sendButton.disabled = false;
    sendButton.innerHTML = '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>';
  }
  const status = document.getElementById("assistantStatus");
  if (status){
    status.textContent = "";
    status.classList.remove("error");
  }
  const panel = document.getElementById("assistantPanel");
  const greeting = document.getElementById("assistantGreeting");
  const launcher = document.getElementById("assistantLauncher");
  if (panel) panel.hidden = true;
  if (greeting) greeting.hidden = false;
  if (launcher){
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Open dorm assistant");
  }
}

function initializeAssistantWidget(){
  const panel = document.getElementById("assistantPanel");
  const launcher = document.getElementById("assistantLauncher");
  const greeting = document.getElementById("assistantGreeting");
  const form = document.getElementById("assistantForm");
  const input = document.getElementById("assistantInput");
  const sendButton = document.getElementById("assistantSendBtn");
  const status = document.getElementById("assistantStatus");
  const setOpen = isOpen=>{
    panel.hidden = !isOpen;
    greeting.hidden = isOpen;
    launcher.setAttribute("aria-expanded", String(isOpen));
    launcher.setAttribute("aria-label", isOpen ? "Close dorm assistant" : "Open dorm assistant");
    if (isOpen) input.focus();
  };
  launcher.addEventListener("click", ()=>setOpen(panel.hidden));
  document.getElementById("assistantCloseBtn").addEventListener("click", ()=>setOpen(false));
  document.addEventListener("keydown", event=>{
    if (event.key === "Escape" && !panel.hidden) setOpen(false);
  });
  form.addEventListener("submit", event=>{
    event.preventDefault();
    sendAssistantMessage().catch(error=>{
      console.error("Assistant request failed", error);
      setAssistantStatus("The assistant request failed: " + error.message, true);
      setAssistantBusy(false);
    });
  });

  function setAssistantStatus(message, isError=false){
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function setAssistantBusy(isBusy){
    assistantBusy = isBusy;
    input.disabled = isBusy || Boolean(assistantPendingAction);
    sendButton.disabled = isBusy || Boolean(assistantPendingAction);
    sendButton.innerHTML = isBusy
      ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>'
      : '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>';
  }

  function appendAssistantMessage(text, speaker="assistant"){
    const row = document.createElement("div");
    row.className = "assistant-message" + (speaker === "user" ? " user" : "");
    if (speaker !== "user"){
      const avatar = document.createElement("span");
      avatar.className = "assistant-message-avatar";
      avatar.setAttribute("aria-hidden", "true");
      avatar.innerHTML = '<i class="fa-solid fa-sparkles"></i>';
      row.appendChild(avatar);
    }
    const message = document.createElement("p");
    message.textContent = text;
    row.appendChild(message);
    document.getElementById("assistantMessages").appendChild(row);
    row.scrollIntoView({block:"nearest"});
    return row;
  }

  function appendAssistantAction(action){
    const card = document.createElement("div");
    card.className = "assistant-action";
    const title = document.createElement("strong");
    title.textContent = "Confirm this tracker change";
    const description = document.createElement("p");
    description.textContent = describeAssistantAction(action);
    const controls = document.createElement("div");
    controls.className = "assistant-action-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "confirm";
    confirm.textContent = "Confirm";
    controls.append(cancel, confirm);
    card.append(title, description, controls);
    document.getElementById("assistantMessages").appendChild(card);
    card.scrollIntoView({block:"nearest"});

    assistantPendingAction = {action, card, uid:currentUser.uid};
    setAssistantBusy(false);
    cancel.addEventListener("click", ()=>{
      assistantPendingAction = null;
      card.remove();
      setAssistantBusy(false);
      appendAssistantMessage("Okay, I cancelled that change.");
      setAssistantStatus("No tracker changes were made.");
    });
    confirm.addEventListener("click", async ()=>{
      if (!assistantPendingAction || assistantPendingAction.card !== card) return;
      const actionUid = assistantPendingAction.uid;
      if (!currentUser || currentUser.uid !== actionUid) return;
      cancel.disabled = true;
      confirm.disabled = true;
      confirm.textContent = "Working…";
      setAssistantBusy(true);
      setAssistantStatus("Applying the confirmed change…");
      try{
        await applyAssistantAction(action, actionUid);
        if (!currentUser || currentUser.uid !== actionUid) return;
        appendAssistantMessage("I sent the confirmed change through the tracker’s existing workflow. Check the app for its saved record or any validation message.");
        setAssistantStatus("Confirmed action submitted.");
      }catch(error){
        if (!currentUser || currentUser.uid !== actionUid) return;
        console.error("Confirmed assistant action failed", error);
        appendAssistantMessage("I couldn’t complete that change: " + error.message);
        setAssistantStatus("The change was not completed.", true);
      }finally{
        if (assistantPendingAction && assistantPendingAction.card === card){
          assistantPendingAction = null;
          card.remove();
          setAssistantBusy(false);
        }
      }
    });
  }

  async function sendAssistantMessage(){
    if (assistantBusy || assistantPendingAction) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    appendAssistantMessage(text, "user");
    if (!currentUser || !currentUser.uid){
      appendAssistantMessage("Please sign in to ask about live tracker data or make changes.");
      setAssistantStatus("Sign in is required for private tracker data.", true);
      return;
    }
    if (db && !Object.values(assistantDataLoaded).every(Boolean)){
      appendAssistantMessage("Your tracker data is still loading. Please try again in a moment.");
      setAssistantStatus("Waiting for the signed-in account’s live data.", true);
      return;
    }

    setAssistantBusy(true);
    setAssistantStatus("Checking your question and current tracker data…");
    const pending = appendAssistantMessage("Thinking…");
    pending.classList.add("pending");
    const requestUid = currentUser.uid;
    const controller = new AbortController();
    assistantRequestController = controller;
    try{
      const timeout = setTimeout(()=>controller.abort(), 65000);
      let response;
      const token = await auth.currentUser.getIdToken();
      if (!currentUser || currentUser.uid !== requestUid) return;
      try{
        response = await fetch(ASSISTANT_ENDPOINT, {
          method:"POST",
          headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
          signal:controller.signal,
          body:JSON.stringify({question:text})
        });
      }finally{
        clearTimeout(timeout);
      }
      if (!currentUser || currentUser.uid !== requestUid) return;
      const result = await response.json();
      if (!currentUser || currentUser.uid !== requestUid) return;
      if (!response.ok) throw new Error(result.error || "Assistant service returned HTTP " + response.status + ".");
      const answer = result;
      if (typeof answer.response !== "string" || !["tracker","unrelated","uncertain"].includes(answer.scope)){
        throw new Error("The assistant service returned an invalid answer. Please try again.");
      }
      pending.remove();
      if (answer.scope === "unrelated"){
        appendAssistantMessage("I can help with this Dorm Vacancy Tracker—its features, records, and workflows. I can’t help with unrelated questions.");
        setAssistantStatus("This assistant is limited to the vacancy tracker.");
      }else if (answer.scope === "uncertain"){
        appendAssistantMessage(answer.response || "I can’t verify that from the tracker. Could you clarify what screen or record you mean?");
        setAssistantStatus("I couldn’t verify enough tracker information to answer.");
      }else{
        appendAssistantMessage(answer.response);
        if (answer.action && answer.action.type && answer.action.type !== "none"){
          const validation = validateAssistantAction(answer.action);
          if (validation){
            appendAssistantMessage(validation);
            setAssistantStatus("No changes were made; I need more specific information.");
          }else{
            appendAssistantAction(answer.action);
            setAssistantStatus("Review the proposed change. Nothing is written until you confirm.");
          }
        }else{
          setAssistantStatus("Answer based on the current tracker and its features.");
        }
      }
    }catch(error){
      pending.remove();
      if (!currentUser || currentUser.uid !== requestUid) return;
      let message;
      if (error.name === "AbortError"){
        message = "The assistant took too long to respond. Please try again.";
      }else if (error instanceof TypeError){
        message = "I can’t reach the assistant service. Check your connection and try again.";
      }else{
        message = error.message;
      }
      appendAssistantMessage(message);
      setAssistantStatus(message, true);
    }finally{
      if (assistantRequestController === controller){
        assistantRequestController = null;
        setAssistantBusy(false);
      }
    }
  }

  setAssistantStatus("Deploy the Python tracker assistant to enable chat.");
}

function validateAssistantAction(action){
  if (!action || typeof action !== "object" || typeof action.type !== "string") return "I couldn’t understand the requested tracker change. Please describe it another way.";
  if (!currentUser || !currentUser.uid || !db) return "Please sign in before making tracker changes.";
  const fail = message=>message;
  const has = (object,key)=>typeof object[key]==="string" && object[key].trim().length>0;
  switch(action.type){
    case "create_room":
      if (!has(action,"room")) return fail("What room name or number should I use?");
      if (!Number.isInteger(action.capacity) || action.capacity<1 || action.capacity>20) return fail("Please specify a room capacity from 1 to 20 beds.");
      if (action.roomType !== undefined && !["Room","Bedspacer"].includes(action.roomType)) return fail("Choose Room or Bedspacer for the room type.");
      if (!["Male","Female","Mixed"].includes(action.gender) || !["Students","Reviewees","Mixed"].includes(action.demographic) || !["Bedspace","Whole Room"].includes(action.tenancyMode)) return fail("I need valid room gender, resident-group zoning, and tenancy-mode details before proposing this room.");
      if (action.beds !== undefined && (!Array.isArray(action.beds) || action.beds.length>action.capacity)) return fail("The room's bed details do not match its capacity.");
      if (Array.isArray(action.beds) && action.beds.some(bed=>bed && ((bed.residentType!==undefined && !["Student","Reviewee","Temporary"].includes(bed.residentType)) || (bed.residentGender!==undefined && !["Unspecified","Male","Female"].includes(bed.residentGender))))) return fail("One or more bed details contain an unsupported resident group or gender.");
      break;
    case "edit_room":{
      if (!has(action,"roomId") || !action.changes || typeof action.changes!=="object") return fail("Which room should I edit, and what should change?");
      {
        const matches = rooms.filter(room=>room.id===action.roomId || String(room.room)===action.roomId);
        if (matches.length!==1) return fail("I can’t identify that room uniquely. Please specify its room number.");
        if (!Object.keys(action.changes).length) return fail("Please specify at least one room field to change.");
        const allowed = new Set(["room","type","gender","demographic","tenancyMode","capacity","bedChanges"]);
        if (Object.keys(action.changes).some(key=>!allowed.has(key))) return fail("I can’t safely apply those room changes. Please request supported room or bed fields.");
        if (action.changes.type!==undefined && !["Room","Bedspacer"].includes(action.changes.type)) return fail("Choose Room or Bedspacer for the room type.");
        if (action.changes.gender!==undefined && !["Male","Female","Mixed"].includes(action.changes.gender)) return fail("Room gender must be Male, Female, or Mixed.");
        if (action.changes.demographic!==undefined && !["Students","Reviewees","Mixed"].includes(action.changes.demographic)) return fail("Resident-group zoning must be Students, Reviewees, or Mixed.");
        if (action.changes.tenancyMode!==undefined && !["Bedspace","Whole Room"].includes(action.changes.tenancyMode)) return fail("Tenancy mode must be Bedspace or Whole Room.");
        if (action.changes.capacity!==undefined && (!Number.isInteger(action.changes.capacity) || action.changes.capacity<1 || action.changes.capacity>20)) return fail("Room capacity must be from 1 to 20 beds.");
        if (action.changes.room!==undefined && (typeof action.changes.room!=="string" || !action.changes.room.trim())) return fail("Room name cannot be blank.");
        if (action.changes.bedChanges!==undefined){
          if (!Array.isArray(action.changes.bedChanges)) return fail("Bed changes must identify specific beds.");
          const room = matches[0];
          const slots = new Set(room.beds.map(bed=>bed.slot));
          const seen = new Set();
          for (const bed of action.changes.bedChanges){
            if (!bed || !slots.has(bed.slot) || seen.has(bed.slot)) return fail("Each bed change must refer to a different existing bed.");
            seen.add(bed.slot);
            if (Object.keys(bed).some(key=>!["slot","tenant","residentType","residentGender","start","end"].includes(key))) return fail("A bed change contains an unsupported field.");
            if (bed.residentType!==undefined && !["Student","Reviewee","Temporary"].includes(bed.residentType)) return fail("Choose Student, Reviewee, or Temporary as the resident group.");
            if (bed.residentGender!==undefined && !["Unspecified","Male","Female"].includes(bed.residentGender)) return fail("Choose Unspecified, Male, or Female as the resident gender.");
            if (bed.tenant!==undefined && bed.tenant!==null && typeof bed.tenant!=="string") return fail("Bed occupant must be a name or null.");
          }
        }
      }
      break;
    }
    case "delete_room":
      if (!has(action,"roomId") || !rooms.some(room=>room.id===action.roomId || String(room.room)===action.roomId)) return fail("I can’t identify that room. Please specify its room number.");
      break;
    case "add_reserve_client":
      if (!has(action,"name") || !has(action,"checkIn") || !["Male","Female","Any"].includes(action.gender) || !["Student","Reviewee"].includes(action.demographic)) return fail("To add a reserve client, I need a name, gender, resident group, and check-in date.");
      if (Boolean(action.roomId)!==Boolean(action.slot)) return fail("A preferred reservation needs both a room and a bed.");
      break;
    case "delete_reserve_client":
      if (!has(action,"prospectId") || !prospects.some(client=>client.id===action.prospectId)) return fail("I can’t identify that reserve client. Please specify their name.");
      break;
    case "add_temporary_client":
      if (!has(action,"name") || !has(action,"start") || !has(action,"end") || !["Male","Female","Mixed"].includes(action.gender) || !has(action,"roomId") || !has(action,"slot")) return fail("To assign a temporary client, I need their name, gender, check-in/out, and a specific compatible vacant bed.");
      if (parseScheduleDate(action.end,true) && parseScheduleDate(action.start) && parseScheduleDate(action.end,true)<=parseScheduleDate(action.start)) return fail("The temporary client's checkout must be later than check-in.");
      break;
    case "checkout_temporary_client":
      if (!has(action,"clientId") || !temporaryClients.some(client=>client.id===action.clientId && client.status!=="Checked out")) return fail("I can’t identify an active temporary client to check out.");
      break;
    case "transfer_resident":{
      if (!has(action,"sourceRoomId") || !has(action,"sourceSlot") || !has(action,"targetRoomId") || !has(action,"targetSlot")) return fail("Please specify the resident’s current bed and the destination bed.");
      const source = rooms.find(room=>room.id===action.sourceRoomId);
      const target = rooms.find(room=>room.id===action.targetRoomId);
      if (!source || !target || !source.beds.some(bed=>bed.slot===action.sourceSlot && bed.tenant)) return fail("I can’t verify that occupied source bed.");
      if (!target.beds.some(bed=>bed.slot===action.targetSlot)) return fail("I can’t verify the destination bed.");
      break;
    }
    case "confirm_reservation":{
      const prospect = prospects.find(item=>item.id===action.prospectId);
      const room = rooms.find(item=>item.id===action.roomId);
      if (!prospect || !room || !has(action,"slot")) return fail("I can’t verify the reserve client and target bed.");
      break;
    }
    case "cancel_reservation":{
      const prospect = prospects.find(item=>item.id===action.prospectId);
      if (!prospect || !prospect.reservedBed) return fail("I can’t find an active reservation to cancel.");
      break;
    }
    case "create_shape":
      if (!has(action,"label") || !["facility","walkway"].includes(action.kind) || !["rectangle","circle","triangle"].includes(action.geometry)) return fail("I need a label and a supported facility/walkway shape before creating it.");
      if (action.color!==undefined && !/^#[0-9a-f]{6}$/i.test(action.color)) return fail("Shape color must be a six-digit hex color.");
      break;
    case "edit_shape":{
      if (!has(action,"shapeId") || !action.changes || !shapes.some(shape=>shape.id===action.shapeId)) return fail("I can’t identify that hallway shape or the requested changes.");
      const allowed = new Set(["label","kind","geometry","color"]);
      if (!Object.keys(action.changes).length || Object.keys(action.changes).some(key=>!allowed.has(key))) return fail("I can only change the shape label, type, geometry, or color.");
      if (action.changes.kind!==undefined && !["facility","walkway"].includes(action.changes.kind)) return fail("Shape type must be facility or walkway.");
      if (action.changes.geometry!==undefined && !["rectangle","circle","triangle"].includes(action.changes.geometry)) return fail("Choose rectangle, circle, or triangle geometry.");
      if (action.changes.color!==undefined && !/^#[0-9a-f]{6}$/i.test(action.changes.color)) return fail("Shape color must be a six-digit hex color.");
      if (action.changes.label!==undefined && (typeof action.changes.label!=="string" || !action.changes.label.trim())) return fail("A shape label cannot be blank.");
      break;
    }
    case "delete_shape":
      if (!has(action,"shapeId") || !shapes.some(shape=>shape.id===action.shapeId)) return fail("I can’t identify that hallway shape to delete.");
      break;
    case "none":
      break;
    default:
      return fail("That tracker operation isn’t available through the assistant.");
  }
  return null;
}

function describeAssistantAction(action){
  const room = action.roomId && rooms.find(item=>item.id===action.roomId || String(item.room)===action.roomId);
  const prospect = action.prospectId && prospects.find(item=>item.id===action.prospectId);
  const client = action.clientId && temporaryClients.find(item=>item.id===action.clientId);
  const shape = action.shapeId && shapes.find(item=>item.id===action.shapeId);
  switch(action.type){
    case "create_room":
      return `Create room ${action.room}, capacity ${action.capacity}, ${action.gender}, ${action.demographic}, ${action.tenancyMode}.`;
    case "edit_room":
      return `Edit room ${room ? room.room : action.roomId}. Requested changes: ${JSON.stringify(action.changes)}.`;
    case "delete_room":
      return `Delete room ${room ? room.room : action.roomId}. The existing tracker will block deletion if residents, reservations, or temporary-client records remain.`;
    case "add_reserve_client":
      return `Add reserve client ${action.name}, ${action.gender} ${action.demographic}, check-in ${action.checkIn}${action.roomId ? `, preferred room ${rooms.find(item=>item.id===action.roomId)?.room||action.roomId} ${action.slot||""}` : ""}.`;
    case "delete_reserve_client":
      return `Delete reserve client ${prospect ? prospect.name : action.prospectId}.`;
    case "add_temporary_client":
      return `Add temporary client ${action.name}, assigned to room ${rooms.find(item=>item.id===action.roomId)?.room||action.roomId}, ${action.slot}, from ${action.start} to ${action.end}.`;
    case "checkout_temporary_client":
      return `Check out temporary client ${client ? client.name : action.clientId} and release their assigned bed.`;
    case "transfer_resident":{
      const sourceRoom = rooms.find(item=>item.id===action.sourceRoomId);
      const targetRoom = rooms.find(item=>item.id===action.targetRoomId);
      return `Transfer the resident in room ${sourceRoom ? sourceRoom.room : action.sourceRoomId}, ${action.sourceSlot}, to room ${targetRoom ? targetRoom.room : action.targetRoomId}, ${action.targetSlot}.`;
    }
    case "confirm_reservation":
      return `Confirm ${prospect ? prospect.name : "the reserve client"} for room ${rooms.find(item=>item.id===action.roomId)?.room||action.roomId}, ${action.slot}.`;
    case "cancel_reservation":
      return `Cancel the reservation for ${prospect ? prospect.name : action.prospectId}.`;
    case "create_shape":
      return `Add hallway ${action.kind} “${action.label}” as a ${action.geometry}.`;
    case "edit_shape":
      return `Edit hallway shape “${shape ? shape.label : action.shapeId}”: ${JSON.stringify(action.changes)}.`;
    case "delete_shape":
      return `Delete hallway shape “${shape ? shape.label : action.shapeId}”.`;
    default:
      return "Perform the requested tracker operation.";
  }
}

function findAssistantRoom(roomId){
  const matches = rooms.filter(room=>room.id===roomId || String(room.room)===String(roomId));
  if (matches.length!==1) throw new Error("The room name is missing or ambiguous; no changes were made.");
  return matches[0];
}

function assistantDateTimeValue(value){
  if (!value) return "";
  const date = parseScheduleDate(value);
  if (!date) throw new Error("A date could not be understood. Use an ISO date or date/time.");
  return toDateTimeInput(date.toISOString());
}

function assistantSetRoomForm(room, changes, isNew=false){
  const values = {
    room:changes.room ?? (room && room.room) ?? "",
    type:changes.type ?? (room && room.type) ?? "Room",
    gender:changes.gender ?? (room && room.gender) ?? "Mixed",
    demographic:changes.demographic ?? (room && room.demographic) ?? "Mixed",
    tenancyMode:changes.tenancyMode ?? (room && room.tenancyMode) ?? "Bedspace"
  };
  document.getElementById("rmRoomNumber").value = values.room;
  document.getElementById("rmType").value = values.type;
  document.getElementById("rmGender").value = values.gender;
  document.getElementById("rmDemographic").value = values.demographic;
  document.getElementById("rmTenancyMode").value = values.tenancyMode;
  const capacity = changes.capacity ?? (room ? room.beds.length : 4);
  if (!Number.isInteger(capacity) || capacity<1 || capacity>20) throw new Error("Room capacity must be between 1 and 20 beds.");
  setCapacity(capacity);
  const rows = Array.from(document.querySelectorAll("#bedsEditor .bed-edit-row"));
  const baseBeds = room ? room.beds : [];
  const bedChanges = Array.isArray(changes.bedChanges) ? changes.bedChanges : [];
  const initialBeds = Array.isArray(changes.beds) ? changes.beds : [];
  if (isNew && initialBeds.length>capacity) throw new Error("Room bed details cannot exceed its capacity.");
  if (!isNew && bedChanges.some(edit=>!room.beds.some(bed=>bed.slot===edit.slot))) throw new Error("One of the specified beds no longer exists.");
  rows.forEach((row,index)=>{
    const old = baseBeds[index] || {};
    let next = isNew ? (initialBeds[index] || {}) : {};
    if (!isNew){
      const slot = old.slot || "Bed " + (index+1);
      const edits = bedChanges.filter(item=>item.slot===slot);
      if (edits.length>1) throw new Error("A bed change refers to the same bed more than once.");
      next = edits[0] || {};
    }
    const tenant = Object.prototype.hasOwnProperty.call(next,"tenant") ? next.tenant : old.tenant;
    row.querySelector(".be-tenant").value = tenant || "";
    row.querySelector(".be-demographic").value = next.residentType || old.residentType || "Student";
    row.querySelector(".be-gender").value = next.residentGender || old.residentGender || "Unspecified";
    row.querySelector(".be-start").value = assistantDateTimeValue(Object.prototype.hasOwnProperty.call(next,"start") ? next.start : old.start);
    row.querySelector(".be-end").value = assistantDateTimeValue(Object.prototype.hasOwnProperty.call(next,"end") ? next.end : old.end);
  });
}

async function applyAssistantAction(action, expectedUid=currentUser && currentUser.uid){
  const invalid = validateAssistantAction(action);
  if (invalid) throw new Error(invalid);
  if (!currentUser || !currentUser.uid || currentUser.uid !== expectedUid) throw new Error("Your sign-in expired. Sign in again before applying a change.");

  switch(action.type){
    case "create_room":{
      openRoomModal(null);
      assistantSetRoomForm(null,{...action,type:action.roomType||"Room"},true);
      await saveRoom();
      if (document.getElementById("roomModalBackdrop").classList.contains("open")) throw new Error("The room was not saved. Review the room form validation message.");
      return;
    }
    case "edit_room":{
      const room = findAssistantRoom(action.roomId);
      openRoomModal(room.id);
      assistantSetRoomForm(room,action.changes);
      await saveRoom();
      if (document.getElementById("roomModalBackdrop").classList.contains("open")) throw new Error("The room was not saved. Review the room form validation message.");
      return;
    }
    case "delete_room":{
      const room = findAssistantRoom(action.roomId);
      await deleteRoom(room.id);
      return;
    }
    case "add_reserve_client":{
      document.getElementById("pName").value = action.name;
      document.getElementById("pGender").value = action.gender;
      document.getElementById("pDemographic").value = action.demographic;
      document.getElementById("pCheckIn").value = assistantDateTimeValue(action.checkIn);
      document.getElementById("pCheckOut").value = assistantDateTimeValue(action.checkOut);
      document.getElementById("pNotes").value = action.notes || "";
      refreshBedTargetSelectors();
      if (action.roomId || action.slot){
        const room = findAssistantRoom(action.roomId);
        const bed = room.beds.find(item=>item.slot===action.slot);
        if (!bed) throw new Error("The preferred bed was not found; no reserve client was added.");
        const option = Array.from(document.getElementById("pDesiredBed").options)
          .find(item=>JSON.parse(item.value || "[]")[0]===room.id && JSON.parse(item.value || "[]")[1]===room.beds.indexOf(bed));
        if (!option) throw new Error("That bed is not currently an eligible upcoming-checkout match; no reserve client was added.");
        document.getElementById("pDesiredBed").value = option.value;
      }
      await addProspect();
      return;
    }
    case "delete_reserve_client":
      await deleteProspect(action.prospectId);
      return;
    case "add_temporary_client":{
      const room = findAssistantRoom(action.roomId);
      const index = room.beds.findIndex(item=>item.slot===action.slot);
      if (index<0) throw new Error("The specified bed was not found; no temporary client was added.");
      document.getElementById("tName").value = action.name;
      document.getElementById("tGender").value = action.gender;
      document.getElementById("tStart").value = assistantDateTimeValue(action.start);
      document.getElementById("tEnd").value = assistantDateTimeValue(action.end);
      document.getElementById("tNotes").value = action.notes || "";
      refreshBedTargetSelectors();
      const targetValue = JSON.stringify([room.id,index]);
      const target = Array.from(document.getElementById("tTargetBed").options).find(option=>option.value===targetValue);
      if (!target) throw new Error("That bed is no longer vacant or compatible; no temporary client was added.");
      document.getElementById("tTargetBed").value = targetValue;
      await addTemporaryClient();
      return;
    }
    case "checkout_temporary_client":
      await checkoutTemporaryClient(action.clientId);
      return;
    case "transfer_resident":{
      const source = findAssistantRoom(action.sourceRoomId);
      const target = findAssistantRoom(action.targetRoomId);
      const sourceIndex = source.beds.findIndex(bed=>bed.slot===action.sourceSlot);
      const targetIndex = target.beds.findIndex(bed=>bed.slot===action.targetSlot);
      if (sourceIndex<0 || targetIndex<0) throw new Error("The specified source or target bed no longer exists.");
      openTransferModal(source.id,sourceIndex);
      const targetValue = JSON.stringify([target.id,targetIndex]);
      const select = document.getElementById("transferTarget");
      if (!Array.from(select.options).some(option=>option.value===targetValue)) throw new Error("That target bed is no longer vacant or compatible.");
      select.value = targetValue;
      await confirmBedTransfer();
      return;
    }
    case "confirm_reservation":
      await confirmReservation(action.prospectId,action.roomId,action.slot);
      return;
    case "cancel_reservation":
      await cancelReservation(action.prospectId);
      return;
    case "create_shape":
      openShapeModal(null);
      document.getElementById("shapeLabel").value = action.label;
      document.getElementById("shapeKind").value = action.kind;
      document.getElementById("shapeGeometry").value = action.geometry;
      document.getElementById("shapeColor").value = /^#[0-9a-f]{6}$/i.test(action.color||"") ? action.color : "#dce8e4";
      await saveShape();
      return;
    case "edit_shape":
      openShapeModal(action.shapeId);
      if (Object.prototype.hasOwnProperty.call(action.changes,"label")) document.getElementById("shapeLabel").value = action.changes.label;
      if (Object.prototype.hasOwnProperty.call(action.changes,"kind")) document.getElementById("shapeKind").value = action.changes.kind;
      if (Object.prototype.hasOwnProperty.call(action.changes,"geometry")) document.getElementById("shapeGeometry").value = action.changes.geometry;
      if (/^#[0-9a-f]{6}$/i.test(action.changes.color||"")) document.getElementById("shapeColor").value = action.changes.color;
      await saveShape();
      return;
    case "delete_shape":
      openShapeModal(action.shapeId);
      await deleteShape();
      return;
    default:
      throw new Error("That tracker operation is not supported.");
  }
}
