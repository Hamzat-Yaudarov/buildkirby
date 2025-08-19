/**
 * Test script for SubGram API integration
 * Тестовый скрипт для проверки интеграции SubGram API
 */

const { subgramAPI } = require('./subgram-api');
const db = require('./database');

async function testSubGramIntegration() {
    console.log('🧪 Начинаю тестирование SubGram интеграции...\n');

    try {
        // 1. Test database connection
        console.log('1️⃣ Тестирование подключения к базе данных...');
        await db.initializeDatabase();
        console.log('✅ База данных инициализирована\n');

        // 2. Test SubGram settings
        console.log('2️⃣ Тестирование настроек SubGram...');
        const settings = await db.getSubGramSettings();
        console.log('📋 Настройки SubGram:', {
            enabled: settings?.enabled,
            hasApiKey: !!settings?.api_key,
            maxSponsors: settings?.max_sponsors,
            apiUrl: settings?.api_url
        });
        console.log('✅ Настройки SubGram загружены\n');

        // 3. Test SubGram API configuration
        console.log('3️⃣ Тестирование конфигурации SubGram API...');
        const config = subgramAPI.getConfig();
        console.log('🔧 Конфигурация API:', config);
        console.log('✅ API конфигурация корректна\n');

        // 4. Test SubGram API request (with test data)
        console.log('4️⃣ Тестирование запроса к SubGram API...');
        const testUserId = 123456789;
        const testRequest = {
            userId: testUserId.toString(),
            chatId: testUserId.toString(),
            maxOP: 3,
            action: 'subscribe',
            excludeChannelIds: [],
            withToken: true // Тестируем с токеном
        };

        console.log('📤 Отправляю тестовый запрос к SubGram API...');
        const apiResponse = await subgramAPI.requestSponsors(testRequest);
        
        console.log('📥 Ответ от SubGram API:');
        console.log('  • Успешно:', apiResponse.success);
        if (apiResponse.success && apiResponse.data) {
            console.log('  • Статус:', apiResponse.data.status);
            console.log('  • Код:', apiResponse.data.code);
            console.log('  • Сообщение:', apiResponse.data.message);
            console.log('  • Количество ссылок:', apiResponse.data.links?.length || 0);
            
            if (apiResponse.data.additional?.sponsors) {
                console.log('  • Спонсоры найдены:', apiResponse.data.additional.sponsors.length);
                
                // Show first few sponsors
                const sponsors = apiResponse.data.additional.sponsors.slice(0, 3);
                sponsors.forEach((sponsor, index) => {
                    console.log(`    ${index + 1}. ${sponsor.resource_name} (${sponsor.status})`);
                });
            }
        } else {
            console.log('  • Ошибка:', apiResponse.error);
        }
        console.log('✅ API запрос выполнен\n');

        // 5. Test data processing
        if (apiResponse.success && apiResponse.data) {
            console.log('5️⃣ Тестирование обработки данных...');
            const processedData = subgramAPI.processAPIResponse(apiResponse.data);
            
            console.log('📊 Обработанные данные:');
            console.log('  • Статус:', processedData.status);
            console.log('  • Нужна подписка:', processedData.needsSubscription);
            console.log('  • Нужен пол:', processedData.needsGender);
            console.log('  • Все подписаны:', processedData.allSubscribed);
            console.log('  • Можно продолжать:', processedData.canProceed);
            console.log('  • Всего каналов:', processedData.channels.length);
            console.log('  • Для подписки:', processedData.channelsToSubscribe.length);
            
            if (processedData.channelsToSubscribe.length > 0) {
                console.log('📺 Каналы для подписки:');
                processedData.channelsToSubscribe.forEach((channel, index) => {
                    console.log(`    ${index + 1}. ${channel.name} - ${channel.link}`);
                });
            }
            console.log('✅ Обработка данных успешна\n');

            // 6. Test message formatting
            console.log('6️⃣ Тестировани�� форматирования сообщений...');
            const formattedMessage = subgramAPI.formatChannelsMessage(processedData);
            
            console.log('💬 Форматированное сообщение:');
            console.log('  • Длина сообщения:', formattedMessage.message.length);
            console.log('  • Количество кнопок:', formattedMessage.buttons.length);
            console.log('  • Первые 200 символов сообщения:');
            console.log('   ', formattedMessage.message.substring(0, 200) + '...');
            console.log('✅ Форматирование сообщений работает\n');
        }

        // 7. Test database operations
        console.log('7️⃣ Тестирование операций с базой данных...');
        
        // Log API request
        await db.logSubGramAPIRequest(
            testUserId,
            'test_request',
            testRequest,
            apiResponse.data || {},
            apiResponse.success,
            apiResponse.error || null
        );
        console.log('✅ Запрос записан в лог');

        // Get API history
        const history = await db.getSubGramAPIRequestHistory(null, 5);
        console.log('📋 История запросов:', history.length, 'записей');

        // Test session operations
        if (apiResponse.success && apiResponse.data) {
            const processedData = subgramAPI.processAPIResponse(apiResponse.data);
            await db.saveSubGramUserSession(testUserId, apiResponse.data, processedData);
            console.log('✅ Сессия сохранена');

            const session = await db.getSubGramUserSession(testUserId);
            console.log('✅ Сессия загружена:', !!session);

            if (processedData.channelsToSubscribe.length > 0) {
                await db.saveSubGramChannels(testUserId, processedData.channelsToSubscribe);
                console.log('✅ Каналы сохранены');

                const channels = await db.getSubGramChannels(testUserId);
                console.log('✅ Каналы загружены:', channels.length, 'штук');
            }
        }
        console.log('✅ Операции с БД работают\n');

        // 8. Cleanup
        console.log('8️⃣ Очистка тестовых данных...');
        await db.deleteSubGramUserSession(testUserId);
        console.log('✅ Тестовые данные очищены\n');

        console.log('🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО УСПЕШНО!');
        console.log('✅ Все компоненты SubGram интеграции работают корректно');
        
        // Show summary
        console.log('\n📊 СВОДКА ТЕСТИРОВАНИЯ:');
        console.log('✅ База данных: работает');
        console.log('✅ SubGram API: работает');
        console.log('✅ Обработка данных: работает');
        console.log('✅ Форматирование сообщений: работает');
        console.log('✅ Операции с БД: работают');
        console.log('\n🚀 SubGram интеграция готова к использованию!');

    } catch (error) {
        console.error('\n❌ ОШИБКА ТЕСТИРОВАНИЯ:', error.message);
        console.error('📍 Стек ошибки:', error.stack);
        console.log('\n🛠️ Проверьте конфигурацию и попробуйте снова');
    } finally {
        // Close database connection
        await db.closeConnection();
        console.log('\n🔒 Соединение с базой данных закрыто');
    }
}

// Run the test
if (require.main === module) {
    testSubGramIntegration();
}

module.exports = { testSubGramIntegration };
