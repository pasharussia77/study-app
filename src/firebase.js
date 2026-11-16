import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, addDoc,
  query, where, onSnapshot, serverTimestamp, increment, writeBatch
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyCwlFWhAzgnz5_zuOunEuCmp3ppEI9NFy4',
  authDomain: 'family-study-94e10.firebaseapp.com',
  projectId: 'family-study-94e10',
  storageBucket: 'family-study-94e10.firebasestorage.app',
  messagingSenderId: '526344470356',
  appId: '1:526344470356:web:534bab9cf1cfedec2ad2c1'
};

// ---------- Real backend (Firebase) ----------
function createFirebaseBackend() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  let ready;
  const signedIn = () => (ready ||= new Promise((resolve, reject) => {
    onAuthStateChanged(auth, (u) => { if (u) resolve(u); });
    signInAnonymously(auth).catch(reject);
  }));
  const fam = (code) => doc(db, 'families', code);
  const projects = (code) => collection(db, 'families', code, 'projects');
  const ms = (t) => (t && t.toMillis ? t.toMillis() : Date.now());

  return {
    async init() { await signedIn(); },
    async getFamily(code) {
      await signedIn();
      const s = await getDoc(fam(code));
      return s.exists() ? s.data() : null;
    },
    async createFamily(code, profiles) {
      await signedIn();
      await setDoc(fam(code), { profiles, createdAt: serverTimestamp() });
    },
    watchFamily(code, cb) {
      let unsub = () => {};
      signedIn().then(() => {
        unsub = onSnapshot(fam(code), (s) => { if (s.exists()) cb({ profiles: s.data().profiles }); }, () => {});
      });
      return () => unsub();
    },
    async setProfiles(code, profiles) {
      await signedIn();
      await updateDoc(fam(code), { profiles });
    },
    watchProjects(code, profileId, cb, onError) {
      const q = query(projects(code), where('profileId', '==', profileId));
      let unsub = () => {};
      signedIn().then(() => {
        unsub = onSnapshot(q, (snap) => {
          cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ms(d.data().createdAt) })));
        }, onError);
      });
      return () => unsub();
    },
    async createProject(code, profileId, name) {
      await signedIn();
      const ref = await addDoc(projects(code), { profileId, name, text: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return ref.id;
    },
    async getProject(code, id) {
      await signedIn();
      const s = await getDoc(doc(db, 'families', code, 'projects', id));
      return s.exists() ? { id: s.id, ...s.data(), createdAt: ms(s.data().createdAt) } : null;
    },
    async saveProjectText(code, id, text) {
      await signedIn();
      await updateDoc(doc(db, 'families', code, 'projects', id), { text, updatedAt: serverTimestamp() });
    },
    async deleteProject(code, id) {
      await signedIn();
      try {
        const fs = await getDocs(collection(db, 'families', code, 'projects', id, 'files'));
        await Promise.all(fs.docs.map((d) => deleteDoc(d.ref)));
        const its = await getDocs(collection(db, 'families', code, 'projects', id, 'items'));
        await Promise.all(its.docs.map((d) => deleteDoc(d.ref)));
        await deleteDoc(doc(db, 'families', code, 'projects', id, 'stats', 'main'));
      } catch {}
      await deleteDoc(doc(db, 'families', code, 'projects', id));
    },
    async idToken() { const u = await signedIn(); return u.getIdToken(); },
    watchItems(code, pid, cb) {
      let unsub = () => {};
      signedIn().then(() => {
        unsub = onSnapshot(collection(db, 'families', code, 'projects', pid, 'items'), (snap) => {
          cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ms(d.data().createdAt) })));
        }, () => cb([]));
      });
      return () => unsub();
    },
    // Replaces everything made from one photo with a fresh list (used when a photo is read or re-read).
    async replaceItemsForFile(code, pid, fileId, list) {
      await signedIn();
      const col = collection(db, 'families', code, 'projects', pid, 'items');
      const old = await getDocs(query(col, where('fileId', '==', fileId)));
      const batch = writeBatch(db);
      old.docs.forEach((d) => batch.delete(d.ref));
      list.forEach((it) => batch.set(doc(col), { ...it, fileId, createdAt: serverTimestamp() }));
      await batch.commit();
    },
    async updateItem(code, pid, id, patch) {
      await signedIn();
      await updateDoc(doc(db, 'families', code, 'projects', pid, 'items', id), patch);
    },
    async deleteItem(code, pid, id) {
      await signedIn();
      await deleteDoc(doc(db, 'families', code, 'projects', pid, 'items', id));
    },
    watchFiles(code, pid, cb) {
      let unsub = () => {};
      signedIn().then(() => {
        unsub = onSnapshot(collection(db, 'families', code, 'projects', pid, 'files'), (snap) => {
          cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: ms(d.data().createdAt) })).sort((a, b) => a.createdAt - b.createdAt));
        }, () => cb([]));
      });
      return () => unsub();
    },
    async addFile(code, pid, data) {
      await signedIn();
      const ref = await addDoc(collection(db, 'families', code, 'projects', pid, 'files'), { ...data, createdAt: serverTimestamp() });
      return ref.id;
    },
    async updateFile(code, pid, id, patch) {
      await signedIn();
      await updateDoc(doc(db, 'families', code, 'projects', pid, 'files', id), patch);
    },
    async deleteFile(code, pid, id) {
      await signedIn();
      await deleteDoc(doc(db, 'families', code, 'projects', pid, 'files', id));
    },
    watchStats(code, pid, cb) {
      let unsub = () => {};
      signedIn().then(() => {
        unsub = onSnapshot(doc(db, 'families', code, 'projects', pid, 'stats', 'main'),
          (s) => cb(s.exists() ? s.data().items || {} : {}), () => cb({}));
      });
      return () => unsub();
    },
    // fix = true changes an earlier answer from wrong to right
    async saveResult(code, pid, key, right, fix = false) {
      await signedIn();
      const entry = { last: right ? 'right' : 'wrong', t: Date.now() };
      if (right) entry.right = increment(1); else entry.wrong = increment(1);
      if (fix) entry.wrong = increment(-1);
      await setDoc(doc(db, 'families', code, 'projects', pid, 'stats', 'main'), { items: { [key]: entry } }, { merge: true });
    },
    async resetStats(code, pid) {
      await signedIn();
      await setDoc(doc(db, 'families', code, 'projects', pid, 'stats', 'main'), { items: {} });
    }
  };
}

