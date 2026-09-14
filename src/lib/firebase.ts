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
    tokensBalance: docData?.tokensBalance ?? 10000,
    totalTokensUsed: docData?.totalTokensUsed ?? 0,
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
    const cleanUsername = params.login.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const userEmail = params.email ? params.email.trim().toLowerCase() : undefined;
    const authEmail = formatAuthEmail(params.email || params.login);
    const displayName = params.name?.trim() || cleanUsername;

    const isFirstAdmin =
      authEmail.toLowerCase() === 'sashanushan@gmail.com' ||
      cleanUsername === 'admin' ||
      cleanUsername === 'sasha' ||
      userEmail === 'sashanushan@gmail.com';

    let fbUid: string | null = null;
    let fbUser: FirebaseUser | null = null;

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        authEmail,
        params.password
      );
      fbUser = userCredential.user;
      fbUid = fbUser.uid;
      await updateProfile(fbUser, { displayName });
    } catch (authError: any) {
      if (authError?.code === 'auth/email-already-in-use') {
        return {
          success: false,
          message: 'Этот логин или email уже зарегистрирован. Пожалуйста, выполните вход.',
        };
      }
      if (authError?.code === 'auth/weak-password') {
        return {
          success: false,
          message: 'Пароль слишком простой (минимум 6 символов).',
        };
      }
    }

    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const duplicate = usersSnap.docs.find((d) => {
        const data = d.data();
        const u = (data.username || '').toLowerCase();
        const e = (data.email || '').toLowerCase();
        return (
          u === cleanUsername ||
          (userEmail && e === userEmail) ||
          e === authEmail ||
          d.id.toLowerCase() === cleanUsername
        );
      });

      if (duplicate) {
        return {
          success: false,
          message: 'Пользователь с таким логином или email уже существует. Пожалуйста, выполните вход.',
        };
      }
    } catch (fsCheckErr) {
      console.warn('Firestore duplicate check warning:', fsCheckErr);
    }

    const uid = fbUid || `fb_${cleanUsername}_${Math.random().toString(36).substring(2, 8)}`;

    const accountData = {
      uid,
      id: uid,
      username: cleanUsername,
      email: userEmail || authEmail,
      name: displayName,
      tokensBalance: 10000,
      totalTokensUsed: 0,
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
      role: (isFirstAdmin ? 'admin' : 'user') as 'admin' | 'user',
    };

    try {
      await setDoc(doc(db, 'users', uid), accountData);
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
    let message = 'Ошибка регистрации в Firebase.';
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
        await updateDoc(doc(db, 'users', fbUser.uid), { lastLoginAt: Date.now() });
      }
    } catch (fsErr) {
      console.warn('Firestore read error during login:', fsErr);
    }

    const account = mapFirebaseUserToAccount(fbUser, docData);
    return {
      success: true,
      account,
      message: 'Вход в аккаунт выполнен успешно!',
    };
  } catch (authError: any) {
    // Continue to server authentication
  }

  return {
    success: false,
    message: 'Аккаунт не найден. Проверьте логин или зарегистрируйтесь.',
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
    await updateDoc(doc(db, 'users', userId), {
      tokensBalance: newBalance,
      lastUpdated: Date.now(),
    });
    return true;
  } catch (err) {
    return false;
  }
}

export async function updateUserFirestoreRole(
  userId: string,
  role: 'admin' | 'user'
): Promise<boolean> {
  try {
    await updateDoc(doc(db, 'users', userId), {
      role,
      lastUpdated: Date.now(),
    });
    return true;
  } catch (err) {
    return false;
  }
}

export async function deleteUserFromFirestore(userId: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'users', userId));
    return true;
  } catch (err) {
    return false;
  }
}
