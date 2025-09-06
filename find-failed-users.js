const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database');
const config = require('./config');

const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });

async function findAndMessageFailedUsers() {
    try {
        console.log('🔍 Поиск пользователей, которые не прошли капчу или не подписались на спонсоров...\n');

        await Database.init();

        // 1. Найти пользователей, которые НЕ прошли капчу
        console.log('🤖 Поиск пользователей с непройденной капчей...');
        const captchaFailedUsers = await Database.pool.query(`
            SELECT user_id, first_name, username, created_at, captcha_passed
            FROM users 
            WHERE captcha_passed = FALSE OR captcha_passed IS NULL
            ORDER BY created_at DESC
        `);

        console.log(`📊 Найдено пользователей с непройденной капчей: ${captchaFailedUsers.rows.length}`);

        // 2. Найти пользователей, которые прошли капчу, но не заверши��и процесс (потенциально не подписались)
        console.log('\n📢 Поиск пользователей, которые прошли капчу, но не активированы...');
        const subscriptionFailedUsers = await Database.pool.query(`
            SELECT user_id, first_name, username, created_at, captcha_passed, referral_completed
            FROM users 
            WHERE captcha_passed = TRUE 
            AND referral_completed = FALSE
            AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
            ORDER BY created_at DESC
        `);

        console.log(`📊 Найдено пользователей с потенциальными проблемами подписки: ${subscriptionFailedUsers.rows.length}`);

        // Объединяем списки пользователей (избегая дублирования)
        const allFailedUsers = new Map();
        
        // Добавляем пользователей с непройденной капчей
        captchaFailedUsers.rows.forEach(user => {
            allFailedUsers.set(user.user_id, {
                ...user,
                failure_reason: 'captcha_failed'
            });
        });

        // Добавляем пользователей с проблемами подписк�� (если их еще нет в списке)
        subscriptionFailedUsers.rows.forEach(user => {
            if (!allFailedUsers.has(user.user_id)) {
                allFailedUsers.set(user.user_id, {
                    ...user,
                    failure_reason: 'subscription_failed'
                });
            }
        });

        const totalFailedUsers = Array.from(allFailedUsers.values());
        console.log(`\n📋 Общее количество пользователей для отправки напоминания: ${totalFailedUsers.length}`);

        if (totalFailedUsers.length === 0) {
            console.log('✅ Нет пользователей для отправки напоминаний.');
            return;
        }

        // Группируем пользователей по причине
        const captchaFailed = totalFailedUsers.filter(u => u.failure_reason === 'captcha_failed');
        const subscriptionFailed = totalFailedUsers.filter(u => u.failure_reason === 'subscription_failed');

        console.log(`\n📊 Статистика:`);
        console.log(`   🤖 Не прошли капчу: ${captchaFailed.length}`);
        console.log(`   📢 Проблемы с подпиской: ${subscriptionFailed.length}`);

        // Сообщение для отправки
        const reminderMessage = 'Напоминание о рейтинге';

        console.log(`\n📨 Начинаем отправку сообщения: "${reminderMessage}"`);

        let successCount = 0;
        let errorCount = 0;
        let blockedCount = 0;

        // Отправляем сообщения с задержкой для избежания rate limit
        for (let i = 0; i < totalFailedUsers.length; i++) {
            const user = totalFailedUsers[i];
            const progress = `[${i + 1}/${totalFailedUsers.length}]`;
            
            try {
                await bot.sendMessage(user.user_id, reminderMessage);
                
                const reason = user.failure_reason === 'captcha_failed' ? '🤖 капча' : '📢 подписка';
                console.log(`${progress} ✅ Отправлено пользователю ${user.user_id} (${user.first_name}) - причина: ${reason}`);
                successCount++;

                // Задержка 100ms между сообщениями для избежания rate limit
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                if (error.response && error.response.body) {
                    const errorCode = error.response.body.error_code;
                    const description = error.response.body.description;

                    if (errorCode === 403) {
                        console.log(`${progress} 🚫 Пользователь ${user.user_id} заблокировал бота`);
                        blockedCount++;
                    } else if (errorCode === 400 && description.includes('chat not found')) {
                        console.log(`${progress} ❌ Чат с пользователем ${user.user_id} не найден`);
                        errorCount++;
                    } else {
                        console.log(`${progress} ❌ Ошибка отправки пользователю ${user.user_id}: ${description}`);
                        errorCount++;
                    }
                } else {
                    console.log(`${progress} ❌ Неизвестная ошибка для пользователя ${user.user_id}:`, error.message);
                    errorCount++;
                }
            }
        }

        console.log('\n📊 ИТОГИ ОТПРАВКИ:');
        console.log(`✅ Успешно отправлено: ${successCount}`);
        console.log(`🚫 Заблокировали бота: ${blockedCount}`);
        console.log(`❌ Ошибки отправки: ${errorCount}`);
        console.log(`📋 Всего обработано: ${successCount + blockedCount + errorCount}`);

        // Показываем примеры пользователей по категориям
        if (captchaFailed.length > 0) {
            console.log('\n🤖 ПРИМЕРЫ ПОЛЬЗОВАТЕЛЕЙ С НЕПРОЙДЕННОЙ КАПЧЕЙ:');
            captchaFailed.slice(0, 5).forEach((user, index) => {
                const date = new Date(user.created_at).toLocaleDateString('ru-RU');
                console.log(`   ${index + 1}. ${user.first_name || 'Без имени'} (${user.user_id}) - ${date}`);
            });
            if (captchaFailed.length > 5) {
                console.log(`   ... и еще ${captchaFailed.length - 5} пользователей`);
            }
        }

        if (subscriptionFailed.length > 0) {
            console.log('\n📢 ПРИМЕРЫ ПОЛЬЗОВАТЕЛЕЙ С ПРОБЛЕМАМИ ПОДПИСКИ:');
            subscriptionFailed.slice(0, 5).forEach((user, index) => {
                const date = new Date(user.created_at).toLocaleDateString('ru-RU');
                console.log(`   ${index + 1}. ${user.first_name || 'Без имени'} (${user.user_id}) - ${date}`);
            });
            if (subscriptionFailed.length > 5) {
                console.log(`   ... и еще ${subscriptionFailed.length - 5} пользователей`);
            }
        }

    } catch (error) {
        console.error('❌ Ошибка выполнения скрипта:', error);
    } finally {
        // Закрываем соединения
        await Database.pool.end();
        process.exit(0);
    }
}

// Запуск скрипта
if (require.main === module) {
    console.log('🚀 ЗАПУСК СКРИПТА ПОИСКА И УВЕДОМЛЕНИЯ ПОЛЬЗОВАТЕЛЕЙ\n');
    findAndMessageFailedUsers();
}

module.exports = { findAndMessageFailedUsers };
