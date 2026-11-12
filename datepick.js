/* datepick.js — one calendar for the whole system. Replaces the browser's date / date-time pickers.
   Opens centered over a blurred page, in the colours of the current theme. Values keep the same format as the native inputs. */
(function(){
  const pad = n => String(n).padStart(2,"0");
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  let overlay, st = null;

  function parse(input){
    const v = input.value || "", d = new Date();
    let y = d.getFullYear(), m = d.getMonth(), day = null, hh = 12, mm = 0;
    const mt = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (mt){ y = +mt[1]; m = +mt[2]-1; day = +mt[3]; if (mt[4] !== undefined){ hh = +mt[4]; mm = +mt[5]; } }
    return {vy:y, vm:m, sel:day ? {y, m, d:day} : null, hh, mm};
  }
  function ensure(){
    if (overlay) return;
    overlay = document.createElement("div"); overlay.className = "dp-overlay";
    overlay.innerHTML = '<div class="dp-card" role="dialog" aria-modal="true" aria-label="Choose a date"></div>';
    overlay.addEventListener("mousedown", e=>{ if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
    document.addEventListener("keydown", e=>{ if (e.key === "Escape" && st) close(); });
  }
  function close(){ if (overlay) overlay.classList.remove("open"); document.body.classList.remove("dp-open"); st = null; }
  function apply(){
    if (!st) return;
    const {input, sel, hh, mm, time} = st;
    if (!sel) input.value = "";
    else { const ds = `${sel.y}-${pad(sel.m+1)}-${pad(sel.d)}`; input.value = time ? `${ds}T${pad(hh)}:${pad(mm)}` : ds; }
    input.dispatchEvent(new Event("input", {bubbles:true})); input.dispatchEvent(new Event("change", {bubbles:true}));
    close();
  }
  function render(){
    const card = overlay.firstElementChild, {vy, vm, sel, time} = st;
    const lead = (new Date(vy, vm, 1).getDay() + 6) % 7, days = new Date(vy, vm+1, 0).getDate();
    const t = new Date(), isToday = d => t.getFullYear() === vy && t.getMonth() === vm && t.getDate() === d;
    let cells = ""; for (let i = 0; i < lead; i++) cells += "<i></i>";
    for (let d = 1; d <= days; d++){
      const on = sel && sel.y === vy && sel.m === vm && sel.d === d;
      cells += `<button type="button" data-d="${d}" class="${on ? "sel" : ""} ${isToday(d) ? "today" : ""}">${d}</button>`;
    }
    const opts = (n, cur) => Array.from({length:n}, (_, i)=>`<option value="${i}" ${i === cur ? "selected" : ""}>${pad(i)}</option>`).join("");
    card.innerHTML = `
      <header><button type="button" data-nav="-1" aria-label="Previous month">‹</button><h3>${MONTHS[vm]}</h3><button type="button" data-nav="1" aria-label="Next month">›</button><span class="dp-sp"></span><small>${vy}</small></header>
      <div class="dp-week"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
      <div class="dp-grid">${cells}</div>
      ${time ? `<div class="dp-time"><span>Time</span><select data-t="hh" aria-label="Hour">${opts(24, st.hh)}</select><b>:</b><select data-t="mm" aria-label="Minute">${opts(60, st.mm)}</select></div>` : ""}
      <footer><button type="button" data-act="clear">Clear</button><button type="button" data-act="today">Today</button><span class="dp-sp"></span><button type="button" data-act="done" class="dp-primary">Done</button></footer>`;
  }
  document.addEventListener("click", e=>{
    if (!st || !overlay.contains(e.target)) return;
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.nav){ st.vm += +b.dataset.nav; if (st.vm < 0){ st.vm = 11; st.vy--; } if (st.vm > 11){ st.vm = 0; st.vy++; } render(); }
    else if (b.dataset.d){ st.sel = {y:st.vy, m:st.vm, d:+b.dataset.d}; if (!st.time) apply(); else render(); }
    else if (b.dataset.act === "clear"){ st.sel = null; apply(); }
    else if (b.dataset.act === "today"){ const n = new Date(); st.vy = n.getFullYear(); st.vm = n.getMonth(); st.sel = {y:st.vy, m:st.vm, d:n.getDate()}; if (st.time){ st.hh = n.getHours(); st.mm = n.getMinutes(); render(); } else apply(); }
    else if (b.dataset.act === "done"){ if (!st.sel){ const n = new Date(); st.sel = {y:st.vy, m:st.vm, d:(n.getMonth() === st.vm && n.getFullYear() === st.vy) ? n.getDate() : 1}; } apply(); }
  });
  document.addEventListener("change", e=>{ if (st && e.target.dataset && e.target.dataset.t){ st[e.target.dataset.t] = +e.target.value; } });
  function open(input){
    ensure();
    st = {input, time:input.dataset.dpType === "datetime-local", ...parse(input)};
    render(); overlay.classList.add("open"); document.body.classList.add("dp-open");
  }
  function wrap(input){
    if (input.dataset.dp) return;
    const type = input.type;
    if (type !== "date" && type !== "datetime-local") return;
    input.dataset.dp = "1"; input.dataset.dpType = type;
    const w = document.createElement("span"); w.className = "dp-wrap";
    input.parentNode.insertBefore(w, input); w.appendChild(input);
    const hit = document.createElement("button"); hit.type = "button"; hit.className = "dp-hit"; hit.tabIndex = -1; hit.setAttribute("aria-label", "Choose a date");
    hit.addEventListener("click", e=>{ e.preventDefault(); open(input); });
    w.appendChild(hit);
  }
  const scan = ()=>document.querySelectorAll('input[type="date"]:not([data-dp]),input[type="datetime-local"]:not([data-dp])').forEach(wrap);
  document.addEventListener("DOMContentLoaded", scan);
  new MutationObserver(scan).observe(document.documentElement, {childList:true, subtree:true});
})();
