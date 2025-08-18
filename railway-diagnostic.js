#!/usr/bin/env node
console.log('🔍 [RAILWAY-DIAGNOSTIC] Проверка конфигурации для Railway...\n');

// Проверка Node.js версии
console.log('📦 Node.js версия:', process.version);
console.log('🌍 Платформа:', process.platform);
console.log('🏗️ Архитектура:', process.arch);
console.log('📂 Рабочая директория:', process.cwd());
console.log('⏰ Время запуска:', new Date().toISOString());
console.log('');

// Проверка переменных окружения
console.log('🔧 ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ:');
console.log('========================');

const requiredVars = [
    'BOT_TOKEN',
    'DATABASE_URL',
    'NODE_ENV',
    'ADMIN_CHANNEL', 
    'PAYMENTS_CHANNEL'
];

const optionalVars = [
    'PORT',
    'RAILWAY_DEPLOYMENT_ID',
    'RAILWAY_ENVIRONMENT_NAME',
    'RAILWAY_PROJECT_NAME',
    'RAILWAY_SERVICE_NAME'
];

let missingRequired = [];
let hasOptional = [];

// Проверка обязательных переменных
requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        if (varName === 'BOT_TOKEN') {
            console.log(`✅ ${varName}: ${value.substring(0, 10)}...${value.substring(value.length - 5)} (скрыт)`);
        } else if (varName === 'DATABASE_URL') {
            console.log(`✅ ${varName}: ${value.substring(0, 15)}...${value.substring(value.length - 10)} (скрыт)`);
        } else {
            console.log(`✅ ${varName}: ${value}`);
        }
    } else {
        console.log(`❌ ${varName}: НЕ УСТАНОВЛЕНА`);
        missingRequired.push(varName);
    }
});

console.log('\n🔧 ДОПОЛНИТЕЛЬНЫЕ ПЕРЕМЕННЫЕ:');
console.log('============================');

// Проверка дополнительных переменных
optionalVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
        console.log(`✅ ${varName}: ${value}`);
        hasOptional.push(varName);
    } else {
        console.log(`⚪ ${varName}: не установлена`);
    }
});

// Проверка наличия файлов
console.log('\n📁 ФАЙЛЫ ПРОЕКТА:');
console.log('=================');

const fs = require('fs');
const requiredFiles = [
    'index.js',
    'database.js', 
    'package.json',
    'captcha-system.js',
    'message-throttler.js'
];

requiredFiles.forEach(fileName => {
    if (fs.existsSync(fileName)) {
        console.log(`✅ ${fileName}: найден`);
    } else {
        console.log(`❌ ${fileName}: НЕ НАЙДЕН`);
    }
});

// Проверка зависимостей
console.log('\n📦 ЗАВИСИМОСТИ NODE.JS:');
console.log('=======================');

try {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const dependencies = packageJson.dependencies || {};
    
    Object.keys(dependencies).forEach(dep => {
        try {
            require.resolve(dep);
            console.log(`✅ ${dep}: установлен`);
        } catch (error) {
            console.log(`❌ ${dep}: НЕ УСТАНОВЛЕН`);
        }
    });
} catch (error) {
    console.log(`❌ Ошибка чтения package.json: ${error.message}`);
}

// Проверка подключения к базе данных
console.log('\n🗄️ БАЗА ДАННЫХ:');
console.log('===============');

async function testDatabase() {
    try {
        const db = require('./database');
        console.log('✅ Модуль database.js загружен');
        
        // Попытка подключения
        const result = await db.executeQuery('SELECT NOW() as current_time');
        console.log(`✅ Подключение к БД успешно: ${result.rows[0].current_time}`);
        
        // Проверка таблиц
        const tables = await db.executeQuery(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log(`✅ Найдено таблиц в БД: ${tables.rows.length}`);
        
    } catch (error) {
        console.log(`❌ Ошибка подключения к БД: ${error.message}`);
    }
}

// Проверка Telegram Bot API
console.log('\n🤖 TELEGRAM BOT:');
console.log('================');

async function testBot() {
    try {
        const TelegramBot = require('node-telegram-bot-api');
        const token = process.env.BOT_TOKEN;
        
        if (!token) {
            console.log('❌ BOT_TOKEN не установлен');
            return;
        }
        
        const bot = new TelegramBot(token);
        const me = await bot.getMe();
        console.log(`✅ Бот найден: @${me.username} (${me.first_name})`);
        console.log(`✅ Bot ID: ${me.id}`);
        
    } catch (error) {
        console.log(`❌ Ошибка Telegram Bot: ${error.message}`);
    }
}

// Итоговая диагностика
console.log('\n🎯 ИТОГОВАЯ ДИАГНОСТИКА:');
console.log('========================');

if (missingRequired.length > 0) {
    console.log(`❌ КРИТИЧНО: Отсутствуют обязательные переменные: ${missingRequired.join(', ')}`);
    console.log('');
    console.log('🔧 ДЛЯ ИСПРАВЛЕНИЯ В RAILWAY:');
    console.log('1. Откройте Railway Dashboard');
    console.log('2. Перейдите в ваш проект');
    console.log('3. Откройте вкладку "Variables"');
    console.log('4. Добавьте недостающие переменные:');
    missingRequired.forEach(varName => {
        console.log(`   - ${varName}=ваше_значение`);
    });
} else {
    console.log('✅ Все обязательные переменные установлены');
}

// Проверка Railway окружения
if (hasOptional.some(v => v.startsWith('RAILWAY_'))) {
    console.log('✅ Обнаружено Railway окружение');
} else {
    console.log('⚠️ Railway переменные не найдены - возможно запуск локальный');
}

// Запуск асинхронных проверок
Promise.all([
    testDatabase(),
    testBot()
]).then(() => {
    console.log('\n🏁 Диагностика завершена!');
    console.log('');
    
    if (missingRequired.length === 0) {
        console.log('✅ Все проверки пройдены - бот готов к запуску на Railway');
    } else {
        console.log('❌ Есть проблемы - см. инструкции выше');
    }
    
    process.exit(missingRequired.length === 0 ? 0 : 1);
}).catch(error => {
    console.error('❌ Критическая ошибка диагностики:', error);
    process.exit(1);
});
