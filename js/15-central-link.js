// js/15-central-link.js — Link this dormitory to the Super Admin's central platform.
// The Super Admin platform uses its own tables (superAdmins, pairing, branches, directory,
// audit) in the SQL database. This file reaches them through the data API with the signed-in
// account; the server decides access.
const CL = {branch:null, pairing:null, timer:null, busy:false, lastPush:0, lastKey:"", error:""};

// All reads and writes go through the SQL-backed API (sqlstore.js). The server decides what this
// signed-in account may read or change, exactly as the old security rules did.
function clDec(fields){
  const out = {};
  Object.keys(fields||{}).forEach(k=>{
    const x = fields[k];
    out[k] = x instanceof SQLSTORE.Timestamp ? x.toDate() : x;
  });
  return out;
}
async function clReq(method, path, obj, opts){
  opts = opts || {};
  const seg = path.split("/");
  const isDoc = seg.length % 2 === 0;
  if (method === "GET"){
    if (isDoc){
      const snap = await new SQLSTORE.DocRef(seg).get();
      return snap.exists ? {fields: snap.data()} : null;
    }
    const snap = await new SQLSTORE.CollectionRef(seg).get();
    return {documents: snap.docs.map(d=>({name: d.ref.path, fields: d.data()}))};
  }
  if (method === "POST") return new SQLSTORE.CollectionRef(seg).add(obj);
  if (method === "PATCH"){
    const ref = new SQLSTORE.DocRef(seg);
    if (opts.createOnly) return ref.create(obj);
    if (opts.mask) return ref.update(obj);
    return ref.set(obj);
  }
  if (method === "DELETE") return new SQLSTORE.DocRef(seg).delete();
  throw new Error("Unsupported request");
}
async function clAudit(action, detail){
  try{
    await clReq("POST", "audit", {actorUid:currentUser.uid, actorEmail:currentUser.email||"", action, branch:(CL.branch&&CL.branch.dormName)||"", detail:detail||"", at:new Date(), targetAdmin:(CL.branch&&CL.branch.requestedBy)||currentUser.uid});
  }catch(e){ /* audit is best effort */ }
}

async function clRefresh(){
  if (!currentUser || CL.busy) return;
  try{
    const doc = await clReq("GET", "branches/" + currentUser.uid);
    CL.branch = doc ? clDec(doc.fields) : null;
    if (CL.branch) CL.pairing = null;
    CL.error = "";
  }catch(e){ CL.error = e.message; }
  if (activeTab === "central") renderCentralLink();
}

function clSummary(){
  const s = {total:0, vacant:0, occupied:0, maleVacant:0, femaleVacant:0, studentVacant:0, revieweeVacant:0, mixedVacant:0, mixedGroupVacant:0, acVacant:0, nonAcVacant:0};
  rooms.forEach(room=>{
    const v = roomVacancy(room);
    s.total += v.total; s.vacant += v.vacant;
    if (room.gender === "Male") s.maleVacant += v.vacant;
    if (room.gender === "Female") s.femaleVacant += v.vacant;
    if (room.gender === "Mixed") s.mixedVacant += v.vacant;
    if (room.demographic !== "Students" && room.demographic !== "Reviewees") s.mixedGroupVacant += v.vacant;
    if (room.demographic === "Students") s.studentVacant += v.vacant;
    if (room.demographic === "Reviewees") s.revieweeVacant += v.vacant;
    if (room.ac) s.acVacant += v.vacant; else s.nonAcVacant += v.vacant;
  });
  s.occupied = s.total - s.vacant;
  return s;
}

