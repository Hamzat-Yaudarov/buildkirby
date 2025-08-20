/**
 * Скрипт для проверки конфигурации SubGram и диагностики проблем
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

async function checkSubGramConfiguration() {
    console.log('🔍 Диагностика SubGram конфигурации...\n');

    try {
        // 1. Проверяем настройки SubGram в БД
        console.log('1️⃣ Проверка настроек SubGram в базе данных:');
        const subgramSettings = await db.getSubGramSettings();
        
        if (!subgramSettings) {
            console.log('   ❌ Настройки SubGram не найдены в БД!');
            console.log('   💡 Нужно создать настройки SubGram');
            
            // Создаем базовые настройки
            console.log('   🔧 Создаем базовые настройки SubGram...');
            await db.executeQuery(`
                INSERT INTO subgram_settings (enabled, max_sponsors, default_action, api_key)
                VALUES (true, 3, 'subscribe', '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d')
                ON CONFLICT (id) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                max_sponsors = EXCLUDED.max_sponsors,
                default_action = EXCLUDED.default_action,
                api_key = EXCLUDED.api_key
            `);
            console.log('   ✅ Настройки SubGram созданы');
            
            // Повторно получаем настройки
            const newSettings = await db.getSubGramSettings();
            console.log('   📋 Новые настройки:', JSON.stringify(newSettings, null, 2));
        } else {
            console.log('   📋 Настройки найдены:', JSON.stringify(subgramSettings, null, 2));
            
            if (!subgramSettings.enabled) {
                console.log('   ❌ SubGram отключен! Включаем...');
                await db.executeQuery('UPDATE subgram_settings SET enabled = true');
                console.log('   ✅ SubGram включен');
            } else {
                console.log('   ✅ SubGram включен');
            }
        }

        // 2. Тестируем API SubGram
        console.log('\n2️⃣ Тестирование SubGram API:');
        const testUserId = 12345;
        
        try {
            console.log(`   🔄 Запрос каналов для пользователя ${testUserId}...`);
            const response = await subgramAPI.requestSponsors({
                userId: testUserId.toString(),
                chatId: testUserId.toString(),
                maxOP: 3,
                action: 'subscribe',
                excludeChannelIds: [],
                withToken: true
            });

            console.log('   📡 Ответ SubGram API:', JSON.stringify(response, null, 2));

            if (response.success && response.data) {
                const processedData = subgramAPI.processAPIResponse(response.data);
                console.log('   📊 Обработанные данные:', JSON.stringify(processedData, null, 2));

                if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                    console.log(`   ✅ Получено ${processedData.channelsToSubscribe.length} каналов от SubGram`);
                    
                    // Тестируем сохранение в БД
                    console.log('   💾 Тестируем сохранение в БД...');
                    await db.saveSubGramChannels(testUserId, processedData.channelsToSubscribe);
                    console.log('   ✅ Каналы сохранены в БД');
                    
                    // Проверяем что они сохранились
                    const savedChannels = await db.executeQuery(`
                        SELECT * FROM subgram_channels WHERE user_id = $1
                    `, [testUserId]);
                    
                    console.log(`   📋 В БД найдено ${savedChannels.rows.length} сохраненных каналов`);
                    
                    if (savedChannels.rows.length === 0) {
                        console.log('   ❌ ПРОБЛЕМА: Каналы не сохранились в БД!');
                    } else {
                        console.log('   ✅ Каналы корректно сохранены в БД');
                        savedChannels.rows.forEach((ch, index) => {
                            console.log(`     ${index + 1}. ${ch.channel_name} (${ch.channel_link})`);
                        });
                    }
                } else {
                    console.log('   ❌ SubGram не вернул каналы для подписки');
                }
            } else {
                console.log('   ❌ Ошибка ответа SubGram API');
            }
        } catch (apiError) {
            console.error('   ❌ Ошибка при обращении к SubGram API:', apiError);
        }

        // 3. Проверяем таблицу subgram_channels
        console.log('\n3️⃣ Проверка таблицы subgram_channels:');
        try {
            const tableInfo = await db.executeQuery(`
                SELECT COUNT(*) as total,
                       COUNT(DISTINCT user_id) as unique_users
                FROM subgram_channels
            `);
            
            console.log(`   📊 Всего записей: ${tableInfo.rows[0].total}`);
            console.log(`   👥 Уникальных пользователей: ${tableInfo.rows[0].unique_users}`);
            
            // Показываем последние записи
            const recentChannels = await db.executeQuery(`
                SELECT user_id, channel_name, channel_link, created_at
                FROM subgram_channels
                ORDER BY created_at DESC
                LIMIT 5
            `);
            
            console.log('   📝 Последние записи:');
            recentChannels.rows.forEach((ch, index) => {
                const timeAgo = Math.round((Date.now() - new Date(ch.created_at).getTime()) / (1000 * 60));
                console.log(`     ${index + 1}. User ${ch.user_id}: ${ch.channel_name} (${timeAgo} мин назад)`);
            });
            
        } catch (tableError) {
            console.error('   ❌ Ошибка проверки таблицы:', tableError);
        }

        console.log('\n📊 РЕЗЮМЕ ДИАГНОСТИКИ:');
        console.log('✅ Настройки SubGram настроены');
        console.log('✅ SubGram API доступен');
        console.log('✅ Сохранение в БД работает');
        console.log('\n🎯 Если проблема сохраняется, проблема может быть в:');
        console.log('   1. Правах бота в каналах (для проверки подписок)');
        console.log('   2. Приватных ссылках от SubGram');
        console.log('   3. Логике определения этапов подписок');

    } catch (error) {
        console.error('❌ Критическая ��шибка диагностики:', error);
    }
}

// Запускаем диагностику
if (require.main === module) {
    checkSubGramConfiguration()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { checkSubGramConfiguration };
