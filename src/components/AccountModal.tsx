import React from 'react';
import { UserAccount } from '../types';
import { X, User, Sparkles, LogOut, ShieldCheck, Mail, Calendar, KeyRound, Crown, ArrowRightLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface AccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: UserAccount;
  onLogout: () => void;
  onOpenRedeem: () => void;
  onOpenBuy: () => void;
  onSwitchAccount?: () => void;
}

export const AccountModal: React.FC<AccountModalProps> = ({
  isOpen,
  onClose,
  account,
  onLogout,
  onOpenRedeem,
  onOpenBuy,
  onSwitchAccount,
}) => {
  if (!isOpen) return null;

  const isAdmin = account.role === 'admin';
  const initial = (account.name || account.username || 'U')[0]?.toUpperCase();

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          className="relative w-full max-w-md max-h-[92dvh] overflow-y-auto bg-[#09090b] border border-white/15 rounded-2xl sm:rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5"
        >
          <button
            onClick={onClose}
            className="absolute top-4 sm:top-5 right-4 sm:right-5 p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3.5 pr-8">
            <div className="relative">
              {account.avatar ? (
                <img
                  src={account.avatar}
                  alt={account.name}
                  className="w-14 h-14 rounded-2xl object-cover border border-white/20 shadow-md"
                />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-zinc-700 to-zinc-900 border border-white/20 flex items-center justify-center text-white text-xl font-bold shadow-md select-none">
                  {initial}
                </div>
              )}
              {isAdmin && (
                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white text-black flex items-center justify-center shadow-md">
                  <Crown className="w-3 h-3" />
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white font-display truncate">
                  {account.name}
                </h3>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider font-mono ${
                    isAdmin ? 'bg-white text-black' : 'bg-white/10 text-zinc-300'
                  }`}
                >
                  {isAdmin ? 'Администратор' : 'Пользователь'}
                </span>
              </div>
              <div className="text-xs text-zinc-400 font-mono truncate">@{account.username}</div>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-black border border-white/10 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Баланс токенов:</span>
              <span className="font-mono text-base font-bold text-white flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-zinc-300" />
                {account.tokensBalance.toLocaleString('ru-RU')}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs border-t border-white/5 pt-2">
              <span className="text-zinc-400">Потрачено всего:</span>
              <span className="font-mono text-zinc-300">
                {account.totalTokensUsed.toLocaleString('ru-RU')} токенов
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenRedeem();
                }}
                className="py-2 px-3 rounded-xl bg-white hover:bg-zinc-200 active:scale-98 text-black font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Ввести ключ</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenBuy();
                }}
                className="py-2 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Купить (0.5 ₽)</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#121215] border border-white/5 space-y-2 text-xs">
            {account.email && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5" />
                  Email:
                </span>
                <span className="text-zinc-200 font-mono">{account.email}</span>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                Регистрация:
              </span>
              <span className="text-zinc-300 font-mono">
                {new Date(account.createdAt).toLocaleDateString('ru-RU')}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                ID аккаунта:
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(account.id)}
                className="text-zinc-400 hover:text-white font-mono text-[11px] underline"
                title="Нажмите, чтобы скопировать ID"
              >
                {account.id.length > 18 ? `${account.id.slice(0, 16)}...` : account.id}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {onSwitchAccount && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onSwitchAccount();
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 hover:text-white font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Сменить или добавить аккаунт</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 hover:text-white font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Выйти из аккаунта</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