// ---------- In-memory backend (used for testing with ?mock=1) ----------
function createMockBackend() {
  const families = {};
  const projs = {};
  const stats = {};
  const filesStore = {};
  const itemsStore = {};
  const listeners = new Set();
  const notify = () => listeners.forEach((f) => f());
  let n = 0;
  return {
    async init() {},
    async getFamily(code) { return families[code] || null; },
    async createFamily(code, profiles) { families[code] = { profiles }; },
    watchFamily(code, cb) {
      const run = () => { if (families[code]) cb({ profiles: [...families[code].profiles] }); };
      listeners.add(run); run();
      return () => listeners.delete(run);
    },
    async setProfiles(code, profiles) { families[code].profiles = profiles; notify(); },
    watchProjects(code, profileId, cb) {
      const run = () => cb(Object.values(projs).filter((p) => p.code === code && p.profileId === profileId).map((p) => ({ ...p })));
      listeners.add(run); run();
      return () => listeners.delete(run);
    },
    async createProject(code, profileId, name) {
      const id = 'p' + (++n);
      projs[id] = { id, code, profileId, name, text: '', createdAt: Date.now() };
      notify(); return id;
    },
    async getProject(code, id) { return projs[id] ? { ...projs[id] } : null; },
    async saveProjectText(code, id, text) { projs[id].text = text; notify(); },
    async deleteProject(code, id) { delete projs[id]; delete filesStore[id]; delete itemsStore[id]; notify(); },
    async idToken() { return 'mock-token'; },
    watchItems(code, pid, cb) {
      const run = () => cb(Object.values(itemsStore[pid] || {}).map((x) => ({ ...x })));
      listeners.add(run); run();
      return () => listeners.delete(run);
    },
    async replaceItemsForFile(code, pid, fileId, list) {
      const store = (itemsStore[pid] ||= {});
      Object.keys(store).forEach((k) => { if (store[k].fileId === fileId) delete store[k]; });
      list.forEach((it) => { const id = 'i' + (++n); store[id] = { id, ...JSON.parse(JSON.stringify(it)), fileId, createdAt: Date.now() + n }; });
      notify();
    },
    async updateItem(code, pid, id, patch) { Object.assign(itemsStore[pid][id], JSON.parse(JSON.stringify(patch))); notify(); },
    async deleteItem(code, pid, id) { delete itemsStore[pid][id]; notify(); },
    watchFiles(code, pid, cb) {
      const run = () => cb(Object.values(filesStore[pid] || {}).map((f) => ({ ...f })).sort((a, b) => a.createdAt - b.createdAt));
      listeners.add(run); run();
      return () => listeners.delete(run);
    },
    async addFile(code, pid, data) {
      const id = 'f' + (++n);
      (filesStore[pid] ||= {})[id] = { id, ...data, createdAt: Date.now() + n };
      notify(); return id;
    },
    async updateFile(code, pid, id, patch) { Object.assign(filesStore[pid][id], patch); notify(); },
    async deleteFile(code, pid, id) { delete filesStore[pid][id]; notify(); },
    watchStats(code, pid, cb) {
      const run = () => cb(JSON.parse(JSON.stringify(stats[pid] || {})));
      listeners.add(run); run();
      return () => listeners.delete(run);
    },
    async saveResult(code, pid, key, right, fix = false) {
      const it = ((stats[pid] ||= {})[key] ||= { right: 0, wrong: 0 });
      it.last = right ? 'right' : 'wrong';
      if (right) it.right++; else it.wrong++;
      if (fix) it.wrong--;
      notify();
    },
    async resetStats(code, pid) { stats[pid] = {}; notify(); }
  };
}

const useMock = new URLSearchParams(location.search).has('mock');
export const backend = useMock ? createMockBackend() : createFirebaseBackend();
export const isMock = useMock;
