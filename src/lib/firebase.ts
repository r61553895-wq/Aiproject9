import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import type { UserAccount } from '../types';
import firebaseConfigData from '../../firebase-applet-config.json';

const firebaseConfig = {
  apiKey: firebaseConfigData.apiKey,
  authDomain: firebaseConfigData.authDomain,
  projectId: firebaseConfigData.projectId,
  storageBucket: firebaseConfigData.storageBucket,
  messagingSenderId: firebaseConfigData.messagingSenderId,
  appId: firebaseConfigData.appId,
};

export const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

export const db = firebaseConfigData.firestoreDatabaseId
  ? getFirestore(app, firebaseConfigData.firestoreDatabaseId)
  : getFirestore(app);

export async function sha256Hex(str: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // Fallback hash
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(16);
  }
}

export function formatAuthEmail(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return `${trimmed.replace(/[^a-z0-9._-]/g, '')}@grokson.internal`;
}

export function mapFirebaseUserToAccount(
  fbUser: FirebaseUser,
  docData?: any
): UserAccount {
  const isAdminEmail = fbUser.email?.toLowerCase() === 'sashanushan@gmail.com';
  const role = docData?.role || (isAdminEmail ? 'admin' : 'user');

  return {
    id: fbUser.uid,
    username:
      docData?.username ||
      fbUser.email?.split('@')[0] ||
      `user_${fbUser.uid.slice(0, 6)}`,
    name: docData?.name || fbUser.displayName || fbUser.email?.split('@')[0] || 'Пользователь',
    email: fbUser.email || undefined,
    tokensBalance: typeof docData?.tokensBalance === 'number' ? docData.tokensBalance : 10000,
    totalTokensUsed: typeof docData?.totalTokensUsed === 'number' ? docData.totalTokensUsed : 0,
    createdAt: docData?.createdAt ? (typeof docData.createdAt === 'number' ? docData.createdAt : Date.now()) : Date.now(),
    lastLoginAt: Date.now(),
    role: role as 'user' | 'admin',
    avatar: docData?.avatar || fbUser.photoURL || undefined,
  };
}

