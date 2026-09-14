import React, { useState } from 'react';
import { X, User, Lock, Mail, Sparkles, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, LogIn, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserAccount } from '../types';
import {
  safeFetchJson,
  registerLocalAccount,
  loginLocalAccount,
  getLocalAccounts,
  saveAccountPassword,
} from '../utils/safeApi';
import { registerFirebaseUser, loginFirebaseUser } from '../lib/firebase';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: (account: UserAccount, tokensDelta?: number) => void;
  initialMode?: 'login' | 'register';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onAuthSuccess,
  initialMode = 'login',
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const localSavedAccounts = getLocalAccounts();

  if (!isOpen) return null;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLogin = login.trim();
    const cleanPassword = password.trim();

    if (!cleanLogin || !cleanPassword) {
      setError('Пожалуйста, заполните логин и пароль.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // 1. First: Try Server API login (has access to persistent /data/store.json with salted hashes)
      const serverRes = await safeFetchJson<{
        success: boolean;
        account?: UserAccount;
        error?: string;
        message?: string;
      }>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: cleanLogin, password: cleanPassword }),
      }, 5000);

      if (serverRes.ok && serverRes.data?.success && serverRes.data.account) {
        const account = serverRes.data.account;
        saveAccountPassword(account.username, cleanPassword);
        setSuccessMsg('Вход выполнен успешно! Добро пожаловать, ' + account.name);
        setTimeout(() => {
          onAuthSuccess(account);
          onClose();
        }, 600);
        return;
      }

      // If server explicitly said wrong password, report it directly
      if (serverRes.status === 401) {
        setError(serverRes.data?.error || 'Неверный пароль. Пожалуйста, проверьте введённые данные.');
        setLoading(false);
        return;
      }

      // 2. Second: Try Firebase Auth
      const fbRes = await loginFirebaseUser({ login: cleanLogin, password: cleanPassword });
      if (fbRes.success && fbRes.account) {
        saveAccountPassword(fbRes.account.username, cleanPassword);
        // Sync with backend
        safeFetchJson('/api/auth/sync-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accounts: [{ ...fbRes.account, password: cleanPassword }],
          }),
        }).catch(() => {});

        setSuccessMsg('Вход выполнен через Firebase! Добро пожаловать.');
        setTimeout(() => {
          onAuthSuccess(fbRes.account!);
          onClose();
        }, 600);
        return;
      }

      // 3. Third: Try local device account
      const localRes = loginLocalAccount({ login: cleanLogin, password: cleanPassword });
      if (localRes.success && localRes.account) {
        // Sync account to server so it is recognized globally
        safeFetchJson('/api/auth/sync-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accounts: [{ ...localRes.account, password: cleanPassword }],
          }),
        }).catch(() => {});

        setSuccessMsg('Вход выполнен на данном устройстве!');
        setTimeout(() => {
          onAuthSuccess(localRes.account!);
          onClose();
        }, 600);
        return;
      }

      setError(
        localRes.message ||
        fbRes.message ||
        serverRes.data?.error ||
        'Аккаунт с таким логином не найден. Проверьте правильность логина или зарегистрируйтесь.'
      );
    } catch (err: any) {
      setError(err.message || 'Ошибка соединения при входе в аккаунт.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanLogin = login.trim().toLowerCase();
    const cleanPassword = password.trim();
    const cleanName = name.trim() || cleanLogin;
    const cleanEmail = email.trim() || undefined;

    if (!cleanLogin || cleanLogin.length < 3) {
      setError('Логин должен содержать не менее 3 символов.');
      return;
    }

    if (!cleanPassword || cleanPassword.length < 4) {
      setError('Пароль должен быть не менее 4 символов.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      // 1. Register on Server (primary authority)
      const serverRes = await safeFetchJson<{
        success: boolean;
        account?: UserAccount;
        error?: string;
        message?: string;
      }>('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: cleanLogin,
          password: cleanPassword,
          name: cleanName,
          email: cleanEmail,
        }),
      }, 6000);

      let createdAccount: UserAccount | undefined = serverRes.data?.account;

      if (!serverRes.ok && serverRes.status === 400) {
        setError(serverRes.data?.error || 'Пользователь с таким логином уже существует.');
        setLoading(false);
        return;
      }

      // 2. Also register in Firebase Auth/Firestore for persistence
      try {
        const fbRes = await registerFirebaseUser({
          login: cleanLogin,
          password: cleanPassword,
          name: cleanName,
          email: cleanEmail,
        });
        if (fbRes.success && fbRes.account && !createdAccount) {
          createdAccount = fbRes.account;
        }
      } catch (fbErr) {
        console.warn('Firebase register notice:', fbErr);
      }

      // 3. Also save to local storage
      const localRes = registerLocalAccount({
        username: cleanLogin,
        name: cleanName,
        email: cleanEmail,
        password: cleanPassword,
        currentUserId: createdAccount?.id,
      });

      if (!createdAccount && localRes.account) {
        createdAccount = localRes.account;
      }

      if (createdAccount) {
        saveAccountPassword(cleanLogin, cleanPassword);
        setSuccessMsg('Аккаунт успешно создан! Начислено +10 000 токенов.');
        setTimeout(() => {
          onAuthSuccess(createdAccount!, 10000);
          onClose();
        }, 700);
      } else {
        setError('Не удалось создать аккаунт. Попробуйте другой логин.');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка при регистрации аккаунта.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSelectAccount = (acc: UserAccount) => {
    setLogin(acc.username);
    setMode('login');
    setError(null);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto bg-[#09090b] border border-white/15 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-2xl"
        >
          <button
            onClick={onClose}
            className="absolute top-4 sm:top-5 right-4 sm:right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 mb-5 pr-8">
            <div className="p-3 rounded-2xl bg-white/10 border border-white/15 text-white shrink-0">
              {mode === 'login' ? <LogIn className="w-6 h-6" /> : <UserPlus className="w-6 h-6" />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white font-display">
                {mode === 'login' ? 'Вход в аккаунт Grokson' : 'Регистрация аккаунта'}
              </h3>
              <p className="text-xs text-zinc-400">
                {mode === 'login'
                  ? 'Войдите для сохранения истории и токенов'
                  : 'Создайте аккаунт и получите +10 000 токенов'}
              </p>
            </div>
          </div>

          <div className="flex p-1 bg-black rounded-xl border border-white/10 mb-5">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'login' ? 'bg-white text-black shadow-xs' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Вход
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'register' ? 'bg-white text-black shadow-xs' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Регистрация (+10K)
            </button>
          </div>

          {localSavedAccounts.length > 0 && mode === 'login' && (
            <div className="mb-5 p-3 rounded-2xl bg-[#121215] border border-white/10">
              <div className="text-[11px] font-mono uppercase text-zinc-400 tracking-wider mb-2">
                Сохранённые на устройстве аккаунты:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {localSavedAccounts.map((acc) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => handleQuickSelectAccount(acc)}
                    className="px-2.5 py-1 rounded-lg bg-black hover:bg-white/10 border border-white/10 text-xs text-white flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <User className="w-3 h-3 text-zinc-400" />
                    <span>{acc.username}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={mode === 'login' ? handleLoginSubmit : handleRegisterSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Логин {mode === 'login' ? 'или Email' : ''}
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder={mode === 'login' ? 'Ваш логин...' : 'Придумайте логин...'}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black border border-white/15 focus:border-white/40 focus:outline-none text-white text-sm"
                  required
                />
              </div>
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Имя пользователя
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Как к вам обращаться..."
                    className="w-full px-4 py-2.5 rounded-xl bg-black border border-white/15 focus:border-white/40 focus:outline-none text-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    Email (необязательно)
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black border border-white/15 focus:border-white/40 focus:outline-none text-white text-sm"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                Пароль
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-zinc-500 absolute left-3.5 top-3" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Введите пароль..."
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black border border-white/15 focus:border-white/40 focus:outline-none text-white text-sm"
                  required
                />
              </div>
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-rose-950/40 border border-rose-800/40 text-rose-300 text-xs flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{error}</span>
              </motion.div>
            )}

            {successMsg && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-xl bg-white/10 border border-white/20 text-white text-xs flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 text-white shrink-0" />
                <span>{successMsg}</span>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-white hover:bg-zinc-200 active:scale-98 text-black font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>{mode === 'login' ? 'Войти в аккаунт' : 'Зарегистрироваться'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-4 text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
            <span>Защита данных с SHA-256 соленым хэшированием пароля</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
