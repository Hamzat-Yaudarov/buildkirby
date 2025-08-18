/**
 * Clear old Telegram updates utility
 * Утилита для очистки старых обновлений Telegram
 */

const TelegramBot = require('node-telegram-bot-api');

// Bot token
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';

async function clearOldUpdates() {
    console.log('🧹 Очистка старых обновлений Telegram...\n');

    try {
        const bot = new TelegramBot(token, { polling: false });

        // 1. Clear webhook first
        console.log('1️⃣ Очистка webhook...');
        await bot.deleteWebHook();
        console.log('✅ Webhook очищен\n');

        // 2. Get all pending updates
        console.log('2️⃣ Получение ��сех pending обновлений...');
        const updates = await bot.getUpdates({ timeout: 1 });
        console.log(`📋 Найдено ${updates.length} pending обновлений\n`);

        if (updates.length > 0) {
            // 3. Clear all updates by getting them with offset
            console.log('3️⃣ Очистка всех pending обновлений...');
            const lastUpdateId = updates[updates.length - 1].update_id;
            console.log(`📍 Последний update_id: ${lastUpdateId}`);
            
            // Clear by getting updates with offset = lastUpdateId + 1
            await bot.getUpdates({ offset: lastUpdateId + 1, timeout: 1 });
            console.log('✅ Все старые обновления очищены\n');
            
            // 4. Verify clearing
            console.log('4️⃣ Проверка очистки...');
            const remainingUpdates = await bot.getUpdates({ timeout: 1 });
            console.log(`📋 Осталось обновлений: ${remainingUpdates.length}`);
            
            if (remainingUpdates.length === 0) {
                console.log('✅ Очистка прошла успешно!');
            } else {
                console.log('⚠️ Еще остались обновления, но это нормаль��о для новых сообщений');
            }
        } else {
            console.log('✅ Старых обновлений не найдено');
        }

        console.log('\n🎉 ОЧИСТКА ЗАВЕРШЕНА!');
        console.log('📝 Теперь можно безопасно запускать бота с polling');
        console.log('💡 Старые callback queries больше не будут вызывать ошибки');

    } catch (error) {
        console.error('\n❌ ОШИБКА ОЧИСТКИ:', error.message);
        console.error('📍 Детали:', error.stack);
        
        console.log('\n🛠️ РЕКОМЕНДАЦИИ:');
        console.log('1. Проверьте BOT_TOKEN');
        console.log('2. Убедитесь что бот не запущен в другом месте');
        console.log('3. Проверьте интернет соединение');
    }
}

// Run if called directly
if (require.main === module) {
    clearOldUpdates();
}

module.exports = { clearOldUpdates };
