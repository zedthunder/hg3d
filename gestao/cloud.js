/* HG Gestão | Conexão com o Firebase (login e banco de dados).
   Carregado só quando o app abre por http(s); em arquivo local o app funciona sem nuvem.
   A configuração abaixo não é secreta: quem protege os dados são o login e as regras do Firestore. */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, getDoc, setDoc, deleteDoc, terminate, clearIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB65WdLCggvjLzKc9jlbcmqejF4z8whfhY',
  authDomain: 'hg-gestao.firebaseapp.com',
  projectId: 'hg-gestao',
  storageBucket: 'hg-gestao.firebasestorage.app',
  messagingSenderId: '535954881873',
  appId: '1:535954881873:web:07ffc4c92570ca834e6770',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Cache no aparelho: o app abre e salva sem internet e envia quando a conexão volta.
const db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

let listeners = [];
const metaRef = (uid) => doc(db, 'users', uid, 'meta', 'state');
const ordersRef = (uid) => collection(db, 'users', uid, 'orders');

window.HGCloud = {
  onAuth(callback) {
    return onAuthStateChanged(auth, (user) => callback(user ? { uid: user.uid, email: user.email } : null));
  },
  signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
  resetPassword: (email) => sendPasswordResetEmail(auth, email),

  /* Sair também apaga a cópia local do banco, para não deixar dados num aparelho emprestado. */
  async signOut() {
    listeners.forEach((stop) => stop());
    listeners = [];
    await signOut(auth);
    await terminate(db);
    await clearIndexedDbPersistence(db);
  },

  subscribe(uid, handlers) {
    const opts = { includeMetadataChanges: true };
    listeners.push(onSnapshot(metaRef(uid), opts,
      (snap) => handlers.onMeta(snap.exists() ? snap.data() : null, snap.metadata),
      (err) => handlers.onError(err)));
    listeners.push(onSnapshot(ordersRef(uid), opts,
      (snap) => handlers.onOrders(snap.docs.map((d) => d.data()), snap.metadata),
      (err) => handlers.onError(err)));
  },

  writeMeta: (uid, data) => setDoc(metaRef(uid), data),
  writeOrder: (uid, order) => setDoc(doc(ordersRef(uid), order.id), order),
  deleteOrder: (uid, id) => deleteDoc(doc(ordersRef(uid), id)),

  /* Dados só da conta, fora do backup (ex.: o token do GitHub da galeria). */
  async readPrivate(uid, key) {
    const snap = await getDoc(doc(db, 'users', uid, 'private', key));
    return snap.exists() ? snap.data() : null;
  },
  writePrivate: (uid, key, data) => setDoc(doc(db, 'users', uid, 'private', key), data),
};

window.dispatchEvent(new Event('hgcloud-ready'));
