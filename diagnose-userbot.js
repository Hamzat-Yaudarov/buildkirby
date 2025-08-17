#!/usr/bin/env node
/**
 * Диагностика проблем с userbot системой
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 ДИАГНОСТИКА USERBOT СИСТЕМЫ\n');

// 1. Проверка файлов
console.log('📁 1. ПРОВЕРКА ФАЙЛОВ:');
const requiredFiles = [
    'userbot_session.session',
    'userbot_queue.db', 
    'userbot-agent.py',
    'userbot-agent.log',
    'requirements.txt'
];

requiredFiles.forEach(file => {
    if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        console.log(`   ✅ ${file} - ${(stats.size / 1024).toFixed(1)} KB`);
    } else {
        console.log(`   ❌ ${file} - Н�� НАЙДЕН`);
    }
});

// 2. Анализ логов
console.log('\n📝 2. АНАЛИЗ ЛОГОВ:');
if (fs.existsSync('userbot-agent.log')) {
    const logs = fs.readFileSync('userbot-agent.log', 'utf8');
    const lines = logs.split('\n').filter(line => line.trim());
    
    console.log(`   📊 Всего строк в логе: ${lines.length}`);
    
    // Последние 10 строк
    console.log('\n   🔍 Последние события:');
    lines.slice(-10).forEach(line => {
        if (line.includes('ERROR') || line.includes('❌')) {
            console.log(`   ❌ ${line.substring(0, 100)}...`);
        } else if (line.includes('INFO') || line.includes('✅')) {
            console.log(`   ℹ️  ${line.substring(0, 100)}...`);
        } else if (line.includes('WARNING') || line.includes('⚠️')) {
            console.log(`   ⚠️  ${line.substring(0, 100)}...`);
        }
    });
    
    // Ключевые ошибки
    console.log('\n   🚨 КЛЮЧЕВЫЕ ПРОБЛЕМЫ:');
    if (logs.includes('AUTH_KEY_DUPLICATED')) {
        console.log('   ❌ AUTH_KEY_DUPLICATED - сессия используется в нескольких местах');
        console.log('   💡 РЕШЕНИЕ: Удалить файл сессии и пере-авторизоваться');
    }
    if (logs.includes('banned') || logs.includes('deactivated')) {
        console.log('   ❌ АККАУНТ ЗАБЛОКИРОВАН - номер телефона забанен в Telegram');
    }
    if (logs.includes('FloodWait')) {
        console.log('   ⚠️ FloodWait - превышены лимиты Telegram API');
    }
    if (logs.includes('Session stopped')) {
        console.log('   ⚠️ Сессия остановлена - userbot не активен');
    }
} else {
    console.log('   ❌ Лог файл не найден');
}

// 3. Проверка конфигурации
console.log('\n⚙️ 3. КОНФИГУРАЦИЯ:');
if (fs.existsSync('userbot-agent.py')) {
    const pythonCode = fs.readFileSync('userbot-agent.py', 'utf8');
    
    // Извлекаем API конфигурацию
    const apiIdMatch = pythonCode.match(/"api_id":\s*(\d+)/);
    const phoneMatch = pythonCode.match(/"phone_number":\s*"([^"]+)"/);
    const usernameMatch = pythonCode.match(/"username":\s*"([^"]+)"/);
    
    if (apiIdMatch) console.log(`   📱 API ID: ${apiIdMatch[1]}`);
    if (phoneMatch) console.log(`   ☎️  Телефон: ${phoneMatch[1]}`);
    if (usernameMatch) console.log(`   👤 Username: @${usernameMatch[1]}`);
    
    // Проверка настроек безопасности
    if (pythonCode.includes('"test_mode": True')) {
        console.log('   🧪 Тест-режим: ВКЛЮЧЕН (максимум 25 звёзд за раз)');
    }
    
    const maxPerDay = pythonCode.match(/"max_stars_per_day":\s*(\d+)/);
    const maxPerHour = pythonCode.match(/"max_stars_per_hour":\s*(\d+)/);
    if (maxPerDay) console.log(`   📊 Лимит в день: ${maxPerDay[1]} звёзд`);
    if (maxPerHour) console.log(`   ⏰ Лимит в час: ${maxPerHour[1]} звёзд`);
}

// 4. Интеграция с основным ботом
console.log('\n🔗 4. РЕЖИМ РАБОТЫ СИСТЕМЫ:');
console.log('   ℹ️ Система работает в РУЧНОМ РЕЖИМЕ');
console.log('   📝 Userbot отключен - все заявки обрабатывает администратор');
console.log('   ✅ Автоматическая интеграция НЕ НУЖНА');
console.log('   🎯 Заявки создаются и одобряются в боте');
console.log('   👤 Звёзды отправляет администратор вру��ную через Telegram');

// 5. Рекомендации для ручного режима
console.log('\n💡 5. ИНСТРУКЦИИ ДЛЯ РАБОТЫ В РУЧНОМ РЕЖИМЕ:');

console.log('   📋 Команды для администратора:');
console.log('   🔹 /pending_withdrawals - список заявок на обработку');
console.log('   🔹 /find_user [ID] - найти пользователя для отправки звёзд');
console.log('   🔹 /check_withdrawals - диагностика проблем');
console.log('   🔹 /fix_withdrawals - автоисправление дублей');

console.log('\n   📝 Процесс обработки заявки:');
console.log('   1️⃣ Получить уведомление о новой заявке');
console.log('   2️⃣ Нажать "✅ Выполнено" для одобрения');
console.log('   3️⃣ Найти пользователя через /find_user [ID]');
console.log('   4️⃣ Отправить звёзды вручную в Telegram');

console.log('\n   📖 Подробная инструкция: ИНСТРУКЦИЯ_ДЛЯ_АДМИНА.md');

console.log('\n✅ ДИАГНОСТИКА ЗАВЕРШЕНА');
console.log('\n🎯 Система готова к работе в ручном режиме!');
