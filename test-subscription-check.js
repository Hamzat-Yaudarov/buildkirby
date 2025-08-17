#!/usr/bin/env node

/**
 * Тест проверки подписок для диагностики проблем
 */

const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');

// Bot token
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';
const bot = new TelegramBot(token, { polling: false });

async function getRequiredChannels() {
    try {
        const result = await db.executeQuery('SELECT channel_id FROM required_channels WHERE is_active = TRUE');
        return result.rows.map(row => row.channel_id);
    } catch (error) {
        console.error('Error getting required channels:', error);
        return [];
    }
}

async function testSubscriptionCheck(testUserId) {
    console.log(`🧪 Тестирование проверки подписок для пользователя ${testUserId}\n`);

    try {
        // 1. Получить список каналов
        const channels = await getRequiredChannels();
        console.log(`📋 Найдено каналов для проверки: ${channels.length}`);
        channels.forEach((channel, index) => {
            console.log(`   ${index + 1}. ${channel}`);
        });

        if (channels.length === 0) {
            console.log('✅ Нет каналов для проверки - пользователь одобрен');
            return true;
        }

        // 2. Проверить каждый канал
        console.log(`\n🔍 Проверка подписок пользователя ${testUserId}:`);
        
        for (const channel of channels) {
            try {
                console.log(`\n📺 Проверяю канал: ${channel}`);
                const member = await bot.getChatMember(channel, testUserId);
                
                console.log(`   📊 Статус: ${member.status}`);
                
                if (member.status === 'left' || member.status === 'kicked') {
                    console.log(`   ❌ Пользователь НЕ подписан`);
                    return false;
                } else {
                    console.log(`   ✅ Пользователь подписан`);
                }
            } catch (error) {
                console.log(`   ⚠️ Ошибка проверки: ${error.message}`);
                
                const errorCode = error.response?.body?.error_code;
                const errorDesc = error.response?.body?.description || error.message;
                
                console.log(`   📝 Код ошибки: ${errorCode}`);
                console.log(`   📝 Описание: ${errorDesc}`);
                
                // Анализ типа ошибки
                if (errorCode === 400 || 
                    errorDesc.includes('chat not found') ||
                    errorDesc.includes('bot was kicked') ||
                    errorDesc.includes('bot is not a member')) {
                    console.log(`   ✅ Автоодобрение - проблемы с доступом к каналу`);
                } else {
                    console.log(`   ❌ Блокирующая ошибка - пользователь будет заблокирован`);
                    return false;
                }
            }
        }

        console.log(`\n✅ Все проверки пройдены - пользователь одобрен`);
        return true;

    } catch (error) {
        console.error('\n❌ Критическая ошибка при проверке подписок:', error);
        return false;
    }
}

// Функция для тестирования нескольких пользователей
async function testMultipleUsers() {
    console.log('🎯 МАССОВОЕ ТЕСТИРОВАНИЕ ПРОВЕРКИ ПОДПИСОК\n');

    // Тестовые ID пользователей (замените на реальные)
    const testUsers = [
        123456789,   // Замените на реальные ID
        987654321,
        555666777
    ];

    for (const userId of testUsers) {
        console.log(`${'='.repeat(60)}`);
        const result = await testSubscriptionCheck(userId);
        console.log(`🎯 РЕЗУЛЬТАТ для ${userId}: ${result ? '✅ ОДОБРЕН' : '❌ ЗАБЛОКИРОВАН'}`);
    }
}

// Проверка конкретного пользователя
async function testSpecificUser(userId) {
    try {
        await db.initializeDatabase();
        const result = await testSubscriptionCheck(parseInt(userId));
        console.log(`\n🎯 ФИНАЛЬНЫЙ РЕЗУЛЬТАТ: ${result ? '✅ ОДОБРЕН' : '❌ ЗАБЛОКИРОВАН'}`);
    } catch (error) {
        console.error('Ошибка тестирования:', error);
    }
}

// Запуск
if (require.main === module) {
    const userId = process.argv[2];
    
    if (userId) {
        console.log(`🧪 Тестирование пользователя: ${userId}`);
        testSpecificUser(userId);
    } else {
        console.log('❌ Укажите ID пользователя для тестирования:');
        console.log('node test-subscription-check.js 123456789');
        console.log('\nИли измените код для массового тестирования');
    }
}

module.exports = { testSubscriptionCheck };
