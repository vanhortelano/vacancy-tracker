// js/04-helpers.js — Date parsing, bed status, vacancy and matching rules
/* ---------------------------- helpers ---------------------------- */

function todayISO(){
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}

function toDateTimeInput(value,isEnd=false){
  if (!value) return "";
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return text.slice(0,16);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + (isEnd ? "T23:59" : "T00:00");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime()-date.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}

function parseScheduleDate(value, isEnd=false){
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)){
    return new Date(text + (isEnd ? "T23:59:59" : "T00:00:00"));
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoLocalDateTime(value){
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sameEditorDateTime(left,right,isEnd=false){
  return toDateTimeInput(left,isEnd) === toDateTimeInput(right,isEnd);
}

function bedStatus(bed, room=null){
  const now = Date.now();
  const start = parseScheduleDate(bed.start);
  const end = parseScheduleDate(bed.end, true);
  if (room && room.tenancyMode === "Whole Room" && !bed.tenant){
    if (room.beds.some(item=>item.tenant && bedStatus(item)!=="reserved")) return "occupied";
    if (room.beds.some(item=>item.reservedFor || (item.tenant && bedStatus(item)==="reserved"))) return "reserved";
  }
  if (!bed.tenant){
    if (bed.reservedFor) return "reserved";
    return "vacant";
  }
  if (end && end.getTime() < now) return "overdue";
  if (start && start.getTime() > now) return "reserved";
  if (bed.residentType === "Temporary") return "temporary";
  if (end && end.getTime() - now <= 48 * 60 * 60 * 1000) return "soon";
  return "occupied";
}

function fmtDate(iso){
  if (!iso) return "—";
  const d = parseScheduleDate(iso);
  if (!d) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso))
    ? d.toLocaleDateString([], {month:'short', day:'numeric', year:'numeric'})
    : d.toLocaleString([], {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'});
}

function roomVacancy(r){
  const total = r.beds.length;
  if (r.tenancyMode === "Whole Room"){
    const status=r.beds.reduce((result,b)=>{
      const bedState=bedStatus(b,r);
      if (bedState==="reserved") result.reserved=true;
      else if (bedState!=="vacant") result.occupied=true;
      return result;
    },{occupied:false,reserved:false});
    return {total, vacant:status.occupied||status.reserved?0:total, occupied:status.occupied?total:0, reserved:status.reserved?total:0};
  }
  const vacant = r.beds.filter(b=>bedStatus(b,r)==="vacant").length;
  const reserved = r.beds.filter(b=>bedStatus(b,r)==="reserved").length;
  const occupied = total - vacant - reserved;
  return {total, vacant, occupied, reserved};
}

function genderMatches(roomGender, prospectGender){
  if (roomGender === "Mixed" || prospectGender === "Any") return true;
  return roomGender === prospectGender;
}

function roomAllowsResident(room, residentType){
  if (residentType === "Temporary" || !room.demographic || room.demographic === "Mixed") return true;
  return (room.demographic === "Students" && residentType === "Student") ||
    (room.demographic === "Reviewees" && residentType === "Reviewee");
}

function residentGenderForBed(room, bed){
  return bed.residentGender && bed.residentGender !== "Unspecified" ? bed.residentGender : (room.gender || "Mixed");
}

function bedCanHost(room, bed, residentType, gender){
  if (!roomAllowsResident(room,residentType) || !genderMatches(room.gender,gender)) return false;
  if (room.tenancyMode === "Whole Room"){
    return !room.beds.some(other=>other.tenant || other.reservedFor);
  }
  return !bed.tenant && !bed.reservedFor;
}

function availableBedOptions(gender, residentType, includeUpcomingCheckouts=false, checkIn=null){
  const choices = [];
  rooms.forEach(room=>room.beds.forEach((bed,index)=>{
    if (room.tenancyMode === "Whole Room" && index > 0) return;
    if (!roomAllowsResident(room,residentType) || !genderMatches(room.gender,gender)) return;
    if (includeUpcomingCheckouts){
      if (bed.reservedFor || bed.temporaryClientId) return;
      if (bed.tenant && !bed.end) return;
      if (room.tenancyMode==="Whole Room" && room.beds.some(other=>other!==bed && (other.tenant||other.reservedFor))) return;
      if (!bed.tenant && !bedCanHost(room,bed,residentType,gender)) return;
    } else if (!bedCanHost(room,bed,residentType,gender)) return;
    choices.push({room,index,bed});
  }));
  return choices;
}

function sameMonth(iso1, iso2){
  if (!iso1 || !iso2) return false;
  const a = parseScheduleDate(iso1), b = parseScheduleDate(iso2);
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function dayStart(date){ return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); }

// Whole days between a bed's checkout and a client's arrival (positive = bed frees up before arrival).
function checkoutGapDays(bed, checkInValue){
  const end = parseScheduleDate(bed.end, true);
  const checkIn = parseScheduleDate(checkInValue);
  if (!end || !checkIn) return null;
  return Math.round((dayStart(checkIn) - dayStart(end)) / DAY_MS);
}

function bedTimingNote(bed, checkInValue){
  const gap = checkoutGapDays(bed, checkInValue);
  if (gap === null) return "";
  if (gap > 0) return "frees up " + gap + " day" + (gap===1?"":"s") + " before arrival";
  if (gap === 0) return "frees up on the arrival day";
  const late = -gap;
  return "⚠ still occupied " + late + " day" + (late===1?"":"s") + " after arrival";
}

function makeHistoryEntry(room, bed, reason){
  return {
    tenant: bed.tenant,
    roomId: room.id || null,
    room: room.room || "",
    slot: bed.slot || "",
    start: bed.start || null,
    end: bed.end || null,
    residentType: bed.residentType || "Student",
    residentGender: bed.residentGender || "Unspecified",
    reason,
    leftAt: sqlServerTimestamp(),
    expireAt: sqlTimestamp.fromMillis(Date.now() + HISTORY_DAYS * DAY_MS)
  };
}

function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
