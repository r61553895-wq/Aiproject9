import https from 'https';
import crypto from 'crypto';

export interface GigaChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GigaChatResponse {
  text: string;
  usage: GigaChatUsage;
  model: string;
}

export const DEFAULT_GIGACHAT_KEY =
  'MDFhMDk0NGMtZDg2MS03NTE4LTk1YzktOTY2NmI1ZWIyMTFhOmM2NGRjMDQzLWZjMTMtNGE0Ny1iMGM1LTJjMmM3NGU4ZDQ5MQ==';

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

export function normalizeAuthKey(key?: string): string {
  if (!key || key.trim() === '') {
    return DEFAULT_GIGACHAT_KEY;
  }
  let clean = key.trim();
  if (clean.startsWith('Basic ')) {
    clean = clean.replace('Basic ', '').trim();
  }
  if (clean.includes(':') && !clean.includes('=')) {
    try {
      clean = Buffer.from(clean, 'utf-8').toString('base64');
    } catch {
      // keep as is
    }
  }
  return clean;
}

export async function getGigaChatAccessToken(authKey: string): Promise<string> {
  const normalizedKey = normalizeAuthKey(authKey);

  if (normalizedKey.startsWith('eyJ') || authKey.trim().startsWith('Bearer ')) {
    return normalizedKey.replace('Bearer ', '').trim();
  }

  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  try {
    return await requestOAuthToken(normalizedKey, 'GIGACHAT_API_PERS');
  } catch (err: any) {
    console.warn('[GigaChat] Scope PERS failed, trying CORP scope:', err.message);
    return await requestOAuthToken(normalizedKey, 'GIGACHAT_API_CORP');
  }
}

function requestOAuthToken(normalizedKey: string, scope: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rqUid = crypto.randomUUID();
    const postData = `scope=${scope}`;

    const req = https.request(
      {
        hostname: 'ngw.devices.sberbank.ru',
        port: 9443,
        path: '/api/v2/oauth',
        method: 'POST',
        timeout: 10000,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'RqUID': rqUid,
          'Authorization': `Basic ${normalizedKey}`,
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = JSON.parse(rawData);
              cachedAccessToken = parsed.access_token;
              tokenExpiresAt = parsed.expires_at || Date.now() + 1800000;
              resolve(cachedAccessToken!);
            } else {
              reject(new Error(`GigaChat OAuth Error (${res.statusCode}): ${rawData}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse GigaChat OAuth response: ${rawData}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GigaChat OAuth request timed out'));
    });

    req.on('error', (err) => {
      reject(new Error(`GigaChat OAuth network error: ${err.message}`));
    });

    req.write(postData);
    req.end();
  });
}

export async function callGigaChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  authKey?: string
): Promise<GigaChatResponse> {
  const token = await getGigaChatAccessToken(authKey || DEFAULT_GIGACHAT_KEY);

  return new Promise((resolve, reject) => {
    const hasSystem = messages.some((m) => m.role === 'system');
    const sanitizedMessages = messages
      .filter((m) => m.content && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role,
        content: m.content.trim(),
      }));

    const fullMessages = hasSystem
      ? sanitizedMessages
      : [
          {
            role: 'system' as const,
            content:
              'Ты — Grokson (Гроксон), умный, вежливый и дружелюбный ИИ-помощник с отличным чувством юмора и глубокими знаниями. Твой слоган: "YOUR AI PARTNER ALWAYS ONLINE". Отвечай структурированно, полезно, используй форматирование Markdown, списки и блоки кода при необходимости. Никогда не отвечай шаблонами, отвечай живо и точно на вопрос пользователя.',
          },
          ...sanitizedMessages,
        ];

    const postData = JSON.stringify({
      model: 'GigaChat',
      messages: fullMessages,
      temperature: 0.7,
      max_tokens: 2048,
    });

    const req = https.request(
      {
        hostname: 'gigachat.devices.sberbank.ru',
        port: 443,
        path: '/api/v1/chat/completions',
        method: 'POST',
        timeout: 20000,
        rejectUnauthorized: false,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => (rawData += chunk));
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = JSON.parse(rawData);
              const choice = parsed.choices?.[0];
              const replyText = choice?.message?.content || 'Не удалось получить ответ от Grokson.';
              const usage: GigaChatUsage = parsed.usage || {
                prompt_tokens: Math.ceil(JSON.stringify(messages).length / 4),
                completion_tokens: Math.ceil(replyText.length / 4),
                total_tokens: Math.ceil((JSON.stringify(messages).length + replyText.length) / 4),
              };

              resolve({
                text: replyText,
                usage,
                model: 'Grokson (GigaChat AI)',
              });
            } else {
              reject(new Error(`GigaChat API Error (${res.statusCode}): ${rawData}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse GigaChat completion response: ${rawData}`));
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GigaChat API request timed out'));
    });

    req.on('error', (err) => {
      reject(new Error(`GigaChat Chat network error: ${err.message}`));
    });

    req.write(postData);
    req.end();
  });
}