export async function registerFirebaseUser(params: {
  login: string;
  email?: string;
  password: string;
  name?: string;
  guestUserId?: string;
}): Promise<{ success: boolean; account?: UserAccount; message: string }> {
  try {
    const cleanUsername = params.login.trim().toLowerCase();
    const userEmail = params.email ? params.email.trim().toLowerCase() : undefined;
    const authEmail = formatAuthEmail(params.email || params.login);
    const displayName = params.name?.trim() || cleanUsername;

    const isFirstAdmin =
      authEmail.toLowerCase() === 'sashanushan@gmail.com' ||
      cleanUsername === 'admin' ||
      cleanUsername === 'sasha' ||
      userEmail === 'sashanushan@gmail.com';

    // 1. STRICT UNIQUENESS CHECK IN FIRESTORE
    try {
      const docDirect1 = await getDoc(doc(db, 'users', `usr_${cleanUsername}`));
      const docDirect2 = await getDoc(doc(db, 'users', cleanUsername));
      if (docDirect1.exists() || docDirect2.exists()) {
        return {
          success: false,
          message: `Пользователь с логином «${cleanUsername}» уже зарегистрирован. Пожалуйста, выполните вход.`,
        };
      }

      const usersSnap = await getDocs(collection(db, 'users'));
      const duplicate = usersSnap.docs.find((d) => {
        const data = d.data();
        const u = (data.username || '').toLowerCase();
        const e = (data.email || '').toLowerCase();
        return (
          u === cleanUsername ||
          (userEmail && e && e === userEmail) ||
          d.id.toLowerCase() === cleanUsername ||
          d.id.toLowerCase() === `usr_${cleanUsername}`
        );
      });

      if (duplicate) {
        return {
          success: false,
          message: `Пользователь с логином «${cleanUsername}» уже зарегистрирован. Пожалуйста, выполните вход.`,
        };
      }
    } catch (fsCheckErr) {
      console.warn('Firestore duplicate check warning:', fsCheckErr);
    }

    // 2. Firebase Auth creation (optional helper)
    let fbUid: string | null = null;
    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        authEmail,
        params.password
      );
      if (userCredential.user) {
        fbUid = userCredential.user.uid;
        await updateProfile(userCredential.user, { displayName });
      }
    } catch (authError: any) {
      if (authError?.code === 'auth/email-already-in-use') {
        return {
          success: false,
          message: `Логин «${cleanUsername}» или email уже зарегистрирован. Пожалуйста, выполните вход.`,
        };
      }
      if (authError?.code === 'auth/weak-password') {
        return {
          success: false,
          message: 'Пароль слишком простой (минимум 6 символов).',
        };
      }
    }

    // 3. Compute salted hash for cross-device authentication
    const salt = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    const passwordHash = await sha256Hex(params.password + salt);

    const uid = `usr_${cleanUsername}`;
    const accountData = {
      id: uid,
      uid: fbUid || uid,
      username: cleanUsername,
      email: userEmail || authEmail,
      name: displayName,
      passwordHash,
      salt,
      tokensBalance: 10000,
      totalTokensUsed: 0,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      role: (isFirstAdmin ? 'admin' : 'user') as 'admin' | 'user',
    };

    // Save to Firestore under canonical id and alias
    try {
      await setDoc(doc(db, 'users', uid), accountData);
      if (fbUid && fbUid !== uid) {
        await setDoc(doc(db, 'users', fbUid), accountData);
      }
    } catch (fsErr) {
      console.warn('Firestore write warning:', fsErr);
    }

    const account: UserAccount = {
      id: uid,
      username: cleanUsername,
      name: displayName,
      email: accountData.email,
      tokensBalance: 10000,
      totalTokensUsed: 0,
      createdAt: accountData.createdAt,
      lastLoginAt: accountData.lastLoginAt,
      role: accountData.role,
    };

    return {
      success: true,
      account,
      message: 'Аккаунт успешно создан! Начислено +10 000 токенов.',
    };
  } catch (error: any) {
    console.error('Firebase registration error:', error);
    let message = 'Ошибка регистрации в базе аккаунтов.';
    if (error.code === 'auth/email-already-in-use') {
      message = 'Этот логин/email уже зарегистрирован. Пожалуйста, выполните вход.';
    } else if (error.code === 'auth/weak-password') {
      message = 'Пароль слишком простой (минимум 6 символов).';
    } else if (error.message && !error.message.includes('operation-not-allowed')) {
      message = error.message;
    }
    return { success: false, message };
  }
}

