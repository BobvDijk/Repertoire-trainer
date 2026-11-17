// Firebase glue for sync: email/password accounts (Firebase Auth) and one small collection
// per user in Firestore: users/{uid}/data/{key} = {t, by, json}. Loaded only when sync is used.

const AUTH_ERRORS = {
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'No account with this email.',
  'auth/invalid-email': 'That doesn’t look like an email address.',
  'auth/email-already-in-use': 'There is already an account with this email. Sign in instead.',
  'auth/weak-password': 'Choose a password of at least 6 characters.',
  'auth/missing-password': 'Enter a password.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/network-request-failed': 'No connection to the sync service.',
};
export const authMessage = e => AUTH_ERRORS[e && e.code] || (e && e.message) || String(e);

/** opts.emulator: use the local Firebase emulators (development only). */
export async function connectFirebase(config, opts = {}) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import('../vendor/firebase/firebase-app.js'),
    import('../vendor/firebase/firebase-auth.js'),
    import('../vendor/firebase/firebase-firestore.js'),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app), db = F.getFirestore(app);
  if (opts.emulator) {
    A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  const col = uid => F.collection(db, 'users', uid, 'data');
  return {
    onUser: cb => A.onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email } : null)),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signUp: (email, pw) => A.createUserWithEmailAndPassword(auth, email, pw),
    resetPassword: email => A.sendPasswordResetEmail(auth, email),
    signOut: () => A.signOut(auth),
    backend: uid => ({
      async pull() { const out = {}; (await F.getDocs(col(uid))).forEach(d => { out[d.id] = d.data(); }); return out; },
      push: (key, doc) => F.setDoc(F.doc(col(uid), key), doc),
      subscribe: cb => F.onSnapshot(col(uid), snap => snap.docChanges().forEach(ch => {
        if (ch.type !== 'removed' && !ch.doc.metadata.hasPendingWrites) cb(ch.doc.id, ch.doc.data());
      })),
    }),
  };
}
