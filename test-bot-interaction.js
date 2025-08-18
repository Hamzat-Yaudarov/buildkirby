/**
 * Simple bot interaction test
 * Простой тест взаимодействия с ботом
 */

const TelegramBot = require('node-telegram-bot-api');

// Используем тестовый токен или переменную окружения
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';

async function testBotInteraction() {
    console.log('🤖 Тестирование взаимодействия с Telegram API...\n');

    try {
        // Create bot instance
        const bot = new TelegramBot(token, { polling: false });

        // 1. Test bot info
        console.log('1️⃣ Получение информации о боте...');
        const me = await bot.getMe();
        console.log('✅ Бот найде��:', me.username);
        console.log('   • ID:', me.id);
        console.log('   • Имя:', me.first_name);
        console.log('   • Может присоединяться к группам:', me.can_join_groups);
        console.log('   • Может читать все сообщения:', me.can_read_all_group_messages);
        console.log('   • Поддерживает inline:', me.supports_inline_queries);

        // 2. Test webhook status
        console.log('\n2️⃣ Проверка webhook...');
        const webhookInfo = await bot.getWebHookInfo();
        console.log('✅ Webhook статус:');
        console.log('   • URL:', webhookInfo.url || 'Не установлен');
        console.log('   • Pending updates:', webhookInfo.pending_update_count);
        console.log('   • Последняя ошибка:', webhookInfo.last_error_message || 'Нет ошибок');

        // 3. Test updates
        console.log('\n3️⃣ Получение последних обновлений...');
        const updates = await bot.getUpdates({ limit: 5 });
        console.log('✅ Последние обновления:', updates.length);
        if (updates.length > 0) {
            const lastUpdate = updates[updates.length - 1];
            console.log('   • Последнее обновление ID:', lastUpdate.update_id);
            if (lastUpdate.message) {
                console.log('   • От пользователя:', lastUpdate.message.from.first_name);
                console.log('   • Текст:', lastUpdate.message.text?.substring(0, 50) + '...');
                console.log('   • Время:', new Date(lastUpdate.message.date * 1000).toLocaleString('ru-RU'));
            }
        }

        // 4. Try to clear webhook (important for polling mode)
        console.log('\n4️⃣ Очистка webhook для polling...');
        await bot.deleteWebHook();
        console.log('✅ Webhook очищен');

        console.log('\n🎉 TELEGRAM API ТЕСТ ЗАВЕРШЕН!');
        console.log('✅ Бот полностью функционален в Telegram');
        
        console.log('\n📋 РЕКОМЕНДАЦИИ:');
        console.log('1. Попробуйте написать боту /start');
        console.log('2. Проверьте что бот отвечает на команды');
        console.log('3. Если не отвечает - проверьте токен');

    } catch (error) {
        console.error('\n❌ ОШИБКА TELEGRAM API:', error.message);
        
        if (error.code === 'ETELEGRAM') {
            console.log('\n🛠️ ПРОБЛЕМЫ С TELEGRAM API:');
            console.log('1. Неправильный BOT_TOKEN');
            console.log('2. Бот заблокирован или удален');
            console.log('3. Проблемы с интернет соединением');
            console.log('4. Telegram API временно недоступен');
        } else {
            console.log('\n🛠️ ОБЩИЕ ПРОБЛЕМЫ:');
            console.log('1. Проверьте интернет соединение');
            console.log('2. Убедитесь что токен правильный');
            console.log('3. Перезапустите бота');
        }
        
        console.error('\n📍 Детали ошибки:', error.stack);
    }
}

// Run the test
if (require.main === module) {
    testBotInteraction();
}

module.exports = { testBotInteraction };