async function clSync(force){
  const b = CL.branch;
  if (!b || !currentUser || !assistantDataLoaded.rooms || CL.busy) return;
  const uid = currentUser.uid, s = clSummary(), key = JSON.stringify(s);
  const legacy = {...s}; delete legacy.mixedVacant; delete legacy.mixedGroupVacant;   // older published rules don't know these fields
  let problem = "";
  // 1) live directory card (an error here must never stop the chart data below)
  if (b.dirStatus === "approved" && (force || key !== CL.lastKey || Date.now() - CL.lastPush > 5*60000)){
    const base = {ownerUid:uid, dormName:b.dormName, location:b.location || "", updatedAt:new Date()};
    try{ await clReq("PATCH", "directory/" + uid, {...base, ...s}); CL.lastKey = key; CL.lastPush = Date.now(); }
    catch(e){
      try{ await clReq("PATCH", "directory/" + uid, {...base, ...legacy}); CL.lastKey = key; CL.lastPush = Date.now(); }
      catch(e2){ problem = e2.message; }
    }
  }
  // 2) analytics snapshot, kept forever once approved
  if (b.analyticsStatus === "approved"){
    const k = "clSnap_" + uid, last = Number(localStorage.getItem(k) || 0);
    if (force || Date.now() - last >= 10*60000){
      try{ await clReq("POST", "branches/" + uid + "/snapshots", {...s, checkouts:clCheckouts(), checkins:clCheckins(), capturedAt:new Date()}); localStorage.setItem(k, String(Date.now())); }
      catch(e){
        try{ await clReq("POST", "branches/" + uid + "/snapshots", {...legacy, capturedAt:new Date()}); localStorage.setItem(k, String(Date.now())); }
        catch(e2){ problem = problem || e2.message; }
      }
    }
  }
  CL.error = problem;
}

function clStart(){
  if (CL.timer) return;
  const tick = async()=>{ await clRefresh(); await clSync(false); };
  tick();
  CL.timer = setInterval(tick, 60000);
  document.addEventListener("visibilitychange", ()=>{ if (!document.hidden) tick(); });
  window.addEventListener("online", tick);
}
function clStop(){
  if (CL.timer) clearInterval(CL.timer);
  CL.timer = null; CL.branch = null; CL.pairing = null; CL.lastKey = ""; CL.lastPush = 0; CL.error = "";
}

function clCode(){
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const c = Array.from(bytes, b=>chars[b % chars.length]).join("");
  return c.slice(0,4) + "-" + c.slice(4);
}

async function clGeneratePairing(){
  const name = document.getElementById("clDormName").value.trim();
  const location = document.getElementById("clLocation").value.trim();
  if (!name){ CL.error = "Enter your dormitory name first."; return renderCentralLink(); }
  const code = clCode(), expires = new Date(Date.now() + 19*60000);
  CL.busy = true;
  try{
    await clReq("PATCH", "pairing/" + code, {ownerUid:currentUser.uid, dormName:name, location, expiresAt:expires}, {createOnly:true});
    CL.pairing = {code, expires, name}; CL.error = "";
  }catch(e){ CL.error = "Could not create a code: " + e.message; }
  CL.busy = false;
  renderCentralLink();
}

async function clDecide(kind, decision){
  const word = decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "revoke";
  const text = decision === "revoked" ? "Revoke this permission? The Super Admin will stop receiving this data immediately."
    : "Are you sure you want to " + word + " this request?";
  if (!confirm(text)) return;
  const field = kind === "directory" ? "dirStatus" : "analyticsStatus";
  CL.busy = true;
  try{
    await clReq("PATCH", "branches/" + currentUser.uid, {[field]:decision, decidedAt:new Date()}, {mask:[field, "decidedAt"]});
    if (kind === "directory" && decision === "revoked"){ await clReq("DELETE", "directory/" + currentUser.uid).catch(()=>{}); CL.lastKey = ""; }
    await clAudit("PERMISSION_" + decision.toUpperCase(), kind === "directory" ? "Directory publishing" : "Historical analytics");
    CL.error = "";
  }catch(e){ CL.error = "Could not save your decision: " + e.message; }
  CL.busy = false;
  await clRefresh();
  if (decision === "approved") await clSync(true);
}

