const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database');
const config = require('./config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });

// Функция для получения информации о пользователе через Telegram API
async function getUserInfo(userId) {
    try {
        // Пытаемся получить информацию о пользователе через getChat
        const chat = await bot.getChat(userId);
        
        return {
            userId: userId,
            username: chat.username || '',
            firstName: chat.first_name || '',
            lastName: chat.last_name || '',
            languageCode: chat.language_code || 'ru',
            isPremium: chat.is_premium || false
        };
    } catch (error) {
        // Если не удалось получить через getChat, возвращаем базовую информацию
        console.log(`⚠️ Не удалось получить информацию о пользователе ${userId} через Telegram API`);
        return {
            userId: userId,
            username: '',
            firstName: `User_${userId}`,
            lastName: '',
            languageCode: 'ru',
            isPremium: false
        };
    }
}

// Функция для создания пользователя в БД при отправке сообщения
async function ensureUserInDatabase(userId) {
    try {
        // Проверяем, есть ли пользователь в БД
        let user = await Database.getUser(userId);
        
        if (user) {
            console.log(`👤 Пользователь ${userId} уже есть в БД`);
            return user;
        }
        
        console.log(`💾 Пользователь ${userId} Не найден в БД, создаем...`);
        
        // Получаем информацию о пользователе
        const userInfo = await getUserInfo(userId);
        
        // Создаем пользователя в БД
        user = await Database.createUser({
            userId: userInfo.userId,
            username: userInfo.username,
            firstName: userInfo.firstName,
            languageCode: userInfo.languageCode,
            isPremium: userInfo.isPremium,
            referrerId: null // При отправке напоминания реферер неизвестен
        });
        
        console.log(`✅ Пользователь ${userId} (${userInfo.firstName}) сохранен в БД`);
        
        // Помечаем что капча НЕ пройдена (поскольку мы отправляем напоминание)
        await Database.setCaptchaPassed(userId, false);
        
        return user;
        
    } catch (error) {
        console.error(`❌ Ошибка создания пользователя ${userId} в БД:`, error.message);
        return null;
    }
}

// Улучшенная функция отправки напоминаний с сохранением в БД
async function sendReminderWithDbSave(userIds) {
    try {
        console.log('🚀 ОТПРАВКА НАПОМИНАНИЙ С АВТОСОХРАНЕНИЕМ В БД\n');

        await Database.init();

        if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
            console.log('❌ Не предоставлен список ID пользователей');
            return;
        }

        console.log(`📋 Обработка ${userIds.length} пользователей`);

        const reminderMessage = 'Напоминание о рейтинге';

        let successCount = 0;
        let errorCount = 0;
        let blockedCount = 0;
        let notFoundCount = 0;
        let savedToDbCount = 0;
        let alreadyInDbCount = 0;

        console.log(`\n📨 Начинаем отправку с автосохранением в БД...\n`);

        for (let i = 0; i < userIds.length; i++) {
            const userId = parseInt(userIds[i]);
            const progress = `[${i + 1}/${userIds.length}]`;
            
            try {
                // ШАГИ:
                // 1. Проверяем/создаем пользователя в БД ПЕРЕД отправкой
                console.log(`${progress} 🔍 Проверяем пользователя ${userId} в БД...`);
                
                const existingUser = await Database.getUser(userId);
                let userName = '';
                
                if (existingUser) {
                    alreadyInDbCount++;
                    userName = existingUser.first_name || 'Без имени';
                    console.log(`${progress} ✅ Пользователь ${userId} (${userName}) уже в БД`);
                } else {
                    // Создаем пользователя в БД
                    const newUser = await ensureUserInDatabase(userId);
                    if (newUser) {
                        savedToDbCount++;
                        userName = newUser.first_name || 'Без имени';
                        console.log(`${progress} 💾 Пользователь ${userId} (${userName}) сохранен в БД`);
                    } else {
                        userName = `User_${userId}`;
                        console.log(`${progress} ⚠️ Не удалось сохранить пользователя ${userId} в БД`);
                    }
                }

                // 2. Отправляем сообщение
                console.log(`${progress} 📤 Отправляем сообщение пользователю ${userId}...`);
                await bot.sendMessage(userId, reminderMessage);
                
                console.log(`${progress} ✅ Сообщение отправлено пользователю ${userId} (${userName})`);
                successCount++;

                // 3. Задержка между сообщениями
                await new Promise(resolve => setTimeout(resolve, 150)); // 150ms задержка

            } catch (error) {
                if (error.response && error.response.body) {
                    const errorCode = error.response.body.error_code;
                    const description = error.response.body.description;

                    if (errorCode === 403) {
                        console.log(`${progress} 🚫 Пользователь ${userId} заблокировал бота`);
                        blockedCount++;
                        
                        // Все равно пытаемся сохранить в БД
                        const existingUser = await Database.getUser(userId);
                        if (!existingUser) {
                            await ensureUserInDatabase(userId);
                            savedToDbCount++;
                        }
                        
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

        console.log('\n📊 ИТОГИ ОТПРАВКИ С СОХРАНЕНИЕМ В БД:');
        console.log(`✅ Успешно отправлено: ${successCount}`);
        console.log(`🚫 Заблокировали бота: ${blockedCount}`);
        console.log(`❌ Чат не найден: ${notFoundCount}`);
        console.log(`❌ Другие ошибки: ${errorCount}`);
        console.log(`📋 Всего обработано: ${successCount + blockedCount + notFoundCount + errorCount}`);
        
        console.log('\n💾 СТАТИСТИКА ПО БАЗЕ ДАННЫХ:');
        console.log(`👤 Уже были в БД: ${alreadyInDbCount}`);
        console.log(`💾 Новых сохранено в БД: ${savedToDbCount}`);
        console.log(`📊 Всего в БД после операции: ${alreadyInDbCount + savedToDbCount}`);

        // Проверяем результат сохранения
        const totalInDb = await Database.pool.query('SELECT COUNT(*) as count FROM users WHERE user_id = ANY($1)', [userIds]);
        const finalCount = parseInt(totalInDb.rows[0].count);
        
        console.log(`\n🎯 РЕЗУЛЬТАТ:`);
        console.log(`📥 Из ${userIds.length} пользователей в БД сохранено: ${finalCount}`);
        console.log(`📈 Процент сохранения: ${((finalCount / userIds.length) * 100).toFixed(1)}%`);

        if (finalCount === userIds.length) {
            console.log(`🎉 ВСЕ ПОЛЬЗОВАТЕЛИ УСПЕШНО СОХРАНЕНЫ В БД!`);
        } else {
            console.log(`⚠️ ${userIds.length - finalCount} пользователей НЕ удалось сохранить в БД`);
        }

        return {
            totalProcessed: userIds.length,
            successCount,
            blockedCount,
            notFoundCount,
            errorCount,
            alreadyInDb: alreadyInDbCount,
            savedToDb: savedToDbCount,
            finalDbCount: finalCount
        };

    } catch (error) {
        console.error('❌ Ошибка выполнения скрипта с сохранением в БД:', error);
        throw error;
    }
}

// Функция для отправки напоминаний с автоматическим поиском проблемных пользователей
async function sendRemindersToFailedUsersWithSave() {
    try {
        console.log('🔍 ПОИСК И ОТПРАВКА НАПОМИНАНИЙ С СОХРАНЕНИЕМ В БД\n');

        await Database.init();

        // Находим пользователей с проблемами
        const captchaFailedUsers = await Database.pool.query(`
            SELECT user_id FROM users 
            WHERE captcha_passed = FALSE OR captcha_passed IS NULL
            ORDER BY created_at DESC
        `);

        const subscriptionFailedUsers = await Database.pool.query(`
            SELECT user_id FROM users 
            WHERE captcha_passed = TRUE 
            AND referral_completed = FALSE
            AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
            ORDER BY created_at DESC
        `);

        // Объединяем списки без дублирования
        const allFailedUserIds = new Set();
        
        captchaFailedUsers.rows.forEach(row => allFailedUserIds.add(row.user_id));
        subscriptionFailedUsers.rows.forEach(row => allFailedUserIds.add(row.user_id));

        const userIds = Array.from(allFailedUserIds);
        
        console.log(`📊 Найдено пользователей с проблемами: ${userIds.length}`);
        console.log(`   🤖 НЕ прошли капчу: ${captchaFailedUsers.rows.length}`);
        console.log(`   📢 Проблемы с подпиской: ${subscriptionFailedUsers.rows.length}`);

        if (userIds.length === 0) {
            console.log('✅ Нет пользователей для отправки напоминаний');
            return;
        }

        // ��тправляем напоминания с сохранением в БД
        return await sendReminderWithDbSave(userIds);

    } catch (error) {
        console.error('❌ Ошибка поиска и отправки напоминаний:', error);
        throw error;
    }
}

// Основная функция для запуска
async function main() {
    try {
        const args = process.argv.slice(2);
        
        console.log('🌟 ===== НАПОМИНАНИЯ С АВТОСОХРАНЕНИЕМ В БД =====\n');
        console.log('📅 Время запуска:', new Date().toLocaleString('ru-RU'));
        
        if (args.length === 0) {
            // Автоматический поиск проблемных пол��зователей
            console.log('🔍 Режим: Автоматический поиск проблемных пользователей');
            await sendRemindersToFailedUsersWithSave();
            
        } else if (args.length === 1 && args[0].endsWith('.txt')) {
            // Чтение из файла
            const fs = require('fs');
            const filePath = args[0];
            
            if (!fs.existsSync(filePath)) {
                console.log(`❌ Файл ${filePath} не найден`);
                process.exit(1);
            }

            const fileContent = fs.readFileSync(filePath, 'utf8');
            const userIds = fileContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !isNaN(line))
                .map(line => parseInt(line));

            console.log(`📁 Режим: Чтение из файла ${filePath}`);
            console.log(`📊 Загружено ID: ${userIds.length}`);
            
            await sendReminderWithDbSave(userIds);
            
        } else {
            // ID из аргументов
            const userIds = args.map(id => parseInt(id)).filter(id => !isNaN(id));
            
            console.log('👤 Режим: Конкретные ID из аргументов');
            console.log(`📊 Количество ID: ${userIds.length}`);
            
            await sendReminderWithDbSave(userIds);
        }

        console.log('\n🎉 ===== ОПЕРАЦИЯ ЗАВЕРШЕНА УСПЕШНО =====');

    } catch (error) {
        console.error('\n❌ ===== КРИТИЧЕСКАЯ ОШИБКА =====');
        console.error('Время ошибки:', new Date().toLocaleString('ru-RU'));
        console.error('Детали:', error);
        process.exit(1);
    } finally {
        await Database.pool.end();
        process.exit(0);
    }
}

// Запуск
if (require.main === module) {
    main();
}

module.exports = {
    sendReminderWithDbSave,
    ensureUserInDatabase,
    sendRemindersToFailedUsersWithSave
};
