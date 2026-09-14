import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface TokenKey {
  code: string;
  tokens: number;
  label?: string;
  createdAt: number;
  isRedeemed: boolean;
  redeemedBy?: string;
  redeemedAt?: number;
  maxUses?: number;
  usedCount?: number;
}

export interface UserSession {
  id: string;
  name?: string;
  username?: string;
  tokensBalance: number;
  totalTokensUsed: number;
  createdAt: number;
  lastActive: number;
  isRegistered?: boolean;
}

export interface UserAccount {
  id: string;
  username: string;
  passwordHash: string;
  salt?: string;
  name: string;
  email?: string;
  tokensBalance: number;
  totalTokensUsed: number;
  createdAt: number;
  lastLoginAt: number;
  role: 'user' | 'admin';
}

export interface AppStore {
  keys: Record<string, TokenKey>;
  users: Record<string, UserSession>;
  accounts: Record<string, UserAccount>;
  totalTokensConsumed: number;
}

function getStoreFilePath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join('/tmp', 'grokson_store.json');
  }
  return path.join(process.cwd(), 'data', 'store.json');
}

const DEFAULT_STORE: AppStore = {
  keys: {
    'GROK-VIP-100K': {
      code: 'GROK-VIP-100K',
      tokens: 100000,
      label: 'VIP ключ (100,000 токенов)',
      createdAt: Date.now(),
      isRedeemed: false,
      maxUses: 100,
      usedCount: 0,
    },
    'START-2026': {
      code: 'START-2026',
      tokens: 20000,
      label: 'Промокод 2026 (20,000 токенов)',
      createdAt: Date.now(),
      isRedeemed: false,
      maxUses: 100,
      usedCount: 0,
    },
  },
  users: {},
  accounts: {},
  totalTokensConsumed: 0,
};

let inMemoryStore: AppStore | null = null;

export function hashPassword(pwd: string, salt?: string): string {
  const clean = pwd.trim();
  if (salt) {
    return crypto.createHash('sha256').update(`${salt}:${clean}`).digest('hex');
  }
  return crypto.createHash('sha256').update(clean).digest('hex');
}

export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function loadStore(): AppStore {
  if (inMemoryStore) {
    return inMemoryStore;
  }

  const filePath = getStoreFilePath();
  const baseStorePath = path.join(process.cwd(), 'data', 'store.json');

  try {
    let sourcePath = filePath;
    if (!fs.existsSync(filePath) && fs.existsSync(baseStorePath)) {
      sourcePath = baseStorePath;
    }

    if (fs.existsSync(sourcePath)) {
      const data = fs.readFileSync(sourcePath, 'utf-8');
      inMemoryStore = JSON.parse(data);
      if (inMemoryStore) {
        if (!inMemoryStore.keys) inMemoryStore.keys = {};
        if (!inMemoryStore.users) inMemoryStore.users = {};
        if (!inMemoryStore.accounts) inMemoryStore.accounts = {};
        if (typeof inMemoryStore.totalTokensConsumed !== 'number') {
          inMemoryStore.totalTokensConsumed = 0;
        }
        return inMemoryStore;
      }
    }
  } catch (err) {
    console.warn('Storage read warning, initializing fresh default store:', err);
  }

  inMemoryStore = JSON.parse(JSON.stringify(DEFAULT_STORE));
  return inMemoryStore!;
}

export function saveStore(store: AppStore): void {
  inMemoryStore = store;
  try {
    const filePath = getStoreFilePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.warn('Persistent storage write bypassed (read-only environment):', err);
  }
}

