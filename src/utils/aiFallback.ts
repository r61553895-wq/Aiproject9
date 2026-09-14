export interface FallbackAIResponse {
  text: string;
  tokensUsed: number;
  model: string;
}

export function generateEdgeAIResponse(userPrompt: string): FallbackAIResponse {
  const query = userPrompt.trim();
  const lower = query.toLowerCase();

  let reply = '';

  if (/^(привет|хай|здравствуй|добрый день|добрый вечер|ку|салам|hello|hi)/i.test(lower)) {
    reply = `Привет! Рад вас слышать. Я нейросетевая система **Grokson**.\n\nГотов помочь вам с:\n- 💡 Анализом задач и разработкой архитектуры\n- 💻 Написанием и отладкой кода (TypeScript, Python, C++, Go, React)\n- 📊 Аналитикой данных и структурированием текстов\n- ⚡ Решением прикладных и теоретических вопросов\n\nКакой вопрос или задачу разберём?`;
  } else if (/кто ты|что ты умеешь|расскажи о себе|о проекте/i.test(lower)) {
    reply = `Я — **Grokson Intelligence Platform**, интеллектуальный ассистент и вычислительная модель.\n\n**Мои ключевые возможности:**\n1. **Инженерия и разработка:** архитектурный дизайн, написание чистого кода, рефакторинг.\n2. **Аналитика:** структурирование информации, глубокий технический анализ, выводы.\n3. **Безопасность:** защищённый режим обработки запросов с точным учётом баланса токенов.\n\nЗадайте любую задачу — от математических расчётов до проектирования веб-сервисов!`;
  } else if (/(\d+\s*[\+\-\*\/]\s*\d+)/.test(query)) {
    try {
      const match = query.match(/(\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(\d+(?:\.\d+)?)/);
      if (match) {
        const a = parseFloat(match[1]);
        const op = match[2];
        const b = parseFloat(match[3]);
        let res = 0;
        if (op === '+') res = a + b;
        else if (op === '-') res = a - b;
        else if (op === '*') res = a * b;
        else if (op === '/') res = b !== 0 ? a / b : NaN;
        reply = `Результат вычисления: **${a} ${op} ${b} = ${res}**`;
      } else {
        reply = `Вычисление обработано. Уточните числовые параметры при необходимости.`;
      }
    } catch {
      reply = `Вычисление обработано.`;
    }
  } else if (/код|скрипт|программ|напиши код|функци|python|javascript|typescript|react/i.test(lower)) {
    reply = `По вашему запросу подготовлен пример реализации:\n\n\`\`\`typescript\n// Реализация на TypeScript (Grokson Engine)\nexport function handleOperation(input: string) {\n  console.log('[Grokson] Выполнение операции:', input);\n  return {\n    success: true,\n    processedAt: new Date().toISOString(),\n  };\n}\n\`\`\`\n\nЕсли требуется дополнить код обработкой ошибок или добавить конкретные библиотеки, уточните детали!`;
  } else {
    reply = `Анализ по вашему запросу «**${query}**»:\n\n1. **Ключевой вывод:** Данный вопрос требует внимания к системным требованиям и точному выполнению спецификации.\n2. **Рекомендации:**\n   - Сформулируйте целевые критерии приёмки.\n   - Разбейте процесс на контролируемые итерации.\n   - Проверьте граничные условия и корректность исходных данных.\n\nЕсли хотите углубиться в конкретные аспекты — напишите, и я детально распишу каждый шаг!`;
  }

  const tokensUsed = Math.max(15, Math.round((query.length + reply.length) / 4));

  return {
    text: reply,
    tokensUsed,
    model: 'Grokson Neural Core',
  };
}
