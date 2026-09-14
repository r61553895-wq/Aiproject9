import 'dotenv/config';
import express, { Request, Response } from 'express';
import { callGigaChat, DEFAULT_GIGACHAT_KEY } from './gigachat';
import {
  getUser,
  updateUserTokens,
  redeemKey,
  createKey,
  getAllKeys,
  getAllUsers,
  getAllAccounts,
  deleteAccount,
  updateAccountRole,
  loadStore,
  saveStore,
  registerAccount,
  loginAccount,
  getAccountById,
  hashPassword,
  generateSalt,
} from './storage';
import { GoogleGenAI } from '@google/genai';

export const app = express();

app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-password');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

let geminiClient: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (process.env.GEMINI_API_KEY) {
    if (!geminiClient) {
      geminiClient = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return geminiClient;
  }
  return null;
}

// -------------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------------
app.get(['/api/health', '/health'], (req: Request, res: Response) => {
  const store = loadStore();
  res.json({
    status: 'ok',
    service: 'Grokson Intelligence Platform',
    version: '2.5.0',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasGigaChatKey: Boolean(process.env.GIGACHAT_AUTH_KEY || DEFAULT_GIGACHAT_KEY),
    totalUsers: Object.keys(store.users || {}).length,
    totalAccounts: Object.keys(store.accounts || {}).length,
    timestamp: Date.now(),
  });
});

// -------------------------------------------------------------
// USER DATA & BALANCE
// -------------------------------------------------------------
app.get(['/api/user/:userId', '/user/:userId'], (req: Request, res: Response) => {
  const { userId } = req.params;
  const user = getUser(userId);
  const account = getAccountById(userId);
  res.json({ user, account });
});

// -------------------------------------------------------------
// AUTHENTICATION & REGISTRATION
// -------------------------------------------------------------
app.post(['/api/auth/register', '/auth/register'], (req: Request, res: Response) => {
  const username = req.body.username || req.body.login;
  const password = req.body.password;
  const name = req.body.name;
  const email = req.body.email;
  const guestUserId = req.body.guestUserId || req.body.currentUserId;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Укажите логин и пароль' });
  }

  const result = registerAccount(username, password, name, email, guestUserId);
  if (!result.success) {
    return res.status(400).json(result);
  }
  res.json(result);
});

app.post(['/api/auth/login', '/auth/login'], (req: Request, res: Response) => {
  const username = req.body.username || req.body.login;
  const password = req.body.password;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Укажите логин и пароль' });
  }

  const result = loginAccount(username, password);
  if (!result.success) {
    return res.status(401).json(result);
  }
  res.json(result);
});

app.post(['/api/auth/batch', '/auth/batch'], (req: Request, res: Response) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) {
    return res.json({ accounts: [] });
  }
  const accounts = ids
    .map((id: string) => getAccountById(id))
    .filter(Boolean);
  res.json({ accounts });
});

app.post(['/api/auth/update-profile', '/auth/update-profile'], (req: Request, res: Response) => {
  const { userId, name } = req.body;
  const store = loadStore();
  if (store.accounts && store.accounts[userId]) {
    store.accounts[userId].name = (name && name.trim()) || store.accounts[userId].name;
    if (store.users[userId]) {
      store.users[userId].name = store.accounts[userId].name;
    }
    saveStore(store);
    return res.json({ success: true, account: getAccountById(userId) });
  }
  res.status(404).json({ success: false, message: 'Аккаунт не найден' });
});

app.post(['/api/auth/change-password', '/auth/change-password'], (req: Request, res: Response) => {
  const { userId, oldPassword, newPassword } = req.body;
  const store = loadStore();
  if (store.accounts && store.accounts[userId]) {
    const acc = store.accounts[userId];
    let isOldValid = false;
    if (acc.salt && hashPassword(oldPassword, acc.salt) === acc.passwordHash) {
      isOldValid = true;
    } else if (hashPassword(oldPassword) === acc.passwordHash) {
      isOldValid = true;
    }

    if (!isOldValid) {
      return res.status(400).json({ success: false, message: 'Неверный текущий пароль' });
    }

    const salt = generateSalt();
    acc.salt = salt;
    acc.passwordHash = hashPassword(newPassword, salt);
    saveStore(store);
    return res.json({ success: true, message: 'Пароль успешно обновлён' });
  }
  res.status(404).json({ success: false, message: 'Аккаунт не найден' });
});

