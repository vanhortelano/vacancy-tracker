// js/21-checkout-carousel.js — Checkout Schedule: full-width 3D month carousel with embedded controls,
// gesture-isolated scrolling, and a calendar modal (Done + typable year).
// Load AFTER js/14-canvas-tabs.js and BEFORE js/99-main.js. It overrides renderCalendar().
(function(){
  const SIDES = 15, STEP = 360 / SIDES, HALF = 7;
  const CO = {live:false, radius:0, angle:0, center:0, dragging:false, pending:false, g:null, token:0, suppress:false, active:0, byMonth:{}};
  const CM = {open:false, vy:0, vm:0, sel:null};
  let coSelDay = null, modal = null;
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, "0");
  const keyOf = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const monthBase = () => { const b = new Date(); return b.getFullYear() * 12 + b.getMonth(); };
  const monthDate = off => { const b = new Date(); return new Date(b.getFullYear(), b.getMonth() + off, 1); };
  const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------ cards ------------------------------ */
  function cardHtml(slot, live){
    const idx = CO.center + slot, d = monthDate(idx), list = CO.byMonth[idx] || [];
    const title = d.toLocaleDateString([], {month:"long", year:"numeric"});
    const sub = list.length + " checkout" + (list.length === 1 ? "" : "s") + " scheduled";
    const body = list.length ? list.map(item => {
      const p = checkoutProximityFor(item.date);
      const overdue = bedStatus(item.bed, item.room) === "overdue";
      const badge = p.key === "near" ? (overdue ? "OVERDUE" : Math.max(0, p.days) + " DAY" + (p.days === 1 ? "" : "S") + " LEFT")
        : p.key === "moderate" ? "Approaching · " + p.days + "d" : "Future";
      const bedData = escapeHtml(JSON.stringify([item.room.id, item.index]));
      const hit = coSelDay && keyOf(item.date) === coSelDay ? " hit" : "";
      return `<div class="co-guest${hit}">
        <div class="co-guest-top"><strong>${escapeHtml(item.bed.tenant)}</strong><span class="co-badge ${p.key}">${badge}</span></div>
        <div class="co-meta"><span>${escapeHtml(item.bed.slot || "Bed")}</span><span>Room ${escapeHtml(item.room.room)}</span><span>${escapeHtml(residentGenderForBed(item.room, item.bed))}</span></div>
        <div class="co-meta"><span>${fmtDate(item.bed.end)}</span></div>
        <div class="co-actions">
          <button type="button" data-canvas-action="edit-room" data-room="${escapeHtml(item.room.id)}">Edit</button>
          <button type="button" data-canvas-action="extend" data-bed="${bedData}">Extend</button>
          <button type="button" data-canvas-action="checkout" data-bed="${bedData}">Check out</button>
          <button type="button" data-canvas-action="inspect" data-room="${escapeHtml(item.room.id)}">Inspect</button>
        </div></div>`;
    }).join("") : `<div class="co-empty">No checkouts scheduled for this month.</div>`;
    return `<div class="co-card${live ? " is-active" : ""}" data-slot="${slot}" data-idx="${idx}">${live ? "" : '<div class="co-overlay"></div>'}
      <div class="co-head"><div><h3>${escapeHtml(title)}</h3><p>${sub}</p></div><span class="co-count">${list.length}</span></div>
      <div class="co-list">${body}</div></div>`;
  }

  /* ------------------------------ 3D geometry ------------------------------ */
  function metrics(){
    const track = $("coTrack"); if (!track) return;
    CO.radius = track.clientWidth * 0.9 / (2 * Math.sin(Math.PI / SIDES));
  }
  function setAngle(a, animate){
    const track = $("coTrack"); if (!track) return;
    CO.angle = a;
    track.style.transition = animate && !reduced ? "transform 460ms cubic-bezier(.2,.75,.25,1)" : "none";
    // The cylinder axis sits at +radius so the centered card lands on the screen plane at full size.
    track.style.transform = `translate(-50%,-50%) translateZ(${CO.radius}px) rotateY(${a}deg)`;
    placeCards();
  }
  const clampIdx = i => Math.max(CO.center - HALF, Math.min(CO.center + HALF, i));
  const currentIdx = () => clampIdx(CO.center + Math.round(CO.angle / STEP));
  function placeCards(){
    const stage = $("coStage"); if (!stage) return;
    const act = currentIdx();
    stage.querySelectorAll("#coTrack .co-card").forEach(card => {
      const sel = Number(card.dataset.idx) === act, ca = -Number(card.dataset.slot) * STEP;   // next month sits to the RIGHT
      card.style.transform = `rotateY(${ca}deg) translateZ(-${CO.radius}px) scale(${sel ? 1 : 0.9})`;
      card.classList.toggle("is-active", sel);
      // while moving: the 3D card is what you see; once settled: the real live card replaces it
      card.classList.toggle("is-swapped", sel && CO.live);
      card.querySelector(".co-overlay").style.opacity = sel ? "0" : "0.62";
    });
    if (act !== CO.active){ CO.active = act; paintActive(); }
  }
  function setLive(on){
    CO.live = on;
    const el = $("coLive"); if (el) el.classList.toggle("on", on);
    placeCards();
  }
  function paintActive(){
    const el = $("coActive"); if (!el) return;
    const d = monthDate(CO.active), n = (CO.byMonth[CO.active] || []).length;
    el.innerHTML = `<div><b>${escapeHtml(d.toLocaleDateString([], {month:"long", year:"numeric"}))}</b><small>${n} checkout${n === 1 ? "" : "s"} scheduled</small></div><span>${n} Checkout${n === 1 ? "" : "s"}</span>`;
  }

  function rotateTo(target){
    checkoutPickerOpen = false;
    if (!$("coTrack")){ calOffset = target; renderCalendar(); return; }
    const diff = target - CO.center, token = ++CO.token;
    if (diff === 0) return;
    setLive(false);
    if (Math.abs(diff) > HALF){ calOffset = target; renderCalendar(); return; }
    setAngle(diff * STEP, true);
    setTimeout(() => { if (token === CO.token){ calOffset = target; renderCalendar(); } }, reduced ? 0 : 490);
  }
  function snap(){
    const idx = currentIdx(), token = ++CO.token;
    setAngle((idx - CO.center) * STEP, true);
    setTimeout(() => { if (token === CO.token){ calOffset = idx; renderCalendar(); } }, reduced ? 0 : 490);
  }

  // Native vertical scrolling inside cards: wheel/touch scrolling never reaches the carousel handlers.
  function wireLists(){
    document.querySelectorAll("#coStage .co-list").forEach(list => {
      const stop = e => e.stopPropagation();
      list.addEventListener("wheel", stop, {passive:true});
      list.addEventListener("touchmove", stop, {passive:true});
    });
  }

  /* ------------------------------ gesture isolation ------------------------------
     A press starts as "pending". After ~6px of movement the axis decides what it is:
       - started inside a card's scroll list: horizontal-dominant -> rotate carousel; otherwise -> scroll that list only
       - started outside any list:            horizontal -> rotate carousel; vertical -> ignored (page may scroll)
     Once decided, the mode never changes until the pointer is released. */
  function wireStage(){
    const stage = $("coStage"); if (!stage) return;
    stage.addEventListener("pointerdown", e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest("button") || e.target.closest(".co-btn")) return;
      const list = e.target.closest(".co-list");
      ++CO.token; CO.pending = true;
      CO.g = {id:e.pointerId, x:e.clientX, y:e.clientY, type:e.pointerType, list, top:list ? list.scrollTop : 0, mode:"pending", sa:CO.angle};
    });
    stage.addEventListener("pointermove", e => {
      const g = CO.g; if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x, dy = e.clientY - g.y, ax = Math.abs(dx), ay = Math.abs(dy);
      if (g.mode === "pending"){
        if (Math.max(ax, ay) < 6) return;
        g.mode = g.list ? (ax > ay * 1.5 ? "rotate" : "scroll") : (ax >= ay * 0.8 ? "rotate" : "ignore");
        CO.suppress = true;
        if (g.mode === "rotate"){ CO.dragging = true; setLive(false); g.sa = CO.angle; stage.classList.add("grabbing"); }
        if ((g.mode === "rotate" || (g.mode === "scroll" && g.type === "mouse")) ){ try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
      }
      if (g.mode === "rotate"){
        const pxStep = Math.max(120, Math.min(190, stage.clientWidth * 0.2));
        const max = STEP * (HALF + 0.45);
        // content follows the finger: drag left = next month (January -> December), drag right = previous
        setAngle(Math.max(-max, Math.min(max, g.sa - (dx / pxStep) * STEP)), false);
      } else if (g.mode === "scroll" && g.type === "mouse" && g.list){
        g.list.scrollTop = g.top - dy;     // touch scrolls natively; mouse needs help. Carousel never moves.
      }
    });
    const end = e => {
      const g = CO.g; if (!g || (e && e.pointerId !== undefined && e.pointerId !== g.id)) return;
      CO.g = null; CO.pending = false; stage.classList.remove("grabbing");
      setTimeout(() => { CO.suppress = false; }, 100);
      if (g.mode === "rotate"){ CO.dragging = false; snap(); }
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);   // browser took a vertical touch pan: scroll only, no rotation
    stage.addEventListener("lostpointercapture", end);
    stage.addEventListener("dragstart", e => e.preventDefault());
    stage.addEventListener("click", e => {
      if (CO.suppress || e.target.closest("button")) return;
      const card = e.target.closest(".co-card"); if (!card) return;
      const idx = Number(card.dataset.idx);
      if (idx !== CO.center) rotateTo(idx);
    });
  }

  /* ------------------------------ render ------------------------------ */
  window.renderCalendar = function renderCalendar(){
    const host = $("checkoutList"); if (!host || CO.dragging || CO.pending) return;
    const items = checkoutItems();
    const counts = {near:0, moderate:0, far:0};
    items.forEach(i => counts[checkoutProximityFor(i.date).key]++);
    const filtered = items.filter(i => checkoutProximity === "all" || checkoutProximityFor(i.date).key === checkoutProximity);
    const base = monthBase();
    CO.byMonth = {};
    filtered.forEach(i => { const o = i.date.getFullYear() * 12 + i.date.getMonth() - base; (CO.byMonth[o] = CO.byMonth[o] || []).push(i); });
    // keep the open card's scroll position across the 1-minute refresh (same month only)
    const keepList = $("coStage") && CO.center === calOffset ? document.querySelector("#coLive .co-list") : null;
    const keepTop = keepList ? keepList.scrollTop : 0;
    CO.center = calOffset; CO.active = calOffset; CO.angle = 0; ++CO.token;

    const filters = [["all","All"],["near",`Near (${counts.near})`],["moderate",`Moderate (${counts.moderate})`],["far",`Far (${counts.far})`]]
      .map(([k,l]) => `<button type="button" class="co-btn ${checkoutProximity === k ? "active" : ""}" data-canvas-action="checkout-filter" data-filter="${k}">${l}</button>`).join("");
    let cards = ""; for (let s = -HALF; s <= HALF; s++) cards += cardHtml(s);

    host.innerHTML = `<div class="co-stage" id="coStage" aria-label="Checkout schedule carousel">
      <div class="co-ui-top">
        <div class="co-ui-row"><div class="co-ui-title"><h3>Checkout Schedule</h3><small>${items.length} scheduled checkouts</small></div><span class="co-sp"></span>
          <button type="button" class="co-btn arrow" data-canvas-action="checkout-nav" data-delta="-1" aria-label="Previous month">‹</button>
          <button type="button" class="co-btn" data-canvas-action="checkout-active">Jump to Active</button>
          <button type="button" class="co-btn arrow" data-canvas-action="checkout-nav" data-delta="1" aria-label="Next month">›</button>
          <button type="button" class="co-btn" data-canvas-action="checkout-picker" aria-haspopup="dialog" aria-expanded="${checkoutPickerOpen}"><i class="fa-regular fa-calendar"></i> Calendar</button></div>
        <div class="co-ui-row">${filters}<span class="co-scale">Near: overdue / 0–3 days · Moderate: 4–10 days · Far: 11+ days</span></div>
      </div>
      <div class="co-track" id="coTrack">${cards}</div>
      <div class="co-live" id="coLive">${cardHtml(0, true)}</div>
      <div class="co-active" id="coActive"></div></div>`;
    metrics(); setAngle(0, false); paintActive(); wireStage(); wireLists(); setLive(true);
    if (keepTop){ const l = document.querySelector("#coLive .co-list"); if (l) l.scrollTop = keepTop; }
    syncModal();
  };

  /* ------------------------------ calendar modal ------------------------------ */
  function dayMap(){
    const m = {}; checkoutItems().forEach(i => { (m[keyOf(i.date)] = m[keyOf(i.date)] || []).push(i); }); return m;
  }
  function ensureModal(){
    if (modal) return;
    modal = document.createElement("div"); modal.className = "co-modal";
    modal.innerHTML = `<div class="co-modal-card" role="dialog" aria-modal="true" aria-label="Choose a checkout date">
      <header><button type="button" class="co-nav" data-cm="prev" aria-label="Previous month">‹</button><h3 id="coMonth"></h3><button type="button" class="co-nav" data-cm="next" aria-label="Next month">›</button><span class="co-sp"></span>
        <input id="coYear" class="co-year" type="text" inputmode="numeric" maxlength="4" aria-label="Year (type to change)" autocomplete="off"></header>
      <div class="co-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
      <div class="co-grid" id="coGrid"></div><div class="co-day-list" id="coDayList"></div>
      <footer><button type="button" data-cm="clear">Clear</button><span class="co-sp"></span><button type="button" data-cm="cancel">Cancel</button><button type="button" class="co-done" id="coDone" data-cm="done">Done</button></footer></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("mousedown", e => { if (e.target === modal){ closeModal(); renderCalendar(); } });
    modal.addEventListener("click", e => {
      const b = e.target.closest("[data-cm],[data-day]"); if (!b) return;
      if (b.dataset.day){ CM.sel = b.dataset.day; paintBody(); return; }
      const a = b.dataset.cm;
      if (a === "prev" || a === "next"){ CM.vm += a === "next" ? 1 : -1; if (CM.vm < 0){ CM.vm = 11; CM.vy--; } if (CM.vm > 11){ CM.vm = 0; CM.vy++; } $("coYear").value = CM.vy; paintBody(); }
      else if (a === "clear"){ CM.sel = null; coSelDay = null; paintBody(); }
      else if (a === "cancel"){ closeModal(); renderCalendar(); }
      else if (a === "done") done();
    });
    const yr = $("coYear");
    const commitYear = () => { const v = parseInt(yr.value, 10); if (v >= 1900 && v <= 2200) CM.vy = v; yr.value = CM.vy; paintBody(); };
    yr.addEventListener("input", () => { yr.value = yr.value.replace(/\D/g, "").slice(0, 4); const v = parseInt(yr.value, 10); if (yr.value.length === 4 && v >= 1900 && v <= 2200){ CM.vy = v; paintBody(); } });
    yr.addEventListener("change", commitYear);
    yr.addEventListener("keydown", e => { if (e.key === "Enter"){ e.preventDefault(); commitYear(); yr.blur(); } });
    yr.addEventListener("focus", () => yr.select());
  }
  function paintBody(){
    $("coMonth").textContent = new Date(CM.vy, CM.vm, 1).toLocaleDateString([], {month:"long"});
    if (document.activeElement !== $("coYear")) $("coYear").value = CM.vy;
    const by = dayMap(), lead = (new Date(CM.vy, CM.vm, 1).getDay() + 6) % 7, days = new Date(CM.vy, CM.vm + 1, 0).getDate(), today = keyOf(new Date());
    let cells = ""; for (let i = 0; i < lead; i++) cells += "<i></i>";
    for (let d = 1; d <= days; d++){
      const k = CM.vy + "-" + pad(CM.vm + 1) + "-" + pad(d);
      cells += `<button type="button" data-day="${k}" class="${k === CM.sel ? "sel" : ""} ${k === today ? "today" : ""}">${d}${by[k] ? "<i></i>" : ""}</button>`;
    }
    $("coGrid").innerHTML = cells;
    const list = CM.sel ? (by[CM.sel] || []) : [];
    $("coDayList").innerHTML = !CM.sel ? '<span class="co-day-none">Pick a date to see who checks out.</span>'
      : list.length ? list.map(i => `<div><strong>${escapeHtml(i.bed.tenant)}</strong><em>Room ${escapeHtml(i.room.room)} · ${escapeHtml(i.bed.slot || "")}</em></div>`).join("")
      : '<span class="co-day-none">No checkouts on this day.</span>';
    $("coDone").disabled = !CM.sel;
  }
  function openModal(){
    ensureModal();
    const t = monthDate(calOffset);
    CM.vy = t.getFullYear(); CM.vm = t.getMonth(); CM.sel = coSelDay; CM.open = true;
    paintBody(); modal.classList.add("open");
  }
  function closeModal(){
    checkoutPickerOpen = false; CM.open = false;
    if (modal) modal.classList.remove("open");
  }
  function syncModal(){
    if (checkoutPickerOpen && !CM.open) openModal();
    else if (!checkoutPickerOpen && CM.open) closeModal();
  }
  function done(){
    if (!CM.sel) return;
    coSelDay = CM.sel;
    const [y, m] = CM.sel.split("-").map(Number), n = new Date();
    calOffset = (y - n.getFullYear()) * 12 + (m - 1) - n.getMonth();
    closeModal(); renderCalendar();
  }

  /* ------------------------------ animated navigation ------------------------------ */
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-canvas-action]"); if (!b) return;
    const a = b.dataset.canvasAction;
    if (a === "checkout-nav"){ e.stopImmediatePropagation(); rotateTo(calOffset + Number(b.dataset.delta)); }
    else if (a === "checkout-active"){
      e.stopImmediatePropagation();
      const n = new Date(), first = checkoutItems().find(i => i.date >= new Date(n.getFullYear(), n.getMonth(), 1));
      const d = first ? first.date : n;
      rotateTo((d.getFullYear() - n.getFullYear()) * 12 + d.getMonth() - n.getMonth());
    }
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && CM.open){ closeModal(); renderCalendar(); return; }
    if (typeof activeTab === "undefined" || activeTab !== "calendar" || CM.open) return;
    if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) return;
    if (e.key === "ArrowLeft") rotateTo(calOffset - 1);
    if (e.key === "ArrowRight") rotateTo(calOffset + 1);
  });
  window.addEventListener("resize", () => { metrics(); setAngle(CO.angle, false); });
})();