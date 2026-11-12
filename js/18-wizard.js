// js/18-wizard.js — "Add reserve client" / "Add temporary client": one clean pop-up, one question at a time.
// The old form fields stay in the page (hidden) and hold the values; the existing scan/save logic does the work.
(function(){
  const $ = id => document.getElementById(id);
  const esc = s => escapeHtml(String(s == null ? "" : s));
  const STEPS = {reserve:["type","who","details","scan","confirm"], temp:["type","who","details","scan","transfer","confirm"]};
  let W = null, overlay = null, holder = null;

  function ensure(){
    if (overlay) return;
    holder = document.createElement("div"); holder.hidden = true; holder.id = "wzHolder"; document.body.appendChild(holder);
    overlay = document.createElement("div"); overlay.className = "wz-overlay";
    overlay.innerHTML = '<div class="wz-card" role="dialog" aria-modal="true"><div class="wz-head"><div><small id="wzKicker"></small><h3 id="wzTitle"></h3></div><button type="button" class="wz-x" data-wz="cancel" aria-label="Close">✕</button></div><div class="wz-dots" id="wzDots"></div><div class="wz-body" id="wzBody"></div><div class="wz-foot" id="wzFoot"></div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener("mousedown", e=>{ if (e.target === overlay) close(); });
    overlay.addEventListener("click", onClick);
    overlay.addEventListener("input", onInput);
    document.addEventListener("keydown", e=>{ if (e.key === "Escape" && W) close(); });
    // a scan result was picked -> go on to the next question
    document.addEventListener("click", e=>{ if (W && e.target.closest(".scan-opt")) setTimeout(afterPick, 160); });
    document.addEventListener("input", e=>{ if (W && W.kind === "temp" && e.target.matches("[data-troom]")) setTimeout(()=>refreshFoot(), 30); });
  }
  const opts = (sel, cur) => Array.from($(sel).options).map(o=>`<option value="${esc(o.value)}" ${o.value === cur ? "selected" : ""}>${esc(o.textContent)}</option>`).join("");
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const stepList = () => STEPS[W.kind].filter(s => !(s === "scan" && false));
  const park = () => ["prospectScanResults","tScan","tTransferScan"].forEach(id=>{ const el = $(id); if (el && holder && el.parentNode !== holder) holder.appendChild(el); });
  const need = () => W.mode === "group" ? W.count : 1;
  function open(kind){
    ensure();
    const dt = $(kind === "reserve" ? "pCheckIn" : "tStart").type;
    W = {kind, step:"type", mode:null, phase:"count", count:2, names:[], gender:"Male", demo:"Student", checkIn:"", checkOut:"", notes:"", afterOut:"", dtType:dt};
    overlay.classList.add("open"); document.body.classList.add("wz-open"); render();
  }
  function close(){ if (!W) return; park(); overlay.classList.remove("open"); document.body.classList.remove("wz-open"); W = null; }

  // ---- values into the hidden form fields (so the existing logic can be reused) ----
  function syncReserve(){
    setReserveMode(W.mode);
    if (W.mode === "group"){ $("pGroupSize").value = W.count; drawGroupNames(); document.querySelectorAll("#pGroupNames input").forEach((i,k)=>i.value = W.names[k] || ""); }
    else $("pName").value = W.names[0] || "";
    $("pGender").value = W.gender; $("pDemographic").value = W.demo; $("pCheckIn").value = W.checkIn; $("pCheckOut").value = W.checkOut; $("pNotes").value = W.notes;
  }
  function syncTemp(){
    setTempMode(W.mode);
    if (W.mode === "group"){ $("tGroupSize").value = W.count; drawTempNames(); document.querySelectorAll("#tGroupNames input").forEach((i,k)=>i.value = W.names[k] || ""); }
    else $("tName").value = W.names[0] || "";
    $("tGender").value = W.gender; $("tStart").value = W.checkIn; $("tNotes").value = W.notes; $("tDemo").value = W.demo; $("tAfterOut").value = W.afterOut;
  }

  function titleFor(){ return W.kind === "reserve" ? "Add reserve client" : "Add temporary client"; }
  function render(){
    park();
    $("wzKicker").textContent = W.kind === "reserve" ? "Reservation" : "Temporary stay";
    const list = STEPS[W.kind], idx = list.indexOf(W.step);
    $("wzDots").innerHTML = list.map((s,i)=>`<i class="${i < idx ? "done" : i === idx ? "on" : ""}"></i>`).join("");
    const body = $("wzBody"); let title = "", html = "";
    if (W.step === "type"){
      title = "Single or group?";
      html = `<div class="wz-choice"><button type="button" data-wz="mode" data-mode="single"><b>Single</b><span>One person</span></button><button type="button" data-wz="mode" data-mode="group"><b>Group</b><span>Several people together</span></button></div>`;
    } else if (W.step === "who"){
      if (W.mode === "group" && W.phase === "count"){ title = "How many are in the group?"; html = field("Number of members", `<input type="number" id="wzCount" min="2" max="12" value="${W.count}">`); }
      else if (W.mode === "group"){ title = "Who are they?"; html = Array.from({length:W.count}, (_,i)=>field("Member " + (i+1), `<input type="text" data-name="${i}" placeholder="Full name" value="${esc(W.names[i])}">`)).join(""); }
      else { title = "What is the client's name?"; html = field("Full name", `<input type="text" data-name="0" placeholder="Full name" value="${esc(W.names[0])}">`); }
    } else if (W.step === "details"){
      title = "Details";
      html = field("Gender", `<select data-f="gender">${opts(W.kind === "reserve" ? "pGender" : "tGender", W.gender)}</select>`);
      if (W.kind === "reserve") html += field("Resident group", `<select data-f="demo">${opts("pDemographic", W.demo)}</select>`);
      html += field("Check-in", `<input type="${W.dtType}" data-f="checkIn" value="${esc(W.checkIn)}">`);
      if (W.kind === "reserve") html += field("Check-out (optional)", `<input type="${W.dtType}" data-f="checkOut" value="${esc(W.checkOut)}">`);
      html += field("Notes (optional)", `<textarea rows="2" data-f="notes">${esc(W.notes)}</textarea>`);
    } else if (W.step === "scan"){
      title = W.kind === "reserve" ? "Free beds that fit" : "Rooms with a vacancy";
      html = '<div class="wz-scroll" id="wzScroll"></div>';
    } else if (W.step === "transfer"){
      title = "Where will they move to?";
      html = field("Resident group after the move", `<select data-f="demo" id="wzDemo">${opts("tDemo", W.demo)}</select>`) + '<div class="wz-scroll" id="wzScroll2"></div>';
    } else if (W.step === "confirm"){
      title = "Check and add";
      html = confirmHtml();
    }
    $("wzTitle").textContent = title; body.innerHTML = html;
    if (W.step === "scan") runScan();
    if (W.step === "transfer") runTransferScan();
    refreshFoot(); const first = body.querySelector("input,select,textarea"); if (first && W.step !== "type") setTimeout(()=>first.focus(), 60);
  }

  function runScan(){
    if (W.kind === "reserve"){ syncReserve(); scanReserveVacancies(); $("wzScroll").appendChild($("prospectScanResults")); }
    else { syncTemp(); scanTemporaryRooms(); $("wzScroll").appendChild($("tScan")); }
  }
  function runTransferScan(){ syncTemp(); collectTempPicks(); scanTransferRooms(); $("wzScroll2").appendChild($("tTransferScan")); }

  function confirmHtml(){
    const row = (k,v)=>`<div class="wz-row"><span>${k}</span><b>${v}</b></div>`;
    const names = W.names.slice(0, need()).map(esc).join(", ");
    if (W.kind === "reserve"){
      const ch = reserveChoice ? `Room ${esc((rooms.find(r=>r.id === reserveChoice.roomId)||{}).room)} · ${esc(reserveChoice.slots.join(", "))}` : "Not picked (assign later)";
      return row("Type", W.mode === "group" ? "Group of " + W.count : "Single") + row(W.mode === "group" ? "Members" : "Name", names) + row("Gender", esc(W.gender)) + row("Resident group", esc(W.demo)) + row("Check-in", esc(fmtDate(isoLocalDateTime(W.checkIn)))) + (W.checkOut ? row("Check-out", esc(fmtDate(isoLocalDateTime(W.checkOut)))) : "") + row("Reserved bed", ch);
    }
    const temp = tempPicks.map(p=>`Room ${esc((rooms.find(r=>r.id === p.roomId)||{}).room)} · ${esc(p.slot)}`).join("<br>");
    const to = transferPick ? `Room ${esc((rooms.find(r=>r.id === transferPick.roomId)||{}).room)} · ${esc(transferPick.slots.join(", "))}` : "—";
    return row("Type", W.mode === "group" ? "Group of " + W.count : "Single") + row(W.mode === "group" ? "Members" : "Name", names) + row("Check-in", esc(fmtDate(isoLocalDateTime(W.checkIn)))) + row("Temporary room", temp) + row("Moves to", to) + row("Temporary check-out", esc(tempFree ? fmtDate(tempFree) : "—")) +
      field("Check-out date after the move", `<input type="${W.dtType}" data-f="afterOut" value="${esc(W.afterOut)}">`);
  }

  function ready(){ // can we go on from this step?
    if (W.step === "who") return W.mode === "group" && W.phase === "count" ? W.count >= 2 : W.names.slice(0, need()).length === need() && W.names.slice(0, need()).every(n=>n && n.trim());
    if (W.step === "details") return !!W.checkIn;
    if (W.step === "scan") return W.kind === "reserve" ? true : tempPicks.length === need();
    if (W.step === "transfer") return !!transferPick;
    return true;
  }
  function refreshFoot(){
    const list = STEPS[W.kind], idx = list.indexOf(W.step), last = idx === list.length - 1;
    const back = idx > 0 ? '<button type="button" class="wz-ghost" data-wz="back">Back</button>' : '<button type="button" class="wz-ghost" data-wz="cancel">Cancel</button>';
    let primary = "";
    if (W.step === "type") primary = "";
    else if (last) primary = `<button type="button" class="wz-primary" data-wz="add">${titleFor()}</button>`;
    else primary = `<button type="button" class="wz-primary" data-wz="next" ${ready() ? "" : "disabled"}>${W.step === "scan" && W.kind === "reserve" && !reserveChoice ? "Skip, assign later" : "Next"}</button>`;
    $("wzFoot").innerHTML = back + '<span class="wz-sp"></span>' + primary;
  }
  function go(delta){
    const list = STEPS[W.kind], i = list.indexOf(W.step) + delta;
    if (W.step === "who" && delta < 0 && W.mode === "group" && W.phase === "names"){ W.phase = "count"; return render(); }
    if (i < 0 || i >= list.length) return;
    W.step = list[i]; render();
  }
  function afterPick(){
    if (!W) return;
    if (W.step === "scan" && W.kind === "reserve" && reserveChoice) return go(1);
    if (W.step === "scan" && W.kind === "temp" && W.mode === "single" && tempPicks.length === 1) return go(1);
    if (W.step === "transfer" && transferPick) return go(1);
    refreshFoot();
  }
  async function add(){
    if (W.kind === "reserve"){ syncKeepChoice(); await addProspect(); if ($("pCheckIn").value === "") close(); }
    else { const keep = {p:tempPicks, x:transferPick, f:tempFree}; syncTemp(); tempPicks = keep.p; transferPick = keep.x; tempFree = keep.f; await addTemporaryClient(); if ($("tStart").value === "") close(); }
  }
  function syncKeepChoice(){ const keep = reserveChoice; syncReserve(); reserveChoice = keep; }

  function onClick(e){
    const b = e.target.closest("[data-wz]"); if (!b || !W) return;
    const a = b.dataset.wz;
    if (a === "cancel") close();
    else if (a === "back") go(-1);
    else if (a === "mode"){ W.mode = b.dataset.mode; W.phase = "count"; go(1); }
    else if (a === "next"){
      if (W.step === "who" && W.mode === "group" && W.phase === "count"){ W.phase = "names"; return render(); }
      go(1);
    } else if (a === "add") add();
  }
  function onInput(e){
    const t = e.target;
    if (t.id === "wzCount") W.count = Math.max(2, Math.min(12, parseInt(t.value, 10) || 2));
    else if (t.dataset.name !== undefined) W.names[+t.dataset.name] = t.value;
    else if (t.dataset.f){ W[t.dataset.f] = t.value; if (t.id === "wzDemo" && W.step === "transfer") runTransferScan(); }
    if (W && ["who","details","transfer"].includes(W.step)) { const n = overlay.querySelector('[data-wz="next"]'); if (n) n.disabled = !ready(); }
  }
  document.addEventListener("click", e=>{
    if (e.target.closest("#openReserveWizard")) open("reserve");
    if (e.target.closest("#openTempWizard")) open("temp");
  });
  document.addEventListener("keydown", e=>{ if (W && e.key === "Enter" && e.target.matches("input[type=text],input[type=number]")){ const n = overlay.querySelector('[data-wz="next"]'); if (n && !n.disabled) n.click(); } });
})();
