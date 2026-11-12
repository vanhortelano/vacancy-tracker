// js/09-hallway.js — Hallway layout: facilities, shapes, drag and resize
/* ============================= FACILITY / SHAPE MODAL ============================= */

function openShapeModal(shapeId){
  const shape = shapeId ? shapes.find(item=>item.id===shapeId) : null;
  editingShapeId = shape ? shape.id : null;
  document.getElementById("shapeModalTitle").textContent = shape ? "Edit " + shape.label : "Add Facility / Shape";
  document.getElementById("shapeLabel").value = shape ? shape.label : "";
  document.getElementById("shapeLabelRotation").value = String(normalizeTextRotation(shape && shape.labelRotation));
  document.getElementById("shapeKind").value = shape ? shape.kind : "facility";
  document.getElementById("shapeGeometry").value = shape ? (shape.geometry || "rectangle") : "rectangle";
  document.getElementById("shapeColor").value = shape ? safeShapeColor(shape.color) : "#dce8e4";
  document.getElementById("deleteShapeBtn").hidden = !shape;
  document.getElementById("shapeModalBackdrop").classList.add("open");
}

function closeShapeModal(){
  document.getElementById("shapeModalBackdrop").classList.remove("open");
  editingShapeId = null;
}

function safeShapeColor(color){
  return /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#dce8e4";
}

function normalizeTextRotation(rotation){
  const degrees = Number(rotation);
  return Number.isFinite(degrees) ? ((Math.round(degrees / 90) * 90) % 360 + 360) % 360 : 0;
}

async function rotateShapeText(shapeId){
  const shape = shapes.find(item=>item.id===shapeId);
  if (!shape) return;
  const labelRotation = (normalizeTextRotation(shape.labelRotation) + 90) % 360;
  await userCollection("shapes").doc(shape.id).update({labelRotation});
  shape.labelRotation = labelRotation;
  if (document.getElementById("shapeModalBackdrop").classList.contains("open") && editingShapeId === shape.id){
    document.getElementById("shapeLabelRotation").value = String(labelRotation);
  }
  renderHallway();
}

async function saveShape(){
  const label = document.getElementById("shapeLabel").value.trim();
  const kind = document.getElementById("shapeKind").value;
  if (!label){ alert("Please enter a label for the facility or shape."); return; }
  const geometry = document.getElementById("shapeGeometry").value;
  const payload = {
    label,
    labelRotation:normalizeTextRotation(document.getElementById("shapeLabelRotation").value),
    kind,
    geometry,
    color: safeShapeColor(document.getElementById("shapeColor").value),
  };
  if (editingShapeId){
    await userCollection("shapes").doc(editingShapeId).update(payload);
  } else {
    const idx = rooms.length + shapes.length;
    payload.x = 20 + (idx % 5) * 170;
    payload.y = 20 + Math.floor(idx / 5) * 130;
    payload.width = 160;
    payload.height = 100;
    await userCollection("shapes").add(payload);
  }
  closeShapeModal();
}

async function deleteShape(){
  const shape = shapes.find(item=>item.id===editingShapeId);
  if (!shape || !confirm("Delete " + shape.label + "? This cannot be undone.")) return;
  await userCollection("shapes").doc(shape.id).delete();
  if (selectedShapeId === shape.id) selectedShapeId = null;
  closeShapeModal();
}

/* ============================= RENDER: HALLWAY ============================= */

