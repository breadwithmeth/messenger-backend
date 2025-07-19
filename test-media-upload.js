#!/usr/bin/env node

// Простой тест для проверки отправки медиафайлов
// Используйте этот скрипт для тестирования API отправки медиафайлов

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const { createReadStream } = require('fs');

async function testMediaUpload() {
  const testImagePath = path.join(__dirname, 'test-image.jpg');
  
  // Создаем простое тестовое изображение (если его нет)
  if (!fs.existsSync(testImagePath)) {
    console.log('Создание тестового изображения...');
    const Buffer = require('buffer').Buffer;
    const testImageData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(testImagePath, testImageData);
  }

  const form = new FormData();
  form.append('media', createReadStream(testImagePath));
  form.append('chatId', '1'); // Замените на реальный ID чата
  form.append('mediaType', 'image');
  form.append('caption', 'Тестовое изображение');

  console.log('Отправка тестового медиафайла...');
  console.log('Используйте следующую команду curl для тестирования:');
  console.log('');
  console.log('curl -X POST http://localhost:3000/api/media/send \\');
  console.log('  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\');
  console.log('  -F "media=@test-image.jpg" \\');
  console.log('  -F "chatId=1" \\');
  console.log('  -F "mediaType=image" \\');
  console.log('  -F "caption=Тестовое изображение"');
  console.log('');
  console.log('Замените YOUR_JWT_TOKEN на ваш реальный JWT токен');
  console.log('Замените chatId=1 на реальный ID чата из вашей базы данных');
}

testMediaUpload().catch(console.error);
