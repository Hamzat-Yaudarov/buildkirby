/**
 * Утилиты для сообщений для устранения дублирования
 * Заменяет множество повторяющихся bot.editMessageText и bot.sendMessage
 */

/**
 * Универсальная функция для редактирования сообщений
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {number} messageId - ID сообщения
 * @param {string} text - текст сообщения
 * @param {Object} options - дополнительные опции
 * @returns {Promise} результат отправки
 */
async function editMessage(bot, chatId, messageId, text, options = {}) {
    const {
        keyboard = null,
        parseMode = 'Markdown',
        disableWebPagePreview = true
    } = options;

    const editOptions = {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: parseMode,
        disable_web_page_preview: disableWebPagePreview
    };

    if (keyboard) {
        editOptions.reply_markup = { inline_keyboard: keyboard };
    }

    return await bot.editMessageText(text, editOptions);
}

/**
 * Универсальная функция для отправки сообщений
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {string} text - текст сообщения
 * @param {Object} options - дополнительные опции
 * @returns {Promise} результат отправки
 */
async function sendMessage(bot, chatId, text, options = {}) {
    const {
        keyboard = null,
        parseMode = 'Markdown',
        disableWebPagePreview = true,
        replyToMessageId = null
    } = options;

    const sendOptions = {
        parse_mode: parseMode,
        disable_web_page_preview: disableWebPagePreview
    };

    if (keyboard) {
        sendOptions.reply_markup = { inline_keyboard: keyboard };
    }

    if (replyToMessageId) {
        sendOptions.reply_to_message_id = replyToMessageId;
    }

    return await bot.sendMessage(chatId, text, sendOptions);
}

/**
 * Отправка сообщения об ошибке
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {number} messageId - ID сообщения (опционально)
 * @param {string} errorText - текст ошибки
 * @param {Array} retryButtons - кнопки для повтора
 * @returns {Promise} результат отправки
 */
async function sendErrorMessage(bot, chatId, messageId = null, errorText = 'Произошла ошибка', retryButtons = null) {
    const defaultButtons = retryButtons || [
        [{ text: '🔄 Попробовать снова', callback_data: 'main_menu' }]
    ];

    const message = `❌ ${errorText}`;

    if (messageId) {
        return await editMessage(bot, chatId, messageId, message, { keyboard: defaultButtons });
    } else {
        return await sendMessage(bot, chatId, message, { keyboard: defaultButtons });
    }
}

/**
 * Отправка сообщения об успехе
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {number} messageId - ID сообщения (опционально)
 * @param {string} successText - текст успеха
 * @param {Array} buttons - кнопки
 * @returns {Promise} результат отправки
 */
async function sendSuccessMessage(bot, chatId, messageId = null, successText, buttons = null) {
    const defaultButtons = buttons || [
        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
    ];

    const message = `✅ ${successText}`;

    if (messageId) {
        return await editMessage(bot, chatId, messageId, message, { keyboard: defaultButtons });
    } else {
        return await sendMessage(bot, chatId, message, { keyboard: defaultButtons });
    }
}

/**
 * Отправка сообщения с загрузкой
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {number} messageId - ID сообщения
 * @param {string} loadingText - текст загрузки
 * @returns {Promise} результат отправки
 */
async function sendLoadingMessage(bot, chatId, messageId, loadingText = 'Загрузка...') {
    return await editMessage(bot, chatId, messageId, `🔄 ${loadingText}`);
}

/**
 * Отправка сообщения со статистикой в едином формате
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {number} messageId - ID сообщения
 * @param {string} title - заголовок статистики
 * @param {Object} stats - объект со статистикой
 * @param {Array} buttons - кнопки
 * @returns {Promise} результат отправки
 */
async function sendStatsMessage(bot, chatId, messageId, title, stats, buttons = null) {
    let message = `📊 **${title}**\n\n`;
    
    Object.entries(stats).forEach(([key, value]) => {
        const emoji = getStatsEmoji(key);
        const formattedKey = formatStatsKey(key);
        message += `${emoji} **${formattedKey}:** ${formatStatsValue(value)}\n`;
    });

    const defaultButtons = buttons || [
        [{ text: '🔄 Обновить', callback_data: 'admin_stats' }],
        [{ text: '🏠 Админ-панель', callback_data: 'admin' }]
    ];

    return await editMessage(bot, chatId, messageId, message, { keyboard: defaultButtons });
}

