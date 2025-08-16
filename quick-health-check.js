#!/usr/bin/env node
/**
 * Быстрая проверка состояния системы вывода
 * Проверяет основные компоненты которые могут вызывать ошибки
 */

const db = require('./database');
const TelegramBot = require('node-telegram-bot-api');

// Configuration
let token = process.env.BOT_TOKEN;
if (!token) {
    token = '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';
}

const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';
const bot = new TelegramBot(token, { polling: false });

async function quickHealthCheck() {
    console.log('🔍 Быстрая проверка состояния системы...\n');
    
    const results = {
        database: '❌',
        adminChannel: '❌',
        botToken: '❌',
        permissions: '❌'
    };
    
    // 1. Проверка токена бота
    console.log('1️⃣ Проверка токена бота...');
    try {
        const botInfo = await bot.getMe();
        console.log(`✅ Бот работает: @${botInfo.username} (${botInfo.id})`);
        results.botToken = '✅';
    } catch (error) {
        console.error(`❌ Проблема с токеном бота: ${error.message}`);
    }
    
    // 2. Проверка базы данных
    console.log('\n2️⃣ Проверка базы данных...');
    try {
        await db.initializeDatabase();
        
        // Проверяем таблицу withdrawal_requests
        const result = await db.executeQuery('SELECT COUNT(*) as count FROM withdrawal_requests LIMIT 1');
        console.log(`✅ База данных доступна. Заявок в системе: ${result.rows[0].count}`);
        results.database = '✅';
    } catch (error) {
        console.error(`❌ Проблема с базой данных: ${error.message}`);
    }
    
    // 3. Проверка админского канала
    console.log('\n3️⃣ Проверка админского канала...');
    try {
        const chatInfo = await bot.getChat(ADMIN_CHANNEL);
        console.log(`✅ Канал найден: ${chatInfo.title || chatInfo.username || ADMIN_CHANNEL}`);
        results.adminChannel = '✅';
        
        // Проверяем права бота
        const botInfo = await bot.getMe();
        const memberInfo = await bot.getChatMember(ADMIN_CHANNEL, botInfo.id);
        
        if (memberInfo.status === 'administrator' || memberInfo.status === 'member') {
            console.log(`✅ Бот в канале со статусом: ${memberInfo.status}`);
            results.permissions = '✅';
        } else {
            console.warn(`⚠️ Неожиданный статус бота: ${memberInfo.status}`);
        }
        
    } catch (error) {
        console.error(`❌ Проблема с админским каналом: ${error.message}`);
        
        if (error.message.includes('chat not found')) {
            console.log(`💡 Канал ${ADMIN_CHANNEL} не найден или бот не добавлен`);
        } else if (error.message.includes('Forbidden')) {
            console.log(`💡 Бот заблокирован в канале ${ADMIN_CHANNEL}`);
        }
    }
    
    // 4. Проверка недавних заявок
    console.log('\n4️⃣ Анализ недавних заяво��...');
    try {
        const recentRequests = await db.executeQuery(`
            SELECT status, COUNT(*) as count 
            FROM withdrawal_requests 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            GROUP BY status
        `);
        
        if (recentRequests.rows.length === 0) {
            console.log('ℹ️ Заявок за последние 24 часа нет');
        } else {
            console.log('📊 Заявки за 24 часа:');
            recentRequests.rows.forEach(row => {
                const emoji = row.status === 'pending' ? '⏳' : 
                             row.status === 'completed' ? '✅' : 
                             row.status === 'rejected' ? '❌' : '❓';
                console.log(`   ${emoji} ${row.status}: ${row.count}`);
            });
        }
        
        // Проверяем заявки которые висят слишком долго
        const stuckRequests = await db.executeQuery(`
            SELECT COUNT(*) as count 
            FROM withdrawal_requests 
            WHERE status = 'pending' 
            AND created_at < NOW() - INTERVAL '2 hours'
        `);
        
        if (parseInt(stuckRequests.rows[0].count) > 0) {
            console.warn(`⚠️ Найдено ${stuckRequests.rows[0].count} заявок старше 2 часов в статусе pending`);
        }
        
    } catch (error) {
        console.error(`❌ Ошибка анализа заявок: ${error.message}`);
    }
    
    // 5. Итоговый отчёт
    console.log('\n📋 ИТОГОВЫЙ ОТЧЁТ:');
    console.log('==================');
    console.log(`🤖 Токен бота:      ${results.botToken}`);
    console.log(`🗄️ База данных:     ${results.database}`);
    console.log(`📡 Админский канал:  ${results.adminChannel}`);
    console.log(`🔑 Права бота:       ${results.permissions}`);
    
    const allGood = Object.values(results).every(status => status === '✅');
    
    if (allGood) {
        console.log('\n🎉 ВСЕ СИСТЕМЫ РАБОТАЮТ НОРМАЛЬНО!');
        console.log('Если пользователи всё ещё получают ошибки, проверьте:');
        console.log('• Логи бота в реальном времени');
        console.log('• Конкретные сообщения об ошибках');
        console.log('• Тест команды /withdrawal_diagnostics');
    } else {
        console.log('\n⚠️ ОБНАРУЖЕНЫ ПРОБЛЕМЫ!');
        console.log('Исправьте проблемы выше для норм��льной работы системы вывода.');
    }
    
    console.log('\n🔧 Полезные команды:');
    console.log('• node test-admin-channel.js - детальный тест канала');
    console.log('• /withdrawal_diagnostics - диагностика в боте');
    console.log('• /test_admin_channel - тест канала в боте');
}

// Запуск проверки
if (require.main === module) {
    quickHealthCheck()
        .then(() => {
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Критическая ошибка:', error);
            process.exit(1);
        });
}

module.exports = { quickHealthCheck };
