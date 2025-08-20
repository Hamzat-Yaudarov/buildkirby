/**
 * Тестовый скрипт для проверки умной системы SubGram
 * Запускается независимо от основного бота
 */

const smartSubGram = require('./subgram-smart-handler');
const db = require('./database');

// Мок бота для тестирования
const mockBot = {
    getChatMember: async (chat, userId) => {
        console.log(`[MOCK] Checking membership: user ${userId} in chat ${chat}`);
        // Симулируем проверку подписки - можно менять для тестов
        return { status: 'member' }; // или 'left', 'kicked'
    }
};

async function testSmartSubGram() {
    console.log('🧪 Запуск тестирования умной системы SubGram...\n');

    try {
        // Инициализируем базу данных
        await db.initializeDatabase();
        console.log('✅ База данных инициализирована\n');

        // Тестовый пользователь (ID админа)
        const testUserId = 7972065986;

        console.log('='.repeat(50));
        console.log('1️⃣ ТЕСТ: Получение состояния SubGram');
        console.log('='.repeat(50));

        const state = await smartSubGram.getSubGramState(testUserId);
        console.log('📊 Состояние SubGram:');
        console.log(`   • Статус: ${state.state}`);
        console.log(`   • Должен блокировать: ${state.shouldBlock}`);
        console.log(`   • Каналов найдено: ${state.channels.length}`);
        console.log(`   • Сообщение: ${state.message}`);
        if (state.error) {
            console.log(`   • Ошибка: ${state.error}`);
        }

        console.log('\n' + '='.repeat(50));
        console.log('2️⃣ ТЕСТ: Решение о блокировке доступа');
        console.log('='.repeat(50));

        const accessCheck = await smartSubGram.shouldBlockBotAccess(testUserId);
        console.log('🔒 Решение о доступе:');
        console.log(`   • Блокировать: ${accessCheck.shouldBlock}`);
        console.log(`   • Причина: ${accessCheck.reason}`);
        console.log(`   • Каналов для подписки: ${accessCheck.channels.length}`);
        console.log(`   • Сообщение: ${accessCheck.message}`);

        console.log('\n' + '='.repeat(50));
        console.log('3️⃣ ТЕСТ: Получение сообщения для пользователя');
        console.log('='.repeat(50));

        const subscriptionMessage = await smartSubGram.getSubscriptionMessage(testUserId);
        console.log('📝 Сообщение для пользователя:');
        console.log(`   • Доступ разрешен: ${subscriptionMessage.accessAllowed}`);
        console.log(`   • Причина: ${subscriptionMessage.reason || 'N/A'}`);
        if (subscriptionMessage.channelsCount) {
            console.log(`   • Каналов для подписки: ${subscriptionMessage.channelsCount}`);
        }

        console.log('\n' + '='.repeat(50));
        console.log('4️⃣ ТЕСТ: Проверка подписок (с мок-ботом)');
        console.log('='.repeat(50));

        const subscriptionCheck = await smartSubGram.checkUserSubscriptions(mockBot, testUserId);
        console.log('✅ Проверка подписок:');
        console.log(`   • Все подписки выполнены: ${subscriptionCheck.allSubscribed}`);
        console.log(`   • Проверено каналов: ${subscriptionCheck.channels.length}`);
        if (subscriptionCheck.refreshed) {
            console.log('   • Состояние обновлено с сервера');
        }

        console.log('\n' + '='.repeat(50));
        console.log('5️⃣ ТЕСТ: Статистика системы');
        console.log('='.repeat(50));

        const stats = await smartSubGram.getSubGramStats();
        console.log('📈 Статистика:');
        if (stats.api) {
            console.log(`   • API запросов: ${stats.api.total_requests || 0}`);
            console.log(`   • Успешных: ${stats.api.successful_requests || 0}`);
        }
        if (stats.channels) {
            console.log(`   • Пользователей с каналами: ${stats.channels.users_with_channels || 0}`);
        }

        console.log('\n🎯 ИТОГ ТЕСТИРОВАНИЯ:');
        console.log('='.repeat(50));

        if (!accessCheck.shouldBlock) {
            console.log('✅ УСПЕХ: Пользователь может пользоваться ботом без ограничений');
            console.log(`   Причина: ${accessCheck.reason}`);
        } else {
            console.log('⚠️ БЛОКИРОВКА: Пользователю будут показаны спонсорские каналы');
            console.log(`   Каналов для подписки: ${accessCheck.channels.length}`);
        }

        console.log('\n🔧 Рекомендации для исправления проблемы:');
        console.log('1. Проверьте настройки SubGram в админ панели');
        console.log('2. Убедитесь что бот добавлен в SubGram с токеном');
        console.log('3. Проверьте логи SubGram API запросов');
        console.log('4. Используйте команду /smart_subgram_test в боте');

    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        // Закрываем соединение с базой данных
        try {
            await db.closeConnection();
            console.log('\n🔒 Соединение с базой данных закрыто');
        } catch (closeError) {
            console.error('Ошибка закрытия соединения:', closeError);
        }
    }
}

// Запускаем тест
if (require.main === module) {
    testSmartSubGram().then(() => {
        console.log('\n✅ Тестирование завершено');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Критическая ошибка тестирования:', error);
        process.exit(1);
    });
}

module.exports = { testSmartSubGram };
