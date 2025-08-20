/**
 * С��рипт для диагностики и исправления проблемы с получением спонсорских каналов от SubGram
 * Проблема: API возвращает linkedCount: 0 - нет доступных спонсорских каналов
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');
const axios = require('axios');

async function fixSubGramSponsorChannels() {
    console.log('🔧 ИСПРАВЛЕНИЕ ПРОБЛЕМЫ С SUBGRAM СПОНСОРСКИМИ КАНАЛАМИ\n');

    try {
        // 1. Инициализация БД
        await db.initializeDatabase();
        console.log('✅ База данных готова\n');

        // 2. Проверяем текущие настройки
        console.log('1️⃣ Проверка настроек SubGram...');
        let settings = await db.getSubGramSettings();
        
        if (!settings) {
            console.log('❌ Настройки SubGram не найдены! Создаем...');
            await db.executeQuery(`
                INSERT INTO subgram_settings (api_key, api_url, enabled, max_sponsors, default_action)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO UPDATE SET
                    api_key = EXCLUDED.api_key,
                    enabled = EXCLUDED.enabled,
                    max_sponsors = EXCLUDED.max_sponsors,
                    default_action = EXCLUDED.default_action
            `, [
                '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d',
                'https://api.subgram.ru/request-op/',
                true,
                5,
                'subscribe'
            ]);
            
            settings = await db.getSubGramSettings();
            console.log('✅ Настройки созданы');
        } else {
            console.log('📋 Текущие настройки:', {
                enabled: settings.enabled,
                max_sponsors: settings.max_sponsors,
                hasApiKey: !!settings.api_key
            });
        }

        if (!settings.enabled) {
            console.log('⚠️ SubGram отключен, включаем...');
            await db.executeQuery('UPDATE subgram_settings SET enabled = true');
            console.log('✅ SubGram включен');
        }

        // 3. Тестируем разные варианты запроса
        console.log('\n2️⃣ Тестирование различных параметров запроса...');
        
        const testParams = [
            {
                name: 'Базовый запрос',
                params: {
                    UserId: "7961237966",
                    ChatId: "7961237966", 
                    MaxOP: 5,
                    action: "subscribe",
                    exclude_channel_ids: []
                }
            },
            {
                name: 'С минимальным MaxOP',
                params: {
                    UserId: "7961237966",
                    ChatId: "7961237966",
                    MaxOP: 1,
                    action: "subscribe",
                    exclude_channel_ids: []
                }
            },
            {
                name: 'С действием newtask',
                params: {
                    UserId: "7961237966",
                    ChatId: "7961237966",
                    MaxOP: 3,
                    action: "newtask",
                    exclude_channel_ids: []
                }
            },
            {
                name: 'С дополнительными полями',
                params: {
                    UserId: "7961237966",
                    ChatId: "7961237966",
                    MaxOP: 3,
                    action: "subscribe",
                    exclude_channel_ids: [],
                    first_name: "Test",
                    language_code: "ru"
                }
            }
        ];

        for (const test of testParams) {
            console.log(`\n🧪 Тест: ${test.name}`);
            try {
                const response = await axios.post(settings.api_url, test.params, {
                    headers: {
                        'Auth': settings.api_key,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                console.log(`✅ Статус: ${response.data.status}, Код: ${response.data.code}`);
                console.log(`📊 Результат:`, {
                    status: response.data.status,
                    code: response.data.code,
                    message: response.data.message,
                    linksCount: response.data.links?.length || 0,
                    linkedCount: response.data.linkedCount || 0
                });

                if (response.data.links && response.data.links.length > 0) {
                    console.log(`🎉 НАЙДЕНЫ КАНАЛЫ! Количество: ${response.data.links.length}`);
                    response.data.links.slice(0, 3).forEach((link, i) => {
                        console.log(`  ${i+1}. ${link}`);
                    });
                    break; // Найден работающий запрос
                }

                // Логируем в БД
                await db.logSubGramAPIRequest(
                    7961237966,
                    `test_${test.name.toLowerCase().replace(/\s+/g, '_')}`,
                    test.params,
                    response.data,
                    true
                );

            } catch (error) {
                console.log(`❌ Ошибка: ${error.message}`);
                if (error.response?.data) {
                    console.log(`📝 Ответ сервера:`, error.response.data);
                }

                // Логируем ошибку
                await db.logSubGramAPIRequest(
                    7961237966,
                    `test_${test.name.toLowerCase().replace(/\s+/g, '_')}`,
                    test.params,
                    error.response?.data || {},
                    false,
                    error.message
                );
            }
        }

        // 4. Проверяем статус бота в SubGram
        console.log('\n3️⃣ Диагностика проблем с API...');
        
        // Проверяем имеет ли бот права на получение каналов
        try {
            const statusResponse = await axios.get('https://api.subgram.ru/bot-status/', {
                headers: {
                    'Auth': settings.api_key,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            console.log('🤖 Статус бота в SubGram:', statusResponse.data);
        } catch (statusError) {
            console.log('⚠️ Не удалось проверить статус бота:', statusError.message);
        }

        // 5. Проверяем настройки в админ панели SubGram
        console.log('\n4️⃣ Возможные причины отсутствия каналов...');
        console.log('🔍 ОСНОВНЫЕ ПРИЧИНЫ ПРОБЛЕМЫ:');
        console.log('');
        console.log('1. 🤖 БОТ НЕ ДОБАВЛЕН В SUBGRAM С ТОКЕНОМ');
        console.log('   - Перейдите на https://subgram.ru');
        console.log('   - Войдите в админ панель');
        console.log('   - Убедитесь что бот добавлен и активен');
        console.log('   - ВАЖНО: Бот должен быть добавлен "С ТОКЕНОМ"');
        console.log('');
        console.log('2. 🚫 НЕТ РАЗРЕШЕНИЙ НА ПОЛУЧЕНИЕ КАНАЛОВ');
        console.log('   - Проверьте ��рава бота в SubGram');
        console.log('   - Убедитесь что "получение спонсорских каналов" включено');
        console.log('');
        console.log('3. 📭 НЕТ ДОСТУПНЫХ СПОНСОРСКИХ КАНАЛОВ');
        console.log('   - В данный момент может не быть активных спонсоров');
        console.log('   - Попробуйте позже или обратитесь в поддержку SubGram');
        console.log('');
        console.log('4. 🔧 НЕПРАВИЛЬНАЯ КОНФИГУРАЦИЯ API');
        console.log('   - Проверьте API ключ в SubGram панели');
        console.log('   - Убедитесь что URL API актуальный');

        // 6. Предлагаем решения
        console.log('\n5️⃣ РЕШЕНИЯ:');
        console.log('');
        console.log('A. 🔄 БЫСТРОЕ ИСПРАВЛЕНИЕ:');
        console.log('   1. Зайдите на https://subgram.ru');
        console.log('   2. Проверьте что ваш бот добавлен и активен');
        console.log('   3. Убедитесь что бот добавлен "С ТОКЕНОМ"');
        console.log('   4. Проверьте что получение кана��ов разрешено');
        console.log('');
        console.log('B. 🛠️ АЛЬТЕРНАТИВНОЕ РЕШЕНИЕ:');
        console.log('   1. Используйте только обязательные каналы');
        console.log('   2. Добавьте больше обязательных каналов в админ панели');
        console.log('   3. Отключите SubGram временно если проблема критична');
        console.log('');
        console.log('C. 🔧 ТЕХНИЧЕСКОЕ ИСПРАВЛЕНИЕ:');
        console.log('   1. Обновите API ключ в настройках');
        console.log('   2. Проверьте права бота в SubGram панели');
        console.log('   3. Свяжитесь с поддержкой SubGram');

        // 7. Предлагаем временное отключение SubGram
        console.log('\n6️⃣ ВРЕМЕННОЕ ОТКЛЮЧЕНИЕ SUBGRAM:');
        console.log('');
        console.log('Если проблема критична, можно временно отключить SubGram:');
        console.log('```sql');
        console.log('UPDATE subgram_settings SET enabled = false;');
        console.log('```');
        console.log('');
        console.log('Это заставит бота работать только с обязательными каналами.');

        // 8. Проверяем есть ли обязательные каналы
        console.log('\n7️⃣ Проверка обязательных каналов...');
        const requiredChannels = await db.executeQuery(
            'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE'
        );
        
        console.log(`📋 Найдено ${requiredChannels.rows.length} обязательных каналов:`);
        requiredChannels.rows.forEach((ch, i) => {
            console.log(`  ${i+1}. ${ch.channel_name || ch.channel_id} (${ch.channel_id})`);
        });

        if (requiredChannels.rows.length === 0) {
            console.log('⚠️ ВНИМАНИЕ: Нет обязательных каналов!');
            console.log('📝 Добавьте хотя бы один обязательный канал:');
            console.log('```sql');
            console.log(`INSERT INTO required_channels (channel_id, channel_name, is_active) VALUES ('@your_channel', 'Ваш канал', true);`);
            console.log('```');
        } else {
            console.log('✅ Обязательные каналы настроены - бот будет работать');
        }

        console.log('\n📊 РЕЗЮМЕ:');
        console.log('==========================================');
        console.log('✅ Настройки SubGram проверены и исправлены');
        console.log('✅ API протестирован с разными параметрами');
        console.log('✅ Диагностика завершена');
        console.log('');
        console.log('🎯 СЛЕДУЮЩИЙ ШАГ: Проверьте настройки бота в SubGram админ панели');
        console.log('🌐 Ссылка: https://subgram.ru');

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
    fixSubGramSponsorChannels();
}

module.exports = { fixSubGramSponsorChannels };
