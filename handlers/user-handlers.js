/**
 * Обработчики пользовательских действий
 * Вынесено из огромного switch в index.js
 */

const { keyboards } = require('../keyboards');
const { editMessage, sendProfileMessage, sendErrorMessage } = require('../message-utils');
const { withCommonChecks } = require('../middlewares');
const db = require('../database');

/**
 * Обработчик главного меню
 */
async function handleMainMenu(bot, chatId, messageId, userId, user) {
    const welcomeMessage = `🏠 **Главное меню**

💫 Добро пожаловать в StarBot!

🎯 **Ваша статистика:**
💰 Баланс: ${user?.balance || 0} ⭐
👥 Рефералы: ${user?.referrals_count || 0}
📊 Недельные очки: ${user?.weekly_points || 0}

Выберите действие:`;

    await editMessage(bot, chatId, messageId, welcomeMessage, {
        keyboard: keyboards.getMainMenuKeyboard().reply_markup.inline_keyboard
    });
}

/**
 * Обработчик профиля пользователя
 */
async function handleProfile(bot, chatId, messageId, userId, user) {
    await sendProfileMessage(bot, chatId, messageId, user);
}

/**
 * Обработчик кликера
 */
async function handleClicker(bot, chatId, messageId, userId, user) {
    try {
        const now = new Date();
        const lastClick = user.last_click ? new Date(user.last_click) : null;
        const canClick = !lastClick || (now.getTime() - lastClick.getTime()) >= 24 * 60 * 60 * 1000; // 24 hours

        if (!canClick) {
            const timeLeft = 24 * 60 * 60 * 1000 - (now.getTime() - lastClick.getTime());
            const hoursLeft = Math.ceil(timeLeft / (60 * 60 * 1000));
            
            const message = `🎯 **Кликер**

⏰ До следующего клика: ${hoursLeft} часов

💰 Ваш баланс: ${user.balance || 0} ⭐
📅 Последний клик: ${lastClick.toLocaleDateString('ru-RU')}

💡 Возвращайтесь каждые 24 часа за звёздами!`;

            await editMessage(bot, chatId, messageId, message, {
                keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard
            });
            return;
        }

        // Award daily click
        await db.updateUserBalance(userId, 1);
        await db.updateUserField(userId, 'last_click', now);
        await db.updateUserField(userId, 'clicks_today', (user.clicks_today || 0) + 1);
        
        // Add weekly points
        await db.addWeeklyPoints(userId, 1, 'daily_click');

        const message = `🎯 **Кликер - Успех!**

🎉 Вы получили +1 ⭐!
📊 Вы получили +1 очко в недельном рейтинге!

💰 Ваш баланс: ${(user.balance || 0) + 1} ⭐
📅 Следующий клик через: 24 часа

💡 Не забывайте кликать каждый день!`;

        await editMessage(bot, chatId, messageId, message, {
            keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard
        });

    } catch (error) {
        console.error('Error in clicker:', error);
        await sendErrorMessage(bot, chatId, messageId, 'Ошибка кликера');
    }
}

/**
 * Обработчик инструкции
 */
async function handleInstruction(bot, chatId, messageId, userId, user) {
    const message = `📖 **Инструкция по боту**

🎯 **Как зарабатывать звёзды:**

1️⃣ **Ежедневный кликер** - получайте 1⭐ каждые 24 часа
2️⃣ **Выполнение заданий** - подписывайтесь на каналы за вознаграждение
3️⃣ **Реферальная программа** - приглашайте друзей и получайте 3⭐ за каждого
4️⃣ **Участие в лотереях** - шанс выиграть крупные призы
5️⃣ **Открытие кейсов** - получайте случайные награды

💸 **Вывод звёзд:**
• Минимум для вывода: 15⭐
• Доступны суммы: 15, 25, 50, 100⭐
• Telegram Premium: 1300⭐

🏆 **Рейтинги:**
• Общий рейтинг по балансу
• Недельный рейтинг по активности
• Специальные награды для топ игроков

💡 **Советы:**
• Подписывайтесь на обязательные каналы
• Приглашайте активных друзей
• Участвуйте в еженедельных конкурсах`;

    await editMessage(bot, chatId, messageId, message, {
        keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard
    });
}

/**
 * Обработчик рейтингов
 */
async function handleRatings(bot, chatId, messageId, userId, user) {
    const message = `🏆 **Рейтинги**

Выберите тип рейтинга:

📊 **Доступные рейтинги:**
• Общий рейтинг по балансу
• Недельный рейтинг по рефералам  
• Рейтинг по недельным очкам

🎁 **Награды за топ места:**
🥇 1 место: 10⭐
🥈 2 место: 5⭐  
🥉 3 место: 3⭐
4-5 места: 2⭐ каждому`;

    await editMessage(bot, chatId, messageId, message, {
        keyboard: keyboards.getRatingsKeyboard().reply_markup.inline_keyboard
    });
}