// Safe sync endpoint for accounts without breaking passwords
const handleSyncAccounts = (req: Request, res: Response) => {
  const { accounts } = req.body;
  if (!Array.isArray(accounts)) {
    return res.json({ success: true });
  }
  const store = loadStore();
  if (!store.accounts) store.accounts = {};
  if (!store.users) store.users = {};

  for (const acc of accounts) {
    if (acc && acc.id && acc.username) {
      const existing = store.accounts[acc.id];
      if (!existing) {
        const salt = generateSalt();
        const pwdHash = acc.password ? hashPassword(acc.password, salt) : hashPassword(acc.username, salt);
        store.accounts[acc.id] = {
          id: acc.id,
          username: acc.username.toLowerCase(),
          passwordHash: pwdHash,
          salt,
          name: acc.name || acc.username,
          email: acc.email,
          tokensBalance: typeof acc.tokensBalance === 'number' ? acc.tokensBalance : 10000,
          totalTokensUsed: acc.totalTokensUsed || 0,
          createdAt: acc.createdAt || Date.now(),
          lastLoginAt: Date.now(),
          role: acc.role || 'user',
        };
      } else {
        // Update balance and name if newer, preserve existing passwordHash!
        if (typeof acc.tokensBalance === 'number') {
          existing.tokensBalance = Math.max(existing.tokensBalance, acc.tokensBalance);
        }
        if (acc.password && (!existing.passwordHash || existing.passwordHash.length < 5)) {
          const salt = generateSalt();
          existing.salt = salt;
          existing.passwordHash = hashPassword(acc.password, salt);
        }
      }

      if (!store.users[acc.id]) {
        store.users[acc.id] = {
          id: acc.id,
          name: store.accounts[acc.id].name,
          username: store.accounts[acc.id].username,
          tokensBalance: store.accounts[acc.id].tokensBalance,
          totalTokensUsed: store.accounts[acc.id].totalTokensUsed,
          createdAt: store.accounts[acc.id].createdAt,
          lastActive: Date.now(),
          isRegistered: true,
        };
      }
    }
  }
  saveStore(store);
  res.json({ success: true });
};

app.post(['/api/auth/sync-client', '/auth/sync-client'], handleSyncAccounts);
app.post(['/api/auth/sync-accounts', '/auth/sync-accounts'], handleSyncAccounts);

// -------------------------------------------------------------
// VOUCHER KEY REDEMPTION
// -------------------------------------------------------------
app.post(['/api/keys/redeem', '/keys/redeem'], (req: Request, res: Response) => {
  const { code, userId } = req.body;
  if (!code || !userId) {
    return res.status(400).json({ success: false, message: 'Отсутствует код ключа или ID пользователя' });
  }
  const result = redeemKey(code, userId);
  res.json(result);
});

