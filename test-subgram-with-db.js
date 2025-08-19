/**
 * Тест SubGram API с использованием настроек из базы данных
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');
const axios = require('axios');

async function testSubGramWithDB() {
    console.log('🧪 ТЕСТИРОВАНИЕ SUBGRAM API С НАСТРОЙКАМИ ИЗ БД\n');

    try {
        // 1. Инициализация БД
        console.log('1️⃣ Инициализация базы данных...');
        await db.initializeDatabase();
        console.log('✅ База данных готова\n');

        // 2. Получение настроек из БД
        console.log('2️⃣ Получение настроек SubGram из БД...');
        const settings = await db.getSubGramSettings();
        
        if (!settings) {
            console.log('⚠️ Настройки не найдены в БД, используем настройки по умолчанию');
        } else {
            console.log('📋 Настройки из БД:');
            console.log(`  • Включено: ${settings.enabled}`);
            console.log(`  • API URL: ${settings.api_url}`);
            console.log(`  • API ключ: ${settings.api_key ? settings.api_key.substring(0, 20) + '...' : 'НЕТ'}`);
            console.log(`  • Макс спонсоров: ${settings.max_sponsors}`);
            console.log(`  • Действие по умолчанию: ${settings.default_action}`);
        }
        console.log('');

        // 3. Проверка настроек модуля
        console.log('3️⃣ Настройки модуля subgram-api.js...');
        const moduleConfig = subgramAPI.getConfig();
        console.log('🔧 Конфигурация модуля:', moduleConfig);
        console.log('');

        // 4. Прямой тест API с настройками из БД
        console.log('4️⃣ Прямой тест API с настройками из БД...');
        
        const apiKey = settings?.api_key || '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d';
        const apiUrl = settings?.api_url || 'https://api.subgram.ru/request-op/';
        
        const directTestData = {
            UserId: "123456789",
            ChatId: "123456789",
            MaxOP: settings?.max_sponsors || 3,
            action: settings?.default_action || "subscribe",
            exclude_channel_ids: []
        };

        console.log('📤 Отправляю прямой запрос...');
        console.log('URL:', apiUrl);
        console.log('Данные:', JSON.stringify(directTestData, null, 2));

        try {
            const directResponse = await axios.post(apiUrl, directTestData, {
                headers: {
                    'Auth': apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });

            console.log('✅ Прямой запрос успешен!');
            console.log('📥 Ответ:', JSON.stringify(directResponse.data, null, 2));
            
            // Логируем в БД
            await db.logSubGramAPIRequest(
                123456789,
                'direct_test',
                directTestData,
                directResponse.data,
                true
            );
            
        } catch (directError) {
            console.log('❌ Прямой запрос неудачен:', directError.message);
            
            if (directError.response) {
                console.log('HTTP статус:', directError.response.status);
                console.log('Ответ сервера:', JSON.stringify(directError.response.data, null, 2));
            }
            
            // Логируем ошибку в БД
            await db.logSubGramAPIRequest(
                123456789,
                'direct_test',
                directTestData,
                directError.response?.data || {},
                false,
                directError.message
            );
        }
        console.log('');

        // 5. Тест через модуль subgram-api.js
        console.log('5️⃣ Тест через модуль subgram-api.js...');
        
        const moduleTestData = {
            userId: "987654321",
            chatId: "987654321",
            maxOP: 3,
            action: 'subscribe',
            excludeChannelIds: [],
            withToken: true
        };

        console.log('📤 Отправляю запрос через модуль...');
        
        const moduleResponse = await subgramAPI.requestSponsors(moduleTestData);
        
        console.log('📥 Ответ от модуля:');
        console.log(`  • Успешно: ${moduleResponse.success}`);
        if (moduleResponse.success && moduleResponse.data) {
            console.log(`  • Статус: ${moduleResponse.data.status}`);
            console.log(`  • Код: ${moduleResponse.data.code}`);
            console.log(`  • Сообщение: ${moduleResponse.data.message || 'Нет сообщения'}`);
            console.log(`  • Ссылок: ${moduleResponse.data.links?.length || 0}`);
            
            if (moduleResponse.data.links && moduleResponse.data.links.length > 0) {
                console.log('📺 Первые 3 ссылки:');
                moduleResponse.data.links.slice(0, 3).forEach((link, index) => {
                    console.log(`    ${index + 1}. ${link}`);
                });
            }
        } else {
            console.log(`  • Ошибка: ${moduleResponse.error || 'Неизвестная ошибка'}`);
            if (moduleResponse.details) {
                console.log(`  • Детали: ${JSON.stringify(moduleResponse.details, null, 2)}`);
            }
        }
        console.log('');

        // 6. Тест обработки данных
        if (moduleResponse.success && moduleResponse.data) {
            console.log('6️⃣ Тест обработки данных...');
            
            const processedData = subgramAPI.processAPIResponse(moduleResponse.data);
            console.log('📊 Обработанные данные:');
            console.log(`  • Статус: ${processedData.status}`);
            console.log(`  • Нужна подписка: ${processedData.needsSubscription}`);
            console.log(`  • Нужен пол: ${processedData.needsGender}`);
            console.log(`  • Все подписаны: ${processedData.allSubscribed}`);
            console.log(`  • Можно продолжать: ${processedData.canProceed}`);
            console.log(`  • Всего каналов: ${processedData.channels.length}`);
            console.log(`  • Для подписки: ${processedData.channelsToSubscribe.length}`);
            
            if (processedData.channelsToSubscribe.length > 0) {
                console.log('📺 Каналы для подписки:');
                processedData.channelsToSubscribe.slice(0, 3).forEach((channel, index) => {
                    console.log(`    ${index + 1}. ${channel.name} - ${channel.link}`);
                });
            }
            console.log('');
        }

        // 7. Проверка последних логов
        console.log('7️⃣ Проверка логов API за последний час...');
        try {
            const recentLogs = await db.executeQuery(`
                SELECT * FROM subgram_api_requests 
                WHERE created_at > NOW() - INTERVAL '1 hour'
                ORDER BY created_at DESC
                LIMIT 10
            `);
            
            console.log(`📋 Найдено ${recentLogs.rows.length} записей за последний час`);
            
            if (recentLogs.rows.length > 0) {
                const successCount = recentLogs.rows.filter(log => log.success).length;
                const errorCount = recentLogs.rows.length - successCount;
                
                console.log(`  • Успешных: ${successCount}`);
                console.log(`  • Ошибок: ${errorCount}`);
                
                if (errorCount > 0) {
                    console.log('\n❌ Последние ошибки:');
                    recentLogs.rows.filter(log => !log.success).slice(0, 3).forEach((error, index) => {
                        console.log(`    ${index + 1}. ${error.error_message || 'Неизвестная ошибка'}`);
                    });
                }
                
                if (successCount > 0) {
                    console.log('\n✅ Последние успешные запросы:');
                    recentLogs.rows.filter(log => log.success).slice(0, 3).forEach((success, index) => {
                        const status = success.response_data?.status || 'unknown';
                        const links = success.response_data?.links?.length || 0;
                        console.log(`    ${index + 1}. Статус: ${status}, Ссылок: ${links}`);
                    });
                }
            }
        } catch (error) {
            console.log('⚠️ Ошибка получения логов:', error.message);
        }
        console.log('');

        // 8. Заключение
        console.log('8️⃣ ЗАКЛЮЧЕНИЕ И РЕКОМЕНДАЦИИ');
        console.log('========================================');
        
        console.log('✅ ПРОВЕРЕНО:');
        console.log('  • Настройки в БД');
        console.log('  • Прямой API запрос');
        console.log('  • Запрос через модуль');
        console.log('  • Обработка данных');
        console.log('  • Логирование');
        
        console.log('\n🎯 СЛЕДУЮЩИЕ ШАГИ:');
        console.log('1. Если API работает - интеграция готова');
        console.log('2. Если есть ошибки - проверьте ��татус бота в SubGram');
        console.log('3. Убедитесь что бот добавлен с токеном');
        console.log('4. Проверьте права бота в SubGram панели');

    } catch (error) {
        console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
        console.error('📍 Стек:', error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Подключение к БД закрыто');
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    testSubGramWithDB();
}

module.exports = { testSubGramWithDB };
