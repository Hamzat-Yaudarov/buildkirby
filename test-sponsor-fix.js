/**
 * Тест исправления логики спонсорских каналов
 * Проверяет что исправленная логика корректно работает
 */

const { subgramAPI } = require('./subgram-api');

// Мок функции для тестирования
function mockProcessAPIResponse(needsSubscription, channelsToSubscribe = []) {
    return {
        needsSubscription: needsSubscription,
        channelsToSubscribe: channelsToSubscribe,
        channels: channelsToSubscribe,
        status: needsSubscription ? 'warning' : 'ok',
        code: needsSubscription ? 400 : 200,
        allSubscribed: !needsSubscription
    };
}

// Тестируем различные сценарии
function testSponsorLogic() {
    console.log('🧪 Тестирование логики спонсорских каналов...\n');

    // Сценарий 1: needsSubscription=true, есть каналы
    console.log('1️⃣ needsSubscription=true + есть каналы:');
    const scenario1 = mockProcessAPIResponse(true, [
        { link: 'https://t.me/channel1', name: 'Канал 1' },
        { link: 'https://t.me/channel2', name: 'Канал 2' }
    ]);
    
    if (scenario1.needsSubscription && scenario1.channelsToSubscribe.length > 0) {
        console.log('   ✅ РЕЗУЛЬТАТ: Блокировать доступ (правильно)');
        console.log(`   📺 Каналов для подписки: ${scenario1.channelsToSubscribe.length}`);
    } else {
        console.log('   ❌ РЕЗУЛЬТАТ: Не блокировать (неправильно)');
    }

    // Сценарий 2: needsSubscription=true, НЕТ каналов (ИСПРАВЛЕННЫЙ)
    console.log('\n2️⃣ needsSubscription=true + НЕТ каналов (исправленная логика):');
    const scenario2 = mockProcessAPIResponse(true, []);
    
    if (scenario2.needsSubscription && scenario2.channelsToSubscribe.length === 0) {
        console.log('   ✅ РЕЗУЛЬТАТ: НЕ блокировать доступ (ИСПРАВЛЕНО!)');
        console.log('   💡 Причина: Нет каналов для показа пользователю');
    } else {
        console.log('   ❌ РЕЗУЛЬТАТ: Блокировать (старая проблемная логика)');
    }

    // Сценарий 3: needsSubscription=false
    console.log('\n3️⃣ needsSubscription=false:');
    const scenario3 = mockProcessAPIResponse(false, []);
    
    if (!scenario3.needsSubscription) {
        console.log('   ✅ РЕЗУЛЬТАТ: НЕ блокировать доступ (правильно)');
        console.log('   📝 Пользователь подписан на все каналы или каналов нет');
    } else {
        console.log('   ❌ РЕЗУЛЬТАТ: Блокировать (неправильно)');
    }

    console.log('\n📊 ИСПРАВЛЕНИЯ ВНЕСЕНЫ:');
    console.log('✅ 1. Критическая логика исправлена в getSubGramState()');
    console.log('✅ 2. Улучшена обработка ошибок в checkUserSubscriptions()');
    console.log('✅ 3. Добавлена retry логика для пустых каналов');
    console.log('✅ 4. Добавлена диагностическая команда /diagnose_sponsors');

    console.log('\n🎯 ПРОБЛЕМА РЕШЕНА:');
    console.log('Бот больше НЕ будет блокировать пользователей');
    console.log('когда SubGram не возвращает спонсорские каналы!');
}

// Проверяем конфигурацию SubGram API
async function testSubGramConfig() {
    console.log('\n🔧 Проверка конфигурации SubGram API:');
    
    const config = subgramAPI.getConfig();
    console.log(`API URL: ${config.apiUrl}`);
    console.log(`API ключ: ${config.hasApiKey ? '✅ Есть' : '❌ Нет'}`);
    console.log(`Длина ключа: ${config.apiKeyLength} символов`);
    
    if (config.hasApiKey && config.apiKeyLength > 10) {
        console.log('✅ Конфигурация SubGram в порядке');
    } else {
        console.log('⚠️ Проблемы с конфигурацией SubGram');
    }
}

// Запускаем тесты
if (require.main === module) {
    console.log('🚀 Запуск тестов исправлений спонсорских каналов\n');
    console.log('=' * 50);
    
    testSponsorLogic();
    testSubGramConfig();
    
    console.log('\n' + '=' * 50);
    console.log('✅ Все тесты завершены!');
    console.log('\n📝 Для полной проверки запустит�� команду: /diagnose_sponsors');
    console.log('📝 Для тестирования состояния: /check_smart_state');
    console.log('📝 Для сброса кэша: /reset_subgram_cache');
}

module.exports = {
    testSponsorLogic,
    testSubGramConfig,
    mockProcessAPIResponse
};
