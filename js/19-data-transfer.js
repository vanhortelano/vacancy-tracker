// js/19-data-transfer.js — move ALL of this account's data to a new account (e.g. when a branch admin resigns).
// Same idea as the Super Admin connector: a one-time code + purpose + permission. Nothing is shared by e-mail or password.
const TRANSFER_COLLECTIONS = ["rooms","prospects","temporary_dorm_clients","tenant_history","shapes","bed_transfers","settings"];
const TR = {out:null, inc:null, busy:false, msg:"", timer:null};
const trDb = () => db.collection("accountTransfers");

async function trLoad(){
  if (!currentUser) return;
  try{
    const mine = await trDb().where("fromUid","==",currentUser.uid).get().catch(()=>null);
    const docs = mine ? mine.docs.map(d=>({code:d.id, ...d.data()})).filter(x=>x.status !== "done") : [];
    TR.out = docs[0] || null;
    const inc = await db.collection("incomingTransfer").doc(currentUser.uid).get().catch(()=>null);
    TR.inc = null;
    if (inc && inc.exists){ const t = await trDb().doc(inc.data().code).get().catch(()=>null); if (t && t.exists) TR.inc = {code:t.id, ...t.data()}; }
  }catch(e){ TR.msg = e.message; }
  trRender();
}
function trWhen(ts){ try{ return (ts.toDate ? ts.toDate() : new Date(ts)).toLocaleString([], {dateStyle:"medium", timeStyle:"short"}); }catch(e){ return ""; } }

function trRender(){
  const host = document.getElementById("transferPanel"); if (!host) return;
  const o = TR.out, i = TR.inc;
  const msg = TR.msg ? `<p class="cl-msg">${escapeHtml(TR.msg)}</p>` : "";
  let send;
  if (!o) send = `<div class="field"><label for="trPurpose">Why are you transferring?</label><input id="trPurpose" placeholder="e.g. I'm resigning; Maria takes over"></div><button class="btn btn-primary" id="trGen" type="button">Generate transfer code</button>`;
  else if (o.status === "open") send = `<div class="cl-code"><span>Give this code to the new account. It works once and expires ${escapeHtml(trWhen(o.expiresAt))}.</span><strong>${escapeHtml(o.code)}</strong></div><p class="det">Purpose: ${escapeHtml(o.purpose)}</p><button class="btn btn-outline" id="trCancel" type="button">Cancel this code</button>`;
  else if (o.status === "requested") send = `<div class="cl-code"><span>${escapeHtml(o.toEmail || "A new account")} wants to receive all your data.</span><strong>${escapeHtml(o.code)}</strong></div><p class="det">Purpose: ${escapeHtml(o.purpose)}</p><p class="det"><b>If you approve:</b> your rooms, reservations, temporary clients, history and layout move to that account. After that, <b>this account will have no data.</b></p><div style="display:flex;gap:8px"><button class="btn btn-primary" id="trApprove" type="button" ${TR.busy ? "disabled" : ""}>Approve and transfer</button><button class="btn btn-outline" id="trReject" type="button" ${TR.busy ? "disabled" : ""}>Reject</button></div>`;
  else send = `<p class="det">Working… keep this page open until it finishes.</p>`;
  let recv;
  if (!i) recv = `<div class="field"><label for="trCode">Transfer code from the other account</label><input id="trCode" placeholder="XXXX-XXXX" autocomplete="off"></div><button class="btn btn-primary" id="trRequest" type="button">Request transfer</button>`;
  else if (i.status === "requested") recv = `<p class="det">Waiting for <b>${escapeHtml(i.fromEmail || "the other account")}</b> to approve. Purpose: ${escapeHtml(i.purpose)}</p>`;
  else if (i.status === "approved") recv = `<p class="det">Approved. The data is being moved to this account. Keep this page open.</p>`;
  else recv = `<p class="det">Done. All data was moved to this account.</p>`;
  host.innerHTML = `${msg}<div class="panel"><h3>Transfer my data to a new account</h3><p class="det">For a Branch Admin who is leaving. The new person signs in with their own account, so no Google account or e-mail is ever handed over.</p>${send}</div>
  <div class="panel" style="margin-top:14px"><h3>Receive data from another account</h3><p class="det">Your own data must be empty. You will keep working in your own account.</p>${recv}</div>
  <p class="det" style="margin-top:12px">Not moved: the Viewer Access server and the Super Admin link belong to the old account. Set them up again from the new account.</p>`;
}