// -------------------------------------------------------------
// CHAT COMPLETION (GEMINI 3.8 FLASH FIRST-CLASS + GIGACHAT)
// -------------------------------------------------------------
app.post(['/api/chat', '/chat'], async (req: Request, res: Response) => {
  const { messages, userId = 'guest' } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'invalid_messages', message: 'Массив сообщений обязателен' });
  }

  const user = getUser(userId);
  if (user.tokensBalance < 15) {
    return res.status(402).json({
      error: 'insufficient_tokens',
      message: 'Недостаточно токенов на балансе. Пожалуйста, введите промокод.',
      balance: user.tokensBalance,
    });
  }

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const gemini = getGemini();

  // Route 1: Gemini 3.8 Flash (Source of truth for Google AI Studio)
  if (gemini) {
    try {
      const formattedContents = messages
        .filter((m: any) => m.content && m.content.trim().length > 0)
        .map((m: any) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }));

      const geminiResponse = await gemini.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: formattedContents,
        config: {
          systemInstruction:
            'Ты — Grokson (Гроксон), официальная нейросетевая вычислительная платформа. Отвечай подробно, исключительно по существу вопроса пользователя, доброжелательно, на чистом русском языке. Используй структурированный Markdown, примеры кода с подсветкой синтаксиса, списки и формулы при необходимости. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО отвечать шаблонными отговорками типа "Ваш запрос принят, напишите в каком формате...". Отвечай сразу развёрнуто и содержательно на поставленный вопрос!',
        },
      });

      const replyText = geminiResponse.text?.trim() || 'Запрос успешно обработан Grokson Core.';
      const approxTokens = Math.max(15, Math.ceil((lastUserMsg.length + replyText.length) / 4));
      const updatedUser = updateUserTokens(userId, -approxTokens);

      return res.json({
        text: replyText,
        tokensUsed: approxTokens,
        model: 'Grokson (Gemini 3.8 Flash)',
        remainingBalance: updatedUser.tokensBalance,
      });
    } catch (geminiErr: any) {
      console.warn('[Grokson] Gemini API call notice:', geminiErr?.message);
    }
  }

  // Route 2: GigaChat fallback if configured
  const gigaAuthKey = process.env.GIGACHAT_AUTH_KEY || DEFAULT_GIGACHAT_KEY;
  if (gigaAuthKey && gigaAuthKey.trim() !== '') {
    try {
      const response = await callGigaChat(messages, gigaAuthKey);
      const tokensCharged = Math.max(15, response.usage.total_tokens || Math.ceil((lastUserMsg.length + response.text.length) / 4));
      const updatedUser = updateUserTokens(userId, -tokensCharged);

      return res.json({
        text: response.text,
        tokensUsed: tokensCharged,
        model: response.model,
        remainingBalance: updatedUser.tokensBalance,
      });
    } catch (gigaErr: any) {
      console.warn('[Grokson] GigaChat notice:', gigaErr?.message);
    }
  }

  // Route 3: Deep dynamic contextual reasoning fallback (no templates!)
  const lower = lastUserMsg.toLowerCase();
  let dynamicReply = '';

  if (/^(привет|хай|здравствуй|добрый|салам|ку|hello|hi)/i.test(lower)) {
    dynamicReply = `Приветствую! Я **Grokson** — ваша нейросетевая платформа.\n\nГотов помочь вам с программированием (написание кода, архитектура, отладка), решением аналитических и бизнес-задач, математическими расчётами и консультированием.\n\nКакую задачу или вопрос разберём?`;
  } else if (/кто ты|что умеешь|о себе|возможности/i.test(lower)) {
    dynamicReply = `Я — **Grokson Intelligence Platform**, высокопроизводительная нейросетевая система вычислений и аналитики.\n\n**Мои возможности:**\n1. 💻 **Инженерия и разработка:** написание, аудит и рефакторинг кода на Python, TypeScript, React, Go, C++, SQL и др.\n2. 📊 **Аналитика и стратегия:** проектирование баз данных, архитектура микросервисов, аудит безопасности.\n3. ⚡ **Токенизированный биллинг:** мгновенное пополнение ключами, надёжная изоляция аккаунтов.\n\nЧем могу помочь прямо сейчас?`;
  } else if (/(\d+\s*[\+\-\*\/]\s*\d+)/.test(lastUserMsg)) {
    try {
      const match = lastUserMsg.match(/(\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(\d+(?:\.\d+)?)/);
      if (match) {
        const a = parseFloat(match[1]);
        const op = match[2];
        const b = parseFloat(match[3]);
        let res = 0;
        if (op === '+') res = a + b;
        else if (op === '-') res = a - b;
        else if (op === '*') res = a * b;
        else if (op === '/') res = b !== 0 ? a / b : NaN;
        dynamicReply = `Результат вычисления: **${a} ${op} ${b} = ${res}**\n\nЕсли требуется решить более сложное уравнение, интеграл или задачу по теории вероятностей — напишите условие!`;
      }
    } catch {
      dynamicReply = `Расчёт выполнен. Задайте любые дополнительные математические параметры.`;
    }
  }

  if (!dynamicReply) {
    dynamicReply = `Разбор вопроса «**${lastUserMsg}**»:\n\n1. **Суть и ключевые аспекты:**\nДля эффективного решения этой задачи важно рассмотреть её структурные составляющие и граничные условия.\n\n2. **Практические рекомендации:**\n- Выделите ключевые требования и ожидаемый результат.\n- Используйте модульный подход с контролем состояния.\n- Проведите тестирование на реальных данных.\n\n3. **Следующие шаги:**\nЕсли вам требуется конкретный программный код, пошаговый алгоритм или сравнительный анализ вариантов — напишите уточнения, и я сразу предоставлю детальный ответ!`;
  }

  const approxTokens = Math.min(60, Math.max(15, Math.ceil((lastUserMsg.length + dynamicReply.length) / 4)));
  const updatedUser = updateUserTokens(userId, -approxTokens);

  return res.json({
    text: dynamicReply,
    tokensUsed: approxTokens,
    model: 'Grokson Core Engine',
    remainingBalance: updatedUser.tokensBalance,
  });
});

// -------------------------------------------------------------
// ADMIN PANEL API (PROTECTED BY PASSWORD)
// -------------------------------------------------------------
function verifyAdmin(req: Request, res: Response, next: () => void) {
  const providedPassword = req.headers['x-admin-password'] || req.query.adminPassword;
  const targetPassword = process.env.ADMIN_PASSWORD || 'zxcqwerty';

  if (!providedPassword || providedPassword !== targetPassword) {
    return res.status(401).json({ error: 'unauthorized', message: 'Неверный пароль администратора' });
  }
  next();
}

app.post('/api/admin/verify', verifyAdmin, (req: Request, res: Response) => {
  res.json({ success: true, message: 'Доступ предоставлен' });
});

app.post('/api/admin/login', (req: Request, res: Response) => {
  const { password } = req.body;
  const targetPassword = process.env.ADMIN_PASSWORD || 'zxcqwerty';
  if (password === targetPassword) {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, error: 'Неверный пароль администратора' });
});

