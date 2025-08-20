/**
 * Исправление проблемы SubGram: "Данного пользователя нет в Вашем боте"
 * Проблема: API ключ неправильный или бот не добавлен в SubGram
 */

const db = require('./database');
const axios = require('axios');

async function fixSubGramAPIKeyProblem() {
    console.log('🔧 ИСПРАВЛЕНИЕ ПРОБЛЕМЫ SUBGRAM API КЛЮЧА\n');
    console.log('❌ Ошибка: "Данного пользователя нет в Вашем боте"\n');

    try {
        await db.initializeDatabase();

        // 1. Проверяем текущий API ключ
        console.log('1️⃣ Проверка текущего API ключа...');
        const settings = await db.getSubGramSettings();
        
        if (!settings) {
            console.log('❌ Настройки SubGram не найдены!');
            return;
        }

        console.log('📋 Текущие настройки:');
        console.log(`  • API ключ: ${settings.api_key ? settings.api_key.substring(0, 20) + '...' : 'НЕТ'}`);
        console.log(`  • API URL: ${settings.api_url}`);
        console.log(`  • Включено: ${settings.enabled}`);
        console.log('');

        // 2. Тестируем API ключ с разными пользователями
        console.log('2️⃣ Тестирование API ключа с разными пользователями...');
        
        const testUsers = [
            { id: '7972065986', name: 'Админ' },
            { id: '7961237966', name: 'Проблемный пользователь' },
            { id: '123456789', name: 'Тестовый пользователь' },
            { id: '1', name: 'Минимальный ID' }
        ];

        let workingUsers = [];
        let errorMessages = new Set();

        for (const testUser of testUsers) {
            console.log(`\n🧪 Тест с пользователем ${testUser.name} (ID: ${testUser.id})...`);
            
            try {
                const response = await axios.post(settings.api_url, {
                    UserId: testUser.id,
                    ChatId: testUser.id,
                    MaxOP: 1,
                    action: "subscribe",
                    exclude_channel_ids: []
                }, {
                    headers: {
                        'Auth': settings.api_key,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                console.log(`✅ Успех! Статус: ${response.data.status}, Код: ${response.data.code}`);
                workingUsers.push(testUser);
                
                if (response.data.links && response.data.links.length > 0) {
                    console.log(`🎉 Найдены каналы: ${response.data.links.length}`);
                }

            } catch (error) {
                if (error.response && error.response.data) {
                    const errorData = error.response.data;
                    console.log(`❌ Ошибка: ${errorData.message || 'Неизвестная ошибка'}`);
                    errorMessages.add(errorData.message || 'Неизвестная ошибка');
                } else {
                    console.log(`❌ Сетевая ошибка: ${error.message}`);
                }
            }
        }

        // 3. Анализируем результаты
        console.log('\n3️⃣ Анализ результатов...');
        console.log(`✅ Успешных тестов: ${workingUsers.length}/${testUsers.length}`);
        
        if (workingUsers.length === 0) {
            console.log('\n🚨 КРИТИЧЕСКАЯ ПРОБЛЕМА: API ключ полностью не работает!');
            console.log('\n📋 Уникальные ошибки:');
            errorMessages.forEach((msg, index) => {
                console.log(`  ${index + 1}. ${msg}`);
            });
            
            // Диагностика типов ошибок
            const errorArray = Array.from(errorMessages);
            
            if (errorArray.some(msg => msg.includes('нет в Вашем боте'))) {
                console.log('\n🎯 ДИАГНОЗ: API ключ от другого бота или бот не добавлен в SubGram');
                console.log('\n🔧 РЕШЕНИЯ:');
                console.log('1. Зайдите на https://subgram.ru');
                console.log('2. Проверьте, что ваш бот добавлен в список ботов');
                console.log('3. Скопируйте API ключ именно от вашего бота');
                console.log('4. Убедитесь, что бот добавлен "С ТОКЕНОМ"');
            }
            
            if (errorArray.some(msg => msg.includes('API Key'))) {
                console.log('\n🎯 ДИАГНОЗ: Неправильный API ключ');
                console.log('\n🔧 РЕШЕНИЯ:');
                console.log('1. Получите новый API ключ в SubGram панели');
                console.log('2. Обновите ключ в настройках бота');
            }
            
            if (errorArray.some(msg => msg.includes('авторизац'))) {
                console.log('\n🎯 ДИАГНОЗ: Проблемы с авторизацией');
                console.log('\n🔧 РЕШЕНИЯ:');
                console.log('1. Проверьте права бота в SubGram');
                console.log('2. Перезапустите бота в SubGram панели');
            }
            
        } else if (workingUsers.length < testUsers.length) {
            console.log('\n⚠️ ЧАСТИЧНАЯ ПРОБЛЕМА: API работает не для всех пользователей');
            console.log('\n✅ Работает для пользователей:');
            workingUsers.forEach(user => console.log(`  • ${user.name} (${user.id})`));
            
        } else {
            console.log('\n✅ API ключ работает корректно для всех тестовых пользователей!');
            console.log('⚠️ Проблема может быть в конкретных пользователях или настройках бота');
        }

        // 4. Проверяем информацию о боте
        console.log('\n4️⃣ Проверка информации о боте в SubGram...');
        try {
            // Пытаемся получить информацию о боте
            const botInfoResponse = await axios.get('https://api.subgram.ru/bot-info/', {
                headers: {
                    'Auth': settings.api_key,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            console.log('✅ Информация о боте получена:');
            console.log(JSON.stringify(botInfoResponse.data, null, 2));

        } catch (botInfoError) {
            console.log('⚠️ Не удалось получить информацию о боте');
            if (botInfoError.response && botInfoError.response.data) {
                console.log(`❌ Ошибка: ${JSON.stringify(botInfoError.response.data, null, 2)}`);
            }
        }

        // 5. Предлагаем решения
        console.log('\n5️⃣ РЕКОМЕНДУЕМЫЕ ДЕЙСТВИЯ:');
        console.log('========================================');
        
        if (workingUsers.length === 0) {
            console.log('🚨 СРОЧНО - API ключ не работает:');
            console.log('');
            console.log('1. 🌐 Зайдите на https://subgram.ru');
            console.log('2. 🔑 Войдите в админ панель');
            console.log('3. 🤖 Найдите ваш бот в списке или добавьте его');
            console.log('4. 📋 Скопируйте API ключ ИМЕННО от вашего бота');
            console.log('5. 🔧 Обновите к��юч командой ниже');
            console.log('');
            console.log('💡 ВАЖНО: Убедитесь что:');
            console.log('  • Бот добавлен в SubGram');
            console.log('  • Бот добавлен "С ТОКЕНОМ"');
            console.log('  • API ключ скопирован полностью');
            console.log('  • Бот активен в SubGram панели');
            
        } else {
            console.log('✅ API ключ частично работает');
            console.log('⚠️ Возможно проблема в конкретных пользователях');
            console.log('');
            console.log('1. Проверьте права бота в SubGram');
            console.log('2. Убедитесь что пользователи могут получать каналы');
            console.log('3. Проверьте лимиты в SubGram панели');
        }

        // 6. Команды для обновления API ключа
        console.log('\n6️⃣ КОМАНДЫ ДЛЯ ОБНОВЛЕНИЯ:');
        console.log('========================================');
        console.log('');
        console.log('Если у вас есть новый API ключ, выполните SQL:');
        console.log('```sql');
        console.log(`UPDATE subgram_settings SET api_key = 'ВАШ_НОВЫЙ_API_КЛЮЧ';`);
        console.log('```');
        console.log('');
        console.log('Или временно отключите SubGram:');
        console.log('```sql');
        console.log('UPDATE subgram_settings SET enabled = false;');
        console.log('```');
        console.log('');
        console.log('Админ команды:');
        console.log('• /admin_subgram_disable - отключить SubGram');
        console.log('• /admin_subgram_test - повторить тест');
        console.log('• /fix_subgram_sponsors - полная диагностика');

        // 7. Обновляем статистику
        console.log('\n7️⃣ Обновление статистики...');
        
        // Записываем результат диагностики
        await db.logSubGramAPIRequest(
            7972065986, // админ
            'api_key_diagnostic',
            { diagnostic: true, testUsers: testUsers.length },
            { workingUsers: workingUsers.length, totalErrors: errorMessages.size },
            workingUsers.length > 0,
            workingUsers.length === 0 ? 'API key completely broken' : null
        );

        console.log('✅ Диагностика завершена');
        console.log('');
        console.log('📞 Если проблема не решается:');
        console.log('• Обратитесь в поддержку SubGram');
        console.log('• Укажите ваш API ключ и описание проблемы');
        console.log('• Приложите логи ошибок');

    } catch (error) {
        console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА ДИАГНОСТИКИ:', error.message);
        console.error('📍 Стек:', error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Подключение к БД закрыто');
    }
}

// Запуск если файл вызван напрямую
if (require.main === module) {
    fixSubGramAPIKeyProblem();
}

module.exports = { fixSubGramAPIKeyProblem };
