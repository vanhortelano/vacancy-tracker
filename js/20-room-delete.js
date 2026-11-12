// js/20-room-delete.js — Delete-room modal, duplicate-name validation, duplicate auto-cleanup
let deleteRoomTargetId = null;
let duplicateCleanupUid = null;
const rdEl = id => document.getElementById(id);

/* ---------- helpers ---------- */
function roomNameKey(name){
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}
function findDuplicateRoom(name, ignoreId){
  const key = roomNameKey(name);
  if (!key) return null;
  return rooms.find(r => r.id !== ignoreId && roomNameKey(r.room) === key) || null;
}
function roomActivityScore(room){
  return (room.beds || []).filter(b => b.tenant || b.reservedFor || b.temporaryClientId).length;
}
function roomHasActivity(room){ return roomActivityScore(room) > 0; }

// Safe delete: re-checks inside a transaction so a room with residents is never removed.
async function deleteRoomRecord(id){
  const ref = userCollection("rooms").doc(id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    if ((snap.data().beds || []).some(b => b.tenant || b.reservedFor || b.temporaryClientId)){
      throw new Error("This room has residents, reservations, or temporary-client records. Clear them first.");
    }
    tx.delete(ref);
  });
}

/* ---------- inline error on the Add/Edit room form ---------- */
function showRoomError(message){
  const el = rdEl("rmRoomError"), input = rdEl("rmRoomNumber");
  el.textContent = message; el.hidden = false;
  input.classList.add("has-error"); input.focus();
}
function clearRoomError(){
  const el = rdEl("rmRoomError"), input = rdEl("rmRoomNumber");
  if (el){ el.textContent = ""; el.hidden = true; }
  if (input) input.classList.remove("has-error");
}
rdEl("rmRoomNumber").addEventListener("input", clearRoomError);

/* ---------- delete confirmation modal ---------- */
function openDeleteRoomModal(roomId){
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  deleteRoomTargetId = roomId;
  const blocked = roomHasActivity(room);
  rdEl("deleteRoomName").textContent = "Room " + room.room;
  const err = rdEl("deleteRoomError");
  err.hidden = !blocked;
  err.textContent = blocked
    ? "Room " + room.room + " still has residents, reservations, or temporary clients. Check them out or cancel them first."
    : "";
  rdEl("deleteRoomNote").hidden = blocked;
  const confirmBtn = rdEl("confirmDeleteRoom");
  confirmBtn.disabled = blocked;
  confirmBtn.textContent = "Yes, Delete";
  rdEl("deleteRoomBackdrop").classList.add("open");
  rdEl("cancelDeleteRoom").focus();
}
function closeDeleteRoomModal(){
  rdEl("deleteRoomBackdrop").classList.remove("open");
  deleteRoomTargetId = null;
}
rdEl("cancelDeleteRoom").addEventListener("click", closeDeleteRoomModal);
rdEl("deleteRoomBackdrop").addEventListener("click", e => { if (e.target.id === "deleteRoomBackdrop") closeDeleteRoomModal(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && rdEl("deleteRoomBackdrop").classList.contains("open")) closeDeleteRoomModal();
});
rdEl("confirmDeleteRoom").addEventListener("click", async () => {
  if (!deleteRoomTargetId) return;
  const btn = rdEl("confirmDeleteRoom"), err = rdEl("deleteRoomError");
  btn.disabled = true; btn.textContent = "Deleting…";
  try{
    await deleteRoomRecord(deleteRoomTargetId);
    closeDeleteRoomModal();
  }catch(error){
    console.error("Room deletion failed", error);
    err.textContent = "Could not delete the room: " + error.message;
    err.hidden = false;
    btn.disabled = false; btn.textContent = "Yes, Delete";
  }
});
// Trash icon on any room card
document.addEventListener("click", e => {
  const btn = e.target.closest('[data-canvas-action="delete-room"]');
  if (btn) openDeleteRoomModal(btn.dataset.room);
});

/* ---------- duplicate cleanup ---------- */
// Keeps ONE room per name (the one with the most residents/reservations, then most beds).
// Extra copies are deleted only if empty; extras holding residents are reported, never deleted.
async function removeDuplicateRooms(){
  const groups = new Map();
  rooms.forEach(r => {
    const key = roomNameKey(r.room);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const removed = [], skipped = [];
  for (const list of groups.values()){
    if (list.length < 2) continue;
    list.sort((a, b) => roomActivityScore(b) - roomActivityScore(a) || (b.beds || []).length - (a.beds || []).length);
    for (const extra of list.slice(1)){
      if (roomHasActivity(extra)){ skipped.push(extra.room); continue; }
      try{ await deleteRoomRecord(extra.id); removed.push(extra.room); }
      catch(error){ console.error("Duplicate removal failed", error); skipped.push(extra.room); }
    }
  }
  return {removed, skipped};
}

// Runs once per signed-in user, right after the rooms first load.
async function cleanupDuplicateRooms(){
  if (!db || !currentUser || duplicateCleanupUid === currentUser.uid) return;
  duplicateCleanupUid = currentUser.uid;
  const {removed, skipped} = await removeDuplicateRooms();
  if (removed.length) console.info("Removed empty duplicate rooms:", removed.join(", "));
  if (skipped.length){
    alert("These room names are duplicated but the extra copies contain residents or reservations, so they were NOT deleted:\n\n" +
      [...new Set(skipped)].join(", ") + "\n\nMove or check out those residents, then delete the extra copy with the trash icon.");
  }
}