import React from 'react';
import { GroksonMascot } from './GroksonMascot';
import { Code2, Lightbulb, Sparkles, Terminal, Shield, Zap, UserPlus } from 'lucide-react';
import type { UserAccount } from '../types';

interface WelcomeBannerProps {
  onSelectPrompt: (prompt: string) => void;
  currentUser?: UserAccount | null;
  onOpenAuth?: (mode?: 'login' | 'register') => void;
}

export const WelcomeBanner: React.FC<WelcomeBannerProps> = ({
  onSelectPrompt,
  currentUser,
  onOpenAuth,
}) => {
  const suggestions = [
    {
      icon: <Code2 className="w-4 h-4 text-white" />,
      title: 'Написать алгоритм',
      prompt: 'Напиши эффективный алгоритм поиска дубликатов в массиве на TypeScript с подробными комментариями.',
    },
    {
      icon: <Terminal className="w-4 h-4 text-zinc-300" />,
      title: 'Архитектура веб-сервиса',
      prompt: 'Спроектируй масштабируемую архитектуру API для чат-сервиса с вебсокетами и очередями задач.',
    },
    {
      icon: <Lightbulb className="w-4 h-4 text-zinc-300" />,
      title: 'Инженерный анализ',
      prompt: 'Объясни простыми словами разницу между хэшированием с солью (salt) и симметричным шифрованием.',
    },
    {
      icon: <Sparkles className="w-4 h-4 text-zinc-300" />,
      title: 'Сложные вычисления',
      prompt: 'Помоги рассчитать пропускную способность сервера при 50 000 одновременных запросов в секунду.',
    },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-6 sm:py-10 flex flex-col items-center text-center select-none">
      <div className="mb-4 sm:mb-6">
        <GroksonMascot size="hero" showBubble={true} bubbleText="GROKSON • OPERATIONAL" />
      </div>

      <div className="space-y-2 mb-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px] font-mono text-zinc-300">
          <Shield className="w-3.5 h-3.5 text-zinc-300" />
          <span>Grokson Intelligence Platform</span>
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        </div>

        <h1 className="text-2xl sm:text-4xl font-black text-white font-display tracking-tight">
          Чем могу помочь сегодня?
        </h1>

        <p className="text-xs sm:text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
          Интеллектуальная вычислительная платформа. Анализирует код, строит архитектуры, проводит математические расчеты и решает задачи без заготовленных шаблонов.
        </p>

        {!currentUser && (
          <div className="pt-2">
            <button
              onClick={() => onOpenAuth && onOpenAuth('register')}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-black font-bold text-xs hover:bg-zinc-200 transition-colors shadow-lg cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Создать аккаунт (+10 000 токенов бесплатно)</span>
            </button>
          </div>
        )}
      </div>

      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3 text-left">
        {suggestions.map((item, idx) => (
          <button
            key={idx}
            onClick={() => onSelectPrompt(item.prompt)}
            className="p-3.5 sm:p-4 rounded-2xl bg-[#09090b] hover:bg-[#121215] border border-white/10 hover:border-white/20 transition-all group flex flex-col justify-between gap-2 cursor-pointer shadow-sm text-left active:scale-98"
          >
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/10 group-hover:bg-white/10 transition-colors">
                {item.icon}
              </div>
              <span className="text-xs sm:text-sm font-semibold text-white font-display group-hover:text-zinc-200">
                {item.title}
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-zinc-400 line-clamp-2 leading-relaxed">
              {item.prompt}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};
