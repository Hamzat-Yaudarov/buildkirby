/**
 * Отладочный скрипт для проверки поэтапной системы подписок
 */

console.log('🔍 Отладка поэтапной системы подписок\n');

// Проверяем загрузку модулей
try {
    const subscriptionFlow = require('./subscription-flow-manager');
    console.log('✅ subscription-flow-manager.js загружен');
    
    // Тестируем константы
    console.log('📋 Этапы подписки:', subscriptionFlow.SUBSCRIPTION_STAGES);
    
    // Проверяем доступность функций
    const functions = [
        'getCurrentSubscriptionStage',
        'getSponsorChannels', 
        'getRequiredChannels',
        'formatStageMessage',
        'canUserAccessBot',
        'updateSubscriptionStage'
    ];
    
    console.log('\n🔧 Доступные функции:');
    functions.forEach(func => {
        const type = typeof subscriptionFlow[func];
        console.log(`   ${func}: ${type}`);
        if (type !== 'function') {
            console.log(`   ❌ ОШИБКА: ${func} должна быть функцией!`);
        }
    });
    
} catch (error) {
    console.log('❌ Ошибка загрузки subscription-flow-manager:', error.message);
    console.log('Stack:', error.stack);
}

console.log('\n🎯 Проверка логики этапов:');

// Симуляция разных сценариев
const testScenarios = [
    {
        name: 'Есть спонсоры и обязательные',
        sponsors: ['https://t.me/sponsor1', 'https://t.me/sponsor2'],
        required: ['@channel1', '@channel2'],
        expectedStage: 'sponsors'
    },
    {
        name: 'Только обязательные каналы',
        sponsors: [],
        required: ['@channel1', '@channel2'],
        expectedStage: 'required'
    },
    {
        name: 'Нет каналов вообще',
        sponsors: [],
        required: [],
        expectedStage: 'completed'
    }
];

testScenarios.forEach((scenario, index) => {
    console.log(`\n${index + 1}. ${scenario.name}:`);
    console.log(`   Спонсоров: ${scenario.sponsors.length}`);
    console.log(`   Обязательных: ${scenario.required.length}`);
    console.log(`   Ожидаемый этап: ${scenario.expectedStage}`);
});

console.log('\n✅ Отладка завершена');
console.log('\n📝 Рекомендации:');
console.log('1. Проверить что спонсорские каналы показываются ПЕРВЫМИ');
console.log('2. Обязательные каналы показываются ТОЛЬКО после спонсоров');
console.log('3. Проверка подписок работает корректно');
console.log('4. Блокировка функций действует до завершения ВСЕХ этапов');