function renderHallway(){
  const canvas = document.getElementById("hallwayCanvas");
  canvas.classList.toggle("layout-locked", layoutLocked);
  canvas.classList.toggle("layout-unlocked", !layoutLocked);
  document.getElementById("layoutLockBtn").setAttribute("aria-pressed", String(layoutLocked));
  document.getElementById("layoutLockBtn").innerHTML = layoutLocked
    ? '<i class="fa-solid fa-lock"></i> Layout locked'
    : '<i class="fa-solid fa-lock-open"></i> Layout unlocked';
  document.getElementById("layoutLockBtn").classList.toggle("btn-primary", !layoutLocked);
  document.getElementById("layoutLockBtn").classList.toggle("btn-outline", layoutLocked);
  if (layoutLocked) selectedShapeId = null;
  const editShapeBtn = document.getElementById("editShapeBtn");
  const selectedShape = shapes.find(shape=>shape.id===selectedShapeId);
  editShapeBtn.hidden = layoutLocked || !selectedShape;
  editShapeBtn.textContent = selectedShape ? "Edit " + selectedShape.label : "Edit selected shape";
  canvas.innerHTML = rooms.map(r=>{
    const {vacant}=roomVacancy(r);
    const x = Number.isFinite(Number(r.x)) ? Math.max(0, Number(r.x)) : 20;
    const y = Number.isFinite(Number(r.y)) ? Math.max(0, Number(r.y)) : 20;
    return `<div class="hall-tile room-tile" style="left:${x}px; top:${y}px" data-id="${escapeHtml(r.id)}" tabindex="0" role="button" aria-disabled="${layoutLocked}" aria-label="Edit room ${escapeHtml(r.room)}">
      <div class="room-code">${escapeHtml(r.room)}</div>
      <div class="room-meta">${r.gender} · ${vacant} vacant</div>
      <div class="hall-dots">${r.beds.map(b=>`<span class="${bedStatus(b,r)}"></span>`).join("")}</div>
    </div>`;
  }).join("") + shapes.map(shape=>{
    const kind = shape.kind === "walkway" ? "walkway" : "facility";
    const geometry = ["rectangle", "circle", "triangle"].includes(shape.geometry) ? shape.geometry : "rectangle";
    let width = Number.isInteger(Number(shape.width)) ? Math.max(36, Math.min(2000, Number(shape.width))) : 160;
    let height = Number.isInteger(Number(shape.height)) ? Math.max(36, Math.min(2000, Number(shape.height))) : 100;
    if (geometry === "circle") width = height = Math.max(width,height);
    const x = Number.isFinite(Number(shape.x)) ? Math.max(0, Number(shape.x)) : 20;
    const y = Number.isFinite(Number(shape.y)) ? Math.max(0, Number(shape.y)) : 20;
    const resizeHandles = selectedShapeId === shape.id && !layoutLocked
      ? ["nw","n","ne","e","se","s","sw","w"].map(handle=>`<span class="resize-handle ${handle}" data-handle="${handle}" aria-hidden="true"></span>`).join("")
      : "";
    const toolbar = selectedShapeId === shape.id && !layoutLocked
      ? `<div class="shape-toolbar ${y < 50 ? "below" : "above"}"><button type="button" class="shape-rotate-btn" data-id="${escapeHtml(shape.id)}" aria-label="Rotate ${escapeHtml(shape.label)} text by 90 degrees" title="Rotate text +90°">↻ 90°</button><button type="button" class="shape-edit-btn" data-id="${escapeHtml(shape.id)}" aria-label="Edit ${escapeHtml(shape.label)}">Edit</button><button type="button" class="shape-delete-btn" data-id="${escapeHtml(shape.id)}" aria-label="Delete ${escapeHtml(shape.label)}">Delete</button></div>`
      : "";
    const labelRotation = normalizeTextRotation(shape.labelRotation);
    return `<div class="hall-tile shape-tile ${kind} geometry-${geometry}${selectedShapeId === shape.id && !layoutLocked ? " selected" : ""}" style="left:${x}px; top:${y}px; width:${width}px; height:${height}px; --shape-color:${safeShapeColor(shape.color)}" data-id="${escapeHtml(shape.id)}" data-shape="true" data-geometry="${geometry}" tabindex="0" role="button" aria-disabled="${layoutLocked}" aria-label="${escapeHtml(shape.label || "Facility")}">
      <span class="shape-label" style="transform:rotate(${labelRotation}deg)">${escapeHtml(shape.label || "Facility")}</span>
      ${resizeHandles}${toolbar}
    </div>`;
  }).join("");
  wireHallwayDrag();
}

