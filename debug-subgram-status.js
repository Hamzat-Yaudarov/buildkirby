/**
 * Диагностика состояния SubGram интеграции
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

async function debugSubGramStatus() {
    console.log('🔍 ДИАГНОСТИКА SUBGRAM ИНТЕГРАЦИИ\n');

    try {
        // 1. Проверка подключения к базе данных
        console.log('1️⃣ Инициализация базы данных...');
        await db.initializeDatabase();
        console.log('✅ База данных готова\n');

        // 2. Проверка настроек SubGram в БД
        console.log('2️⃣ Проверка настроек SubGram в БД...');
        try {
            const settings = await db.getSubGramSettings();
            console.log('��� Настройки из БД:', {
                enabled: settings?.enabled,
                hasApiKey: !!settings?.api_key,
                apiKeyLength: settings?.api_key?.length,
                maxSponsors: settings?.max_sponsors,
                apiUrl: settings?.api_url
            });
        } catch (error) {
            console.log('⚠️ Ошибка получения настроек:', error.message);
        }
        console.log('');

        // 3. Проверка конфигурации API модуля
        console.log('3️⃣ Проверка конфигурации API модуля...');
        const config = subgramAPI.getConfig();
        console.log('🔧 Конфигурация API:', config);
        console.log('');

        // 4. Проверка логов запросов
        console.log('4️⃣ Анализ логов API запросов (последние 10)...');
        try {
            const logs = await db.getSubGramAPIRequestHistory(null, 10);
            console.log(`📊 Найдено ${logs.length} записей в логах`);
            
            if (logs.length > 0) {
                // Статистика
                const successCount = logs.filter(log => log.success).length;
                const errorCount = logs.length - successCount;
                console.log(`  • Успешных: ${successCount}`);
                console.log(`  • Ошибок: ${errorCount}`);
                
                // Последние ошибки
                const recentErrors = logs.filter(log => !log.success).slice(0, 3);
                if (recentErrors.length > 0) {
                    console.log('\n❌ Последние ошибки:');
                    recentErrors.forEach((error, index) => {
                        console.log(`  ${index + 1}. [${error.created_at}] ${error.error_message || 'Неизвестная ошибка'}`);
                        if (error.response_data?.status) {
                            console.log(`     API статус: ${error.response_data.status}`);
                        }
                    });
                }
                
                // Последние успешные запросы
                const recentSuccess = logs.filter(log => log.success).slice(0, 3);
                if (recentSuccess.length > 0) {
                    console.log('\n✅ Последние успешные запросы:');
                    recentSuccess.forEach((success, index) => {
                        console.log(`  ${index + 1}. [${success.created_at}] API статус: ${success.api_status || 'unknown'}`);
                    });
                }
            } else {
                console.log('📭 Логов запросов не найдено');
            }
        } catch (error) {
            console.log('⚠️ Ошибка получения логов:', error.message);
        }
        console.log('');

        // 5. Тестовый запрос к API
        console.log('5️⃣ Выполнение тестового запроса к SubGram API...');
        const testUserId = '123456789';
        try {
            const apiResponse = await subgramAPI.requestSponsors({
                userId: testUserId,
                chatId: testUserId,
                maxOP: 3,
                action: 'subscribe',
                excludeChannelIds: [],
                withToken: true
            });

            console.log('📡 Результат API запроса:');
            console.log(`  • Успешно: ${apiResponse.success}`);
            if (apiResponse.success && apiResponse.data) {
                console.log(`  • Статус: ${apiResponse.data.status}`);
                console.log(`  • Код: ${apiResponse.data.code}`);
                console.log(`  • Сообщение: ${apiResponse.data.message || 'Нет сообщения'}`);
                console.log(`  • Ссылок: ${apiResponse.data.links?.length || 0}`);
            } else {
                console.log(`  • Ошибка: ${apiResponse.error || 'Неизвестная ошибка'}`);
            }
            
            // Записать тестовый запрос в логи
            await db.logSubGramAPIRequest(
                parseInt(testUserId),
                'test_request',
                { test: true },
                apiResponse.data || {},
                apiResponse.success,
                apiResponse.error
            );
            
        } catch (error) {
            console.log(`  • Критическая ошибка: ${error.message}`);
        }
        console.log('');

        // 6. Проверка активных сессий пользователей
        console.log('6️⃣ Проверка активных сессий пользователей...');
        try {
            const sessions = await db.executeQuery(`
                SELECT COUNT(*) as count, 
                       MAX(last_check_at) as last_activity,
                       COUNT(CASE WHEN status = 'active' THEN 1 END) as active_sessions
                FROM subgram_user_sessions
                WHERE expires_at > NOW()
            `);
            
            if (sessions.rows.length > 0) {
                const stats = sessions.rows[0];
                console.log(`📈 Статистика сессий:`);
                console.log(`  • Всего активных сессий: ${stats.count}`);
                console.log(`  • Активных статусов: ${stats.active_sessions}`);
                console.log(`  • Последняя активность: ${stats.last_activity || 'Нет данных'}`);
            } else {
                console.log('📭 Активных сессий не найдено');
            }
        } catch (error) {
            console.log('⚠️ Ошибка получения сессий:', error.message);
        }
        console.log('');

        // 7. Проверка сохраненных каналов
        console.log('7️⃣ Проверка сохраненных каналов...');
        try {
            const channels = await db.executeQuery(`
                SELECT COUNT(*) as total_channels,
                       COUNT(DISTINCT user_id) as users_with_channels,
                       MAX(created_at) as last_channel_added
                FROM subgram_channels
            `);
            
            if (channels.rows.length > 0) {
                const stats = channels.rows[0];
                console.log(`📺 Статистика каналов:`);
                console.log(`  • Всего каналов: ${stats.total_channels}`);
                console.log(`  • Пользователей с каналами: ${stats.users_with_channels}`);
                console.log(`  • Последний канал добавлен: ${stats.last_channel_added || 'Нет данных'}`);
            } else {
                console.log('📭 Каналов не сохранено');
            }
        } catch (error) {
            console.log('⚠️ Ошибка получения каналов:', error.message);
        }
        console.log('');

        // 8. Рекомендации
        console.log('8️⃣ РЕКОМЕНДАЦИИ И ВЫВОДЫ');
        console.log('==========================================');
        
        // Проверяем количество ошибок
        try {
            const errorStats = await db.executeQuery(`
                SELECT 
                    COUNT(*) as total_requests,
                    COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
                    COUNT(CASE WHEN success = false THEN 1 END) as failed_requests
                FROM subgram_api_requests 
                WHERE created_at > NOW() - INTERVAL '24 hours'
            `);
            
            if (errorStats.rows.length > 0) {
                const stats = errorStats.rows[0];
                const errorRate = stats.total_requests > 0 ? 
                    (stats.failed_requests / stats.total_requests * 100).toFixed(1) : 0;
                
                console.log(`📊 Статистика за 24 часа:`);
                console.log(`  • Всего запросов: ${stats.total_requests}`);
                console.log(`  • Успешных: ${stats.successful_requests}`);
                console.log(`  • Ошибок: ${stats.failed_requests}`);
                console.log(`  • Процент ошибок: ${errorRate}%`);
                
                if (errorRate > 50) {
                    console.log('🚨 ВЫСОКИЙ ПРОЦЕНТ ОШИБОК - требует внимания!');
                } else if (errorRate > 20) {
                    console.log('⚠️ Умеренный процент ошибок - рекомендуется проверка');
                } else {
                    console.log('✅ Приемлемый процент ошибок');
                }
            }
        } catch (error) {
            console.log('⚠️ Не удалось получить статистику ошибок');
        }

        console.log('\n🎯 СЛЕДУЮЩИЕ ШАГИ:');
        console.log('1. Если много ошибок - ��роверьте API ключ в SubGram');
        console.log('2. Убедитесь что бот добавлен с токеном');
        console.log('3. Проверьте что боту разрешено получать спонсорские каналы');
        console.log('4. При необходимости обновите настройки в БД');

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
    debugSubGramStatus();
}

module.exports = { debugSubGramStatus };
