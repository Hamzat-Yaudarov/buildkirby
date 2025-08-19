/**
 * Тестовый скрипт для новой поэтапной системы подписок
 * Проверяет правильность работы flow: спонсоры → обязательные → завершение
 */

const db = require('./database');
const subscriptionFlow = require('./subscription-flow-manager');

// Мок бота для тестирования
const mockBot = {
    async getChatMember(channelId, userId) {
        console.log(`[MOCK BOT] Checking ${channelId} for user ${userId}`);
        
        // Симулируем разные статусы подписок для тестирования
        if (channelId.includes('sponsor')) {
            return { status: 'left' }; // Не подписан на спонсоров
        } else if (channelId.includes('required')) {
            return { status: 'member' }; // Подписан на обязательные
        }
        
        return { status: 'member' }; // По умолчанию подписан
    }
};

async function testSubscriptionFlow() {
    try {
        console.log('🧪 Тестирование новой поэтапной системы подписок...\n');

        // Подключаемся к БД
        await db.initializeDatabase();
        console.log('✅ База данных подключена\n');

        const testUserId = 123456789;

        // 1. Тест определения этапа подписки
        console.log('1️⃣ Тестирование определения этапа подписки...');
        const stageInfo = await subscriptionFlow.getCurrentSubscriptionStage(testUserId);
        
        console.log(`📋 Этап: ${stageInfo.stage}`);
        console.log(`🎯 Действие: ${stageInfo.nextAction}`);
        console.log(`📺 Спонсорских каналов: ${stageInfo.sponsorChannels?.length || 0}`);
        console.log(`📋 Обязательных каналов: ${stageInfo.requiredChannels?.length || 0}`);
        console.log(`🏁 Завершено: ${stageInfo.allCompleted}`);
        console.log(`📤 Каналов к показу: ${stageInfo.channelsToShow?.length || 0}\n`);

        // 2. Тест обновления этапа с проверкой подписок
        console.log('2️⃣ Тестирование обновления этапа с ботом...');
        const updatedStageInfo = await subscriptionFlow.updateSubscriptionStage(mockBot, testUserId);
        
        console.log(`📋 Обновленный этап: ${updatedStageInfo.stage}`);
        console.log(`🎯 Обновленное действие: ${updatedStageInfo.nextAction}`);
        console.log(`🏁 Обновлено завершено: ${updatedStageInfo.allCompleted}`);
        console.log(`📤 Обновлено каналов к показу: ${updatedStageInfo.channelsToShow?.length || 0}\n`);

        // 3. Тест форматирования сообщений
        console.log('3️⃣ Тестирование форматирования сообщений...');
        const stageMessage = subscriptionFlow.formatStageMessage(updatedStageInfo);
        
        console.log('📝 Сообщение:');
        console.log(stageMessage.message);
        console.log(`\n🔘 Кнопок: ${stageMessage.buttons.length}\n`);

        // 4. Тест проверки доступа к боту
        console.log('4️⃣ Тестирование проверки доступа...');
        const canAccess = await subscriptionFlow.canUserAccessBot(testUserId);
        console.log(`🔓 Может использовать бота: ${canAccess}\n`);

        // 5. Тест получения спонсорских каналов
        console.log('5️⃣ Тестирование получения спонсорских каналов...');
        const sponsorChannels = await subscriptionFlow.getSponsorChannels(testUserId);
        console.log(`💎 Найдено спонсорских каналов: ${sponsorChannels.length}`);
        sponsorChannels.forEach((ch, i) => {
            console.log(`   ${i + 1}. ${ch.name} (${ch.link})`);
        });
        console.log();

        // 6. Тест получения обязательных каналов
        console.log('6️⃣ Тестирование получения обязательных каналов...');
        const requiredChannels = await subscriptionFlow.getRequiredChannels();
        console.log(`📋 Найдено обязательных каналов: ${requiredChannels.length}`);
        requiredChannels.forEach((ch, i) => {
            console.log(`   ${i + 1}. ${ch.name} (${ch.link})`);
        });
        console.log();

        // 7. Симуляция полного flow
        console.log('7️⃣ Симуляция полного flow подписок...');
        
        let currentStage = stageInfo;
        let step = 1;
        
        while (!currentStage.allCompleted && step <= 3) {
            console.log(`   Шаг ${step}: Этап ${currentStage.stage}`);
            console.log(`   Каналов для подписки: ${currentStage.channelsToShow?.length || 0}`);
            
            // Симулируем подписку пользователя
            if (currentStage.channelsToShow && currentStage.channelsToShow.length > 0) {
                currentStage.channelsToShow.forEach(ch => {
                    ch.subscribed = true; // Симулируем подписку
                    console.log(`   ✅ Подписался на: ${ch.name}`);
                });
            }
            
            // Получаем следующий этап
            currentStage = await subscriptionFlow.updateSubscriptionStage(mockBot, testUserId);
            step++;
        }
        
        if (currentStage.allCompleted) {
            console.log('   🎉 Все подписки завершены! Доступ к боту открыт.\n');
        } else {
            console.log('   ⚠�� Не удалось завершить все подписки в симуляции.\n');
        }

        console.log('✅ Тестирование завершено успешно!');

    } catch (error) {
        console.error('❌ Ошибка в тестировании:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        // Закрываем подключение к БД
        await db.closeConnection();
    }
}

// Запускаем тест
console.log('🚀 Запуск тестирования поэтапной системы подписок...\n');
testSubscriptionFlow();
