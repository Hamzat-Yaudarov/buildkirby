/**
 * Middleware для устранения дублированных проверок и обработки
 * Заменяет множество повторяющихся if-else блоков в index.js
 */

const { isAdmin } = require('./config');
const db = require('./database');

/**
 * Middleware для проверки админских прав
 * @param {Function} handler - обработчик для выполнения после проверки
 * @returns {Function} обернутый обработчик
 */
function requireAdmin(handler) {
    return async (chatId, messageId, userId, ...args) => {
        if (!isAdmin(userId)) {
            const bot = require('./index').bot; // Получаем bot из главного файла
            await bot.sendMessage(chatId, '❌ У вас нет прав доступа к панели администратора.');
            return false;
        }
        return await handler(chatId, messageId, userId, ...args);
    };
}

/**
 * Middleware для проверки существования пользователя
 * @param {Function} handler - обработчик для выполнения после проверки
 * @param {boolean} allowAdmin - разрешить админские команды без пользователя
 * @returns {Function} обернутый обработчик
 */
function requireUser(handler, allowAdmin = true) {
    return async (chatId, messageId, userId, callbackData, ...args) => {
        const user = await db.getUser(userId);
        
        if (!user) {
            // Разрешаем админские команды и главное меню
            if (allowAdmin && (isAdmin(userId) || callbackData === 'main_menu' || callbackData?.startsWith('admin_'))) {
                return await handler(chatId, messageId, userId, callbackData, null, ...args);
            }
            
            const bot = require('./index').bot;
            await bot.editMessageText(
                '❌ Пользователь не найден. Нажмите /start для регистрации.',
                { 
                    chat_id: chatId, 
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Начать заново', url: `https://t.me/${(await bot.getMe()).username}` }]
                        ]
                    }
                }
            );
            return false;
        }
        
        return await handler(chatId, messageId, userId, callbackData, user, ...args);
    };
}

/**
 * Middleware для проверки подписок
 * @param {Function} handler - обработчик для выполнения после проверки
 * @param {boolean} skipForAdmin - пропускать проверку для админов
 * @returns {Function} обернутый обработчик
 */
function requireSubscription(handler, skipForAdmin = true) {
    return async (chatId, messageId, userId, ...args) => {
        // Пропускаем проверку для админов если указано
        if (skipForAdmin && isAdmin(userId)) {
            return await handler(chatId, messageId, userId, ...args);
        }

        const { checkAllSubscriptions, getEnhancedSubscriptionMessage } = require('./index');
        const isSubscribed = await checkAllSubscriptions(userId);
        
        if (!isSubscribed) {
            const subData = await getEnhancedSubscriptionMessage(userId);
            const bot = require('./index').bot;
            
            await bot.editMessageText(subData.message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: subData.buttons }
            });
            
            await db.setSubscriptionNotified(userId, true);
            return false;
        }
        
        return await handler(chatId, messageId, userId, ...args);
    };
}

/**
 * Middleware для проверки капчи
 * @param {Function} handler - обработчик для выполнения после проверки
 * @returns {Function} обернутый обработчик
 */
function requireCaptcha(handler) {
    return async (chatId, messageId, userId, ...args) => {
        const user = await db.getUser(userId);
        
        if (!user || !user.captcha_passed) {
            const bot = require('./index').bot;
            await bot.editMessageText(
                '🤖 Сначала необходимо пройти капчу. Нажмите /start для прохождения.',
                { 
                    chat_id: chatId, 
                    message_id: messageId,
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '���� Пройти капчу', url: `https://t.me/${(await bot.getMe()).username}` }]
                        ]
                    }
                }
            );
            return false;
        }
        
        return await handler(chatId, messageId, userId, ...args);
    };
}

/**
 * Универсальный обработчик ошибок
 * @param {Function} handler - обработчик для оборачивания
 * @param {string} errorMessage - сообщение об ошибке
 * @param {boolean} editMessage - использовать editMessage вместо sendMessage
 * @returns {Function} обернутый обработчик
 */
function withErrorHandling(handler, errorMessage = 'Произошла ошибка', editMessage = true) {
    return async (...args) => {
        try {
            return await handler(...args);
        } catch (error) {
            console.error(`Error in ${handler.name}:`, error);
            
            const [chatId, messageId] = args;
            if (chatId) {
                const bot = require('./index').bot;
                const message = `❌ ${errorMessage}`;
                
                try {
                    if (editMessage && messageId) {
                        await bot.editMessageText(message, {
                            chat_id: chatId,
                            message_id: messageId,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '🔄 Попробовать снова', callback_data: 'main_menu' }]
                                ]
                            }
                        });
                    } else {
                        await bot.sendMessage(chatId, message);
                    }
                } catch (sendError) {
                    console.error('Error sending error message:', sendError);
                }
            }
            return false;
        }
    };
}

/**
 * Middleware для проверки кулдауна
 * @param {Map} cooldowns - Map с кулдаунами пользователей
 * @param {number} cooldownMs - время кулдауна в миллисекундах
 * @param {string} action - название действия для сообщения
 * @returns {Function} middleware функция
 */
function withCooldown(cooldowns, cooldownMs, action = 'действие') {
    return function(handler) {
        return async (chatId, messageId, userId, ...args) => {
            const now = Date.now();
            const lastAction = cooldowns.get(userId);
            
            if (lastAction && (now - lastAction) < cooldownMs) {
                const remainingSeconds = Math.ceil((cooldownMs - (now - lastAction)) / 1000);
                const bot = require('./index').bot;
                
                await bot.editMessageText(
                    `⏰ Подождите ${remainingSeconds} секунд перед повторным выполнением.`,
                    { chat_id: chatId, message_id: messageId }
                );
                return false;
            }
            
            cooldowns.set(userId, now);
            return await handler(chatId, messageId, userId, ...args);
        };
    };
}

/**
 * Комбинированный middleware для типичных проверок
 * @param {Object} options - опции проверок
 * @returns {Function} middleware функция
 */
function withCommonChecks(options = {}) {
    const {
        requireUserCheck = true,
        requireCaptchaCheck = true, 
        requireSubscriptionCheck = true,
        requireAdminCheck = false,
        skipForAdmin = true,
        errorMessage = 'Произошла ошибка'
    } = options;
    
    return function(handler) {
        let wrappedHandler = handler;
        
        // Оборачиваем в обратном порядке
        wrappedHandler = withErrorHandling(wrappedHandler, errorMessage);
        
        if (requireAdminCheck) {
            wrappedHandler = requireAdmin(wrappedHandler);
        }
        
        if (requireSubscriptionCheck) {
            wrappedHandler = requireSubscription(wrappedHandler, skipForAdmin);
        }
        
        if (requireCaptchaCheck) {
            wrappedHandler = requireCaptcha(wrappedHandler);
        }
        
        if (requireUserCheck) {
            wrappedHandler = requireUser(wrappedHandler);
        }
        
        return wrappedHandler;
    };
}

module.exports = {
    requireAdmin,
    requireUser,
    requireSubscription,
    requireCaptcha,
    withErrorHandling,
    withCooldown,
    withCommonChecks
};
