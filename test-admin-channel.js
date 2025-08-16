#!/usr/bin/env node
/**
 * Тест доступности админского канала
 * Проверяет можем ли мы отправлять сообщения в админский канал
 */

const TelegramBot = require('node-telegram-bot-api');

// Bot token
let token = process.env.BOT_TOKEN;
if (!token) {
    token = '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';
}

const bot = new TelegramBot(token, { polling: false });
const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';

async function testAdminChannel() {
    console.log('🧪 Тестирование доступности админского канала...\n');
    
    try {
        console.log(`📡 Канал: ${ADMIN_CHANNEL}`);
        
        // Тест 1: Получение информации о канале
        console.log('\n1️⃣ Проверка существования канала...');
        try {
            const chatInfo = await bot.getChat(ADMIN_CHANNEL);
            console.log(`✅ Канал найден:`);
            console.log(`   Название: ${chatInfo.title || 'Без названия'}`);
            console.log(`   Username: ${chatInfo.username || 'Нет username'}`);
            console.log(`   Тип: ${chatInfo.type}`);
            console.log(`   ID: ${chatInfo.id}`);
        } catch (error) {
            console.error(`❌ Канал не найден:`, error.message);
            return;
        }
        
        // Тест 2: Проверка статуса бота
        console.log('\n2️⃣ Проверка статуса бота в канале...');
        try {
            const botInfo = await bot.getMe();
            console.log(`🤖 Бот: @${botInfo.username} (${botInfo.id})`);
            
            const memberInfo = await bot.getChatMember(ADMIN_CHANNEL, botInfo.id);
            console.log(`✅ Статус бота: ${memberInfo.status}`);
            
            if (memberInfo.status === 'administrator') {
                console.log(`🔑 Права администратора:`);
                console.log(`   can_post_messages: ${memberInfo.can_post_messages}`);
                console.log(`   can_edit_messages: ${memberInfo.can_edit_messages}`);
                console.log(`   can_delete_messages: ${memberInfo.can_delete_messages}`);
            } else if (memberInfo.status === 'member') {
                console.log(`👥 Обычный участник канала`);
            } else {
                console.warn(`⚠️ Неожиданный статус: ${memberInfo.status}`);
            }
        } catch (error) {
            console.error(`❌ Не удалось получить статус бота:`, error.message);
            return;
        }
        
        // Тест 3: Отправка тестового сообщения
        console.log('\n3️⃣ Тестирование отправки сообщения...');
        try {
            const testMessage = `🧪 **Тест админского канала**

⏰ Время: ${new Date().toLocaleString('ru-RU')}
🤖 Бот: Проверка отправки сообщений
✅ Если вы видите это сообщение - всё работает!`;

            const sentMessage = await bot.sendMessage(ADMIN_CHANNEL, testMessage, {
                parse_mode: 'Markdown'
            });
            
            console.log(`✅ Сообщение отправлено успешно!`);
            console.log(`   ID сообщения: ${sentMessage.message_id}`);
            
            // Попробуем удалить тестовое сообщение через 5 секунд
            console.log(`🗑️ Удаление тестового сообщения через 5 секунд...`);
            setTimeout(async () => {
                try {
                    await bot.deleteMessage(ADMIN_CHANNEL, sentMessage.message_id);
                    console.log(`✅ Тестовое сообщение удалено`);
                } catch (deleteError) {
                    console.warn(`⚠️ Не удалось удалить тестовое сообщение:`, deleteError.message);
                }
                process.exit(0);
            }, 5000);
            
        } catch (error) {
            console.error(`❌ Ошибка отправки сообщения:`, error.message);
            if (error.response) {
                console.error(`   HTTP статус: ${error.response.status}`);
                console.error(`   Ошибка API:`, error.response.body);
            }
            
            // Анализ типичных ошибок
            if (error.message.includes('chat not found')) {
                console.log(`\n💡 Решение: Убедитесь что канал ${ADMIN_CHANNEL} существует`);
            } else if (error.message.includes('Forbidden')) {
                console.log(`\n💡 Решение: Добавьте бота в канал ${ADMIN_CHANNEL} как администратора`);
            } else if (error.message.includes('not enough rights')) {
                console.log(`\n💡 Решение: Дайте боту права на отправку сообщений в канале`);
            }
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    }
}

// Запуск теста
if (require.main === module) {
    testAdminChannel();
}

module.exports = { testAdminChannel };