/**
 * Получение эмодзи для статистики
 * @param {string} key - ключ статистики
 * @returns {string} эмодзи
 */
function getStatsEmoji(key) {
    const emojiMap = {
        'total_users': '👥',
        'total_balance': '💰',
        'total_referrals': '👥',
        'today_users': '📅',
        'active_tasks': '📋',
        'active_lotteries': '🎰',
        'pending_withdrawals': '💸',
        'completed_withdrawals': '✅'
    };
    return emojiMap[key] || '📈';
}

/**
 * Форматирование ключа статистики
 * @param {string} key - ключ
 * @returns {string} форматированный ключ
 */
function formatStatsKey(key) {
    const keyMap = {
        'total_users': 'Всего пользователей',
        'total_balance': 'Общий баланс',
        'total_referrals': 'Всего рефералов',
        'today_users': 'Новых за сегодня',
        'active_tasks': 'Активных заданий',
        'active_lotteries': 'Активных лотерей',
        'pending_withdrawals': 'Ожидающих выводов',
        'completed_withdrawals': 'Завершенных выводов'
    };
    return keyMap[key] || key.replace(/_/g, ' ');
}

/**
 * Форматирование значения статистики
 * @param {any} value - значение
 * @returns {string} форматированное значение
 */
function formatStatsValue(value) {
    if (typeof value === 'number') {
        if (value >= 1000000) {
            return `${(value / 1000000).toFixed(1)}M`;
        } else if (value >= 1000) {
            return `${(value / 1000).toFixed(1)}K`;
        }
        return value.toLocaleString();
    }
    return String(value);
}

/**
 * Отправка сообщения с пользовательским профилем
 * @param {Object} bot - экземпляр Telegram бота
 * @param {number} chatId - ID чата
 * @param {number} messageId - ID сообщения
 * @param {Object} user - данные пользователя
 * @param {Array} buttons - кнопки
 * @returns {Promise} результат отправки
 */
async function sendProfileMessage(bot, chatId, messageId, user, buttons = null) {
    const { keyboards } = require('./keyboards');
    
    const message = `👤 **Ваш профиль**

💫 **Имя:** ${user.first_name || 'Пользователь'}
🆔 **ID:** ${user.id}
💰 **Баланс:** ${user.balance || 0} ⭐
👥 **Рефералы:** ${user.referrals_count || 0}
📅 **Регистрация:** ${user.registered_at ? new Date(user.registered_at).toLocaleDateString('ru-RU') : 'Неизвестно'}
📊 **Недельные очки:** ${user.weekly_points || 0}

💡 **Приглашайте друзей и зарабатывайте 3⭐ за каждого активного реферала!**`;

    const defaultButtons = buttons || keyboards.getProfileKeyboard().reply_markup.inline_keyboard;

    return await editMessage(bot, chatId, messageId, message, { keyboard: defaultButtons });
}

/**
 * Очистка текста от Markdown для безопасного отображения
 * @param {string} text - исходный текст
 * @returns {string} очищенный текст
 */
function cleanDisplayText(text) {
    if (!text) return 'Пользователь';

    // Remove all potentially problematic characters for clean display
    let cleanText = text
        // Remove markdown special characters
        .replace(/[*_`\[\]()~>#+=|{}.!-]/g, '')
        // Remove control characters
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
        // Remove specific problematic symbols that cause Telegram parsing errors
        .replace(/[☭⧁⁣༒𓆩₦ł₦ℳ₳𓆪⭐]/g, '')
        // Remove various unicode spaces, symbols, and special characters
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F]/g, '')
        // Remove other potentially problematic unicode ranges
        .replace(/[\u2600-\u26FF\u2700-\u27BF]/g, '') // Miscellaneous symbols
        .replace(/[\uFE00-\uFE0F]/g, '') // Variation selectors
        .replace(/[\u200D\u200C\u200B]/g, '') // Zero-width characters
        .trim();

    // Limit length to prevent issues
    if (cleanText.length > 20) {
        cleanText = cleanText.substring(0, 17) + '...';
    }

    // If name becomes empty after cleaning, use default
    return cleanText || 'Пользователь';
}

module.exports = {
    editMessage,
    sendMessage,
    sendErrorMessage,
    sendSuccessMessage,
    sendLoadingMessage,
    sendStatsMessage,
    sendProfileMessage,
    cleanDisplayText,
    getStatsEmoji,
    formatStatsKey,
    formatStatsValue
};
