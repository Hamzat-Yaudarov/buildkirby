const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database');
const config = require('./config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });

// Функция для отправки напоминаний конкретным пользователям по их ID
async function sendReminderToUserIds(userIds) {
    try {
        console.log('🚀 Отправка напоминаний конкретным пользователям из логов Railway...\n');

        await Database.init();

        // Проверяем входные данные
        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            console.log('❌ Не предоставлен список ID пользователей');
            return;
        }

        console.log(`📋 Получен список из ${userIds.length} пользователей для отправки напоминаний`);

        // Сообщение для отправки
        const reminderMessage = 'Напоминание о рейтинге';

        // Проверяем каких пользователей есть в базе данных
        console.log('\n🔍 Проверка пользователей в базе данных...');
        
        const usersInDb = await Database.pool.query(`
            SELECT user_id, first_name, username, captcha_passed, referral_completed, created_at
            FROM users 
            WHERE user_id = ANY($1)
            ORDER BY created_at DESC
        `, [userIds]);

        const foundUserIds = usersInDb.rows.map(user => user.user_id);
        const notFoundUserIds = userIds.filter(id => !foundUserIds.includes(parseInt(id)));

        console.log(`✅ Найдено в БД: ${foundUserIds.length} пользователей`);
        console.log(`❌ НЕ найдено в БД: ${notFoundUserIds.length} пользователей`);

        if (notFoundUserIds.length > 0) {
            console.log('\n👻 ПОЛЬЗОВАТЕЛИ НЕ НАЙДЕННЫЕ В БД:');
            notFoundUserIds.forEach((userId, index) => {
                console.log(`   ${index + 1}. ID: ${userId} - ⚠️ НЕ СОХРАНИЛСЯ В БД`);
            });
        }

        if (usersInDb.rows.length > 0) {
            console.log('\n👤 ПОЛЬЗОВАТЕЛИ НАЙДЕННЫЕ В БД:');
            usersInDb.rows.forEach((user, index) => {
                const date = new Date(user.created_at).toLocaleDateString('ru-RU');
                const captcha = user.captcha_passed ? '✅' : '❌';
                const activated = user.referral_completed ? '✅' : '❌';
                console.log(`   ${index + 1}. ${user.first_name || 'Без имени'} (${user.user_id}) - ${date}`);
                console.log(`      🤖 Капча: ${captcha} | 👥 Активирован: ${activated}`);
            });
        }

        // Отправляем сообщения ВСЕМ пользователям из списка (даже тем, кто не найден в БД)
        console.log(`\n📨 Начинаем отправку сообщения: "${reminderMessage}"`);
        console.log(`📤 Будем отправлять всем ${userIds.length} пользователям (включая не найденных в БД)\n`);

        let successCount = 0;
        let errorCount = 0;
        let blockedCount = 0;
        let notFoundCount = 0;

        for (let i = 0; i < userIds.length; i++) {
            const userId = parseInt(userIds[i]);
            const progress = `[${i + 1}/${userIds.length}]`;
            const userInDb = usersInDb.rows.find(u => u.user_id === userId);
            const userName = userInDb ? userInDb.first_name || 'Без имени' : 'НЕ В БД';
            
            try {
                await bot.sendMessage(userId, reminderMessage);
                
                const dbStatus = userInDb ? '(в БД)' : '(НЕ В БД)';
                console.log(`${progress} ✅ Отправлено пользователю ${userId} (${userName}) ${dbStatus}`);
                successCount++;

                // Задержка 100ms между сообщениями для избежания rate limit
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                if (error.response && error.response.body) {
                    const errorCode = error.response.body.error_code;
                    const description = error.response.body.description;

                    if (errorCode === 403) {
                        console.log(`${progress} 🚫 Пользователь ${userId} заблокировал бота`);
                        blockedCount++;
                    } else if (errorCode === 400 && description.includes('chat not found')) {
                        console.log(`${progress} ❌ Чат с пользователем ${userId} не найден`);
                        notFoundCount++;
                    } else {
                        console.log(`${progress} ❌ Ошибка отправки пользователю ${userId}: ${description}`);
                        errorCount++;
                    }
                } else {
                    console.log(`${progress} ❌ Неизвестная ошибка для пользователя ${userId}:`, error.message);
                    errorCount++;
                }
            }
        }

        console.log('\n📊 ИТОГИ ОТПРАВКИ:');
        console.log(`✅ Успешно отправлено: ${successCount}`);
        console.log(`🚫 Заблокировали бота: ${blockedCount}`);
        console.log(`❌ Чат не найден: ${notFoundCount}`);
        console.log(`❌ Другие ошибки: ${errorCount}`);
        console.log(`📋 Всего обработано: ${successCount + blockedCount + notFoundCount + errorCount}`);

        // Анализ результатов
        console.log('\n📈 АНАЛИЗ РЕЗУЛЬТАТОВ:');
        
        if (notFoundUserIds.length > 0) {
            console.log(`👻 Пользователи НЕ СОХРАНЕННЫЕ в БД: ${notFoundUserIds.length}`);
            console.log('   ↳ Это подтверждает проблему потери пользователей из логов Railway');
        }

        if (foundUserIds.length > 0) {
            console.log(`💾 Пользователи НАЙДЕННЫЕ в БД: ${foundUserIds.length}`);
            
            const captchaFailed = usersInDb.rows.filter(u => !u.captcha_passed).length;
            const notActivated = usersInDb.rows.filter(u => !u.referral_completed).length;
            
            if (captchaFailed > 0) {
                console.log(`   🤖 НЕ прошли капчу: ${captchaFailed}`);
            }
            if (notActivated > 0) {
                console.log(`   📢 НЕ активированы (проблемы с подпиской): ${notActivated}`);
            }
        }

        return {
            totalProcessed: userIds.length,
            successCount,
            blockedCount,
            notFoundCount,
            errorCount,
            foundInDb: foundUserIds.length,
            notFoundInDb: notFoundUserIds.length
        };

    } catch (error) {
        console.error('❌ Ошибка выполнения скрипта:', error);
        throw error;
    }
}

