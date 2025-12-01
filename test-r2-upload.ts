// Тестовый скрипт для проверки загрузки в R2
// Запуск: npx ts-node test-r2-upload.ts

import dotenv from 'dotenv';
dotenv.config(); // Загружаем переменные из .env

import { saveMedia } from './src/services/storageService';
import fs from 'fs/promises';
import path from 'path';

async function testR2Upload() {
  console.log('🧪 Тест загрузки в R2...\n');

  try {
    // Создаем тестовый файл
    const testContent = `Test file created at ${new Date().toISOString()}`;
    const testBuffer = Buffer.from(testContent, 'utf-8');

    console.log('📝 Создан тестовый файл:');
    console.log(`   - Размер: ${testBuffer.length} bytes`);
    console.log(`   - Содержимое: ${testContent}\n`);

    // Загружаем в R2
    console.log('📤 Загрузка в R2...\n');
    const url = await saveMedia(testBuffer, 'test-file.txt', 'text/plain');

    console.log('\n✅ Успешно загружено!');
    console.log(`📍 URL: ${url}\n`);

    console.log('🔍 Проверьте:');
    console.log(`   1. Откройте Cloudflare R2 Dashboard`);
    console.log(`   2. Выберите bucket "messenger"`);
    console.log(`   3. Найдите файл в папке "media/"`);
    console.log(`   4. Откройте URL в браузере: ${url}\n`);

    // Проверяем доступность URL
    console.log('🌐 Проверка доступности URL...');
    try {
      const response = await fetch(url);
      console.log(`   - Status: ${response.status} ${response.statusText}`);
      console.log(`   - Content-Type: ${response.headers.get('content-type')}`);
      
      if (response.ok) {
        const content = await response.text();
        console.log(`   - Содержимое: ${content}`);
        console.log('\n✅ Файл доступен публично!');
      } else {
        console.log('\n⚠️  Файл загружен, но недоступен публично.');
        console.log('   Проверьте настройки Public Access в R2 Dashboard.');
      }
    } catch (fetchError: any) {
      console.log(`\n⚠️  Ошибка при проверке URL: ${fetchError.message}`);
      console.log('   Возможные причины:');
      console.log('   1. Bucket не настроен для публичного доступа');
      console.log('   2. Custom domain не настроен');
      console.log('   3. CORS не настроен');
    }

  } catch (error: any) {
    console.error('\n❌ Ошибка при тестировании:', error.message);
    console.error('\nПолная ошибка:', error);
    
    console.log('\n🔧 Проверьте .env файл:');
    console.log(`   - STORAGE_TYPE: ${process.env.STORAGE_TYPE}`);
    console.log(`   - R2_ACCOUNT_ID: ${process.env.R2_ACCOUNT_ID}`);
    console.log(`   - R2_BUCKET_NAME: ${process.env.R2_BUCKET_NAME}`);
    console.log(`   - R2_PUBLIC_URL: ${process.env.R2_PUBLIC_URL}`);
    console.log(`   - R2_ACCESS_KEY_ID: ${process.env.R2_ACCESS_KEY_ID?.substring(0, 8)}...`);
  }
}

testR2Upload();