/**
 * Обработчик общего рейтинга
 */
async function handleRatingsAll(bot, chatId, messageId, userId, user) {
    try {
        const topUsers = await db.executeQuery(`
            SELECT id, first_name, username, balance
            FROM users
            WHERE balance > 0
            ORDER BY balance DESC, registered_at ASC
            LIMIT 10
        `);

        let message = `🏆 **Общий рейтинг по балансу**\n\n`;

        if (topUsers.rows.length === 0) {
            message += '📭 Пока никто не зар��ботал звёзды';
        } else {
            topUsers.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                const name = user.first_name || user.username || 'Аноним';
                message += `${medal} **${index + 1}.** ${name} - ${user.balance}⭐\n`;
            });
        }

        message += `\n💡 Зарабатывайте звёзды и поднимайтесь в рейтинге!`;

        await editMessage(bot, chatId, messageId, message, {
            keyboard: [
                [{ text: '◀️ К рейтингам', callback_data: 'ratings' }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        });

    } catch (error) {
        console.error('Error in ratings all:', error);
        await sendErrorMessage(bot, chatId, messageId, 'Ошибка загрузки рейтинга');
    }
}

/**
 * Обработчик недельного рейтинга
 */
async function handleRatingsWeek(bot, chatId, messageId, userId, user) {
    try {
        const topUsers = await db.executeQuery(`
            SELECT id, first_name, username, referrals_today
            FROM users
            WHERE referrals_today > 0
            ORDER BY referrals_today DESC, registered_at ASC
            LIMIT 10
        `);

        let message = `📅 **Недельный рейтинг по рефералам**\n\n`;

        if (topUsers.rows.length === 0) {
            message += '📭 На этой неделе пока никто не пригласил друзей';
        } else {
            topUsers.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                const name = user.first_name || user.username || 'Аноним';
                message += `${medal} **${index + 1}.** ${name} - ${user.referrals_today} рефералов\n`;
            });
        }

        message += `\n💡 Приглашайте друзей на этой неделе!`;

        await editMessage(bot, chatId, messageId, message, {
            keyboard: [
                [{ text: '◀️ К рейтингам', callback_data: 'ratings' }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        });

    } catch (error) {
        console.error('Error in ratings week:', error);
        await sendErrorMessage(bot, chatId, messageId, 'Ошибка загрузки недельного рейтинга');
    }
}

/**
 * Обрабо��чик недельных очков
 */
async function handleRatingsWeekPoints(bot, chatId, messageId, userId, user) {
    try {
        const topUsers = await db.getWeeklyTopUsers(10);

        let message = `⭐ **Рейтинг по недельным очкам**\n\n`;

        if (topUsers.length === 0) {
            message += '📭 На этой неделе пока никто не заработал очки';
        } else {
            topUsers.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '👤';
                const name = user.first_name || user.username || 'Аноним';
                message += `${medal} **${index + 1}.** ${name} - ${user.weekly_points} очков\n`;
            });
        }

        message += `\n💡 Выполняйте задания, кликайте и приглашайте друзей!`;

        await editMessage(bot, chatId, messageId, message, {
            keyboard: [
                [{ text: '◀️ К рейтингам', callback_data: 'ratings' }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        });

    } catch (error) {
        console.error('Error in ratings week points:', error);
        await sendErrorMessage(bot, chatId, messageId, 'Ошибка загрузки рейтинга очков');
    }
}

// Экспорт обработчиков с применением middleware
module.exports = {
    handleMainMenu: withCommonChecks({
        requireAdminCheck: false,
        requireSubscriptionCheck: false, // Главное меню доступно всегда
        errorMessage: 'Ошибка загрузки главного меню'
    })(handleMainMenu),

    handleProfile: withCommonChecks({
        errorMessage: 'Ошибка загрузки профиля'
    })(handleProfile),

    handleClicker: withCommonChecks({
        errorMessage: 'Ошибка кликера'
    })(handleClicker),

    handleInstruction: withCommonChecks({
        requireSubscriptionCheck: false, // Инструкция доступна всегда
        errorMessage: 'Ошибка загрузки инструкции'
    })(handleInstruction),

    handleRatings: withCommonChecks({
        errorMessage: 'Ошибка загрузки рейтингов'
    })(handleRatings),

    handleRatingsAll: withCommonChecks({
        errorMessage: 'Ошибка загрузки общего рейтинга'
    })(handleRatingsAll),

    handleRatingsWeek: withCommonChecks({
        errorMessage: 'Ошибка загрузки недельно��о рейтинга'
    })(handleRatingsWeek),

    handleRatingsWeekPoints: withCommonChecks({
        errorMessage: 'Ошибка загрузки рейтинга очков'
    })(handleRatingsWeekPoints)
};
