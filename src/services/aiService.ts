// src/services/aiService.ts

import OpenAI from 'openai';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

if (!DEEPSEEK_API_KEY) {
  logger.warn('[AI Service] DEEPSEEK_API_KEY не установлен в переменных окружения');
}

const openai = new OpenAI({
  apiKey: DEEPSEEK_API_KEY,
  baseURL: DEEPSEEK_BASE_URL,
});

/**
 * Получает предложения ответов для чата на основе истории сообщений за последний час
 */
export async function getSuggestedResponses(
  chatId: number,
  organizationId: number,
  limit: number = 3
): Promise<string[]> {
  try {
    logger.info(`[AI Service] Генерация предложений для чата #${chatId}`);

    // Получаем чат для контекста
    const chat = await prisma.chat.findUnique({
      where: { id: chatId, organizationId },
      select: {
        id: true,
        name: true,
        channel: true,
        status: true,
      },
    });

    if (!chat) {
      throw new Error('Чат не найден');
    }

    // Получаем сообщения за последний час
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    const messages = await prisma.message.findMany({
      where: {
        chatId,
        timestamp: {
          gte: oneHourAgo,
        },
      },
      orderBy: {
        timestamp: 'asc',
      },
      select: {
        id: true,
        content: true,
        fromMe: true,
        timestamp: true,
        type: true,
        senderUser: {
          select: {
            name: true,
            email: true,
          },
        },
      },
      take: 50, // Ограничиваем количество сообщений для контекста
    });

    if (messages.length === 0) {
      logger.warn(`[AI Service] Нет сообщений за последний час для чата #${chatId}`);
      return [];
    }

    // Формируем историю диалога для AI
    const conversationHistory = messages
      .filter(msg => msg.type === 'text' && msg.content) // Только текстовые сообщения
      .map(msg => {
        const sender = msg.fromMe
          ? `Оператор${msg.senderUser ? ` (${msg.senderUser.name || msg.senderUser.email})` : ''}`
          : `Клиент (${chat.name})`;
        return `${sender}: ${msg.content}`;
      })
      .join('\n');

    if (!conversationHistory) {
      logger.warn(`[AI Service] Нет текстовых сообщений для анализа в чате #${chatId}`);
      return [];
    }

    // Определяем последнее сообщение от клиента
    const lastClientMessage = messages
      .filter(msg => !msg.fromMe && msg.type === 'text' && msg.content)
      .slice(-1)[0];

    if (!lastClientMessage) {
      logger.info(`[AI Service] Нет сообщений от клиента для ответа в чате #${chatId}`);
      return [];
    }

    // Формируем промт для DeepSeek
    const systemPrompt = `Ты - помощник для операторов службы поддержки. Твоя задача - предложить ${limit} кратких и профессиональных варианта ответа на последнее сообщение клиента на основе контекста разговора.

Требования к ответам:
- Ответы должны быть на русском языке
- Каждый ответ должен быть коротким (1-2 предложения)
- Ответы должны быть вежливыми и профессиональными
- Учитывай контекст предыдущих сообщений
- Предлагай разные варианты (например: утвердительный, уточняющий, эмпатичный)
- Не используй номера или маркеры списка
- Каждый ответ на новой строке`;

    const userPrompt = `История разговора:
${conversationHistory}

Последнее сообщение клиента: "${lastClientMessage.content}"

Предложи ${limit} варианта ответа оператора. Каждый вариант на отдельной строке без нумерации.`;

    logger.info(`[AI Service] Отправка запроса в DeepSeek API для чата #${chatId}`);

    // Запрос к DeepSeek API
    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const response = completion.choices[0]?.message?.content;

    if (!response) {
      logger.error('[AI Service] DeepSeek не вернул ответ');
      return [];
    }

    // Парсим ответ - разделяем по строкам и фильтруем пустые
    const suggestions = response
      .split('\n')
      .map(line => line.trim())
      .filter(line => {
        // Убираем строки с нумерацией (1., 2., - и т.д.)
        return line.length > 0 && !line.match(/^[\d\-\*\•]+[\.\)]\s*/);
      })
      .slice(0, limit); // Ограничиваем до запрошенного количества

    logger.info(`[AI Service] Сгенерировано ${suggestions.length} предложений для чата #${chatId}`);

    return suggestions;

  } catch (error: any) {
    logger.error(`[AI Service] Ошибка генерации предложений для чата #${chatId}:`, error);
    
    // Более детальная ошибка для отладки
    if (error.response) {
      logger.error('[AI Service] DeepSeek API ответ:', error.response.data);
    }
    
    throw new Error(`Не удалось сгенерировать предложения: ${error.message}`);
  }
}

/**
 * Проверка доступности DeepSeek API
 */
export async function checkAIServiceHealth(): Promise<boolean> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 5,
    });

    return !!completion.choices[0]?.message?.content;
  } catch (error) {
    logger.error('[AI Service] Health check failed:', error);
    return false;
  }
}