async function clDisconnect(){
  if (!confirm("Disconnect from the central platform? Both permissions end and the Super Admin must send a new request.")) return;
  CL.busy = true;
  try{ await clAudit("BRANCH_DISCONNECTED", ""); await clReq("DELETE", "directory/" + currentUser.uid).catch(()=>{}); await clReq("DELETE", "branches/" + currentUser.uid); CL.branch = null; CL.error = ""; }
  catch(e){ CL.error = "Could not disconnect: " + e.message; }
  CL.busy = false;
  renderCentralLink();
}

function clChip(status){
  const labels = {pending:"Pending", approved:"Approved", rejected:"Rejected", revoked:"Revoked"};
  return '<span class="cl-chip ' + escapeHtml(status) + '">' + (labels[status] || escapeHtml(status)) + '</span>';
}

function clRequestCard(kind, title, subtitle, text, purpose, status){
  const buttons = status === "pending"
    ? '<button class="btn btn-primary btn-sm" data-cl="' + kind + ':approved">Approve</button> <button class="btn btn-outline btn-sm" data-cl="' + kind + ':rejected">Reject</button>'
    : status === "approved" ? '<button class="btn btn-outline btn-sm" data-cl="' + kind + ':revoked">Revoke access</button>' : '<span class="va-note">Closed. Ask the Super Admin to send a new request.</span>';
  return '<div class="va-card cl-card"><div class="cl-head"><div><h3>' + title + '</h3><div class="va-note" style="margin:2px 0 0">' + subtitle + '</div></div>' + clChip(status) + '</div>'
    + '<p class="va-note">' + text + '</p><p class="va-note"><strong>Purpose:</strong> ' + purpose + '</p><div class="cl-actions">' + buttons + '</div></div>';
}

function renderCentralLink(){
  const panel = document.getElementById("centralLinkPanel");
  if (!panel) return;
  const err = CL.error ? '<p class="va-note" style="color:var(--overdue)">' + escapeHtml(CL.error) + '</p>' : "";
  if (!CL.branch){
    const p = CL.pairing && CL.pairing.expires > new Date() ? CL.pairing : null;
    const dormDefault = (p && p.name) || (viewerAccess && viewerAccess.dormName) || "";
    panel.innerHTML = '<div class="va-card"><h3>Link to the central platform</h3>'
      + '<p class="va-note">A Super Admin can ask to list your dormitory in a central directory and receive vacancy history for combined analytics. Nothing is shared until you approve it, and you can revoke it at any time. Your password is never shared.</p>'
      + '<div class="va-form"><div class="field"><label for="clDormName">Dormitory name</label><input id="clDormName" value="' + escapeHtml(dormDefault) + '"></div>'
      + '<div class="field"><label for="clLocation">Location (city)</label><input id="clLocation" placeholder="e.g. Cebu City"></div></div>'
      + '<button class="btn btn-primary" id="clGen" type="button">Generate pairing code</button>' + err
      + (p ? '<div class="cl-code"><span>Give this code to the Super Admin. It works once and expires at ' + p.expires.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) + '.</span><strong>' + escapeHtml(p.code) + '</strong></div>' : '')
      + '</div>';
    document.getElementById("clGen").onclick = clGeneratePairing;
    return;
  }
  const b = CL.branch;
  panel.innerHTML = '<div class="va-card"><h3>Connection request from the Super Admin</h3>'
    + '<p class="va-note">Two separate permissions. Approving one does not approve the other.</p>' + err
    + '<p class="va-note"><strong>Dormitory:</strong> ' + escapeHtml(b.dormName) + '</p></div>'
    + clRequestCard("directory", "Directory access", "Publish dormitory information",
        "Display your dormitory name, location and current vacancy counts (vacant, occupied, male/female, student/reviewee, aircon) in the central directory. No resident names are shared.", escapeHtml(b.purpose || "—"), b.dirStatus)
    + clRequestCard("analytics", "Analytics access", "Share vacancy analytics data",
        "Send the same aggregate counts about every 15 minutes so the Super Admin can chart trends and combined statistics. No resident names are shared.", escapeHtml(b.purpose || "—"), b.analyticsStatus)
    + '<div class="va-card"><button class="btn btn-outline btn-sm" data-cl="disconnect">Disconnect from central platform</button></div>';
}

