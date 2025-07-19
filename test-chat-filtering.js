#!/usr/bin/env node

// Тестовые примеры для фильтрации чатов по времени

console.log('📅 Тестирование фильтрации чатов по времени\n');

// Получаем текущую дату и время
const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);

console.log('🕒 Временные метки для тестирования:');
console.log(`   Сейчас: ${now.toISOString()}`);
console.log(`   6 часов назад: ${sixHoursAgo.toISOString()}`);
console.log(`   Вчера: ${yesterday.toISOString()}`);
console.log(`   Неделю назад: ${weekAgo.toISOString()}\n`);

console.log('🧪 Примеры cURL команд для тестирования:\n');

console.log('1️⃣ Получить назначенные чаты за последние 24 часа:');
console.log(`curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=${yesterday.toISOString()}&to=${now.toISOString()}" \\`);
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN"\n');

console.log('2️⃣ Получить назначенные чаты за последние 6 часов:');
console.log(`curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=${sixHoursAgo.toISOString()}" \\`);
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN"\n');

console.log('3️⃣ Получить неназначенные чаты за последнюю неделю:');
console.log(`curl -X GET "http://localhost:3000/api/chat-assignment/unassigned?from=${weekAgo.toISOString()}&to=${now.toISOString()}" \\`);
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN"\n');

console.log('4️⃣ Получить все чаты до вчерашнего дня:');
console.log(`curl -X GET "http://localhost:3000/api/chat-assignment/unassigned?to=${yesterday.toISOString()}" \\`);
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN"\n');

console.log('5️⃣ Получить чаты за конкретный час (например, с 14:00 до 15:00 вчера):');
const yesterday14 = new Date(yesterday);
yesterday14.setHours(14, 0, 0, 0);
const yesterday15 = new Date(yesterday);
yesterday15.setHours(15, 0, 0, 0);
console.log(`curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=${yesterday14.toISOString()}&to=${yesterday15.toISOString()}" \\`);
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN"\n');

console.log('⚠️  ВАЖНЫЕ ЗАМЕЧАНИЯ:');
console.log('   - Замените YOUR_JWT_TOKEN на ваш реальный JWT токен');
console.log('   - Убедитесь, что сервер запущен на порту 3000');
console.log('   - Фильтрация происходит по полю lastMessageAt в чатах');
console.log('   - Если параметр "to" не указан, используется текущее время');
console.log('   - Даты должны быть в формате ISO 8601\n');

console.log('🔍 Тестирование с некорректными датами:');
console.log('curl -X GET "http://localhost:3000/api/chat-assignment/my-assigned?from=invalid-date" \\');
console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN"');
console.log('   ↳ Ожидаемый результат: 400 Bad Request\n');

console.log('📊 Ожидаемый формат ответа:');
console.log(`{
  "chats": [...],
  "total": 5,
  "filters": {
    "from": "${sixHoursAgo.toISOString()}",
    "to": "${now.toISOString()}"
  }
}`);

console.log('\n✅ Все примеры готовы для тестирования!');
