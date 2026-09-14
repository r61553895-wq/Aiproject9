import React, { useState, useEffect, useRef } from 'react';
import { ChatMessage, ChatSession, UserAccount } from './types';
import { Sidebar } from './components/Sidebar';
import { ChatMessageItem } from './components/ChatMessageItem';
import { ChatInput } from './components/ChatInput';
import { WelcomeBanner } from './components/WelcomeBanner';
import { RedeemKeyModal } from './components/RedeemKeyModal';
import { BuyTokensModal } from './components/BuyTokensModal';
import { AdminPanelModal } from './components/AdminPanelModal';
import { AuthModal } from './components/AuthModal';
import { AccountModal } from './components/AccountModal';
import { GroksonLogo } from './components/GroksonLogo';
import { GroksonMascot } from './components/GroksonMascot';
import {
  Menu,
  Sparkles,
  User,
  Zap,
  ShieldCheck,
  Plus,
  AlertCircle,
  KeyRound,
  LogOut,
  UserPlus,
} from 'lucide-react';
import {
  safeFetchJson,
  redeemLocalKey,
  syncSavedAccountsWithServer,
  getLocalAccounts,
  saveLocalAccounts,
} from './utils/safeApi';
import { generateEdgeAIResponse } from './utils/aiFallback';
import {
  logoutFirebaseUser,
  saveUserChatSessions,
  getUserChatSessions,
  getUserFirestoreTokens,
  updateUserFirestoreTokens,
  redeemFirestoreKey,
} from './lib/firebase';

const CHAT_SESSIONS_KEY = 'grokson_chat_sessions';
const CURRENT_USER_KEY = 'grokson_current_user';
const TOKENS_BALANCE_KEY = 'grokson_tokens_balance';

