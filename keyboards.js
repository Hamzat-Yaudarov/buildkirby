/**
 * Централизованные клавиатуры для устранения дублирования
 * Заменяет множество функций get*Keyboard() из index.js
 */

// Универсальная функция для создания клавиатур
function createKeyboard(buttons) {
    return {
        reply_markup: {
            inline_keyboard: buttons
        }
    };
}

// Конфигурация всех клавиатур
const KEYBOARD_CONFIGS = {
    mainMenu: [
        [
            { text: '👤 Профиль', callback_data: 'profile' },
            { text: '👥 Пригласить друзей', callback_data: 'invite' }
        ],
        [
            { text: '🎯 Кликер', callback_data: 'clicker' },
            { text: '⭐ Вывод звёзд', callback_data: 'withdraw' }
        ],
        [
            { text: '📋 Задания', callback_data: 'tasks' },
            { text: '📖 Инструкция по боту', callback_data: 'instruction' }
        ],
        [
            { text: '🏆 Рейтинги', callback_data: 'ratings' },
            { text: '🎁 Кейсы', callback_data: 'cases' }
        ],
        [
            { text: '🎰 Лотерея', callback_data: 'lottery' }
        ]
    ],

    profile: [
        [
            { text: '🎁 промокод', callback_data: 'promocode' },
            { text: '👥 Пригласить друзей', callback_data: 'invite' }
        ],
        [
            { text: '◀️ В главное меню', callback_data: 'main_menu' }
        ]
    ],

    backToMain: [
        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
    ],

    withdraw: [
        [
            { text: '15 ⭐', callback_data: 'withdraw_15' },
            { text: '25 ⭐', callback_data: 'withdraw_25' }
        ],
        [
            { text: '50 ⭐', callback_data: 'withdraw_50' },
            { text: '100 ⭐', callback_data: 'withdraw_100' }
        ],
        [
            { text: '💎 Telegram Premium на 3 месяца (1300⭐)', callback_data: 'withdraw_premium' }
        ],
        [
            { text: '🏠 В главное меню', callback_data: 'main_menu' }
        ]
    ],

    ratings: [
        [
            { text: '🏆 Общий рейтинг', callback_data: 'ratings_all' },
            { text: '📅 Рейтинг за неделю', callback_data: 'ratings_week' }
        ],
        [
            { text: '⭐ Недельные очки', callback_data: 'ratings_week_points' }
        ],
        [
            { text: '🏠 В главное меню', callback_data: 'main_menu' }
        ]
    ],

    adminMenu: [
        [
            { text: '📊 Статистика', callback_data: 'admin_stats' },
            { text: '📋 Управление заданиями', callback_data: 'admin_tasks' }
        ],
        [
            { text: '📺 Обязательные каналы', callback_data: 'admin_channels' },
            { text: '🎰 Управление лотереями', callback_data: 'admin_lottery' }
        ],
        [
            { text: '🎁 Управление промокодами', callback_data: 'admin_promocodes' },
            { text: '📢 Рассылка сообщений', callback_data: 'admin_broadcast' }
        ],
        [
            { text: '🏆 Недельные награды', callback_data: 'admin_weekly_rewards' },
            { text: '🔗 SubGram управление', callback_data: 'admin_subgram' }
        ],
        [
            { text: '💸 Управление выводом', callback_data: 'admin_withdrawals' },
            { text: '📊 Статистика подписок', callback_data: 'admin_subscription_stats' }
        ]
    ]
};

// Функции для создания специфических клавиатур
function getTaskKeyboard(taskId, channelLink) {
    return createKeyboard([
        [
            { text: '📺 Подписаться', url: channelLink }
        ],
        [
            { text: '🔍 Проверить', callback_data: `task_check_${taskId}` }
        ],
        [
            { text: '⏭️ Пропустить задание', callback_data: 'task_skip' },
            { text: '🏠 В главное меню', callback_data: 'main_menu' }
        ]
    ]);
}

function getSubscriptionCheckKeyboard(enhanced = false) {
    const callbackData = enhanced ? 'check_subscriptions_enhanced' : 'check_subscriptions';
    return createKeyboard([
        [{ text: '✅ Проверить подписки', callback_data: callbackData }]
    ]);
}

function getRetryKeyboard(retryCallback = 'main_menu') {
    return createKeyboard([
        [
            { text: '🔄 Попробовать снова', callback_data: retryCallback },
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
    ]);
}

function getGenderSelectionKeyboard() {
    return createKeyboard([
        [
            { text: '👨 Мужской', callback_data: 'subgram_gender_male' },
            { text: '👩 Женский', callback_data: 'subgram_gender_female' }
        ],
        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
    ]);
}

// Экспортируемые функции
module.exports = {
    // Базовые клавиатуры
    getMainMenuKeyboard: () => createKeyboard(KEYBOARD_CONFIGS.mainMenu),
    getProfileKeyboard: () => createKeyboard(KEYBOARD_CONFIGS.profile),
    getBackToMainKeyboard: () => createKeyboard(KEYBOARD_CONFIGS.backToMain),
    getWithdrawKeyboard: () => createKeyboard(KEYBOARD_CONFIGS.withdraw),
    getRatingsKeyboard: () => createKeyboard(KEYBOARD_CONFIGS.ratings),
    getAdminMenuKeyboard: () => createKeyboard(KEYBOARD_CONFIGS.adminMenu),

    // Специальные клавиатуры
    getTaskKeyboard,
    getSubscriptionCheckKeyboard,
    getRetryKeyboard,
    getGenderSelectionKeyboard,

    // Утилиты
    createKeyboard,
    
    // Прямой доступ к конфигурациям для кастомизации
    KEYBOARD_CONFIGS
};
