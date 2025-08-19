/**
 * Обновление настроек SubGram в базе данных
 */

const db = require('./database');

async function updateSubGramSettings() {
    console.log('⚙️ ОБНОВЛЕНИЕ НАСТРОЕК SUBGRAM\n');

    try {
        await db.initializeDatabase();
        console.log('✅ База данных подключена\n');

        // 1. Проверяем текущие настройки
        console.log('1️⃣ Проверка текущих настроек...');
        const currentSettings = await db.getSubGramSettings();
        
        if (currentSettings) {
            console.log('📋 Текущие настройки:');
            console.log(`  • Включено: ${currentSettings.enabled}`);
            console.log(`  • API URL: ${currentSettings.api_url}`);
            console.log(`  • API ключ: ${currentSettings.api_key ? currentSettings.api_key.substring(0, 20) + '...' : 'НЕТ'}`);
            console.log(`  • Макс спонсоров: ${currentSettings.max_sponsors}`);
            console.log(`  • Действие: ${currentSettings.default_action}`);
            console.log(`  • Обновлено: ${currentSettings.updated_at || 'Никогда'}`);
        } else {
            console.log('❌ Настройки не найдены - будут созданы новые');
        }
        console.log('');

        // 2. Правильные настройки для работы с токеном
        console.log('2️⃣ Обновление настроек для работы с токеном...');
        
        const correctSettings = {
            apiKey: '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d',
            apiUrl: 'https://api.subgram.ru/request-op/',
            enabled: true,
            maxSponsors: 3,
            defaultAction: 'subscribe'
        };

        console.log('🔧 Применяем правильные настройки:');
        console.log(`  • API URL: ${correctSettings.apiUrl}`);
        console.log(`  • API ключ: ${correctSettings.apiKey.substring(0, 20)}...`);
        console.log(`  • Включено: ${correctSettings.enabled}`);
        console.log(`  • Макс спонсоров: ${correctSettings.maxSponsors}`);
        console.log(`  • Действие по умолчанию: ${correctSettings.defaultAction}`);

        // 3. Обновляем настройки
        try {
            // Сначала проверяем, есть ли вообще записи в таблице
            const checkSettings = await db.executeQuery('SELECT COUNT(*) as count FROM subgram_settings');
            const hasSettings = parseInt(checkSettings.rows[0].count) > 0;

            if (hasSettings) {
                // Обновляем существующие настройки
                const updated = await db.updateSubGramSettings(correctSettings);
                console.log('✅ Настройки успешно обновлены');
                console.log(`📅 Время обновления: ${updated?.updated_at || new Date().toISOString()}`);
            } else {
                // Создаем новые настройки
                await db.executeQuery(`
                    INSERT INTO subgram_settings (api_key, api_url, enabled, max_sponsors, default_action)
                    VALUES ($1, $2, $3, $4, $5)
                `, [
                    correctSettings.apiKey,
                    correctSettings.apiUrl,
                    correctSettings.enabled,
                    correctSettings.maxSponsors,
                    correctSettings.defaultAction
                ]);
                console.log('✅ Новые настройки успешно созданы');
            }
        } catch (error) {
            console.error('❌ Ошибка обновления настроек:', error.message);
            throw error;
        }
        console.log('');

        // 4. Проверяем обновленные настройки
        console.log('4️⃣ Проверка обновленных настроек...');
        const updatedSettings = await db.getSubGramSettings();
        
        if (updatedSettings) {
            console.log('📋 Обновленные настройки:');
            console.log(`  • Включено: ${updatedSettings.enabled}`);
            console.log(`  • API URL: ${updatedSettings.api_url}`);
            console.log(`  • API ключ: ${updatedSettings.api_key ? updatedSettings.api_key.substring(0, 20) + '...' : 'НЕТ'}`);
            console.log(`  • Макс спонсоров: ${updatedSettings.max_sponsors}`);
            console.log(`  • Действие: ${updatedSettings.default_action}`);
            console.log(`  • Создано: ${updatedSettings.created_at || 'Не указано'}`);
            console.log(`  • Обновлено: ${updatedSettings.updated_at || 'Не указано'}`);
        } else {
            console.error('❌ Не удалось получить обновленные настройки');
        }
        console.log('');

        // 5. Тест API с новыми настройками
        console.log('5️⃣ Тестирование API с новыми настройками...');
        
        const { subgramAPI } = require('./subgram-api');
        
        const testResponse = await subgramAPI.requestSponsors({
            userId: '123456789',
            chatId: '123456789',
            maxOP: updatedSettings.max_sponsors,
            action: updatedSettings.default_action,
            excludeChannelIds: [],
            withToken: true
        });

        if (testResponse.success) {
            console.log('✅ API тест успешен!');
            console.log(`📊 Статус: ${testResponse.data?.status}`);
            console.log(`📈 Код: ${testResponse.data?.code}`);
            console.log(`📺 Ссылок: ${testResponse.data?.links?.length || 0}`);
            
            // Записываем успешный тест в логи
            await db.logSubGramAPIRequest(
                123456789,
                'settings_update_test',
                { settings_update: true },
                testResponse.data,
                true
            );
        } else {
            console.log('❌ API тест неудачен');
            console.log(`🚨 Ошибка: ${testResponse.error}`);
            
            // Записываем ошибку в логи
            await db.logSubGramAPIRequest(
                123456789,
                'settings_update_test',
                { settings_update: true },
                testResponse.details || {},
                false,
                testResponse.error
            );
        }
        console.log('');

        // 6. Очистка старых сессий (опционально)
        console.log('6️⃣ Очистка старых сессий...');
        try {
            const deletedSessions = await db.executeQuery(`
                DELETE FROM subgram_user_sessions 
                WHERE expires_at < NOW() 
                OR last_check_at < NOW() - INTERVAL '2 days'
                RETURNING user_id
            `);
            
            console.log(`🧹 Удалено ${deletedSessions.rows.length} устаревших сессий`);
        } catch (error) {
            console.log('⚠️ Ошибка очистки сессий:', error.message);
        }
        console.log('');

        // 7. Итоги
        console.log('7️⃣ ИТОГИ ОБНОВЛЕНИЯ');
        console.log('==========================================');
        console.log('✅ Настройки SubGram обновлены');
        console.log('✅ API ключ установлен правильный');
        console.log('✅ Настройки оптимизированы для работы с токеном');
        
        if (testResponse.success) {
            console.log('✅ API работает корректно');
            console.log('🎉 Интеграция готова к использованию!');
        } else {
            console.log('⚠️ API тест не прошел - проверьте статус в SubGram');
        }

        console.log('\n🎯 РЕКОМЕНДАЦИИ:');
        console.log('1. Перезапустите бота для применения изменений');
        console.log('2. Протестируйте интеграцию через админ панель');
        console.log('3. Проверьте логи API запросов');
        console.log('4. Убедитесь что бот добавлен в SubGram с токеном');

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
    updateSubGramSettings();
}

module.exports = { updateSubGramSettings };
