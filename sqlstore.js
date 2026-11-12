/* sqlstore.js — browser client for the SQL-backed data API (/api/get, /api/read, /api/commit).
   It keeps the call shapes the app already used (collection().doc().get/set/update/delete/add,
   where/orderBy/limit, onSnapshot, batch(), runTransaction()), so the app's logic is unchanged.
   Nothing here decides who may see what: the server checks every request against the signed-in
   user it verifies from the token. The browser never sends a user id or role as authority. */
(function(){
"use strict";
var POLL_MS = 4000;
var tokenProvider = function(){ return Promise.reject(makeErr("unauthenticated", "Please sign in.")); };

function makeErr(code, message){ var e = new Error(message || code); e.code = code; return e; }

function newId(){
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", out = "";
  var bytes = new Uint8Array(20);
  (window.crypto || window.msCrypto).getRandomValues(bytes);
  for (var i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

/* ---------------------------------------------------------------- values */
function Timestamp(ms){ this._ms = ms; }
Timestamp.prototype.toMillis = function(){ return this._ms; };
Timestamp.prototype.toDate = function(){ return new Date(this._ms); };
Object.defineProperty(Timestamp.prototype, "seconds", {get: function(){ return Math.floor(this._ms / 1000); }});
Object.defineProperty(Timestamp.prototype, "nanoseconds", {get: function(){ return (this._ms % 1000) * 1e6; }});
Timestamp.fromMillis = function(ms){ return new Timestamp(ms); };
Timestamp.fromDate = function(d){ return new Timestamp(d.getTime()); };
Timestamp.now = function(){ return new Timestamp(Date.now()); };

var SERVER_TS = {__sv: 1};
function serverTimestamp(){ return SERVER_TS; }

function encode(v){
  if (v === SERVER_TS) return {__sv: 1};
  if (v instanceof Timestamp) return {__ts: v._ms};
  if (v instanceof Date) return {__ts: v.getTime()};
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object"){
    var o = {};
    Object.keys(v).forEach(function(k){ if (v[k] !== undefined) o[k] = encode(v[k]); });
    return o;
  }
  return v;
}
function decode(v){
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object"){
    if (Object.keys(v).length === 1 && typeof v.__ts === "number") return new Timestamp(v.__ts);
    var o = {};
    Object.keys(v).forEach(function(k){ o[k] = decode(v[k]); });
    return o;
  }
  return v;
}
function clone(v){ return v === undefined ? v : JSON.parse(JSON.stringify(v)); }

/* ---------------------------------------------------------------- transport */
function request(path, body){
  return tokenProvider().then(function(token){
    return fetch("/api" + path, {
      method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + token},
      body: JSON.stringify(body || {})
    });
  }).then(function(res){
    return res.json().catch(function(){ return {}; }).then(function(json){
      if (!res.ok) throw makeErr(json.error || "unavailable", json.message || ("Request failed (" + res.status + ")."));
      return json;
    });
  });
}

/* ---------------------------------------------------------------- snapshots */
function DocSnap(ref, raw, v){ this.ref = ref; this.id = ref.id; this._raw = raw; this.v = v; this.exists = raw !== null && raw !== undefined; }
DocSnap.prototype.data = function(){ return this.exists ? decode(clone(this._raw)) : undefined; };
function QuerySnap(docs){ this.docs = docs; this.size = docs.length; this.empty = docs.length === 0; }
QuerySnap.prototype.forEach = function(fn){ this.docs.forEach(fn); };

/* ---------------------------------------------------------------- references */
function Query(segments, where, order, lim){ this.segments = segments; this._where = where || []; this._order = order || []; this._limit = lim || null; }
Query.prototype._with = function(patch){
  return new Query(this.segments, patch.where || this._where, patch.order || this._order, patch.limit === undefined ? this._limit : patch.limit);
};
Query.prototype.where = function(field, op, value){ return this._with({where: this._where.concat([[field, op, encode(value)]])}); };
Query.prototype.orderBy = function(field, dir){ return this._with({order: this._order.concat([[field, dir === "desc" ? "desc" : "asc"]])}); };
Query.prototype.limit = function(n){ return this._with({limit: n}); };
Query.prototype._spec = function(){ return {type: "query", path: this.segments, where: this._where, orderBy: this._order, limit: this._limit}; };
Query.prototype._snap = function(r){
  var self = this;
  return new QuerySnap(r.docs.map(function(d){ return new DocSnap(new DocRef(self.segments.concat([d.id])), d.data, d.v); }));
};
Query.prototype.get = function(){
  var self = this;
  return request("/read", {ops: [this._spec()]}).then(function(res){
    var r = res.results[0];
    if (!r.ok) throw makeErr(r.error, r.message);
    return self._snap(r);
  });
};
Query.prototype.onSnapshot = function(next, error){ return addListener(this, next, error); };

function CollectionRef(segments){ Query.call(this, segments); this.id = segments[segments.length - 1]; this.path = segments.join("/"); }
CollectionRef.prototype = Object.create(Query.prototype);
CollectionRef.prototype.constructor = CollectionRef;
CollectionRef.prototype.doc = function(id){ return new DocRef(this.segments.concat([id || newId()])); };
CollectionRef.prototype.add = function(data){
  var ref = this.doc();
  return commit([], [{op: "create", path: ref.segments, data: encode(data)}]).then(function(){ return ref; });
};

function DocRef(segments){ this.segments = segments; this.id = segments[segments.length - 1]; this.path = segments.join("/"); }
DocRef.prototype.collection = function(name){ return new CollectionRef(this.segments.concat([name])); };
DocRef.prototype._spec = function(){ return {type: "get", path: this.segments}; };
DocRef.prototype._snap = function(r){ return new DocSnap(this, r.data, r.v); };
DocRef.prototype.get = function(){
  var self = this;
  return request("/read", {ops: [this._spec()]}).then(function(res){
    var r = res.results[0];
    if (!r.ok) throw makeErr(r.error, r.message);
    return self._snap(r);
  });
};
DocRef.prototype.create = function(data){ return commit([], [{op: "create", path: this.segments, data: encode(data)}]); };
DocRef.prototype.set = function(data){ return commit([], [{op: "set", path: this.segments, data: encode(data)}]); };
DocRef.prototype.update = function(data){ return commit([], [{op: "update", path: this.segments, data: encode(data)}]); };
DocRef.prototype.delete = function(){ return commit([], [{op: "delete", path: this.segments}]); };
DocRef.prototype.onSnapshot = function(next, error){ return addListener(this, next, error); };

/* ---------------------------------------------------------------- commits */
function commit(reads, writes){
  return request("/commit", {reads: reads, writes: writes}).then(function(r){ refreshSoon(); return r; });
}

function Batch(){ this._w = []; }
Batch.prototype.set = function(ref, data){ this._w.push({op: "set", path: ref.segments, data: encode(data)}); return this; };
Batch.prototype.update = function(ref, data){ this._w.push({op: "update", path: ref.segments, data: encode(data)}); return this; };
Batch.prototype.delete = function(ref){ this._w.push({op: "delete", path: ref.segments}); return this; };
Batch.prototype.commit = function(){ return this._w.length ? commit([], this._w) : Promise.resolve(); };

function runTransaction(fn, attempt){
  attempt = attempt || 0;
  var reads = {}, writes = [];
  var tx = {
    get: function(ref){
      return request("/read", {ops: [ref._spec()]}).then(function(res){
        var r = res.results[0];
        if (!r.ok) throw makeErr(r.error, r.message);
        reads[ref.path] = {path: ref.segments, v: r.v};
        return ref._snap(r);
      });
    },
    set: function(ref, data){ writes.push({op: "set", path: ref.segments, data: encode(data)}); return tx; },
    update: function(ref, data){ writes.push({op: "update", path: ref.segments, data: encode(data)}); return tx; },
    delete: function(ref){ writes.push({op: "delete", path: ref.segments}); return tx; }
  };
  return Promise.resolve(fn(tx)).then(function(result){
    return commit(Object.keys(reads).map(function(k){ return reads[k]; }), writes).then(function(){ return result; });
  }, function(err){ throw err; }).catch(function(err){
    if (err && err.code === "aborted" && attempt < 12){        // someone else changed it: wait a moment, re-run
      return new Promise(function(resolve){ setTimeout(resolve, 15 + Math.random() * 40 * (attempt + 1)); })
        .then(function(){ return runTransaction(fn, attempt + 1); });
    }
    throw err;
  });
}

/* ---------------------------------------------------------------- live updates (short polling) */
var listeners = [], pollTimer = null, inflight = false, again = false;

function addListener(ref, next, error){
  var L = {ref: ref, next: next, error: error, last: null, alive: true};
  listeners.push(L);
  if (!pollTimer) pollTimer = setInterval(function(){ if (!document.hidden) refresh(); }, POLL_MS);
  refresh();
  return function(){
    L.alive = false;
    listeners = listeners.filter(function(x){ return x !== L; });
    if (!listeners.length && pollTimer){ clearInterval(pollTimer); pollTimer = null; }
  };
}

function refresh(){
  if (inflight){ again = true; return Promise.resolve(); }
  var ls = listeners.filter(function(l){ return l.alive; });
  if (!ls.length) return Promise.resolve();
  inflight = true;
  return request("/read", {ops: ls.map(function(l){ return l.ref._spec(); })}).then(function(res){
    ls.forEach(function(l, i){
      if (!l.alive) return;
      var r = res.results[i];
      if (!r.ok){
        l.alive = false;
        listeners = listeners.filter(function(x){ return x !== l; });
        if (l.error) l.error(makeErr(r.error, r.message));
        return;
      }
      var key = JSON.stringify(r.docs !== undefined ? r.docs : [r.exists, r.data]);
      if (l.last === key) return;
      l.last = key;
      if (l.next) l.next(l.ref._snap(r));
    });
  }).catch(function(err){
    if (err && err.code === "unauthenticated"){
      ls.forEach(function(l){ if (l.alive && l.error) l.error(err); });
    }
    /* a network blip: try again on the next tick */
  }).then(function(){
    inflight = false;
    if (again){ again = false; refresh(); }
  });
}
function refreshSoon(){ setTimeout(refresh, 50); }
document.addEventListener("visibilitychange", function(){ if (!document.hidden) refresh(); });

/* ---------------------------------------------------------------- public object */
var db = {
  collection: function(name){ return new CollectionRef([name]); },
  batch: function(){ return new Batch(); },
  runTransaction: function(fn){ return runTransaction(fn, 0); }
};

window.SQLSTORE = {
  db: db, Timestamp: Timestamp, serverTimestamp: serverTimestamp, newId: newId,
  setTokenProvider: function(fn){ tokenProvider = fn; },
  refresh: refresh, request: request,
  DocRef: DocRef, CollectionRef: CollectionRef, Query: Query, encode: encode, decode: decode
};
window.sqlDb = db;
window.sqlTimestamp = Timestamp;
window.sqlServerTimestamp = serverTimestamp;
})();