// Пример использования с конкретными ID из логов
async function exampleUsage() {
    try {
        // ЗАМЕНИТЕ ЭТОТ СПИСОК на реальные ID из ваших логов Railway
        const userIdsFromLogs = [
            123456789,   // Пример ID пользователя
            987654321,   // Пример ID пользователя
            // Добавьте сюда реальные ID из логов Railway
        ];

        await sendReminderToUserIds(userIdsFromLogs);

    } catch (error) {
        console.error('❌ Ошибка примера использования:', error);
    } finally {
        await Database.pool.end();
        process.exit(0);
    }
}

// Функция для чтения ID из файла (если есть файл с ID)
async function sendReminderFromFile(filePath) {
    try {
        const fs = require('fs');
        
        if (!fs.existsSync(filePath)) {
            console.log(`❌ Файл ${filePath} не найден`);
            return;
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        // Парси�� ID из файла (предполагаем что каждый ID на новой строке)
        const userIds = fileContent
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !isNaN(line))
            .map(line => parseInt(line));

        console.log(`📁 Прочитано ${userIds.length} ID пользователей из файла ${filePath}`);

        if (userIds.length === 0) {
            console.log('❌ В файле не найдено валидных ID пользователей');
            return;
        }

        await sendReminderToUserIds(userIds);

    } catch (error) {
        console.error('❌ Ошибка чтения файла:', error);
        throw error;
    }
}

// Запуск скрипта
if (require.main === module) {
    console.log('🚀 СКРИПТ ОТПРАВКИ НАПОМИНАНИЙ ПО КОНКРЕТНЫМ ID\n');
    
    // Получаем аргументы командной строки
    const args = process.argv.slice(2);
    
    if (args.length > 0 && args[0].endsWith('.txt')) {
        // Если передан файл с ID
        console.log(`📁 Режим чтения из файла: ${args[0]}`);
        sendReminderFromFile(args[0]).then(() => {
            Database.pool.end();
            process.exit(0);
        });
    } else if (args.length > 0) {
        // Если переданы ID как аргументы
        const userIds = args.map(id => parseInt(id)).filter(id => !isNaN(id));
        console.log(`📋 Режим аргументов командной строки: ${userIds.length} ID`);
        sendReminderToUserIds(userIds).then(() => {
            Database.pool.end();
            process.exit(0);
        });
    } else {
        // Запуск примера (нужно отредактировать ID в коде)
        console.log('⚠️ Запуск в режиме примера. Отредактируйте userIdsFromLogs в коде!');
        exampleUsage();
    }
}

module.exports = { sendReminderToUserIds, sendReminderFromFile };