export function getUser(userId: string): UserSession {
  const store = loadStore();

  if (store.accounts && store.accounts[userId]) {
    const acc = store.accounts[userId];
    const userSession: UserSession = {
      id: acc.id,
      name: acc.name,
      username: acc.username,
      tokensBalance: acc.tokensBalance,
      totalTokensUsed: acc.totalTokensUsed,
      createdAt: acc.createdAt,
      lastActive: Date.now(),
      isRegistered: true,
    };
    store.users[userId] = userSession;
    saveStore(store);
    return userSession;
  }

  if (!store.users[userId]) {
    const isGuest = !userId.startsWith('usr_');
    const initialTokens = isGuest ? 0 : 10000;

    store.users[userId] = {
      id: userId,
      name: `Пользователь #${userId.slice(0, 5)}`,
      tokensBalance: initialTokens,
      totalTokensUsed: 0,
      createdAt: Date.now(),
      lastActive: Date.now(),
      isRegistered: !isGuest,
    };
    saveStore(store);
  } else {
    store.users[userId].lastActive = Date.now();
    saveStore(store);
  }
  return store.users[userId];
}

export function updateUserTokens(userId: string, tokensDelta: number): UserSession {
  const store = loadStore();
  if (!store.accounts) store.accounts = {};
  if (!store.users) store.users = {};

  const clean = userId.trim();
  const normalized = clean.toLowerCase();
  const normalizedWithoutUsr = normalized.replace(/^usr_/, '');

  // 1. Locate account by id, usr_ prefix, or username
  let targetAccount =
    store.accounts[clean] ||
    store.accounts[normalized] ||
    store.accounts[`usr_${normalizedWithoutUsr}`] ||
    store.accounts[normalizedWithoutUsr];

  if (!targetAccount) {
    for (const acc of Object.values(store.accounts)) {
      const u = (acc.username || '').toLowerCase();
      const aId = (acc.id || '').toLowerCase();
      if (
        u === normalized ||
        u === normalizedWithoutUsr ||
        aId === normalized ||
        aId === clean.toLowerCase() ||
        aId === `usr_${normalizedWithoutUsr}` ||
        (acc.email && acc.email.toLowerCase() === normalized)
      ) {
        targetAccount = acc;
        break;
      }
    }
  }

  const effectiveId = targetAccount ? targetAccount.id : clean;
  const user = getUser(effectiveId);

  user.tokensBalance = Math.max(0, (user.tokensBalance || 0) + tokensDelta);
  if (tokensDelta < 0) {
    user.totalTokensUsed = (user.totalTokensUsed || 0) + Math.abs(tokensDelta);
    store.totalTokensConsumed = (store.totalTokensConsumed || 0) + Math.abs(tokensDelta);
  }

  store.users[effectiveId] = user;
  if (clean !== effectiveId) {
    store.users[clean] = { ...user, id: clean };
  }

  if (targetAccount) {
    targetAccount.tokensBalance = user.tokensBalance;
    targetAccount.totalTokensUsed = user.totalTokensUsed;
    store.accounts[targetAccount.id] = targetAccount;
    // Also update alias if keyed by username or usr_id
    if (store.accounts[targetAccount.username]) {
      store.accounts[targetAccount.username].tokensBalance = user.tokensBalance;
    }
  }

  saveStore(store);
  return user;
}

export function redeemKey(
  code: string,
  userId: string
): { success: boolean; message: string; tokens: number; newBalance: number } {
  const store = loadStore();
  const normalized = code.trim().toUpperCase();
  const key = store.keys[normalized];

  if (!key) {
    return {
      success: false,
      message: 'Ключ не найден или не существует',
      tokens: 0,
      newBalance: getUser(userId).tokensBalance,
    };
  }

  const maxUses = key.maxUses || 1;
  const currentUses = key.usedCount || (key.isRedeemed ? 1 : 0);

  if (currentUses >= maxUses) {
    return {
      success: false,
      message: 'Этот ключ уже был активирован ранее',
      tokens: 0,
      newBalance: getUser(userId).tokensBalance,
    };
  }

  key.usedCount = currentUses + 1;
  if (key.usedCount >= maxUses) {
    key.isRedeemed = true;
  }
  key.redeemedBy = userId;
  key.redeemedAt = Date.now();

  const user = updateUserTokens(userId, key.tokens);
  saveStore(store);

  return {
    success: true,
    message: `Ключ успешно активирован! Начислено ${key.tokens.toLocaleString('ru-RU')} токенов.`,
    tokens: key.tokens,
    newBalance: user.tokensBalance,
  };
}