function trCode(){ return typeof clCode === "function" ? clCode() : Math.random().toString(36).slice(2,10).toUpperCase(); }

document.addEventListener("click", async e=>{
  const id = e.target.closest("button") && e.target.closest("button").id; if (!id || !id.startsWith("tr") || !currentUser) return;
  TR.msg = "";
  try{
    if (id === "trGen"){
      const purpose = document.getElementById("trPurpose").value.trim(); if (!purpose){ TR.msg = "Write the purpose first."; return trRender(); }
      const code = trCode(), exp = new Date(Date.now() + 23*3600*1000);
      await trDb().doc(code).set({fromUid:currentUser.uid, fromEmail:currentUser.email || "", purpose, expiresAt:exp, status:"open"});
      await trLoad();
    } else if (id === "trCancel"){ await trDb().doc(TR.out.code).delete(); await trLoad(); }
    else if (id === "trReject"){ await trDb().doc(TR.out.code).update({status:"rejected"}); await trDb().doc(TR.out.code).delete(); await trLoad(); }
    else if (id === "trRequest"){
      const code = document.getElementById("trCode").value.trim().toUpperCase();
      const own = await db.collection("users").doc(currentUser.uid).collection("rooms").limit(1).get();
      if (!own.empty){ TR.msg = "This account already has rooms. Only an empty account can receive a transfer."; return trRender(); }
      const t = await trDb().doc(code).get();
      if (!t.exists || t.data().status !== "open" || t.data().expiresAt.toMillis() < Date.now()){ TR.msg = "Code not found, already used, or expired."; return trRender(); }
      if (t.data().fromUid === currentUser.uid){ TR.msg = "You can't transfer to yourself."; return trRender(); }
      await trDb().doc(code).update({status:"requested", toUid:currentUser.uid, toEmail:currentUser.email || ""});
      await db.collection("incomingTransfer").doc(currentUser.uid).set({code, fromUid:t.data().fromUid});
      await trLoad();
    } else if (id === "trApprove"){
      if (!confirm("Transfer ALL data to " + (TR.out.toEmail || "the new account") + "?\n\nAfter this, this account will have no data. This cannot be undone.")) return;
      await trRun();
    }
  }catch(err){ console.error("Transfer failed", err); TR.msg = "Transfer problem: " + (err.code === "permission-denied" ? "permission denied. This transfer is not approved for this account." : err.message); TR.busy = false; trRender(); }
});

async function trRun(){
  const t = TR.out; TR.busy = true; trRender();
  await trDb().doc(t.code).update({status:"approved"});
  const from = db.collection("users").doc(currentUser.uid), to = db.collection("users").doc(t.toUid);
  const moved = [];
  for (const col of TRANSFER_COLLECTIONS){
    const snap = await from.collection(col).get();
    const docs = snap.docs.filter(d=>!(col === "settings" && d.id === "viewerAccess"));   // the viewer server stays with the old account
    for (let i = 0; i < docs.length; i += 400){
      const batch = db.batch(); docs.slice(i, i+400).forEach(d=>batch.set(to.collection(col).doc(d.id), d.data()));
      await batch.commit();
    }
    // verify the copy arrived before anything is deleted
    const check = await to.collection(col).get();
    if (check.size < docs.length) throw new Error("Copy of " + col + " was incomplete. Nothing was deleted.");
    moved.push({col, docs:snap.docs});
  }
  for (const m of moved){
    for (let i = 0; i < m.docs.length; i += 400){
      const batch = db.batch(); m.docs.slice(i, i+400).forEach(d=>{ if (!(m.col === "settings" && d.id === "viewerAccess")) batch.delete(d.ref); });
      await batch.commit();
    }
  }
  await trDb().doc(t.code).update({status:"done"});
  alert("Transfer finished. This account now has no data. You will be signed out.");
  if (typeof auth !== "undefined") await auth.signOut(); else location.reload();
}

window.addEventListener("load", ()=>{
  const sw = switchTab;
  switchTab = function(tab){ sw(tab); if (tab === "transfer"){ trLoad(); clearInterval(TR.timer); TR.timer = setInterval(()=>{ if (activeTab === "transfer" && !TR.busy) trLoad(); else if (activeTab !== "transfer") clearInterval(TR.timer); }, 8000); } };
});
