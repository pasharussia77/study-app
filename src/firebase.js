import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, addDoc,
  query, where, onSnapshot, serverTimestamp
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
      await deleteDoc(doc(db, 'families', code, 'projects', id));
    }
  };
}

// ---------- In-memory backend (used for testing with ?mock=1) ----------
function createMockBackend() {
  const families = {};
  const projs = {};
  const listeners = new Set();
  const notify = () => listeners.forEach((f) => f());
  let n = 0;
  return {
    async init() {},
    async getFamily(code) { return families[code] || null; },
    async createFamily(code, profiles) { families[code] = { profiles }; },
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
    async deleteProject(code, id) { delete projs[id]; notify(); }
  };
}

const useMock = new URLSearchParams(location.search).has('mock');
export const backend = useMock ? createMockBackend() : createFirebaseBackend();
export const isMock = useMock;
