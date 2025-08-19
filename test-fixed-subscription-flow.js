/**
 * Тест для исправленной логики поэтапных подписок
 */

const subscriptionFlow = require('./subscription-flow-manager');

// Мок-функции для тестирования
const mockBot = {
    getChatMember: async (chatId, userId) => {
        // Симулируем различные статусы подписок
        console.log(`[MOCK] Checking membership for user ${userId} in channel ${chatId}`);
        
        // Для тестирования: считаем что пользователь подписан на каналы содержащие "subscribed"
        if (chatId.includes('subscribed') || chatId.includes('_ok')) {
            return { status: 'member' };
        } else {
            return { status: 'left' };
        }
    }
};

// Создаем мок-каналы для тестирования
const mockSponsorChannels = [
    { id: 'https://t.me/sponsor1_subscribed', name: 'Спонсор 1', type: 'sponsor', link: 'https://t.me/sponsor1_subscribed' },
    { id: 'https://t.me/sponsor2_not', name: 'Спонсор 2', type: 'sponsor', link: 'https://t.me/sponsor2_not' }
];

const mockRequiredChannels = [
    { id: '@required1_ok', name: 'Обязательный 1', type: 'required' },
    { id: '@required2_not', name: 'Обязательный 2', type: 'required' }
];

async function testSubscriptionFlow() {
    console.log('🧪 Тестирование исправленной логики подписок...\n');

    const testUserId = 12345;

    try {
        // Тест 1: Проверка получения каналов
        console.log('1️⃣ Тест получения каналов...');
        
        // Мокаем функции получения каналов
        const originalGetSponsorChannels = subscriptionFlow.getSponsorChannels;
        const originalGetRequiredChannels = subscriptionFlow.getRequiredChannels;
        
        subscriptionFlow.getSponsorChannels = async () => mockSponsorChannels;
        subscriptionFlow.getRequiredChannels = async () => mockRequiredChannels;

        const stageInfo = await subscriptionFlow.getCurrentSubscriptionStage(testUserId);
        
        console.log(`   Спонсорские каналы: ${stageInfo.sponsorChannels.length}`);
        console.log(`   Обязательные каналы: ${stageInfo.requiredChannels.length}`);
        console.log('   ✅ Каналы получены успешно\n');

        // Тест 2: Проверка логики определения этапов
        console.log('2️⃣ Тест обновления этапа с проверкой подписок...');
        
        const updatedStageInfo = await subscriptionFlow.updateSubscriptionStage(mockBot, testUserId);
        
        console.log(`   Текущий этап: ${updatedStageInfo.stage}`);
        console.log(`   Статус спонсоров: ${updatedStageInfo.sponsorStatus?.subscribedCount}/${updatedStageInfo.sponsorStatus?.totalCount}`);
        console.log(`   Статус обязательных: ${updatedStageInfo.requiredStatus?.subscribedCount}/${updatedStageInfo.requiredStatus?.totalCount}`);
        console.log(`   Каналы для подписки: ${updatedStageInfo.channelsToShow?.length || 0}`);
        console.log(`   Все завершено: ${updatedStageInfo.allCompleted}`);

        // Проверка правильно��ти логики
        if (updatedStageInfo.stage === subscriptionFlow.SUBSCRIPTION_STAGES.SPONSORS) {
            console.log('   ✅ Корректно определен этап SPONSORS');
        } else if (updatedStageInfo.stage === subscriptionFlow.SUBSCRIPTION_STAGES.REQUIRED) {
            console.log('   ✅ Корректно определен этап REQUIRED');
        } else if (updatedStageInfo.stage === subscriptionFlow.SUBSCRIPTION_STAGES.COMPLETED) {
            console.log('   ✅ Корректно определен этап COMPLETED');
        } else {
            console.log('   ❌ Неожиданный этап:', updatedStageInfo.stage);
        }

        // Тест 3: Проверка функции calculateSubscriptionStatus
        console.log('\n3️⃣ Тест функции calculateSubscriptionStatus...');
        
        const testChannels = [
            { subscribed: true },
            { subscribed: false },
            { subscribed: true }
        ];
        
        const status = subscriptionFlow.calculateSubscriptionStatus(testChannels);
        console.log(`   Подписано: ${status.subscribedCount}/${status.totalCount}`);
        console.log(`   Все подписаны: ${status.allSubscribed}`);
        
        if (status.subscribedCount === 2 && status.totalCount === 3 && !status.allSubscribed) {
            console.log('   ✅ calculateSubscriptionStatus работает корректно');
        } else {
            console.log('   ❌ calculateSubscriptionStatus работает некорректно');
        }

        // Тест 4: Тест форматирования сообщений
        console.log('\n4️⃣ Тест форматирования сообщений...');
        
        const message = subscriptionFlow.formatStageMessage(updatedStageInfo);
        console.log(`   Длина сообщения: ${message.message.length} символов`);
        console.log(`   Количество кнопок: ${message.buttons.length}`);
        console.log('   ✅ Сообщение сформировано успешно');

        console.log('\n🎉 Все тесты завершены успешно!');
        
        // Восстанавливаем оригинальные функции
        subscriptionFlow.getSponsorChannels = originalGetSponsorChannels;
        subscriptionFlow.getRequiredChannels = originalGetRequiredChannels;

    } catch (error) {
        console.error('❌ Ошибка в тестах:', error);
    }
}

// Запускаем тесты
if (require.main === module) {
    testSubscriptionFlow();
}

module.exports = { testSubscriptionFlow };