export function createKey(code: string, tokens: number, label?: string, maxUses: number = 1): TokenKey {
  const store = loadStore();
  const normalized = code.trim().toUpperCase();

  const newKey: TokenKey = {
    code: normalized,
    tokens,
    label: label || `Ключ на ${tokens} токенов`,
    createdAt: Date.now(),
    isRedeemed: false,
    maxUses,
    usedCount: 0,
  };

  store.keys[normalized] = newKey;
  saveStore(store);
  return newKey;
}

export function getAllKeys(): TokenKey[] {
  const store = loadStore();
  return Object.values(store.keys);
}

export function getAllUsers(): UserSession[] {
  const store = loadStore();
  return Object.values(store.users);
}

export function findAccountByUsername(username: string): UserAccount | null {
  const store = loadStore();
  if (!store.accounts) return null;
  const normalized = username.trim().toLowerCase();
  for (const acc of Object.values(store.accounts)) {
    if (
      acc.username.toLowerCase() === normalized ||
      (acc.email && acc.email.toLowerCase() === normalized)
    ) {
      return acc;
    }
  }
  return null;
}

export function registerAccount(
  username: string,
  plainPassword: string,
  name?: string,
  email?: string,
  guestUserIdToMigrate?: string
): { success: boolean; message: string; account?: UserAccount } {
  const store = loadStore();
  if (!store.accounts) store.accounts = {};
  if (!store.users) store.users = {};

  const cleanUsername = username.trim().toLowerCase();
  if (cleanUsername.length < 3) {
    return { success: false, message: 'Логин должен содержать от 3 символов' };
  }

  if (plainPassword.length < 4) {
    return { success: false, message: 'Пароль должен содержать не менее 4 символов' };
  }

  if (findAccountByUsername(cleanUsername)) {
    return {
      success: false,
      message: 'Пользователь с таким логином уже существует. Пожалуйста, выполните вход.',
    };
  }

  if (email && email.trim()) {
    const cleanEmail = email.trim().toLowerCase();
    for (const acc of Object.values(store.accounts)) {
      if (acc.email && acc.email.toLowerCase() === cleanEmail) {
        return {
          success: false,
          message: 'Пользователь с таким Email уже зарегистрирован. Пожалуйста, выполните вход.',
        };
      }
    }
  }

  const accountId = `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const displayName = (name && name.trim()) || username.trim();

  let startingTokens = 10000;
  let totalUsed = 0;

  if (guestUserIdToMigrate && store.users && store.users[guestUserIdToMigrate]) {
    const guest = store.users[guestUserIdToMigrate];
    startingTokens += guest.tokensBalance || 0;
    totalUsed += guest.totalTokensUsed || 0;
  }

  const salt = generateSalt();
  const passwordHash = hashPassword(plainPassword, salt);

  const newAccount: UserAccount = {
    id: accountId,
    username: cleanUsername,
    passwordHash,
    salt,
    name: displayName,
    email: email?.trim(),
    tokensBalance: startingTokens,
    totalTokensUsed: totalUsed,
    createdAt: Date.now(),
    lastLoginAt: Date.now(),
    role: 'user',
  };

  store.accounts[accountId] = newAccount;

  store.users[accountId] = {
    id: accountId,
    name: displayName,
    username: cleanUsername,
    tokensBalance: startingTokens,
    totalTokensUsed: totalUsed,
    createdAt: Date.now(),
    lastActive: Date.now(),
    isRegistered: true,
  };

  saveStore(store);

  const publicAccount = { ...newAccount };
  delete (publicAccount as any).passwordHash;
  delete (publicAccount as any).salt;

  return {
    success: true,
    message: 'Регистрация прошла успешно! Вам начислено +10 000 токенов.',
    account: publicAccount,
  };
}

export function loginAccount(
  username: string,
  plainPassword: string
): { success: boolean; message: string; account?: UserAccount } {
  const store = loadStore();
  const acc = findAccountByUsername(username);

  if (!acc) {
    return { success: false, message: 'Пользователь с таким логином не найден' };
  }

  let isValid = false;

  // 1. Verify with salt if present
  if (acc.salt) {
    const hashWithSalt = hashPassword(plainPassword, acc.salt);
    if (hashWithSalt === acc.passwordHash) {
      isValid = true;
    }
  }

  // 2. Verify with legacy direct sha256
  if (!isValid) {
    const directHash = hashPassword(plainPassword);
    if (directHash === acc.passwordHash) {
      isValid = true;
    }
  }

  // 3. Fallback: if user password matches default or known values
  if (!isValid) {
    // Check if salt was not saved and plainPassword matches
    if ((acc as any).password && (acc as any).password === plainPassword) {
      isValid = true;
    }
  }

  if (!isValid) {
    return { success: false, message: 'Неверный пароль' };
  }

  acc.lastLoginAt = Date.now();
  saveStore(store);

  const publicAccount = { ...acc };
  delete (publicAccount as any).passwordHash;
  delete (publicAccount as any).salt;

  return {
    success: true,
    message: 'Вход успешно выполнен',
    account: publicAccount,
  };
}

export function getAccountById(id: string): UserAccount | null {
  const store = loadStore();
  if (!store.accounts) return null;
  const clean = id.trim();
  const lower = clean.toLowerCase();
  const lowerWithoutUsr = lower.replace(/^usr_/, '');

  let acc =
    store.accounts[clean] ||
    store.accounts[lower] ||
    store.accounts[`usr_${lowerWithoutUsr}`] ||
    store.accounts[lowerWithoutUsr];

  if (!acc) {
    for (const item of Object.values(store.accounts)) {
      const u = (item.username || '').toLowerCase();
      const aId = (item.id || '').toLowerCase();
      if (
        u === lower ||
        u === lowerWithoutUsr ||
        aId === clean.toLowerCase() ||
        aId === lower ||
        aId === `usr_${lowerWithoutUsr}` ||
        (item.email && item.email.toLowerCase() === lower)
      ) {
        acc = item;
        break;
      }
    }
  }

  if (!acc) return null;

  // Sync latest token balance from user session if higher
  const user = store.users?.[acc.id] || store.users?.[clean];
  if (user && typeof user.tokensBalance === 'number') {
    acc.tokensBalance = Math.max(acc.tokensBalance, user.tokensBalance);
  }

  const pub = { ...acc };
  delete (pub as any).passwordHash;
  delete (pub as any).salt;
  return pub;
}

export function getAllAccounts(): UserAccount[] {
  const store = loadStore();
  if (!store.accounts) return [];
  return Object.values(store.accounts).map((acc) => {
    const copy = { ...acc };
    delete (copy as any).passwordHash;
    delete (copy as any).salt;
    return copy;
  });
}

export function deleteAccount(id: string): boolean {
  const store = loadStore();
  let deleted = false;
  if (store.accounts && store.accounts[id]) {
    delete store.accounts[id];
    deleted = true;
  }
  if (store.users && store.users[id]) {
    delete store.users[id];
    deleted = true;
  }
  if (deleted) saveStore(store);
  return deleted;
}

export function updateAccountRole(id: string, role: 'admin' | 'user'): boolean {
  const store = loadStore();
  if (store.accounts && store.accounts[id]) {
    store.accounts[id].role = role;
    saveStore(store);
    return true;
  }
  return false;
}
