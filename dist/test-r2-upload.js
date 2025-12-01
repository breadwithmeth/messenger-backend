"use strict";
// Тестовый скрипт для проверки загрузки в R2
// Запуск: npx ts-node test-r2-upload.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config(); // Загружаем переменные из .env
const storageService_1 = require("./src/services/storageService");
function testR2Upload() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
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
            const url = yield (0, storageService_1.saveMedia)(testBuffer, 'test-file.txt', 'text/plain');
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
                const response = yield fetch(url);
                console.log(`   - Status: ${response.status} ${response.statusText}`);
                console.log(`   - Content-Type: ${response.headers.get('content-type')}`);
                if (response.ok) {
                    const content = yield response.text();
                    console.log(`   - Содержимое: ${content}`);
                    console.log('\n✅ Файл доступен публично!');
                }
                else {
                    console.log('\n⚠️  Файл загружен, но недоступен публично.');
                    console.log('   Проверьте настройки Public Access в R2 Dashboard.');
                }
            }
            catch (fetchError) {
                console.log(`\n⚠️  Ошибка при проверке URL: ${fetchError.message}`);
                console.log('   Возможные причины:');
                console.log('   1. Bucket не настроен для публичного доступа');
                console.log('   2. Custom domain не настроен');
                console.log('   3. CORS не настроен');
            }
        }
        catch (error) {
            console.error('\n❌ Ошибка при тестировании:', error.message);
            console.error('\nПолная ошибка:', error);
            console.log('\n🔧 Проверьте .env файл:');
            console.log(`   - STORAGE_TYPE: ${process.env.STORAGE_TYPE}`);
            console.log(`   - R2_ACCOUNT_ID: ${process.env.R2_ACCOUNT_ID}`);
            console.log(`   - R2_BUCKET_NAME: ${process.env.R2_BUCKET_NAME}`);
            console.log(`   - R2_PUBLIC_URL: ${process.env.R2_PUBLIC_URL}`);
            console.log(`   - R2_ACCESS_KEY_ID: ${(_a = process.env.R2_ACCESS_KEY_ID) === null || _a === void 0 ? void 0 : _a.substring(0, 8)}...`);
        }
    });
}
testR2Upload();
//# sourceMappingURL=test-r2-upload.js.map