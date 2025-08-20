const db = require('./database');
const { subgramAPI } = require('./subgram-api');

async function checkSubGramConfig() {
    try {
        console.log('=== ПРОВЕРКА НАСТРОЕК SUBGRAM ===\n');
        
        // 1. Проверяем настройки в БД
        console.log('1. Настройки в базе данных:');
        const settings = await db.getSubGramSettings();
        if (settings) {
            console.log(`   ✅ Найдены настройки SubGram`);
            console.log(`   • Включен: ${settings.enabled}`);
            console.log(`   • Макс спонсоров: ${settings.max_sponsors}`);
            console.log(`   • API ключ: ${settings.api_key ? settings.api_key.substring(0, 10) + '...' : 'НЕ УСТАНОВЛЕН'}`);
            console.log(`   • Действие по умолчанию: ${settings.default_action}`);
        } else {
            console.log('   ❌ Настройки SubGram не найдены в БД!');
        }
        console.log();
        
        // 2. Проверяем API ключ из кода
        console.log('2. API ключ в коде:');
        // Из subgram-api.js
        console.log(`   • Hardcoded ключ: ${subgramAPI.apiKey ? subgramAPI.apiKey.substring(0, 10) + '...' : 'НЕ НАЙДЕН'}`);
        console.log();
        
        // 3. Тестируем API запрос с подробными параметрами
        console.log('3. Тестовый API запрос:');
        const testUserId = '123456789'; // Тестовый ID
        
        const apiParams = {
            userId: testUserId,
            chatId: testUserId,
            maxOP: 3,
            action: 'subscribe',
            excludeChannelIds: [],
            withToken: true
        };
        
        console.log('   Параметры запроса:', JSON.stringify(apiParams, null, 2));
        
        const testResponse = await subgramAPI.requestSponsors(apiParams);
        
        console.log(`   Статус: ${testResponse.success ? '✅ Успех' : '❌ Ошибка'}`);
        if (testResponse.success) {
            console.log('   Ответ API:', JSON.stringify(testResponse.data, null, 2));
            
            const processedData = subgramAPI.processAPIResponse(testResponse.data);
            console.log(`   Обработанные данные:`);
            console.log(`     • Статус: ${processedData.status}`);
            console.log(`     • Всего каналов: ${processedData.channels?.length || 0}`);
            console.log(`     • Для подписки: ${processedData.channelsToSubscribe?.length || 0}`);
            console.log(`     • Сообщение: ${processedData.message || 'нет'}`);
            
            if (processedData.channels && processedData.channels.length > 0) {
                console.log('   📺 Найденные каналы:');
                processedData.channels.forEach((ch, i) => {
                    console.log(`     ${i+1}. ${ch.name} (${ch.link}) - ${ch.status}`);
                });
            }
        } else {
            console.log(`   Ошибка: ${testResponse.error}`);
            if (testResponse.details) {
                console.log('   Детали:', JSON.stringify(testResponse.details, null, 2));
            }
        }
        console.log();
        
        // 4. Проверяем последние запросы в БД
        console.log('4. Последние API запросы:');
        const recentRequests = await db.executeQuery(`
            SELECT user_id, api_status, success, response_data, error_message, created_at
            FROM subgram_api_requests 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        if (recentRequests.rows.length > 0) {
            recentRequests.rows.forEach((req, i) => {
                console.log(`   ${i+1}. User: ${req.user_id}, Status: ${req.api_status}, Success: ${req.success}, Time: ${req.created_at}`);
                if (!req.success && req.error_message) {
                    console.log(`      Ошибка: ${req.error_message}`);
                }
                if (req.response_data) {
                    const responseText = JSON.stringify(req.response_data).substring(0, 100);
                    console.log(`      Ответ: ${responseText}...`);
                }
            });
        } else {
            console.log('   Нет записей о запросах �� БД');
        }
        console.log();
        
        // 5. Рекомендации
        console.log('=== РЕКОМЕНДАЦИИ ===');
        if (!settings) {
            console.log('❌ Настройки SubGram отсутствуют - нужно их создать');
        } else if (!settings.enabled) {
            console.log('❌ SubGram отключен в настройках');
        } else if (!settings.api_key) {
            console.log('❌ Отсутствует API ключ');
        } else if (testResponse.success && testResponse.data?.message?.includes('рекламодателей')) {
            console.log('⚠️  API работает, но нет подходящих рекламодателей');
            console.log('   • Проверьте настройки бота в панели SubGram');
            console.log('   • Убедитесь что бот активен');
            console.log('   • Проверьте настройки таргетинга');
        } else if (!testResponse.success) {
            console.log('❌ Проблемы с API запросом');
            console.log('   • Проверьте API ключ');
            console.log('   • Проверьте подключение к интернету');
            console.log('   • Свя��итесь с поддержкой SubGram');
        } else {
            console.log('✅ Все выглядит нормально');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Ошибка при проверке конфигурации SubGram:', error);
        process.exit(1);
    }
}

checkSubGramConfig();