export const App: React.FC = () => {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_SESSIONS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    const initialId = `session_${Date.now()}`;
    return [
      {
        id: initialId,
        title: 'Новый диалог',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string>(() => {
    return sessions[0]?.id || `session_${Date.now()}`;
  });

  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() => {
    try {
      const raw = localStorage.getItem(CURRENT_USER_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return null;
  });

  const [tokensBalance, setTokensBalance] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(TOKENS_BALANCE_KEY);
      if (raw !== null) return parseInt(raw, 10);
    } catch {}
    return 10000;
  });

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [preferredModel, setPreferredModel] = useState<'gigachat' | 'gemini'>('gigachat');

  // Modals
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [isBuyOpen, setIsBuyOpen] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');
  const [isAccountOpen, setIsAccountOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Save sessions to localStorage & Cloud
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {}

    if (currentUser?.id) {
      const timer = setTimeout(() => {
        saveUserChatSessions(currentUser.id, sessions);
        safeFetchJson(`/api/users/${encodeURIComponent(currentUser.id)}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chats: sessions }),
        }).catch(() => {});
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [sessions, currentUser?.id]);

  // Save tokens to localStorage & Cloud
  useEffect(() => {
    try {
      localStorage.setItem(TOKENS_BALANCE_KEY, tokensBalance.toString());
    } catch (e) {}

    if (currentUser?.id) {
      const timer = setTimeout(() => {
        updateUserFirestoreTokens(currentUser.id, tokensBalance);
        safeFetchJson(`/api/users/${encodeURIComponent(currentUser.id)}/balance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tokens: tokensBalance }),
        }).catch(() => {});
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [tokensBalance, currentUser?.id]);

  // Sync on startup with server and listen for token updates
  useEffect(() => {
    syncSavedAccountsWithServer();

    if (!currentUser?.id) return;

    const loadUserCloudData = async () => {
      // 1. Fetch balance from Firestore first (cross-device source of truth)
      try {
        const fbTokens = await getUserFirestoreTokens(currentUser.id);
        if (typeof fbTokens === 'number') {
          setTokensBalance(fbTokens);
          setCurrentUser((prev) => (prev ? { ...prev, tokensBalance: fbTokens } : prev));
        } else {
          const meRes = await safeFetchJson<{ account?: UserAccount }>(
            `/api/auth/me?userId=${encodeURIComponent(currentUser.id)}`,
            {},
            3000
          );
          if (meRes.ok && meRes.data?.account) {
            setTokensBalance(meRes.data.account.tokensBalance);
            setCurrentUser(meRes.data.account);
          }
        }
      } catch {}

      // 2. Fetch user's saved chats (cross-device sync)
      try {
        let loadedChats = await getUserChatSessions(currentUser.id);
        if (!loadedChats || loadedChats.length === 0) {
          loadedChats = await getUserChatSessions(currentUser.username);
        }
        if (!loadedChats || loadedChats.length === 0) {
          const serverChatRes = await safeFetchJson<{ chats?: ChatSession[] }>(
            `/api/users/${encodeURIComponent(currentUser.id)}/chats`,
            {},
            3000
          );
          if (serverChatRes.ok && Array.isArray(serverChatRes.data?.chats) && serverChatRes.data.chats.length > 0) {
            loadedChats = serverChatRes.data.chats;
          }
        }
        if (loadedChats && loadedChats.length > 0) {
          setSessions(loadedChats);
          setCurrentSessionId(loadedChats[0].id);
        }
      } catch (e) {
        console.warn('Error loading cloud chats:', e);
      }
    };

    loadUserCloudData();

    const handleTokensUpdated = (e: any) => {
      if (typeof e.detail?.balance === 'number') {
        setTokensBalance(e.detail.balance);
        setCurrentUser((prev) => (prev ? { ...prev, tokensBalance: e.detail.balance } : prev));
      }
    };

    window.addEventListener('grokson_tokens_updated', handleTokensUpdated);
    window.addEventListener('focus', loadUserCloudData);

    return () => {
      window.removeEventListener('grokson_tokens_updated', handleTokensUpdated);
      window.removeEventListener('focus', loadUserCloudData);
    };
  }, [currentUser?.id]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [sessions, currentSessionId, isLoading]);

  const currentSession = sessions.find((s) => s.id === currentSessionId) || sessions[0];

  const handleNewChat = () => {
    const newSession: ChatSession = {
      id: `session_${Date.now()}`,
      title: 'Новый диалог',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
  };

  const handleDeleteSession = (id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      if (filtered.length === 0) {
        const fallback: ChatSession = {
          id: `session_${Date.now()}`,
          title: 'Новый диалог',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setCurrentSessionId(fallback.id);
        return [fallback];
      }
      if (currentSessionId === id) {
        setCurrentSessionId(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleClearAllSessions = () => {
    if (window.confirm('Удалить все диалоги?')) {
      const newSession: ChatSession = {
        id: `session_${Date.now()}`,
        title: 'Новый диалог',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      setSessions([newSession]);
      setCurrentSessionId(newSession.id);
    }
  };

  const handleSendMessage = async (promptToSend?: string) => {
    const text = (promptToSend || input).trim();
    if (!text || isLoading) return;

    if (!currentUser) {
      setAuthInitialMode('register');
      setIsAuthOpen(true);
      return;
    }

    if (tokensBalance < 15) {
      setIsRedeemOpen(true);
      return;
    }

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}_user`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const targetSessionId = currentSessionId;

    // Update session title if first message
    const isFirst = currentSession?.messages.length === 0;
    const newTitle = isFirst ? (text.length > 28 ? `${text.slice(0, 28)}...` : text) : currentSession.title;

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === targetSessionId) {
          return {
            ...s,
            title: newTitle,
            updatedAt: Date.now(),
            messages: [...s.messages, userMessage],
          };
        }
        return s;
      })
    );

    if (!promptToSend) setInput('');
    setIsLoading(true);

    try {
      const historyPayload = currentSession.messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await safeFetchJson<{
        reply?: string;
        text?: string;
        tokensUsed?: number;
        remainingTokens?: number;
        model?: string;
        error?: string;
      }>('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          userId: currentUser?.id || 'guest_user',
          chatHistory: historyPayload,
          preferredModel,
        }),
      }, 16000);

      let replyContent = '';
      let tokensUsed = 25;
      let modelName = preferredModel === 'gigachat' ? 'GigaChat (Сбер)' : 'Gemini 3.8 Flash';

      if (res.ok && (res.data?.reply || (res.data as any)?.text)) {
        replyContent = res.data?.reply || (res.data as any)?.text;
        tokensUsed = res.data?.tokensUsed || 25;
        modelName = res.data?.model || (preferredModel === 'gigachat' ? 'GigaChat (Сбер)' : 'Gemini 3.8 Flash');

        if (typeof res.data?.remainingTokens === 'number') {
          setTokensBalance(res.data.remainingTokens);
        } else {
          setTokensBalance((prev) => Math.max(0, prev - tokensUsed));
        }
      } else {
        // Safe intelligent dynamic fallback
        const fallback = generateEdgeAIResponse(text);
        replyContent = fallback.text;
        tokensUsed = fallback.tokensUsed;
        modelName = fallback.model;
        setTokensBalance((prev) => Math.max(0, prev - tokensUsed));
      }

      const assistantMessage: ChatMessage = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: replyContent,
        timestamp: Date.now(),
        tokensUsed,
        model: modelName,
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId) {
            return {
              ...s,
              updatedAt: Date.now(),
              messages: [...s.messages, assistantMessage],
            };
          }
          return s;
        })
      );
    } catch (err: any) {
      const fallback = generateEdgeAIResponse(text);
      const assistantMessage: ChatMessage = {
        id: `msg_${Date.now()}_assistant`,
        role: 'assistant',
        content: fallback.text,
        timestamp: Date.now(),
        tokensUsed: fallback.tokensUsed,
        model: fallback.model,
      };

      setTokensBalance((prev) => Math.max(0, prev - fallback.tokensUsed));

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId) {
            return {
              ...s,
              updatedAt: Date.now(),
              messages: [...s.messages, assistantMessage],
            };
          }
          return s;
        })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRedeemKey = async (code: string) => {
    const cleanCode = code.trim().toUpperCase();

    // 1. First try server endpoint
    try {
      const res = await safeFetchJson<{
        success: boolean;
        tokens?: number;
        newBalance?: number;
        remainingTokens?: number;
        message?: string;
      }>('/api/redeem-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: cleanCode,
          userId: currentUser?.id || 'guest_user',
        }),
      }, 5000);

      if (res.ok && res.data?.success) {
        const added = res.data.tokens || 0;
        const newBal =
          typeof res.data.newBalance === 'number'
            ? res.data.newBalance
            : typeof res.data.remainingTokens === 'number'
            ? res.data.remainingTokens
            : tokensBalance + added;

        setTokensBalance(newBal);

        if (currentUser) {
          const updated = { ...currentUser, tokensBalance: newBal };
          setCurrentUser(updated);
          localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updated));
          updateUserFirestoreTokens(currentUser.id, newBal);
        }

        return {
          success: true,
          tokens: added,
          message: res.data.message || `Начислено +${added.toLocaleString()} токенов!`,
          newBalance: newBal,
        };
      }
    } catch {}

    // 2. Try Firestore key redemption
    try {
      const fbKeyRes = await redeemFirestoreKey(cleanCode, currentUser?.id || 'guest_user');
      if (fbKeyRes && fbKeyRes.success) {
        setTokensBalance(fbKeyRes.newBalance);
        if (currentUser) {
          const updated = { ...currentUser, tokensBalance: fbKeyRes.newBalance };
          setCurrentUser(updated);
          localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updated));
        }
        return fbKeyRes;
      }
    } catch {}

    // 3. Fallback to local key validation
    const localRes = redeemLocalKey(cleanCode, currentUser?.id || 'guest_user', tokensBalance);
    if (localRes.success) {
      setTokensBalance(localRes.newBalance);
      if (currentUser) {
        const updated = { ...currentUser, tokensBalance: localRes.newBalance };
        setCurrentUser(updated);
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(updated));
        updateUserFirestoreTokens(currentUser.id, localRes.newBalance);
      }
    }
    return localRes;
  };

  const handleAuthSuccess = async (account: UserAccount, tokensDelta?: number) => {
    setCurrentUser(account);
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(account));

    // Save account to saved local accounts list on this device so it's remembered
    try {
      const saved = getLocalAccounts();
      const cleanId = account.id;
      const exists = saved.some(
        (a) => a.id === cleanId || a.username.toLowerCase() === account.username.toLowerCase()
      );
      if (!exists) {
        saved.unshift(account);
        saveLocalAccounts(saved);
      }
    } catch {}

    const newBal = account.tokensBalance + (tokensDelta || 0);
    setTokensBalance(newBal);
    localStorage.setItem(TOKENS_BALANCE_KEY, newBal.toString());

    // 🌟 CROSS-DEVICE CHAT & BALANCE SYNCHRONIZATION:
    try {
      // 1. Authoritative token balance from Firestore
      const fbTokens = await getUserFirestoreTokens(account.id);
      if (typeof fbTokens === 'number') {
        setTokensBalance(fbTokens);
        account.tokensBalance = fbTokens;
        setCurrentUser({ ...account, tokensBalance: fbTokens });
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify({ ...account, tokensBalance: fbTokens }));
      }

      // 2. Fetch user's saved chats
      let loadedChats: ChatSession[] | null = await getUserChatSessions(account.id);
      if (!loadedChats || loadedChats.length === 0) {
        loadedChats = await getUserChatSessions(account.username);
      }
      if (!loadedChats || loadedChats.length === 0) {
        const serverChatRes = await safeFetchJson<{ chats?: ChatSession[] }>(
          `/api/users/${encodeURIComponent(account.id)}/chats`,
          {},
          3000
        );
        if (serverChatRes.ok && Array.isArray(serverChatRes.data?.chats) && serverChatRes.data.chats.length > 0) {
          loadedChats = serverChatRes.data.chats;
        }
      }

      if (loadedChats && loadedChats.length > 0) {
        setSessions(loadedChats);
        setCurrentSessionId(loadedChats[0].id);
        localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(loadedChats));
      } else {
        // First device or no existing chats: sync current sessions to cloud
        saveUserChatSessions(account.id, sessions);
        safeFetchJson(`/api/users/${encodeURIComponent(account.id)}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chats: sessions }),
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('Error synchronizing chats on login:', e);
    }
  };

  const handleLogout = async () => {
    await logoutFirebaseUser();
    setCurrentUser(null);
    localStorage.removeItem(CURRENT_USER_KEY);
  };

  const handleSwitchAccount = () => {
    setAuthInitialMode('login');
    setIsAuthOpen(true);
  };

  const handleRefreshUserBalance = async () => {
    if (!currentUser?.id) return;
    try {
      const res = await safeFetchJson<{ account?: UserAccount }>(
        `/api/auth/me?userId=${encodeURIComponent(currentUser.id)}`,
        {},
        3000
      );
      if (res.ok && res.data?.account) {
        setCurrentUser(res.data.account);
        setTokensBalance(res.data.account.tokensBalance);
        localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(res.data.account));
      }
    } catch {}
  };

  return (
    <div className="flex h-[100dvh] w-full bg-[#000000] text-zinc-100 overflow-hidden font-sans">
      {/* Sidebar Navigation */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSelectSession={setCurrentSessionId}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        onClearAllSessions={handleClearAllSessions}
        tokensBalance={tokensBalance}
        currentUser={currentUser}
        onOpenAuth={() => {
          setAuthInitialMode('login');
          setIsAuthOpen(true);
        }}
        onOpenAccount={() => setIsAccountOpen(true)}
        onLogout={handleLogout}
        onSwitchAccount={handleSwitchAccount}
        onOpenRedeem={() => setIsRedeemOpen(true)}
        onOpenAdmin={() => setIsAdminOpen(true)}
        onOpenBuy={() => setIsBuyOpen(true)}
      />

      {/* Main Chat Viewport */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-[#000000] relative">
        {/* Top Header Bar */}
        <header className="h-14 sm:h-16 border-b border-white/10 px-3 sm:px-6 flex items-center justify-between shrink-0 bg-[#000000]/90 backdrop-blur-md z-10 pt-[max(0rem,env(safe-area-inset-top))]">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Открыть меню"
              className="p-2 rounded-xl text-zinc-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer md:hidden shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 min-w-0">
              <GroksonLogo size="sm" showText={true} />
              <span className="hidden lg:inline-block text-[11px] font-mono text-zinc-400 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 shrink-0">
                Core v3.8
              </span>
            </div>
          </div>

          {/* Center/Model Selector */}
          <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setPreferredModel('gigachat')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 text-xs ${
                preferredModel === 'gigachat'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
              title="Сбер GigaChat AI"
            >
              <Sparkles className="w-3 h-3 text-emerald-400" />
              <span>GigaChat</span>
            </button>
            <button
              type="button"
              onClick={() => setPreferredModel('gemini')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer flex items-center gap-1.5 text-xs ${
                preferredModel === 'gemini'
                  ? 'bg-white text-black font-bold shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
              title="Google Gemini AI"
            >
              <span>Gemini 3.8</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Tokens Balance Pill */}
            <button
              onClick={() => setIsRedeemOpen(true)}
              className="group flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono font-medium transition-all cursor-pointer"
              title="Нажмите, чтобы ввести ключ активации"
            >
              <Zap className="w-3.5 h-3.5 text-zinc-300 group-hover:scale-110 transition-transform" />
              <span className="text-white font-bold">{tokensBalance.toLocaleString('ru-RU')}</span>
              <span className="hidden md:inline text-zinc-400">токенов</span>
            </button>

            {/* User Profile or Register Gate Button */}
            {currentUser ? (
              <button
                id="header-profile-btn"
                onClick={() => setIsAccountOpen(true)}
                className="flex items-center gap-2 p-1 sm:px-2.5 sm:py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white transition-colors cursor-pointer"
              >
                <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-white/20 flex items-center justify-center font-bold text-xs text-white">
                  {(currentUser.name || currentUser.username)[0]?.toUpperCase()}
                </div>
                <span className="hidden sm:inline font-semibold max-w-[110px] truncate">
                  {currentUser.name}
                </span>
              </button>
            ) : (
              <button
                id="header-login-btn"
                onClick={() => {
                  setAuthInitialMode('login');
                  setIsAuthOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black hover:bg-zinc-200 active:scale-95 text-xs font-bold transition-all cursor-pointer shadow-sm"
              >
                <User className="w-3.5 h-3.5" />
                <span>Войти</span>
              </button>
            )}
          </div>
        </header>

        {/* Chat Messages Feed or Empty State */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col">
          {currentSession.messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <WelcomeBanner
                onSelectPrompt={(p) => handleSendMessage(p)}
                currentUser={currentUser}
                onOpenAuth={(mode) => {
                  setAuthInitialMode(mode || 'register');
                  setIsAuthOpen(true);
                }}
              />
            </div>
          ) : (
            <div className="w-full py-4 space-y-1">
              {currentSession.messages.map((message) => (
                <ChatMessageItem
                  key={message.id}
                  message={message}
                  onRetry={() => {
                    const lastUserMsg = currentSession.messages
                      .slice()
                      .reverse()
                      .find((m) => m.role === 'user');
                    if (lastUserMsg) handleSendMessage(lastUserMsg.content);
                  }}
                />
              ))}

              {isLoading && (
                <div className="w-full py-4 px-3 sm:px-6 bg-[#09090b]/80 border-y border-white/5">
                  <div className="max-w-4xl mx-auto flex items-center gap-3 sm:gap-4">
                    <div className="w-8 h-8 rounded-xl bg-black border border-white/20 flex items-center justify-center">
                      <GroksonMascot size="sm" showBubble={false} />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse [animation-delay:0.4s]" />
                      </div>
                      <span className="text-zinc-300">Grokson формирует ответ...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} className="h-2" />
            </div>
          )}
        </div>

        {/* Chat Input Dock */}
        <div className="shrink-0 bg-gradient-to-t from-black via-black/95 to-transparent pt-2">
          <ChatInput
            input={input}
            setInput={setInput}
            onSend={() => handleSendMessage()}
            isLoading={isLoading}
            tokensBalance={tokensBalance}
            onOpenRedeem={() => setIsRedeemOpen(true)}
            currentUser={currentUser}
            onOpenAuth={(mode) => {
              setAuthInitialMode(mode || 'register');
              setIsAuthOpen(true);
            }}
          />
        </div>
      </main>

      {/* Modals */}
      <RedeemKeyModal
        isOpen={isRedeemOpen}
        onClose={() => setIsRedeemOpen(false)}
        onRedeem={handleRedeemKey}
        currentBalance={tokensBalance}
        onOpenBuy={() => setIsBuyOpen(true)}
      />

      <BuyTokensModal
        isOpen={isBuyOpen}
        onClose={() => setIsBuyOpen(false)}
        onOpenRedeem={() => setIsRedeemOpen(true)}
      />

      <AdminPanelModal
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        onRefreshUserBalance={handleRefreshUserBalance}
        currentUserId={currentUser?.id || 'guest_user'}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onAuthSuccess={handleAuthSuccess}
        initialMode={authInitialMode}
      />

      {currentUser && (
        <AccountModal
          isOpen={isAccountOpen}
          onClose={() => setIsAccountOpen(false)}
          account={currentUser}
          onLogout={handleLogout}
          onOpenRedeem={() => setIsRedeemOpen(true)}
          onOpenBuy={() => setIsBuyOpen(true)}
          onSwitchAccount={handleSwitchAccount}
        />
      )}
    </div>
  );
};

export default App;
