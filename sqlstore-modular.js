/* sqlstore-modular.js — same data client, exposed with the function-style names that
   superadmin.html and marketing.html already use (doc, collection, query, onSnapshot, ...). */
const S = window.SQLSTORE;

class ModDocSnap {
  constructor(s){ this._s = s; this.id = s.id; this.ref = s.ref; }
  exists(){ return this._s.exists; }
  data(){ return this._s.data(); }
}

export const getFirestore = () => S.db;
export const collection = (_db, ...segs) => new S.CollectionRef(segs);
export const doc = (base, ...segs) => base && base.segments ? new S.DocRef([...base.segments, ...segs]) : new S.DocRef(segs);
export const where = (f, op, v) => q => q.where(f, op, v);
export const orderBy = (f, d) => q => q.orderBy(f, d);
export const limit = n => q => q.limit(n);
export const query = (q, ...constraints) => constraints.reduce((acc, c) => c(acc), q);
export const getDoc = async ref => new ModDocSnap(await ref.get());
export const getDocs = q => q.get();
export const setDoc = (ref, data) => ref.set(data);
export const addDoc = (col, data) => col.add(data);
export const updateDoc = (ref, data) => ref.update(data);
export const deleteDoc = ref => ref.delete();
export const writeBatch = () => S.db.batch();
export const onSnapshot = (ref, next, error) =>
  ref.onSnapshot(snap => next(ref instanceof S.DocRef ? new ModDocSnap(snap) : snap), error);
export const Timestamp = S.Timestamp;
export const serverTimestamp = S.serverTimestamp;
