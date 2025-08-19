/**
 * Роутер для callback запросов
 * Заменяет огромный switch (строки 2268-2858) в index.js
 */

const userHandlers = require('./handlers/user-handlers');
const { requireAdmin, requireUser, withErrorHandling } = require('./middlewares');

/**
 * Создает роутер для обработки callback данных
 * @param {Object} bot - экземпляр Telegram бота  
 * @param {Object} dependencies - зависимости (db, и т.д.)
 * @returns {Function} функция роутера
 */
function createCallbackRouter(bot, dependencies) {
    const { db } = dependencies;

    // Карта обработчиков callback
    const handlers = new Map();

    // Пользовательские обработчики
    handlers.set('main_menu', userHandlers.handleMainMenu);
    handlers.set('profile', userHandlers.handleProfile);
    handlers.set('clicker', userHandlers.handleClicker);
    handlers.set('instruction', userHandlers.handleInstruction);
    handlers.set('ratings', userHandlers.handleRatings);
    handlers.set('ratings_all', userHandlers.handleRatingsAll);
    handlers.set('ratings_week', userHandlers.handleRatingsWeek);
    handlers.set('ratings_week_points', userHandlers.handleRatingsWeekPoints);

    // Заглушки для будущих обработчиков
    handlers.set('invite', createPlaceholderHandler('Функция приглашения друзей'));
    handlers.set('withdraw', createPlaceholderHandler('Функция вывода звёзд'));
    handlers.set('tasks', createPlaceholderHandler('Функция заданий'));
    handlers.set('lottery', createPlaceholderHandler('Функция лотерей'));
    handlers.set('cases', createPlaceholderHandler('Функция кейсов'));
    handlers.set('promocode', createPlaceholderHandler('Функция промокодов'));

    // Админские обработчики (с проверкой прав)
    handlers.set('admin', requireAdmin(createPlaceholderHandler('Админ-панель')));
    handlers.set('admin_stats', requireAdmin(createPlaceholderHandler('Админская статистика')));
    handlers.set('admin_tasks', requireAdmin(createPlaceholderHandler('Управление заданиями')));
    handlers.set('admin_channels', requireAdmin(createPlaceholderHandler('Управление каналами')));
    handlers.set('admin_lottery', requireAdmin(createPlaceholderHandler('Управление лотереями')));
    handlers.set('admin_promocodes', requireAdmin(createPlaceholderHandler('Управление промокодами')));
    handlers.set('admin_broadcast', requireAdmin(createPlaceholderHandler('Рассылка сообщений')));
    handlers.set('admin_weekly_rewards', requireAdmin(createPlaceholderHandler('Недельные награды')));
    handlers.set('admin_subgram', requireAdmin(createPlaceholderHandler('SubGram управление')));
    handlers.set('admin_withdrawals', requireAdmin(createPlaceholderHandler('Управление выводом')));
    handlers.set('admin_subscription_stats', requireAdmin(createPlaceholderHandler('Статистика подписок')));

    // SubGram обработчики
    handlers.set('check_subscriptions_enhanced', createPlaceholderHandler('Улучшенная проверка подписок'));
    handlers.set('subgram_check', createPlaceholderHandler('Проверка SubGram'));
    handlers.set('subgram-op', createPlaceholderHandler('Официальная проверка SubGram'));
    handlers.set('subgram_gender_male', createPlaceholderHandler('Выбор мужского пола'));
    handlers.set('subgram_gender_female', createPlaceholderHandler('Выбор женского пола'));

    /**
     * Создает заглушку для обработчика
     * @param {string} feature - название функции
     * @returns {Function} обработчик-заглушка
     */
    function createPlaceholderHandler(feature) {
        return async (chatId, messageId, userId, callbackData, user) => {
            const { editMessage } = require('./message-utils');
            const { keyboards } = require('./keyboards');
            
            await editMessage(bot, chatId, messageId, 
                `🚧 **${feature}**\n\nДанная функция находится в разработке.\n\n💡 Скоро будет доступна!`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
        };
    }

    /**
     * Обрабатывает динамические callback (с параметрами)
     * @param {string} callbackData - данные callback
     * @param {number} chatId - ID чата  
     * @param {number} messageId - ID сообщения
     * @param {number} userId - ID пользователя
     * @param {Object} user - данные пользователя
     * @returns {boolean} true если обработано
     */
    async function handleDynamicCallback(callbackData, chatId, messageId, userId, user) {
        const { editMessage } = require('./message-utils');
        const { keyboards } = require('./keyboards');

        // Обработка callback с параметрами
        if (callbackData.startsWith('task_check_')) {
            const taskId = callbackData.replace('task_check_', '');
            await editMessage(bot, chatId, messageId, 
                `🔍 **Проверка задания #${taskId}**\n\nФункция проверки заданий в разработке.`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
            return true;
        }

        if (callbackData.startsWith('lottery_buy_')) {
            const lotteryId = callbackData.replace('lottery_buy_', '');
            await editMessage(bot, chatId, messageId, 
                `🎰 **Покупка билета лотереи #${lotteryId}**\n\nФункция лотерей в разработке.`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
            return true;
        }

        if (callbackData.startsWith('withdraw_')) {
            const amount = callbackData.replace('withdraw_', '');
            await editMessage(bot, chatId, messageId, 
                `💸 **Вывод ${amount} звёзд**\n\nФункция вывода в разработке.`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
            return true;
        }

        if (callbackData.startsWith('ref_lottery_')) {
            const action = callbackData.split('_')[2];
            const lotteryId = callbackData.split('_')[3];
            await editMessage(bot, chatId, messageId, 
                `🎯 **Реферальная лотерея #${lotteryId}**\n\nДействие: ${action}\n\nФункция в разработке.`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
            return true;
        }

        if (callbackData.startsWith('admin_')) {
            // Дополнительные админские callback
            await editMessage(bot, chatId, messageId, 
                `⚙️ **Административная функция**\n\nCallback: ${callbackData}\n\nВ разработке.`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
            return true;
        }

        return false; // Не обработано
    }

    /**
     * Главная функция роутера
     * @param {Object} callbackQuery - объект callback query
     * @returns {Promise<boolean>} true если обработано
     */
    async function route(callbackQuery) {
        const { message: msg, data: callbackData, from: { id: userId } } = callbackQuery;
        const { chat: { id: chatId }, message_id: messageId } = msg;

        try {
            // Получаем пользователя
            const user = await db.getUser(userId);

            // Проверяем статические обработчики
            if (handlers.has(callbackData)) {
                const handler = handlers.get(callbackData);
                await handler(chatId, messageId, userId, callbackData, user);
                return true;
            }

            // Проверяем динамические обработчики
            const dynamicHandled = await handleDynamicCallback(callbackData, chatId, messageId, userId, user);
            if (dynamicHandled) {
                return true;
            }

            // Обработчик по умолчанию для неизвестных callback
            const { editMessage } = require('./message-utils');
            const { keyboards } = require('./keyboards');
            
            console.warn('Unknown callback data:', callbackData);
            await editMessage(bot, chatId, messageId, 
                `❓ **Неизвестная команда**\n\nCallback: \`${callbackData}\`\n\nВозможно, эта функция ещё не реализована.`,
                { keyboard: keyboards.getBackToMainKeyboard().reply_markup.inline_keyboard }
            );
            
            return true;

        } catch (error) {
            console.error('Error in callback router:', error);
            
            try {
                const { sendErrorMessage } = require('./message-utils');
                await sendErrorMessage(bot, chatId, messageId, 'Ошибка обработки команды');
            } catch (sendError) {
                console.error('Error sending error message:', sendError);
            }
            
            return false;
        }
    }

    /**
     * Добавляет новый обработчик
     * @param {string} callbackData - данные callback
     * @param {Function} handler - о��работчик
     */
    function addHandler(callbackData, handler) {
        handlers.set(callbackData, handler);
    }

    /**
     * Удаляет обработчик
     * @param {string} callbackData - данные callback
     */
    function removeHandler(callbackData) {
        handlers.delete(callbackData);
    }

    /**
     * Получает список всех обработчиков
     * @returns {Array} массив callback данных
     */
    function getHandlers() {
        return Array.from(handlers.keys());
    }

    return {
        route,
        addHandler,
        removeHandler,
        getHandlers
    };
}

module.exports = { createCallbackRouter };
