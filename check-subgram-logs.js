/**
 * Проверка логов SubGram в базе данных
 */

const db = require('./database');

async function checkSubGramLogs() {
    console.log('📋 ПРОВЕРКА ЛОГОВ SUBGRAM\n');

    try {
        await db.initializeDatabase();
        console.log('✅ База данных подключена\n');

        // 1. Общая статистика
        console.log('1️⃣ Общая статистика запросов...');
        const totalStats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
                COUNT(CASE WHEN success = false THEN 1 END) as failed_requests,
                MIN(created_at) as first_request,
                MAX(created_at) as last_request
            FROM subgram_api_requests
        `);

        if (totalStats.rows.length > 0) {
            const stats = totalStats.rows[0];
            const errorRate = stats.total_requests > 0 ? 
                (stats.failed_requests / stats.total_requests * 100).toFixed(1) : 0;

            console.log(`📊 Всего запросов: ${stats.total_requests}`);
            console.log(`✅ Успешных: ${stats.successful_requests}`);
            console.log(`❌ Ошибок: ${stats.failed_requests}`);
            console.log(`📈 Процент ошибок: ${errorRate}%`);
            console.log(`📅 Первый запрос: ${stats.first_request || 'Нет данных'}`);
            console.log(`📅 Последний запрос: ${stats.last_request || 'Нет данных'}`);
        } else {
            console.log('📭 Запросов в логах не найдено');
        }
        console.log('');

        // 2. Статистика за последние 24 часа
        console.log('2️⃣ Статистика за последние 24 часа...');
        const recentStats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_requests,
                COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
                COUNT(CASE WHEN success = false THEN 1 END) as failed_requests,
                COUNT(DISTINCT user_id) as unique_users
            FROM subgram_api_requests 
            WHERE created_at > NOW() - INTERVAL '24 hours'
        `);

        if (recentStats.rows.length > 0) {
            const stats = recentStats.rows[0];
            const errorRate = stats.total_requests > 0 ? 
                (stats.failed_requests / stats.total_requests * 100).toFixed(1) : 0;

            console.log(`📊 Запросов за 24ч: ${stats.total_requests}`);
            console.log(`✅ Успешных: ${stats.successful_requests}`);
            console.log(`❌ Ошибок: ${stats.failed_requests}`);
            console.log(`👥 Уникальных пользователей: ${stats.unique_users}`);
            console.log(`📈 Процент ошибок: ${errorRate}%`);
        }
        console.log('');

        // 3. Анализ статусов API
        console.log('3️⃣ Анализ статусов API ответов...');
        const statusStats = await db.executeQuery(`
            SELECT 
                api_status,
                COUNT(*) as count,
                COUNT(CASE WHEN success = true THEN 1 END) as successful
            FROM subgram_api_requests 
            WHERE created_at > NOW() - INTERVAL '24 hours'
            AND api_status IS NOT NULL
            GROUP BY api_status
            ORDER BY count DESC
        `);

        if (statusStats.rows.length > 0) {
            console.log('📊 Статусы API ответов:');
            statusStats.rows.forEach(stat => {
                console.log(`  • ${stat.api_status}: ${stat.count} (успешных: ${stat.successful})`);
            });
        } else {
            console.log('📭 Статусы API не найдены');
        }
        console.log('');

        // 4. Последние ошибки
        console.log('4️⃣ Последние ошибки (топ 10)...');
        const errors = await db.executeQuery(`
            SELECT 
                user_id,
                error_message,
                api_status,
                response_data,
                created_at
            FROM subgram_api_requests 
            WHERE success = false
            ORDER BY created_at DESC
            LIMIT 10
        `);

        if (errors.rows.length > 0) {
            console.log('❌ Последние ошибки:');
            errors.rows.forEach((error, index) => {
                const date = new Date(error.created_at).toLocaleString('ru-RU');
                console.log(`  ${index + 1}. [${date}] User ${error.user_id}`);
                console.log(`     Ошибка: ${error.error_message || 'Неизвестная ошибка'}`);
                if (error.api_status) {
                    console.log(`     API статус: ${error.api_status}`);
                }
                if (error.response_data && Object.keys(error.response_data).length > 0) {
                    console.log(`     Данные ответа: ${JSON.stringify(error.response_data).substring(0, 100)}...`);
                }
                console.log('');
            });
        } else {
            console.log('✅ Ошибок не найдено');
        }
        console.log('');

        // 5. Последние успешные запросы
        console.log('5️⃣ Последние успешные запросы (топ 5)...');
        const successful = await db.executeQuery(`
            SELECT 
                user_id,
                api_status,
                response_data,
                created_at
            FROM subgram_api_requests 
            WHERE success = true
            ORDER BY created_at DESC
            LIMIT 5
        `);

        if (successful.rows.length > 0) {
            console.log('✅ Последние успешные запросы:');
            successful.rows.forEach((success, index) => {
                const date = new Date(success.created_at).toLocaleString('ru-RU');
                const links = success.response_data?.links?.length || 0;
                console.log(`  ${index + 1}. [${date}] User ${success.user_id}`);
                console.log(`     API статус: ${success.api_status || 'unknown'}`);
                console.log(`     Ссылок получено: ${links}`);
                console.log('');
            });
        } else {
            console.log('📭 Успешных запросов не найдено');
        }
        console.log('');

        // 6. Анализ типов ошибок
        console.log('6️⃣ Анализ типов ошибок...');
        const errorTypes = await db.executeQuery(`
            SELECT 
                CASE 
                    WHEN error_message LIKE '%timeout%' OR error_message LIKE '%ECONNREFUSED%' THEN 'Сетевые ошибки'
                    WHEN error_message LIKE '%401%' OR error_message LIKE '%unauthorized%' THEN 'Ошибки авторизации'
                    WHEN error_message LIKE '%400%' OR error_message LIKE '%bad request%' THEN 'Неправильный запрос'
                    WHEN error_message LIKE '%500%' OR error_message LIKE '%server error%' THEN 'Ошибки сервера'
                    ELSE 'Другие ошибки'
                END as error_type,
                COUNT(*) as count
            FROM subgram_api_requests 
            WHERE success = false
            AND created_at > NOW() - INTERVAL '7 days'
            GROUP BY error_type
            ORDER BY count DESC
        `);

        if (errorTypes.rows.length > 0) {
            console.log('🔍 Типы ошибок за последнюю неделю:');
            errorTypes.rows.forEach(type => {
                console.log(`  • ${type.error_type}: ${type.count}`);
            });
        } else {
            console.log('✅ Ошибок за неделю не найдено');
        }
        console.log('');

        // 7. Рекомендации
        console.log('7️⃣ РЕКОМЕНДАЦИИ');
        console.log('==========================================');

        const recentData = recentStats.rows[0];
        if (recentData.total_requests === 0) {
            console.log('⚠️ НЕТ АКТИВНОСТИ: За последние 24 часа не было запросов к SubGram');
            console.log('   • Проверьте, запущен ли бот');
            console.log('   • Убедитесь, что пользователи используют бота');
        } else {
            const errorRate = (recentData.failed_requests / recentData.total_requests * 100);
            
            if (errorRate === 0) {
                console.log('🎉 ОТЛИЧНО: Все запросы выполняются успешно!');
            } else if (errorRate < 10) {
                console.log('✅ ХОРОШО: Низкий процент ошибок');
            } else if (errorRate < 30) {
                console.log('⚠️ ВНИМАНИЕ: Умеренный процент ошибок');
                console.log('   • Проверьте настройки API ключа');
                console.log('   • Убедитесь что бот правильно добавлен в SubGram');
            } else if (errorRate < 60) {
                console.log('🚨 ПРОБЛЕМА: Высокий процент ошибок');
                console.log('   • Срочно проверьте конфигурацию SubGram');
                console.log('   • Возможны проблемы с API ключом или настройками');
            } else {
                console.log('❌ КРИТИЧНО: Очень высокий процент ошибок');
                console.log('   • Интеграция практически не работает');
                console.log('   • Требуется немедленное вмешательство');
            }
        }

        console.log('\n🎯 СЛЕДУЮЩИЕ ДЕЙСТВИЯ:');
        console.log('1. Проверьте статус бота в SubGram панели');
        console.log('2. Убедитесь что API ключ правильный');
        console.log('3. Протестируйте API через админ панель бота');
        console.log('4. При необходимости обратитесь в поддержку SubGram');

    } catch (error) {
        console.error('\n❌ ОШИБКА:', error.message);
        console.error('📍 Стек:', error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Подключение к БД закрыто');
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    checkSubGramLogs();
}

module.exports = { checkSubGramLogs };