export async function loginFirebaseUser(params: {
  login: string;
  password: string;
}): Promise<{ success: boolean; account?: UserAccount; message: string }> {
  const cleanLogin = params.login.trim().toLowerCase();
  const authEmail = formatAuthEmail(params.login);

  // 1. First, check Firestore cloud database directly (supports all devices)
  try {
    let docData: any = null;
    let docRefId: string | null = null;

    // Check by usr_login, login
    const doc1 = await getDoc(doc(db, 'users', `usr_${cleanLogin}`));
    if (doc1.exists()) {
      docData = doc1.data();
      docRefId = doc1.id;
    } else {
      const doc2 = await getDoc(doc(db, 'users', cleanLogin));
      if (doc2.exists()) {
        docData = doc2.data();
        docRefId = doc2.id;
      }
    }

    // If not found by primary key, search by username or email
    if (!docData) {
      const usersSnap = await getDocs(collection(db, 'users'));
      const found = usersSnap.docs.find((d) => {
        const dData = d.data();
        const u = (dData.username || '').toLowerCase();
        const e = (dData.email || '').toLowerCase();
        return u === cleanLogin || (e && e === cleanLogin) || e === authEmail;
      });
      if (found) {
        docData = found.data();
        docRefId = found.id;
      }
    }

    if (docData) {
      let isPassValid = false;

      // Salted check
      if (docData.salt && docData.passwordHash) {
        const calcHash = await sha256Hex(params.password + docData.salt);
        if (calcHash === docData.passwordHash) {
          isPassValid = true;
        }
      }

      // Direct sha256 check
      if (!isPassValid && docData.passwordHash) {
        const directHash = await sha256Hex(params.password);
        if (directHash === docData.passwordHash) {
          isPassValid = true;
        }
      }

      // Plaintext fallback if saved earlier
      if (!isPassValid && docData.password && docData.password === params.password) {
        isPassValid = true;
      }

      // Firebase Auth attempt
      if (!isPassValid) {
        try {
          const userCredential = await signInWithEmailAndPassword(auth, authEmail, params.password);
          if (userCredential.user) {
            isPassValid = true;
          }
        } catch {}
      }

      if (isPassValid) {
        if (docRefId) {
          try {
            await updateDoc(doc(db, 'users', docRefId), { lastLoginAt: Date.now() });
          } catch {}
        }

        const account: UserAccount = {
          id: docData.id || docRefId || `usr_${cleanLogin}`,
          username: docData.username || cleanLogin,
          name: docData.name || cleanLogin,
          email: docData.email || undefined,
          tokensBalance: typeof docData.tokensBalance === 'number' ? docData.tokensBalance : 10000,
          totalTokensUsed: typeof docData.totalTokensUsed === 'number' ? docData.totalTokensUsed : 0,
          createdAt: docData.createdAt || Date.now(),
          lastLoginAt: Date.now(),
          role: (docData.role === 'admin' || cleanLogin === 'admin' || cleanLogin === 'sasha') ? 'admin' : 'user',
          avatar: docData.avatar || undefined,
        };

        return {
          success: true,
          account,
          message: 'Вход в аккаунт выполнен успешно!',
        };
      } else {
        return {
          success: false,
          message: 'Неверный пароль. Пожалуйста, проверьте введённые данные.',
        };
      }
    }
  } catch (fsErr) {
    console.warn('Firestore login check error:', fsErr);
  }

  // 2. Try Firebase Auth standalone
  try {
    const userCredential = await signInWithEmailAndPassword(
      auth,
      authEmail,
      params.password
    );
    const fbUser = userCredential.user;
    let docData: any = null;
    try {
      const docSnap = await getDoc(doc(db, 'users', fbUser.uid));
      if (docSnap.exists()) {
        docData = docSnap.data();
      }
    } catch {}

    const account = mapFirebaseUserToAccount(fbUser, docData);
    return {
      success: true,
      account,
      message: 'Вход в аккаунт выполнен успешно!',
    };
  } catch (authError: any) {
    if (authError?.code === 'auth/wrong-password' || authError?.code === 'auth/invalid-credential') {
      return {
        success: false,
        message: 'Неверный пароль. Пожалуйста, проверьте введённые данные.',
      };
    }
  }

  return {
    success: false,
    message: `Пользователь с логином «${cleanLogin}» не найден. Проверьте правильность логина или зарегистрируйтесь.`,
  };
}

export async function logoutFirebaseUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (e) {
    console.error('Sign out error:', e);
  }
}

export async function getAllFirestoreUsers(): Promise<UserAccount[]> {
  try {
    const snap = await getDocs(collection(db, 'users'));
    const list: UserAccount[] = [];
    snap.forEach((docItem) => {
      const d = docItem.data();
      list.push({
        id: docItem.id,
        username: d.username || docItem.id.slice(0, 8),
        name: d.name || d.username || 'Пользователь',
        email: d.email || undefined,
        tokensBalance: typeof d.tokensBalance === 'number' ? d.tokensBalance : 10000,
        totalTokensUsed: typeof d.totalTokensUsed === 'number' ? d.totalTokensUsed : 0,
        createdAt: d.createdAt || Date.now(),
        lastLoginAt: d.lastLoginAt || Date.now(),
        role: d.role === 'admin' ? 'admin' : 'user',
        avatar: d.avatar || undefined,
      });
    });
    return list;
  } catch (err) {
    return [];
  }
}

