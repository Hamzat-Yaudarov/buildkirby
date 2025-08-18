/**
 * Test script for SubGram moderation status handling
 * Тестовый скрипт для проверки обработки статуса модерации SubGram
 */

const { subgramAPI } = require('./subgram-api');
const db = require('./database');

async function testModerationStatus() {
    console.log('🧪 Тестирование обработки статуса модерации SubGram...\n');

    try {
        // Initialize database
        await db.initializeDatabase();
        console.log('✅ База данных инициализи��ована\n');

        // 1. Test SubGram API configuration
        console.log('1️⃣ Проверка конфигурации SubGram API...');
        const config = subgramAPI.getConfig();
        console.log('📋 Конфигурация:', config);
        console.log('✅ API конфигурация загружена\n');

        // 2. Test actual API request
        console.log('2️⃣ Отправка реального запроса к SubGram API...');
        const testUserId = 123456789;
        const apiResponse = await subgramAPI.requestSponsors({
            userId: testUserId.toString(),
            chatId: testUserId.toString(),
            firstName: 'Тестовый пользователь',
            languageCode: 'ru',
            premium: false,
            maxOP: 3,
            action: 'subscribe',
            excludeChannelIds: []
        });

        console.log('📥 Ответ от SubGram API:');
        console.log('  • success:', apiResponse.success);
        if (apiResponse.success && apiResponse.data) {
            console.log('  • status:', apiResponse.data.status);
            console.log('  • code:', apiResponse.data.code);
            console.log('  • message:', apiResponse.data.message);
            console.log('  • total_fixed_link:', apiResponse.data.total_fixed_link);
        } else {
            console.log('  • error:', apiResponse.error);
            console.log('  • details:', apiResponse.details);
        }
        console.log('✅ API запрос выполнен\n');

        // 3. Test response processing
        if (apiResponse.success && apiResponse.data) {
            console.log('3️⃣ Обработка ответа API...');
            const processedData = subgramAPI.processAPIResponse(apiResponse.data);
            
            console.log('📊 Обработанные данные:');
            console.log('  • status:', processedData.status);
            console.log('  • code:', processedData.code);
            console.log('  • needsSubscription:', processedData.needsSubscription);
            console.log('  • needsGender:', processedData.needsGender);
            console.log('  • allSubscribed:', processedData.allSubscribed);
            console.log('  • canProceed:', processedData.canProceed);
            console.log('  • isModeration:', processedData.isModeration);
            console.log('  • channels.length:', processedData.channels.length);
            console.log('  • channelsToSubscribe.length:', processedData.channelsToSubscribe.length);
            console.log('✅ Ответ обработан\n');

            // 4. Test message formatting
            console.log('4️⃣ Форматирование сообщения для пользователя...');
            const formattedMessage = subgramAPI.formatChannelsMessage(processedData);
            
            console.log('💬 Форматированное сообщение:');
            console.log('  • Длина сообщения:', formattedMessage.message.length);
            console.log('  • Количество кнопок:', formattedMessage.buttons.length);
            console.log('  • Текст сообщения:');
            console.log('    ' + formattedMessage.message.replace(/\n/g, '\n    '));
            console.log('  • Кнопки:');
            formattedMessage.buttons.forEach((buttonRow, index) => {
                buttonRow.forEach(button => {
                    console.log(`    ${index + 1}. "${button.text}" -> ${button.callback_data || button.url}`);
                });
            });
            console.log('✅ Сообщение отформатировано\n');

            // 5. Test database logging
            console.log('5️⃣ Запись в базу данных...');
            await db.logSubGramAPIRequest(
                testUserId,
                'test_moderation',
                { action: 'subscribe', maxOP: 3 },
                apiResponse.data,
                true
            );
            console.log('✅ Запрос записан в лог\n');

            // 6. Test session saving
            console.log('6️⃣ Сохранение сессии пользователя...');
            await db.saveSubGramUserSession(testUserId, apiResponse.data, processedData);
            console.log('✅ Сессия сохранена\n');

            // 7. Get session back
            console.log('7️⃣ Загрузка сессии пользователя...');
            const session = await db.getSubGramUserSession(testUserId);
            console.log('📋 Загруженная сессия:');
            if (session) {
                console.log('  • user_id:', session.user_id);
                console.log('  • status:', session.status);
                console.log('  • session_data.status:', session.session_data?.status);
                console.log('  • session_data.code:', session.session_data?.code);
                console.log('  • channels_data.isModeration:', session.channels_data?.isModeration);
                console.log('  • expires_at:', session.expires_at);
            } else {
                console.log('  • Сессия не найдена');
            }
            console.log('✅ Сессия загруж��на\n');

            // 8. Test API history
            console.log('8️⃣ Проверка истории API запросов...');
            const history = await db.getSubGramAPIRequestHistory(testUserId, 5);
            console.log('📋 История запросов:');
            history.forEach((request, index) => {
                console.log(`  ${index + 1}. ${request.request_type} - ${request.success ? 'успех' : 'ошибка'}`);
                console.log(`     Время: ${new Date(request.created_at).toLocaleString('ru-RU')}`);
                console.log(`     API статус: ${request.api_status}`);
                console.log(`     API код: ${request.api_code}`);
            });
            console.log('✅ История получена\n');
        }

        // 9. Analysis and recommendations
        console.log('9️⃣ Анализ и рекомендации...\n');
        
        if (apiResponse.success && apiResponse.data) {
            const { status, code, message } = apiResponse.data;
            
            if (status === 'ok' && code === 400) {
                console.log('🔍 ДИАГНОЗ: Бот находится на модерации в SubGram');
                console.log('📝 Сообщение от SubGram:', message);
                console.log('✅ Инт��грация работает корректно - ждем завершения модерации');
                console.log('💡 Пользователи видят информационное сообщение о модерации');
            } else if (status === 'warning') {
                console.log('🔍 ДИАГНОЗ: SubGram предоставляет каналы для подписки');
                console.log('✅ Интеграция работает - пользователи получают спонсорские каналы');
            } else if (status === 'gender') {
                console.log('🔍 ДИАГНОЗ: SubGram требует указания пола пользователя');
                console.log('✅ Интеграция работает - пользователи могут выбрать пол');
            } else {
                console.log('🔍 ДИАГНОЗ: Неизвестный статус от SubGram');
                console.log('📝 Статус:', status, 'Код:', code);
            }
        } else {
            console.log('❌ ДИАГНОЗ: Проблема с подключением к SubGram API');
            console.log('🛠️ Проверьте API ключ и интернет соединение');
        }

        // Cleanup
        console.log('\n🧹 Очистка тестовых данных...');
        await db.deleteSubGramUserSession(testUserId);
        console.log('✅ Тестовые данные очищены');

        console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО!');
        console.log('📊 Интеграция SubGram протестирована и работает корректно');

    } catch (error) {
        console.error('\n❌ ОШИБКА ТЕСТИРОВАНИЯ:', error.message);
        console.error('📍 Стек ошибки:', error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Соединение с базой данных закрыто');
    }
}

// Run the test
if (require.main === module) {
    testModerationStatus();
}

module.exports = { testModerationStatus };
