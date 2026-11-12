// js/01-state.js — Shared settings and in-memory data (rooms, shapes, prospects, ...)
/* =========================================================================
  BOARDING HOUSE VACANCY TRACKER — main app logic
  Data lives in the SQL database (via the server API); Firebase only handles sign-in.
   ========================================================================= */

const DAY_MS = 86400000;
const GENDERS = ["Male","Female","Mixed"];
const CAP_PRESETS = [2,4,5,6,8];

let db = null;
let auth = null;
let currentUser = null;
let rooms = [];          // [{id, room, capacity, gender, type, x, y, beds:[{slot,tenant,start,end,reservedFor}]}]
let shapes = [];
let prospects = [];      // [{id, name, gender, checkIn, checkOut, notes, reservedBed:{roomId,slot}}]
let temporaryClients = [];
let unsubRooms = null, unsubShapes = null, unsubProspects = null, unsubTemporaryClients = null, unsubHistory = null;
let tenantHistory = [];  // [{id, tenant, room, slot, start, end, reason, leftAt, expireAt}] kept 30 days
let lastHistoryPurge = 0;
let extendState = null;
const HISTORY_DAYS = 30;
let assistantDataLoaded = {rooms:false,shapes:false,prospects:false,temporaryClients:false};
let activeTab = "dashboard";
let calOffset = 0; // months from current month, unbounded either direction
let checkoutProximity = "all";
let checkoutPickerOpen = false;
let editingRoomId = null;
let editingRoomBaseline = null;
let editingShapeId = null;
let selectedShapeId = null;
let layoutLocked = true;
let transferState = null;
const processingReservations = new Set();
