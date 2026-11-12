// Shared helpers for superadmin.html and marketing.html
window.CUI = (function(){
  const P = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    building:'<path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4"/>',
    shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    bed:'<path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11h.01"/>',
    users:'<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6M17 4.5a3.5 3.5 0 0 1 0 7M22 20c0-2.5-1.5-4.5-4-5.5"/>',
    pin:'<path d="M12 21s7-5.7 7-11a7 7 0 0 0-14 0c0 5.3 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
    moon:'<path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
    logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    plug:'<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
    trend:'<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    google:'<path d="M21 12.2c0-.6-.1-1.200-.2-1.700H12v3.300h5a4.300 4.300 0 0 1-1.900 2.800v2.300h3c1.800-1.600 2.900-4 2.900-6.700z"/><path d="M12 21c2.600 0 4.700-.9 6.300-2.300l-3-2.300c-.9.600-2 .9-3.300.9-2.500 0-4.600-1.700-5.300-4H3.600v2.400A9 9 0 0 0 12 21z"/><path d="M6.700 13.300a5.400 5.400 0 0 1 0-3.500V7.400H3.600a9 9 0 0 0 0 8.200z"/><path d="M12 6.600c1.400 0 2.700.5 3.700 1.400l2.700-2.700A9 9 0 0 0 3.600 7.400l3.100 2.400c.7-2.300 2.800-3.200 5.300-3.200z"/>'
  };
  const icon = n => '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + (P[n]||"") + '</svg>';
  const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const $ = id => document.getElementById(id);

  function toast(text, bad){
    let box = $("toasts"); if (!box){ box = document.createElement("div"); box.id = "toasts"; box.className = "toasts"; box.setAttribute("role","status"); document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "toast" + (bad ? " err" : ""); t.textContent = text; box.appendChild(t);
    setTimeout(()=>t.remove(), 4200);
  }
  function ask(title, text, ok, danger){
    return new Promise(resolve=>{
      const m = document.createElement("div"); m.className = "modal"; m.setAttribute("role","dialog"); m.setAttribute("aria-modal","true");
      m.innerHTML = '<div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p><div class="acts"><button class="btn" data-k="0">Cancel</button><button class="btn ' + (danger ? "danger" : "pri") + '" data-k="1">' + esc(ok||"Confirm") + '</button></div></div>';
      const done = v=>{ m.remove(); document.removeEventListener("keydown", key); resolve(v); };
      const key = e=>{ if (e.key === "Escape") done(false); };
      m.addEventListener("click", e=>{ if (e.target === m) done(false); const b = e.target.closest("[data-k]"); if (b) done(b.dataset.k === "1"); });
      document.addEventListener("keydown", key); document.body.appendChild(m); m.querySelector('[data-k="0"]').focus();
    });
  }
  function theme(btn){
    const saved = localStorage.getItem("centralTheme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const apply = t=>{ document.documentElement.dataset.theme = t; if (btn) btn.innerHTML = icon(t === "dark" ? "sun" : "moon"); };
    apply(saved);
    if (btn) btn.onclick = ()=>{ const n = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; localStorage.setItem("centralTheme", n); apply(n); };
  }
  const when = t=>{ const d = t && t.toDate ? t.toDate() : null; return d ? d.toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}) : "—"; };
  const ago = t=>{
    const d = t && t.toMillis ? t.toMillis() : 0; if (!d) return "—";
    const m = Math.round((Date.now()-d)/60000);
    return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m/60) + " h ago" : Math.round(m/1440) + " d ago";
  };
  const STALE_MS = 30*60*1000;
  const isStale = s => !!(s && s.updatedAt && Date.now() - s.updatedAt.toMillis() > STALE_MS);
  // red = vacancies available, amber = limited (1-2), green = fully occupied
  const kind = v => v > 2 ? "avail" : v > 0 ? "limited" : "full";
  const pct = s => s.total ? Math.round(s.occupied / s.total * 100) : 0;
  const authErr = e => ({"auth/invalid-credential":"Wrong email or password.","auth/user-not-found":"No account with that email.","auth/wrong-password":"Wrong email or password.","auth/too-many-requests":"Too many attempts. Wait a bit.","auth/popup-closed-by-user":"Sign-in window was closed.","auth/invalid-email":"That email doesn't look right."}[e.code] || e.message || "Try again.");
  function dormCard(b, s, extra, rise){
    const k = kind(s.vacant), stale = isStale(s);
    return '<article class="dc ' + k + (rise ? " rise" : "") + '"><div class="dhead"><div><h3>' + esc(b.dormName) + '</h3><div class="loc">' + icon("pin") + esc(b.location || "Location not provided") + '</div></div>'
      + '<div class="ring" style="--p:' + pct(s) + '" title="' + pct(s) + '% occupied"><span>' + pct(s) + '%</span></div></div>'
      + '<div class="nums"><div><b class="v">' + s.vacant + '</b><span>Vacant</span></div><div><b>' + s.occupied + '</b><span>Occupied</span></div><div><b>' + s.total + '</b><span>Total beds</span></div></div>'
      + '<p class="pills-label">Vacant beds by type</p><div class="pills"><span class="pill vac">Male vacant <b>' + s.maleVacant + '</b></span><span class="pill vac">Female vacant <b>' + s.femaleVacant + '</b></span><span class="pill vac">Student vacant <b>' + s.studentVacant + '</b></span><span class="pill vac">Reviewee vacant <b>' + s.revieweeVacant + '</b></span><span class="pill vac">Mixed gender vacant <b>' + (s.mixedVacant||0) + '</b></span><span class="pill vac">Mixed student/reviewee vacant <b>' + (s.mixedGroupVacant||0) + '</b></span><span class="pill vac">Aircon vacant <b>' + s.acVacant + '</b></span><span class="pill vac">Non-aircon vacant <b>' + s.nonAcVacant + '</b></span></div>'
      + '<p class="det ' + (stale ? "stale" : "") + '">Updated ' + ago(s.updatedAt) + "" + '</p>' + (extra || "") + '</article>';
  }
  return {icon, esc, $, toast, ask, theme, when, ago, isStale, kind, pct, authErr, dormCard};
})();