export async function updateUserFirestoreTokens(
  userId: string,
  newBalance: number
): Promise<boolean> {
  try {
    const clean = userId.trim();
    const cleanLower = clean.toLowerCase();
    const cleanWithoutUsr = cleanLower.replace(/^usr_/, '');

    let updated = false;

    // Try updating directly by userId
    try {
      await updateDoc(doc(db, 'users', clean), {
        tokensBalance: newBalance,
        lastUpdated: Date.now(),
      });
      updated = true;
    } catch {}

    // Try with usr_ prefix or without usr_
    if (!cleanLower.startsWith('usr_')) {
      try {
        await updateDoc(doc(db, 'users', `usr_${cleanLower}`), {
          tokensBalance: newBalance,
          lastUpdated: Date.now(),
        });
        updated = true;
      } catch {}
    } else {
      try {
        await updateDoc(doc(db, 'users', cleanWithoutUsr), {
          tokensBalance: newBalance,
          lastUpdated: Date.now(),
        });
        updated = true;
      } catch {}
    }

    // Also scan users collection to ensure any doc with this username gets updated
    try {
      const snap = await getDocs(collection(db, 'users'));
      for (const d of snap.docs) {
        const u = (d.data().username || '').toLowerCase();
        const docId = d.id.toLowerCase();
        if (
          u === cleanLower ||
          u === cleanWithoutUsr ||
          docId === cleanLower ||
          docId === `usr_${cleanWithoutUsr}` ||
          d.data().id === clean
        ) {
          await updateDoc(d.ref, {
            tokensBalance: newBalance,
            lastUpdated: Date.now(),
          });
          updated = true;
        }
      }
    } catch {}

    return updated;
  } catch (err) {
    console.error('Error updating tokens in Firestore:', err);
    return false;
  }
}

export async function updateUserFirestoreRole(
  userId: string,
  role: 'admin' | 'user'
): Promise<boolean> {
  try {
    const clean = userId.trim();
    const cleanLower = clean.toLowerCase();
    const cleanWithoutUsr = cleanLower.replace(/^usr_/, '');

    try {
      await updateDoc(doc(db, 'users', clean), { role, lastUpdated: Date.now() });
    } catch {}

    try {
      await updateDoc(doc(db, 'users', `usr_${cleanWithoutUsr}`), { role, lastUpdated: Date.now() });
    } catch {}

    try {
      const snap = await getDocs(collection(db, 'users'));
      for (const d of snap.docs) {
        const u = (d.data().username || '').toLowerCase();
        if (u === cleanLower || u === cleanWithoutUsr || d.data().id === clean) {
          await updateDoc(d.ref, { role, lastUpdated: Date.now() });
        }
      }
    } catch {}

    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteUserFromFirestore(userId: string): Promise<boolean> {
  try {
    const clean = userId.trim();
    const cleanLower = clean.toLowerCase();
    const cleanWithoutUsr = cleanLower.replace(/^usr_/, '');

    try {
      await deleteDoc(doc(db, 'users', clean));
    } catch {}

    try {
      await deleteDoc(doc(db, 'users', `usr_${cleanWithoutUsr}`));
    } catch {}

    try {
      const snap = await getDocs(collection(db, 'users'));
      for (const d of snap.docs) {
        const u = (d.data().username || '').toLowerCase();
        if (u === cleanLower || u === cleanWithoutUsr || d.data().id === clean) {
          await deleteDoc(d.ref);
        }
      }
    } catch {}

    return true;
  } catch (err) {
    return false;
  }
}
