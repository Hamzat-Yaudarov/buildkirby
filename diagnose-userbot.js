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
console.log('\n🔗 4. ИНТЕГРАЦИЯ С БОТОМ:');
if (fs.existsSync('agent-integration.js')) {
    const integration = fs.readFileSync('agent-integration.js', 'utf8');
    
    if (integration.includes('starsAgent.sendStarsSafely')) {
        console.log('   ✅ Интеграция настроена в основном боте');
    }
    
    if (integration.includes('amount <= 200')) {
        console.log('   ⚙️ Автоматическая обработка: до 200 звёзд');
    }
} else {
    console.log('   ❌ Файл интеграции не найден');
}

// 5. Рекомендации
console.log('\n💡 5. РЕКОМЕНДАЦИИ ПО ИСПРАВЛЕНИЮ:');

if (fs.existsSync('userbot-agent.log')) {
    const logs = fs.readFileSync('userbot-agent.log', 'utf8');
    
    if (logs.includes('AUTH_KEY_DUPLICATED')) {
        console.log('   🔧 1. Удалить файл сессии: rm userbot_session.session');
        console.log('   🔧 2. Пере-авторизоваться: python3 userbot-agent.py');
        console.log('   🔧 3. Ввести SMS код и 2FA пароль');
        console.log('   🔧 4. Загрузить новую сессию на Railway');
    } else if (logs.includes('banned') || logs.includes('deactivated')) {
        console.log('   🔧 Номер телефона заблокирован - нужен другой аккаунт');
    } else if (logs.includes('РЕЖИМ МОНИТОРИНГА')) {
        console.log('   🔧 Userbot в режиме мониторинга - проблемы с авторизацией');
        console.log('   🔧 Проверить настройки API и сессию');
    } else {
        console.log('   ✅ Логи выглядят нормально, возможно нужен простой перезапуск');
    }
}

console.log('\n✅ ДИАГНОСТИКА ЗАВЕРШЕНА');
console.log('\nДля запуска исправлений запустите: npm run fix-userbot');