function wireHallwayDrag(){
  const canvas = document.getElementById("hallwayCanvas");
  canvas.querySelectorAll(".hall-tile").forEach(tile=>{
    let pointerDown = false, dragging = false, startX=0, startY=0, offX=0, offY=0, operation=null;
    const openEditor = ()=>{
      if (tile.dataset.shape === "true") openShapeModal(tile.dataset.id);
      else openRoomModal(tile.dataset.id);
    };
    tile.addEventListener("keydown", event=>{
      if (!layoutLocked && (event.key === "Enter" || event.key === " ")){
        event.preventDefault();
        if (tile.dataset.shape === "true"){
          if (selectedShapeId === tile.dataset.id) openShapeModal(tile.dataset.id);
          else {
            selectedShapeId = tile.dataset.id;
            renderHallway();
          }
        } else openEditor();
      }
    });
    tile.addEventListener("pointerdown", e=>{
      if (layoutLocked || e.button !== 0) return;
      if (e.target.closest(".shape-toolbar")) return;
      pointerDown = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      const handle = e.target.closest(".resize-handle");
      if (handle){
        operation = {
          type:"resize",
          handle:handle.dataset.handle,
          x:Number.parseFloat(tile.style.left),
          y:Number.parseFloat(tile.style.top),
          width:tile.offsetWidth,
          height:tile.offsetHeight,
          geometry:tile.dataset.geometry
        };
      } else {
        operation = {type:"move", wasSelected:selectedShapeId === tile.dataset.id};
        if (tile.dataset.shape === "true") selectedShapeId = tile.dataset.id;
      }
      tile.setPointerCapture(e.pointerId);
      const rect = tile.getBoundingClientRect();
      offX = e.clientX - rect.left;
      offY = e.clientY - rect.top;
    });
    tile.addEventListener("pointermove", e=>{
      if (!pointerDown || layoutLocked) return;
      if (!dragging && Math.hypot(e.clientX-startX, e.clientY-startY) < 8) return;
      dragging = true;
      if (operation.type === "move"){
        const canvasRect = canvas.getBoundingClientRect();
        const x = Math.max(0, e.clientX - canvasRect.left - offX + canvas.scrollLeft);
        const y = Math.max(0, e.clientY - canvasRect.top - offY + canvas.scrollTop);
        tile.style.left = x + "px";
        tile.style.top = y + "px";
      } else {
        const change = resizeBounds(operation, e.clientX-startX, e.clientY-startY);
        tile.style.left = change.x + "px";
        tile.style.top = change.y + "px";
        tile.style.width = change.width + "px";
        tile.style.height = change.height + "px";
      }
    });
    tile.addEventListener("pointerup", async e=>{
      if (!pointerDown) return;
      pointerDown = false;
      if (!dragging){
        if (tile.dataset.shape === "true"){
          if (!operation.wasSelected){
            selectedShapeId = tile.dataset.id;
            renderHallway();
          } else openShapeModal(tile.dataset.id);
        } else openEditor();
        return;
      }
      dragging = false;
      if (tile.dataset.shape === "true"){
        const update = {
          x:Math.round(Number.parseFloat(tile.style.left)),
          y:Math.round(Number.parseFloat(tile.style.top))
        };
        if (operation.type === "resize"){
          update.width = Math.round(tile.offsetWidth);
          update.height = Math.round(tile.offsetHeight);
        }
        await userCollection("shapes").doc(tile.dataset.id).update(update);
      } else {
        await userCollection("rooms").doc(tile.dataset.id).update({
          x:Math.round(Number.parseFloat(tile.style.left)),
          y:Math.round(Number.parseFloat(tile.style.top))
        });
      }
      operation = null;
    });
    tile.addEventListener("pointercancel", ()=>{
      const wasDragging = dragging;
      pointerDown = false;
      dragging = false;
      operation = null;
      if (wasDragging) renderHallway();
    });
  });
  canvas.querySelectorAll(".shape-edit-btn").forEach(button=>button.addEventListener("click", e=>{
    e.stopPropagation();
    openShapeModal(button.dataset.id);
  }));
  canvas.querySelectorAll(".shape-rotate-btn").forEach(button=>button.addEventListener("click", async e=>{
    e.stopPropagation();
    await rotateShapeText(button.dataset.id);
  }));
  canvas.querySelectorAll(".shape-delete-btn").forEach(button=>button.addEventListener("click", async e=>{
    e.stopPropagation();
    const shape = shapes.find(item=>item.id===button.dataset.id);
    if (!shape || !confirm("Delete " + shape.label + "? This cannot be undone.")) return;
    await userCollection("shapes").doc(shape.id).delete();
    selectedShapeId = null;
  }));
}

function resizeBounds(operation, deltaX, deltaY){
  let {x,y,width,height} = operation;
  const handle = operation.handle;
  const minSize = 36, maxSize = 2000;
  if (operation.geometry === "circle"){
    const hasHorizontal = handle.includes("e") || handle.includes("w");
    const hasVertical = handle.includes("n") || handle.includes("s");
    const initialSize = Math.max(width,height);
    let size;
    if (hasHorizontal && hasVertical){
      const deltaW = handle.includes("e") ? deltaX : -deltaX;
      const deltaH = handle.includes("s") ? deltaY : -deltaY;
      size = initialSize + (Math.abs(deltaW) >= Math.abs(deltaH) ? deltaW : deltaH);
      size = Math.max(minSize, Math.min(maxSize, size));
      x = handle.includes("e") ? operation.x : Math.max(0, operation.x + operation.width - size);
      y = handle.includes("s") ? operation.y : Math.max(0, operation.y + operation.height - size);
    } else if (hasHorizontal){
      size = initialSize + (handle.includes("e") ? deltaX : -deltaX);
      size = Math.max(minSize, Math.min(maxSize, size));
      x = handle.includes("e") ? operation.x : Math.max(0, operation.x + operation.width - size);
      y = Math.max(0, operation.y + (operation.height-size)/2);
    } else {
      size = initialSize + (handle.includes("s") ? deltaY : -deltaY);
      size = Math.max(minSize, Math.min(maxSize, size));
      x = Math.max(0, operation.x + (operation.width-size)/2);
      y = handle.includes("s") ? operation.y : Math.max(0, operation.y + operation.height - size);
    }
    return {x,y,width:size,height:size};
  }
  if (handle.includes("e")) width = Math.max(minSize, Math.min(maxSize, operation.width + deltaX));
  if (handle.includes("s")) height = Math.max(minSize, Math.min(maxSize, operation.height + deltaY));
  if (handle.includes("w")){
    width = Math.max(minSize, Math.min(maxSize, operation.width - deltaX));
    x = Math.max(0, operation.x + operation.width - width);
    width = Math.min(width, operation.x + operation.width);
  }
  if (handle.includes("n")){
    height = Math.max(minSize, Math.min(maxSize, operation.height - deltaY));
    y = Math.max(0, operation.y + operation.height - height);
    height = Math.min(height, operation.y + operation.height);
  }
  return {x,y,width,height};
}