document.addEventListener("click", event=>{
  const btn = event.target.closest("[data-cl]");
  if (!btn) return;
  if (btn.dataset.cl === "disconnect") return clDisconnect();
  const [kind, decision] = btn.dataset.cl.split(":");
  clDecide(kind, decision);
});


/* Scheduled check-outs (date:count list) so the Super Admin chart can forecast future vacancies. No names are shared. */
function clCheckouts(){
  const m = {}, now = Date.now();
  rooms.forEach(room=>(room.beds||[]).forEach(b=>{
    if (!b || !b.end || bedStatus(b, room) === "vacant") return;
    const d = parseScheduleDate(b.end, true);
    if (!d || d.getTime() <= now) return;
    const k = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    m[k] = (m[k]||0) + 1;
  }));
  return Object.keys(m).sort().slice(0,120).map(k=>k + ":" + m[k]).join(",");
}

/* Reserved clients arriving later (date:count list). Names are never shared. */
function clCheckins(){
  const m = {}, now = Date.now();
  (typeof prospects !== "undefined" ? prospects : []).forEach(p=>{
    if (!p.reservedBed || p.checkedIn) return;
    const d = parseScheduleDate(p.checkIn);
    if (!d || d.getTime() <= now) return;
    const k = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
    m[k] = (m[k]||0) + 1;
  });
  return Object.keys(m).sort().slice(0,120).map(k=>k + ":" + m[k]).join(",");
}

/* ---- Consent: changing the viewer password or removing the dorm server needs the Super Admin's approval ---- */
async function clChanges(){
  const r = await clReq("GET", "branches/" + currentUser.uid + "/changes");
  return ((r && r.documents) || []).map(d=>({id:d.name.split("/").pop(), ...clDec(d.fields)}));
}
async function clConsentGate(kind, label){
  if (!CL.branch || !currentUser) return true;           // not linked to a Super Admin: no permission needed
  let list;
  try{ list = await clChanges(); }catch(e){ alert("Could not reach your Super Admin to check permission: " + e.message); return false; }
  const mine = list.filter(x=>x.kind === kind);
  const ok = mine.find(x=>x.status === "approved");
  if (ok){ CL.consumeId = ok.id; return true; }
  if (mine.some(x=>x.status === "pending")){ alert("Still waiting for your Super Admin to approve: " + label + ". You'll be able to continue once they accept."); return false; }
  const rejected = mine.filter(x=>x.status === "rejected");
  for (const r of rejected) await clReq("DELETE", "branches/" + currentUser.uid + "/changes/" + r.id).catch(()=>{});
  if (rejected.length) alert("Your Super Admin rejected the last request for: " + label + ".");
  if (!confirm("This dormitory is linked to a Super Admin.\n\n" + label + " needs their permission first. Send the request now?")) return false;
  try{
    await clReq("POST", "branches/" + currentUser.uid + "/changes", {kind, status:"pending", dormName:CL.branch.dormName || "", createdAt:new Date()});
    await clAudit("CHANGE_REQUESTED", label);
    alert("Request sent. Once the Super Admin accepts it, come back and do this again.");
  }catch(e){ alert("Could not send the request: " + e.message); }
  return false;
}
async function clConsentDone(){
  if (CL.consumeId && currentUser) await clReq("DELETE", "branches/" + currentUser.uid + "/changes/" + CL.consumeId).catch(()=>{});
  CL.consumeId = null;
}