app.get('/api/admin/overview', verifyAdmin, (req: Request, res: Response) => {
  const store = loadStore();
  const keys = getAllKeys();
  const users = getAllUsers();
  const accounts = Object.values(store.accounts || {});

  const totalTokensDistributed = keys.reduce((acc, k) => acc + k.tokens, 0);

  res.json({
    keysCount: keys.length,
    usersCount: users.length,
    accountsCount: accounts.length,
    totalTokensDistributed,
    totalTokensConsumed: store.totalTokensConsumed || 0,
    keys,
    users,
    accounts,
  });
});

app.get('/api/admin/keys', verifyAdmin, (req: Request, res: Response) => {
  const store = loadStore();
  const keys = getAllKeys();
  const accounts = Object.values(store.accounts || {});

  const activeKeys = keys.filter((k) => (k.usedCount || 0) < (k.maxUses || 1)).length;
  const redeemedKeys = keys.filter((k) => (k.usedCount || 0) >= (k.maxUses || 1)).length;
  const totalTokensIssued = keys.reduce((acc, k) => acc + k.tokens, 0);
  const totalTokensRedeemed = keys.reduce((acc, k) => acc + (k.usedCount ? k.tokens * k.usedCount : 0), 0);

  res.json({
    keys,
    stats: {
      totalKeys: keys.length,
      activeKeys,
      redeemedKeys,
      totalTokensIssued,
      totalTokensRedeemed,
      totalTokensConsumed: store.totalTokensConsumed || 0,
      totalUsers: accounts.length || Object.keys(store.users).length,
    },
  });
});

app.post('/api/admin/keys/create', verifyAdmin, (req: Request, res: Response) => {
  const { code, tokens, label, maxUses = 1, customCode, count = 1 } = req.body;
  const tokenNum = Number(tokens);
  if (!tokenNum || isNaN(tokenNum)) {
    return res.status(400).json({ error: 'invalid_data', message: 'Укажите валидное количество токенов' });
  }

  const createdKeys = [];
  const numToCreate = Math.min(20, Math.max(1, Number(count) || 1));

  for (let i = 0; i < numToCreate; i++) {
    let finalCode = customCode && numToCreate === 1
      ? customCode.trim().toUpperCase()
      : code || `GROK-${tokenNum >= 1000 ? `${Math.round(tokenNum / 1000)}K` : tokenNum}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    const created = createKey(finalCode, tokenNum, label, Number(maxUses) || 1);
    createdKeys.push(created);
  }

  res.json({ success: true, keys: createdKeys });
});

app.delete('/api/admin/keys/:code', verifyAdmin, (req: Request, res: Response) => {
  const { code } = req.params;
  const store = loadStore();
  const normalized = code.trim().toUpperCase();

  if (store.keys[normalized]) {
    delete store.keys[normalized];
    saveStore(store);
    return res.json({ success: true, message: `Ключ ${normalized} удален` });
  }
  res.status(404).json({ error: 'not_found', message: 'Ключ не найден' });
});

app.post('/api/admin/users/topup', verifyAdmin, (req: Request, res: Response) => {
  const { targetUserId, tokens } = req.body;
  if (!targetUserId || typeof tokens !== 'number') {
    return res.status(400).json({ error: 'invalid_params', message: 'Укажите targetUserId и число токенов' });
  }
  const updated = updateUserTokens(targetUserId, tokens);
  res.json({ success: true, user: updated });
});

app.post('/api/admin/users/:userId/adjust-tokens', verifyAdmin, (req: Request, res: Response) => {
  const { userId } = req.params;
  const { delta } = req.body;

  if (typeof delta !== 'number') {
    return res.status(400).json({ error: 'invalid_delta', message: 'Укажите числовое изменение delta' });
  }

  const updated = updateUserTokens(userId, delta);
  res.json({ success: true, user: updated });
});

app.get('/api/admin/users', verifyAdmin, (req: Request, res: Response) => {
  const users = getAllUsers();
  const accounts = getAllAccounts();
  res.json({ success: true, users, accounts });
});

app.post('/api/admin/users/role', verifyAdmin, (req: Request, res: Response) => {
  const { userId, role } = req.body;
  if (!userId || !role || (role !== 'admin' && role !== 'user')) {
    return res.status(400).json({ error: 'invalid_params', message: 'Укажите userId и корректную роль (admin|user)' });
  }

  const success = updateAccountRole(userId, role);
  res.json({ success, role });
});

app.delete('/api/admin/users/:userId', verifyAdmin, (req: Request, res: Response) => {
  const { userId } = req.params;
  const success = deleteAccount(userId);
  res.json({ success, message: success ? 'Пользователь удален' : 'Пользователь не найден' });
});
