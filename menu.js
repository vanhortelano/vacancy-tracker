/* menu.js — the TERRINSPROJECT logo is the menu button on every page.
   Pages with tabs: the logo slides the tabs in/out. Other pages: it opens a small menu (Home, Light/Night, Sign out). */
(function(){
  const $ = (s, r)=>(r||document).querySelector(s);
  const ico = {
    home:'<svg viewBox="0 0 24 24"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    theme:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    out:'<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>',
    roles:'<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M17 5.5a3 3 0 0 1 0 5.5M21.5 20c-.4-2.4-1.8-4-3.8-4.8"/></svg>'
  };
  const visible = el => el && el.getClientRects().length > 0;
  function themeButton(){
    const ids = ["appThemeToggle","portalThemeToggle","themeB","themeA","vThemeToggle","heroThemeToggle","mobileThemeToggle"];
    const all = ids.map(id=>document.getElementById(id)).filter(Boolean);
    return all.find(b=>visible(b) && !b.classList.contains("hero-theme-toggle") && !b.classList.contains("mobile-theme-toggle")) || document.getElementById("portalThemeToggle") || all[0];
  }
  const backdrop = document.createElement("div"); backdrop.className = "mx-backdrop";
  document.addEventListener("DOMContentLoaded", ()=>document.body.appendChild(backdrop));
  const setDrawer = open => document.body.classList.toggle("menu-open", open);
  backdrop.addEventListener("click", ()=>{ setDrawer(false); closePop(); });
  document.addEventListener("keydown", e=>{ if (e.key === "Escape"){ setDrawer(false); closePop(); } });

  /* ---- pop-up menu ---- */
  const pop = document.createElement("div"); pop.className = "mx-pop"; pop.setAttribute("role","menu");
  document.addEventListener("DOMContentLoaded", ()=>document.body.appendChild(pop));
  const closePop = ()=>{ pop.classList.remove("open"); document.body.classList.remove("pop-open"); };
  document.addEventListener("click", e=>{ if (!pop.contains(e.target) && !e.target.closest(".mx-logo") && !e.target.closest(".mx-backdrop")) closePop(); });
  function openPop(anchor){
    const items = [];
    const back = document.getElementById("backToRolesBtn");
    items.push({icon:ico.home, text:"Home", run:()=>{ if (visible(back)) back.click(); else location.href = "index.html"; }});
    const tb = themeButton();
    if (tb) items.push({icon:ico.theme, text:"Light / Night mode", keep:true, run:()=>tb.click()});
    const out = ["outBtn","vSignOut","signOutBtn"].map(id=>document.getElementById(id)).find(b=>visible(b));
    if (out) items.push({icon:ico.out, text:"Sign out", run:()=>out.click()});
    pop.innerHTML = "";
    items.forEach(it=>{
      const b = document.createElement("button"); b.type = "button"; b.setAttribute("role","menuitem");
      b.innerHTML = it.icon + "<span>" + it.text + "</span>";
      b.onclick = ()=>{ if (!it.keep) closePop(); it.run(); };
      pop.appendChild(b);
    });
    const open = !pop.classList.contains("open");
    pop.classList.toggle("open", open);
    document.body.classList.toggle("pop-open", open);
  }

  function bindPop(el){
    if (!el || el.dataset.mx) return; el.dataset.mx = "1";
    el.classList.add("mx-logo"); el.setAttribute("role","button"); el.setAttribute("tabindex","0"); el.setAttribute("aria-label","Menu"); el.title = "Menu";
    const go = e=>{ e.preventDefault(); e.stopImmediatePropagation(); openPop(el); };
    el.addEventListener("click", go, true);
    el.addEventListener("keydown", e=>{ if (e.key === "Enter" || e.key === " ") go(e); }, true);
  }
  function bindDrawer(el){
    if (!el || el.dataset.mx) return; el.dataset.mx = "1";
    el.classList.add("mx-logo"); el.setAttribute("role","button"); el.setAttribute("tabindex","0"); el.setAttribute("aria-label","Menu"); el.title = "Menu";
    const go = e=>{ e.preventDefault(); e.stopPropagation(); setDrawer(!document.body.classList.contains("menu-open")); };
    el.addEventListener("click", go);
    el.addEventListener("keydown", e=>{ if (e.key === "Enter" || e.key === " ") go(e); });
  }

  // Hamburger buttons use delegation, so they keep working however the page re-renders.
  document.addEventListener("click", e=>{
    const t = e.target.closest("[data-menu-toggle]"), p = e.target.closest("[data-menu-popup]");
    if (t){ e.preventDefault(); setDrawer(!document.body.classList.contains("menu-open")); }
    else if (p){ e.preventDefault(); openPop(p); }
  });
  /* "You are here": the current tab's name at the top of the menu */
  function hereLabel(){
    const a = $("nav.tabs button.active") || $(".shell .nav button.on, .shell .nav button.active, .shell .nav button[aria-current]");
    return a ? a.textContent.replace(/\d+\s*$/,"").trim() : "";
  }
  function paintHere(){
    const t = hereLabel(); if (!t) return;
    [$("nav.tabs"), $(".shell .side")].forEach(box=>{
      if (!box) return;
      let h = box.querySelector(".mx-here");
      if (!h){ h = document.createElement("div"); h.className = "mx-here"; box.insertBefore(h, box.firstChild); }
      const html = "<small>You are in</small><b></b>"; if (!h.firstChild) h.innerHTML = html;
      const b = h.querySelector("b"); if (b.textContent !== t) b.textContent = t;
    });
    document.querySelectorAll(".mx-pop .mx-here").forEach(x=>{});
  }
  /* Profile picture: if the account has none (or it fails to load), show the first letter on a colour made from the name */
  const COLORS = ["#7c5cff","#0ea5e9","#10b981","#f59e0b","#ef4444","#ec4899","#14b8a6","#6366f1"];
  function initialAvatar(img, name){
    const n = (name || "?").trim() || "?", ch = n[0].toUpperCase();
    let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const span = document.createElement("span"); span.className = img.className + " mx-initial"; span.textContent = ch; span.style.background = COLORS[h % COLORS.length];
    span.style.width = (img.width || img.clientWidth || 32) + "px"; span.style.height = span.style.width;
    img.replaceWith(span);
  }
  function colorFor(n){ let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; }
  function paintAvatars(){
    const who = document.getElementById("who");
    if (who && who.textContent.trim() && !who.querySelector(".mx-initial")){
      const n = who.textContent.replace(/sign out|super admin/ig,"").trim() || "S";
      const s = document.createElement("span"); s.className = "mx-initial"; s.textContent = n[0].toUpperCase(); s.style.cssText = "background:" + colorFor(n) + ";width:30px;height:30px;margin-right:8px;vertical-align:middle";
      who.insertBefore(s, who.firstChild);
    }
    document.querySelectorAll(".v-user-avatar:not([data-mxa])").forEach(a=>{
      const n = ((a.closest(".v-user") || {}).textContent || "").replace(/sign out/ig,"").trim(); if (!n) return;
      a.dataset.mxa = "1"; a.textContent = n[0].toUpperCase(); a.style.background = colorFor(n); a.style.color = "#fff"; a.style.fontWeight = "700";
    });
    document.querySelectorAll(".me img, .v-user img, #who img, img.profile-photo").forEach(img=>{
      if (img.dataset.mxa) return;
      const name = (document.getElementById("userName") && document.getElementById("userName").textContent) || (img.closest(".me,#who,.v-user") || {}).textContent || img.alt || "";
      const bad = !img.getAttribute("src") || img.getAttribute("src") === "";
      if (bad){ img.dataset.mxa = "1"; initialAvatar(img, name.replace(/sign out|super admin/ig,"").trim()); return; }
      img.dataset.mxa = "1"; img.addEventListener("error", ()=>initialAvatar(img, name));
    });
  }
  function init(){
    paintHere(); paintAvatars();
    // Pop-up menu logos (login pages, marketing, viewer)
    [".portal-logo","#heroLogo","#topLogo",".v-brand-mark",".hero-theme-toggle",".mobile-theme-toggle"].forEach(s=>document.querySelectorAll(s).forEach(bindPop));
    // Branch admin: logo in the top bar slides the tabs
    bindDrawer($("#app .brand-mark"));
    document.querySelectorAll("nav.tabs button, .shell .nav button").forEach(b=>{ if (!b.dataset.mxc){ b.dataset.mxc = "1"; b.addEventListener("click", ()=>setTimeout(()=>setDrawer(false), 120)); } });
    // Super admin: the sidebar logo also closes the drawer
    bindDrawer($("#sideLogo"));
  }
  let shownTabs = false;
  function autoOpen(){
    const nav = $("nav.tabs, .shell .side");
    if (!shownTabs && nav && (visible($("#app .topbar")) || visible($(".shell .bar")))){ shownTabs = true; setTimeout(()=>setDrawer(true), 250); }
  }
  document.addEventListener("DOMContentLoaded", init);
  document.addEventListener("click", ()=>setTimeout(paintHere, 60));
  new MutationObserver(()=>{ init(); autoOpen(); }).observe(document.documentElement, {childList:true, subtree:true});
})();
