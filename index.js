const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

// Bot token - should be set via environment variable
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';
const bot = new TelegramBot(token, { polling: true });

// Admin configuration
const ADMIN_ID = 6910097562;
const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';

// Required channels/chats for registration
const REQUIRED_CHANNELS = [
    // Add your required channels here
    // '@yourchannel1',
    // '@yourchannel2'
];

// Initialize database
const db = new sqlite3.Database('bot.db');

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        balance REAL DEFAULT 0,
        referrals_count INTEGER DEFAULT 0,
        referrals_today INTEGER DEFAULT 0,
        invited_by INTEGER,
        last_click DATE,
        last_case_open DATE,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_subscribed BOOLEAN DEFAULT 0
    )`);

    // Tasks table
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT,
        channel_name TEXT,
        reward REAL DEFAULT 1,
        is_active BOOLEAN DEFAULT 1
    )`);

    // User tasks completion
    db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
        user_id INTEGER,
        task_id INTEGER,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, task_id)
    )`);

    // Lotteries table
    db.run(`CREATE TABLE IF NOT EXISTS lotteries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        ticket_price REAL,
        max_tickets INTEGER,
        winners_count INTEGER,
        current_tickets INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Lottery tickets
    db.run(`CREATE TABLE IF NOT EXISTS lottery_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lottery_id INTEGER,
        user_id INTEGER,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Withdrawal requests
    db.run(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        type TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
    )`);

    // Promocodes table
    db.run(`CREATE TABLE IF NOT EXISTS promocodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        reward REAL,
        max_uses INTEGER,
        current_uses INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Promocode usage tracking
    db.run(`CREATE TABLE IF NOT EXISTS promocode_usage (
        user_id INTEGER,
        promocode_id INTEGER,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, promocode_id)
    )`);

    // Required channels for registration
    db.run(`CREATE TABLE IF NOT EXISTS required_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT UNIQUE,
        channel_name TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// Helper function to check if user is admin
function isAdmin(userId) {
    return userId === ADMIN_ID;
}

// Helper function to get required channels from database
function getRequiredChannels() {
    return new Promise((resolve, reject) => {
        db.all('SELECT channel_id FROM required_channels WHERE is_active = 1', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.channel_id));
        });
    });
}

// Helper function to check if user is subscribed to required channels
async function checkSubscriptions(userId) {
    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) return true;
    
    try {
        for (const channel of requiredChannels) {
            const member = await bot.getChatMember(channel, userId);
            if (member.status === 'left' || member.status === 'kicked') {
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Error checking subscriptions:', error);
        return false;
    }
}

// Helper function to get user from database
function getUser(userId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Helper function to create or update user
function createOrUpdateUser(user, invitedBy = null) {
    return new Promise((resolve, reject) => {
        const { id, username, first_name } = user;
        
        db.get('SELECT * FROM users WHERE id = ?', [id], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            
            if (row) {
                // Update existing user
                db.run(
                    'UPDATE users SET username = ?, first_name = ? WHERE id = ?',
                    [username, first_name, id],
                    function(err) {
                        if (err) reject(err);
                        else resolve(row);
                    }
                );
            } else {
                // Create new user
                db.run(
                    `INSERT INTO users (id, username, first_name, invited_by) 
                     VALUES (?, ?, ?, ?)`,
                    [id, username, first_name, invitedBy],
                    function(err) {
                        if (err) reject(err);
                        else {
                            // If user was invited, add referral bonus
                            if (invitedBy) {
                                addReferralBonus(invitedBy);
                            }
                            resolve({ id, username, first_name, balance: 0, referrals_count: 0 });
                        }
                    }
                );
            }
        });
    });
}

// Add referral bonus
function addReferralBonus(referrerId) {
    const bonus = 3; // 3 stars for each referral
    
    db.run(
        `UPDATE users SET 
         balance = balance + ?, 
         referrals_count = referrals_count + 1,
         referrals_today = referrals_today + 1
         WHERE id = ?`,
        [bonus, referrerId]
    );
}

// Keyboard layouts
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['👤 Профиль', '👥 Пригласить друзей'],
            ['🎯 Кликер', '💰 Вывод звёзд'],
            ['📋 Задания', '📖 Инструкция'],
            ['🏆 Рейтинги', '🎁 Кейсы'],
            ['🎰 Лотерея']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const backToMainKeyboard = {
    reply_markup: {
        keyboard: [['🏠 В главное меню']],
        resize_keyboard: true
    }
};

// Admin command handler
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа к админ-панели.');
        return;
    }

    const adminMessage = `🔧 Админ-панель

Добро пожаловать в панель администратора!
Выберите действие:`;

    const adminKeyboard = {
        reply_markup: {
            keyboard: [
                ['📊 Статистика', '📋 Управление заданиями'],
                ['📺 Обязательные каналы', '🎰 Управление лотереями'],
                ['🎫 Промокоды', '📢 Рассылка'],
                ['🏠 В главное меню']
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(chatId, adminMessage, adminKeyboard);
});

// Start command handler
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = msg.from;
    const referralCode = match ? match[1] : null;
    
    try {
        // Check if user exists
        let dbUser = await getUser(userId);
        
        if (!dbUser) {
            // New user - check for referral
            let invitedBy = null;
            if (referralCode && !isNaN(referralCode)) {
                const referrer = await getUser(parseInt(referralCode));
                if (referrer) {
                    invitedBy = parseInt(referralCode);
                }
            }
            
            // Create user
            dbUser = await createOrUpdateUser(user, invitedBy);
        }
        
        // Check subscriptions
        const isSubscribed = await checkSubscriptions(userId);
        const requiredChannels = await getRequiredChannels();

        if (!isSubscribed && requiredChannels.length > 0) {
            let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';

            // Get channel names from database
            db.all('SELECT channel_id, channel_name FROM required_channels WHERE is_active = 1', [], (err, channels) => {
                if (!err && channels.length > 0) {
                    channels.forEach((channel, index) => {
                        message += `${index + 1}. ${channel.channel_name || channel.channel_id}\n`;
                    });
                } else {
                    requiredChannels.forEach((channel, index) => {
                        message += `${index + 1}. ${channel}\n`;
                    });
                }

                message += '\nПосле подписки нажмите /start снова';
                bot.sendMessage(chatId, message);
            });
            return;
        }
        
        // Update subscription status
        db.run('UPDATE users SET is_subscribed = 1 WHERE id = ?', [userId]);
        
        // Send welcome message with main menu
        const welcomeMessage = `🌟 Добро пожаловать в бот для заработка звёзд!

Здесь вы можете:
• Приглашать друзей и получать награды
• Выполнять задания
• Участвовать в лотереях
• Открывать кейсы
• И многое другое!

Выберите действие в меню ниже:`;

        bot.sendMessage(chatId, welcomeMessage, mainKeyboard);
        
    } catch (error) {
        console.error('Error in /start:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Admin statistics handler
bot.onText(/📊 Статистика/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        // Get comprehensive statistics
        db.all(`
            SELECT
                COUNT(*) as total_users,
                SUM(balance) as total_balance,
                SUM(referrals_count) as total_referrals,
                COUNT(CASE WHEN datetime(registered_at) >= datetime('now', '-7 days') THEN 1 END) as new_users_week,
                COUNT(CASE WHEN datetime(registered_at) >= datetime('now', '-1 day') THEN 1 END) as new_users_day,
                COUNT(CASE WHEN is_subscribed = 1 AND datetime(registered_at) >= datetime('now', '-7 days') THEN 1 END) as active_week,
                COUNT(CASE WHEN is_subscribed = 1 AND datetime(registered_at) >= datetime('now', '-1 day') THEN 1 END) as active_day
            FROM users
        `, [], (err, stats) => {
            if (err) {
                console.error('Stats error:', err);
                bot.sendMessage(chatId, '❌ Ошибка получения статистики.');
                return;
            }

            const stat = stats[0];

            // Get additional statistics
            db.all(`
                SELECT
                    (SELECT COUNT(*) FROM tasks WHERE is_active = 1) as active_tasks,
                    (SELECT COUNT(*) FROM lotteries WHERE is_active = 1) as active_lotteries,
                    (SELECT COUNT(*) FROM promocodes WHERE is_active = 1) as active_promos,
                    (SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'pending') as pending_withdrawals
            `, [], (err, additional) => {
                if (err) {
                    console.error('Additional stats error:', err);
                    return;
                }

                const add = additional[0];

                const statsMessage = `📊 Статистика бота

👥 **Пользователи:**
• Всего пользователей: ${stat.total_users}
• Активные за неделю: ${stat.active_week}
• Активные за день: ${stat.active_day}
• Новые за неделю: ${stat.new_users_week}
• Новые за день: ${stat.new_users_day}

💰 **Финансы:**
• Общий баланс: ${(stat.total_balance || 0).toFixed(1)} ⭐️
• Всего рефералов: ${stat.total_referrals || 0}

🎯 **Контент:**
• Активных заданий: ${add.active_tasks}
• Активных лотерей: ${add.active_lotteries}
• Активных промокодов: ${add.active_promos}
• Заявок на вывод: ${add.pending_withdrawals}`;

                bot.sendMessage(chatId, statsMessage, {
                    reply_markup: {
                        keyboard: [['🔧 Админ-панель']],
                        resize_keyboard: true
                    }
                });
            });
        });

    } catch (error) {
        console.error('Error in admin stats:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при получении статистики.');
    }
});

// Profile handler
bot.onText(/👤 Профиль/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const user = await getUser(userId);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
            return;
        }
        
        const profileMessage = `👤 Ваш профиль:

👋 Имя: ${user.first_name || 'Не указано'}
🆔 ID: ${user.id}
👥 Всего рефералов: ${user.referrals_count}
📈 Рефералов за день: ${user.referrals_today}
⭐️ Баланс: ${user.balance.toFixed(1)} звёзд`;

        const profileKeyboard = {
            reply_markup: {
                keyboard: [
                    ['🎫 Промокод', '👥 Пригласить друзей'],
                    ['🏠 В главное меню']
                ],
                resize_keyboard: true
            }
        };
        
        bot.sendMessage(chatId, profileMessage, profileKeyboard);
        
    } catch (error) {
        console.error('Error in profile:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке профиля.');
    }
});

// Admin task management handler
bot.onText(/📋 Управление заданиями/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    // Get current tasks
    db.all('SELECT * FROM tasks WHERE is_active = 1 ORDER BY id DESC', [], (err, tasks) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка загрузки заданий.');
            return;
        }

        let message = '📋 **Управление заданиями**\n\n';

        if (tasks.length === 0) {
            message += 'Активных заданий нет.\n\n';
        } else {
            message += '**Активные задания:**\n';
            tasks.forEach((task, index) => {
                message += `${index + 1}. ${task.channel_name}\n`;
                message += `   Канал: ${task.channel_id}\n`;
                message += `   Награда: ${task.reward} ⭐️\n\n`;
            });
        }

        message += '**Команды:**\n';
        message += '• Добавить: /add_task канал|название|награда\n';
        message += '• Удалить: /delete_task [ID]\n';
        message += '• Пример: /add_task @mychannel|Мой канал|2';

        bot.sendMessage(chatId, message, {
            reply_markup: {
                keyboard: [['🔧 Админ-панель']],
                resize_keyboard: true
            },
            parse_mode: 'Markdown'
        });
    });
});

// Add task command
bot.onText(/\/add_task (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const params = match[1].split('|');
    if (params.length !== 3) {
        bot.sendMessage(chatId, '❌ Неверный формат. Используйте: /add_task канал|название|награда');
        return;
    }

    const [channelId, channelName, rewardStr] = params;
    const reward = parseFloat(rewardStr);

    if (isNaN(reward) || reward <= 0) {
        bot.sendMessage(chatId, '❌ Награда должна быть положительным числом.');
        return;
    }

    db.run(
        'INSERT INTO tasks (channel_id, channel_name, reward) VALUES (?, ?, ?)',
        [channelId.trim(), channelName.trim(), reward],
        function(err) {
            if (err) {
                console.error('Add task error:', err);
                bot.sendMessage(chatId, '❌ Ошибка добавления задания.');
                return;
            }

            bot.sendMessage(chatId, `✅ Задание добавлено!\n\nКанал: ${channelName.trim()}\nНаграда: ${reward} ⭐️`);
        }
    );
});

// Delete task command
bot.onText(/\/delete_task (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const taskId = parseInt(match[1]);

    db.run(
        'UPDATE tasks SET is_active = 0 WHERE id = ?',
        [taskId],
        function(err) {
            if (err) {
                console.error('Delete task error:', err);
                bot.sendMessage(chatId, '❌ Ошибка удаления задания.');
                return;
            }

            if (this.changes === 0) {
                bot.sendMessage(chatId, '❌ Задание с таким ID не найдено.');
                return;
            }

            bot.sendMessage(chatId, `✅ Задание #${taskId} удалено.`);
        }
    );
});

// Admin required channels management
bot.onText(/📺 Обязательные каналы/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    // Get current required channels
    db.all('SELECT * FROM required_channels WHERE is_active = 1 ORDER BY id DESC', [], (err, channels) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка загрузки каналов.');
            return;
        }

        let message = '📺 **Обязательные каналы**\n\n';

        if (channels.length === 0) {
            message += 'Обязательных каналов нет.\n\n';
        } else {
            message += '**Активные каналы:**\n';
            channels.forEach((channel, index) => {
                message += `${index + 1}. ${channel.channel_name}\n`;
                message += `   ID: ${channel.channel_id}\n\n`;
            });
        }

        message += '**Команды:**\n';
        message += '• Добавить: /add_channel канал|название\n';
        message += '• Удалить: /delete_channel [ID]\n';
        message += '• Пример: /add_channel @mychannel|Мой канал';

        bot.sendMessage(chatId, message, {
            reply_markup: {
                keyboard: [['🔧 Админ-панель']],
                resize_keyboard: true
            },
            parse_mode: 'Markdown'
        });
    });
});

// Add required channel command
bot.onText(/\/add_channel (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const params = match[1].split('|');
    if (params.length !== 2) {
        bot.sendMessage(chatId, '❌ Неверный формат. Используйте: /add_channel канал|название');
        return;
    }

    const [channelId, channelName] = params;

    db.run(
        'INSERT OR REPLACE INTO required_channels (channel_id, channel_name, is_active) VALUES (?, ?, 1)',
        [channelId.trim(), channelName.trim()],
        function(err) {
            if (err) {
                console.error('Add channel error:', err);
                bot.sendMessage(chatId, '❌ Ошибка добавления канала.');
                return;
            }

            bot.sendMessage(chatId, `✅ Обязательный канал добавлен!\n\nКанал: ${channelName.trim()}\nID: ${channelId.trim()}`);
        }
    );
});

// Delete required channel command
bot.onText(/\/delete_channel (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const channelDbId = parseInt(match[1]);

    db.run(
        'UPDATE required_channels SET is_active = 0 WHERE id = ?',
        [channelDbId],
        function(err) {
            if (err) {
                console.error('Delete channel error:', err);
                bot.sendMessage(chatId, '❌ Ошибка удаления канала.');
                return;
            }

            if (this.changes === 0) {
                bot.sendMessage(chatId, '❌ Канал с таким ID не найден.');
                return;
            }

            bot.sendMessage(chatId, `✅ Обязательный канал #${channelDbId} удален.`);
        }
    );
});

// Invite friends handler
bot.onText(/👥 Пригласить друзей/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    const referralLink = `https://t.me/${(await bot.getMe()).username}?start=${userId}`;
    
    const inviteMessage = `👥 Приглашай друзей и получай по 3 ⭐️ за каждого!

🔗 Твоя реферальная ссылка:
${referralLink}

Поделись этой ссылкой с друзьями, и когда они зарегистрируются через неё, ты получишь бонус!`;
    
    bot.sendMessage(chatId, inviteMessage, backToMainKeyboard);
});

// Universal callback handler
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    if (data.startsWith('withdraw_')) {
        const withdrawalType = data.replace('withdraw_', '');
        let amount;
        let displayName;

        switch (withdrawalType) {
            case '15':
                amount = 15;
                displayName = '15 ⭐️';
                break;
            case '25':
                amount = 25;
                displayName = '25 ⭐️';
                break;
            case '50':
                amount = 50;
                displayName = '50 ⭐️';
                break;
            case '100':
                amount = 100;
                displayName = '100 ⭐️';
                break;
            case 'premium':
                amount = 1300;
                displayName = 'Telegram Premium на 3 месяца (1300 ⭐️)';
                break;
            default:
                bot.answerCallbackQuery(callbackQuery.id, '❌ Неверная сумма');
                return;
        }

        try {
            const user = await getUser(userId);

            if (!user) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Пользователь не найден');
                return;
            }

            if (user.balance < amount) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Недостаточно средств');
                return;
            }

            // Create withdrawal request
            db.run(
                'INSERT INTO withdrawal_requests (user_id, amount, type) VALUES (?, ?, ?)',
                [userId, amount, displayName],
                function(err) {
                    if (err) {
                        console.error('Withdrawal request error:', err);
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка создания заявки');
                        return;
                    }

                    const requestId = this.lastID;

                    // Send request to admin channel
                    const adminMessage = `💰 Новая заявка на вывод #${requestId}

👤 Пользователь: ${user.first_name || 'Неизвестно'}
🆔 ID: ${user.id}
👤 Username: @${user.username || 'нет'}
🔗 Ссылка: tg://user?id=${user.id}
💰 Сумма: ${displayName}
⭐️ Баланс до вывода: ${user.balance.toFixed(1)}

Выберите действие:`;

                    const adminKeyboard = {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Выполнено', callback_data: `approve_${requestId}` },
                                    { text: '❌ Отклонено', callback_data: `reject_${requestId}` }
                                ]
                            ]
                        }
                    };

                    bot.sendMessage(ADMIN_CHANNEL, adminMessage, adminKeyboard);

                    // Confirm to user
                    bot.answerCallbackQuery(callbackQuery.id, '✅ Заявка создана!');
                    bot.editMessageText(
                        `✅ Заявка на вывод ${displayName} создана!

Ожидайте обработки администратором.
Обычно это занимает до 24 часов.`,
                        {
                            chat_id: message.chat.id,
                            message_id: message.message_id
                        }
                    );
                }
            );

        } catch (error) {
            console.error('Withdrawal callback error:', error);
            bot.answerCallbackQuery(callbackQuery.id, '❌ Произошла ошибка');
        }
    }

    // Admin approval/rejection
    else if (data.startsWith('approve_') || data.startsWith('reject_')) {
        const [action, requestId] = data.split('_');

        db.get('SELECT * FROM withdrawal_requests WHERE id = ?', [requestId], (err, request) => {
            if (err || !request) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Заявка не найдена');
                return;
            }

            if (request.status !== 'pending') {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Заявка уже обработана');
                return;
            }

            if (action === 'approve') {
                // Approve withdrawal
                db.run(
                    'UPDATE withdrawal_requests SET status = "approved", processed_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [requestId]
                );

                // Deduct balance
                db.run(
                    'UPDATE users SET balance = balance - ? WHERE id = ?',
                    [request.amount, request.user_id]
                );

                // Notify user
                bot.sendMessage(request.user_id, `🎉 Поздравляем! Ваша заявка на вывод ${request.type} одобрена!

⭐️ Звёзды уже отправлены на ваш аккаунт.
Спасибо за использование нашего бота!`);

                // Update admin message
                bot.editMessageText(
                    `✅ ОДОБРЕНО\n\n${message.text}`,
                    {
                        chat_id: message.chat.id,
                        message_id: message.message_id
                    }
                );

                bot.answerCallbackQuery(callbackQuery.id, '✅ Заявка одобрена');

            } else if (action === 'reject') {
                // For rejection, we should ask for reason, but for now just reject
                db.run(
                    'UPDATE withdrawal_requests SET status = "rejected", processed_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [requestId]
                );

                // Notify user (TODO: add reason input)
                bot.sendMessage(request.user_id, `❌ К сожалению, ваша заявка на вывод ${request.type} была отклонена.

Если у вас есть вопросы, обратитесь к администратору.`);

                // Update admin message
                bot.editMessageText(
                    `❌ ОТКЛОНЕНО\n\n${message.text}`,
                    {
                        chat_id: message.chat.id,
                        message_id: message.message_id
                    }
                );

                bot.answerCallbackQuery(callbackQuery.id, '❌ Заявк�� отклонена');
            }
        });
    }

    // Ratings callbacks
    else if (data === 'rating_all') {
        db.all(`
            SELECT first_name, referrals_count, id
            FROM users
            WHERE referrals_count > 0
            ORDER BY referrals_count DESC
            LIMIT 10
        `, [], (err, rows) => {
            if (err) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка загрузки рейтинга');
                return;
            }

            let ratingText = '🏆 Общий рейтинг по рефералам:\n\n';

            if (rows.length === 0) {
                ratingText += 'Пока никто не пригласил рефералов 😔';
            } else {
                rows.forEach((user, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                    ratingText += `${medal} ${user.first_name || 'Неизвестно'} - ${user.referrals_count} рефералов\n`;
                });
            }

            bot.editMessageText(ratingText, {
                chat_id: message.chat.id,
                message_id: message.message_id
            });
        });

        bot.answerCallbackQuery(callbackQuery.id);
    }

    else if (data === 'rating_week') {
        db.all(`
            SELECT first_name, referrals_today, id
            FROM users
            WHERE referrals_today > 0
            ORDER BY referrals_today DESC
            LIMIT 10
        `, [], (err, rows) => {
            if (err) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка загрузки рейтинга');
                return;
            }

            let ratingText = '📅 Рейтинг за сегодня:\n\n';

            if (rows.length === 0) {
                ratingText += 'Сегодня никто не пригласил рефералов 😔';
            } else {
                rows.forEach((user, index) => {
                    const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                    ratingText += `${medal} ${user.first_name || 'Неизвестно'} - ${user.referrals_today} рефералов\n`;
                });
            }

            bot.editMessageText(ratingText, {
                chat_id: message.chat.id,
                message_id: message.message_id
            });
        });

        bot.answerCallbackQuery(callbackQuery.id);
    }

    // Case opening callback
    else if (data === 'open_case') {
        try {
            const user = await getUser(userId);

            if (!user || user.referrals_today < 3) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Недостаточно рефералов');
                return;
            }

            const today = new Date().toDateString();
            const lastCaseOpen = user.last_case_open ? new Date(user.last_case_open).toDateString() : null;

            if (lastCaseOpen === today) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Уже открывали сегодня');
                return;
            }

            // Generate random reward (1-10 stars)
            const reward = Math.floor(Math.random() * 10) + 1;

            // Update user
            db.run(
                `UPDATE users SET
                 balance = balance + ?,
                 last_case_open = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [reward, userId],
                function(err) {
                    if (err) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка открытия кейса');
                        return;
                    }

                    bot.answerCallbackQuery(callbackQuery.id, `🎉 Поздравляем! +${reward} ⭐️`);
                    bot.editMessageText(
                        `🎁 Кейс открыт!

🎉 Поздравляем! Вы получили ${reward} ⭐️!

Приходите завтра за новым кейсом!`,
                        {
                            chat_id: message.chat.id,
                            message_id: message.message_id
                        }
                    );
                }
            );

        } catch (error) {
            console.error('Case opening error:', error);
            bot.answerCallbackQuery(callbackQuery.id, '❌ Произо��ла ошибка');
        }
    }

    // Buy lottery ticket callback
    else if (data.startsWith('buy_ticket_')) {
        const lotteryId = data.replace('buy_ticket_', '');

        try {
            const user = await getUser(userId);

            if (!user) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Пользователь не найден');
                return;
            }

            // Check if lottery exists and is active
            db.get('SELECT * FROM lotteries WHERE id = ? AND is_active = 1', [lotteryId], (err, lottery) => {
                if (err || !lottery) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Лотерея не найдена');
                    return;
                }

                // Check if user already has a ticket for this lottery
                db.get('SELECT * FROM lottery_tickets WHERE lottery_id = ? AND user_id = ?', [lotteryId, userId], (err, existingTicket) => {
                    if (err) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка проверки билетов');
                        return;
                    }

                    if (existingTicket) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ У вас уже есть билет на эту лотерею');
                        return;
                    }

                    // Check if user has enough balance
                    if (user.balance < lottery.ticket_price) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Недостаточно средств');
                        return;
                    }

                    // Check if there are available tickets
                    if (lottery.current_tickets >= lottery.max_tickets) {
                        bot.answerCallbackQuery(callbackQuery.id, '❌ Все билеты проданы');
                        return;
                    }

                    // Buy ticket
                    db.run('INSERT INTO lottery_tickets (lottery_id, user_id) VALUES (?, ?)', [lotteryId, userId], function(err) {
                        if (err) {
                            bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка покупки билета');
                            return;
                        }

                        // Deduct balance and update lottery
                        db.run('UPDATE users SET balance = balance - ? WHERE id = ?', [lottery.ticket_price, userId]);
                        db.run('UPDATE lotteries SET current_tickets = current_tickets + 1 WHERE id = ?', [lotteryId]);

                        bot.answerCallbackQuery(callbackQuery.id, '✅ Билет куплен!');

                        // Check if lottery is full
                        if (lottery.current_tickets + 1 >= lottery.max_tickets) {
                            // Draw winners
                            setTimeout(() => drawLotteryWinners(lotteryId), 1000);
                        }

                        bot.editMessageText(
                            `🎫 Билет куплен!

Вы купили билет на лотерею "${lottery.name}"
Потрачено: ${lottery.ticket_price} ⭐️

Результаты будут объявлены когда закончатся все билеты.`,
                            {
                                chat_id: message.chat.id,
                                message_id: message.message_id
                            }
                        );
                    });
                });
            });

        } catch (error) {
            console.error('Ticket purchase error:', error);
            bot.answerCallbackQuery(callbackQuery.id, '❌ Произошла ошибка');
        }
    }

    // Task check callback
    else if (data.startsWith('check_task_')) {
        const taskId = data.replace('check_task_', '');

        // Get task details
        db.get('SELECT * FROM tasks WHERE id = ?', [taskId], async (err, task) => {
            if (err || !task) {
                bot.answerCallbackQuery(callbackQuery.id, '❌ Задание не найдено');
                return;
            }

            try {
                // Check if user is subscribed to the channel
                const member = await bot.getChatMember(task.channel_id, userId);

                if (member.status === 'left' || member.status === 'kicked') {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Вы не подписаны на канал!');
                    return;
                }

                // Mark task as completed
                db.run(
                    'INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)',
                    [userId, taskId],
                    function(err) {
                        if (err) {
                            bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка сохранения');
                            return;
                        }

                        // Add reward to user balance
                        db.run(
                            'UPDATE users SET balance = balance + ? WHERE id = ?',
                            [task.reward, userId]
                        );

                        bot.answerCallbackQuery(callbackQuery.id, `✅ Задание выполнено! +${task.reward} ⭐️`);
                        bot.editMessageText(
                            `✅ Задание выполнено!\n\nВы получили ${task.reward} ⭐️\n\nДля следующего задания нажмите "Задания" в меню.`,
                            {
                                chat_id: message.chat.id,
                                message_id: message.message_id
                            }
                        );
                    }
                );

            } catch (checkError) {
                console.error('Subscription check error:', checkError);
                bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка проверки подписки');
            }
        });
    }

    else if (data.startsWith('skip_task_')) {
        const taskId = data.replace('skip_task_', '');

        // Mark task as completed (skipped)
        db.run(
            'INSERT INTO user_tasks (user_id, task_id) VALUES (?, ?)',
            [userId, taskId],
            function(err) {
                if (err) {
                    bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка');
                    return;
                }

                bot.answerCallbackQuery(callbackQuery.id, '⏭️ Задание пропущено');
                bot.editMessageText(
                    `⏭️ Задание пропущено\n\nДля следующего задания нажмите "Задания" в меню.`,
                    {
                        chat_id: message.chat.id,
                        message_id: message.message_id
                    }
                );
            }
        );
    }

    // Handle broadcast callbacks
    else if (data.startsWith('broadcast_')) {
        if (!isAdmin(userId)) {
            bot.answerCallbackQuery(callbackQuery.id, '❌ У вас нет прав доступа.');
            return;
        }

        if (data === 'broadcast_tasks') {
            // Broadcast about new tasks
            const broadcastMsg = '🎯 Новые задания ждут тебя!\n\nЗаходи и выполняй задания, чтобы заработать больше звёзд!';
            const broadcastKeyboard = {
                reply_markup: {
                    keyboard: [
                        ['📋 Задания', '🏠 Главное меню']
                    ],
                    resize_keyboard: true
                }
            };

            sendBroadcast(broadcastMsg, broadcastKeyboard, message.chat.id);
            bot.answerCallbackQuery(callbackQuery.id, '📢 Рассылка запущена!');

        } else if (data === 'broadcast_top') {
            // Broadcast about top referrals
            const broadcastMsg = '🏆 Попади в топ 5 по рефералам и получи еженедельные призы!\n\nПриглашай друзей и зарабатывай больше!';
            const broadcastKeyboard = {
                reply_markup: {
                    keyboard: [
                        ['👥 Пригласить друга', '🏠 Главное меню']
                    ],
                    resize_keyboard: true
                }
            };

            sendBroadcast(broadcastMsg, broadcastKeyboard, message.chat.id);
            bot.answerCallbackQuery(callbackQuery.id, '📢 Рассылка запущена!');

        } else if (data === 'broadcast_custom') {
            bot.sendMessage(message.chat.id, '✍️ Введите текст для рассылки:', {
                reply_markup: { force_reply: true }
            });
            bot.answerCallbackQuery(callbackQuery.id);
        }
    }
});

// Tasks handler
bot.onText(/📋 Задания/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Get available task for user
        db.get(`
            SELECT t.* FROM tasks t
            LEFT JOIN user_tasks ut ON t.id = ut.task_id AND ut.user_id = ?
            WHERE t.is_active = 1 AND ut.task_id IS NULL
            ORDER BY t.id ASC
            LIMIT 1
        `, [userId], async (err, task) => {
            if (err) {
                console.error('Tasks error:', err);
                bot.sendMessage(chatId, '❌ Ошибка загрузки заданий.');
                return;
            }

            if (!task) {
                bot.sendMessage(chatId, '🎉 Вы выполнили все доступные задания!\n\nЗаходите позже, возможно появятся новые.', backToMainKeyboard);
                return;
            }

            const taskMessage = `📋 Доступное задание:

📺 Подпишитесь на канал: ${task.channel_name}
💰 Награда: ${task.reward} ⭐️

После подписки нажмите "Проверить"`;

            const taskKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📺 Выполнить', url: `https://t.me/${task.channel_id.replace('@', '')}` },
                            { text: '✅ Проверить', callback_data: `check_task_${task.id}` }
                        ],
                        [
                            { text: '⏭️ Пропустить задание', callback_data: `skip_task_${task.id}` }
                        ]
                    ]
                }
            };

            bot.sendMessage(chatId, taskMessage, taskKeyboard);
        });

    } catch (error) {
        console.error('Error in tasks:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
});

// Ratings handler
bot.onText(/🏆 Рейтинги/, (msg) => {
    const chatId = msg.chat.id;

    const ratingsMessage = `🏆 Рейтинги

Выберите тип рейтинга:`;

    const ratingsKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🏆 Общий рейтинг', callback_data: 'rating_all' },
                    { text: '📅 За неделю', callback_data: 'rating_week' }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, ratingsMessage, ratingsKeyboard);
});

// Cases handler
bot.onText(/🎁 Кейсы/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const user = await getUser(userId);

        if (!user) {
            bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
            return;
        }

        const today = new Date().toDateString();
        const lastCaseOpen = user.last_case_open ? new Date(user.last_case_open).toDateString() : null;

        if (lastCaseOpen === today) {
            bot.sendMessage(chatId, '📦 Вы уже открывали кейс сегодня!\n\nПриходите завтра за новым кейсом.', backToMainKeyboard);
            return;
        }

        if (user.referrals_today < 3) {
            const casesMessage = `🎁 Кейсы

📦 Для открытия кейса необходимо пригласить минимум 3 рефералов за день.

👥 Приглашено сегодня: ${user.referrals_today}/3

Пригласите ещё ${3 - user.referrals_today} друзей, чтобы открыть кейс!`;

            bot.sendMessage(chatId, casesMessage, backToMainKeyboard);
            return;
        }

        const casesMessage = `🎁 Доступен кейс!

📦 Вы можете открыть кейс и получить от 1 до 10 ⭐️!
👥 Рефералов сегодня: ${user.referrals_today}

Откроете кейс?`;

        const casesKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎁 Открыть кейс', callback_data: 'open_case' }]
                ]
            }
        };

        bot.sendMessage(chatId, casesMessage, casesKeyboard);

    } catch (error) {
        console.error('Error in cases:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
});

// Lottery handler
bot.onText(/🎰 Лотерея/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        // Get active lotteries
        db.all('SELECT * FROM lotteries WHERE is_active = 1', [], (err, lotteries) => {
            if (err) {
                console.error('Lottery error:', err);
                bot.sendMessage(chatId, '❌ Ошибка загрузки лотерей.');
                return;
            }

            if (lotteries.length === 0) {
                bot.sendMessage(chatId, '🎰 В данный момент нет активных лотерей.\n\nСледите за обновлениями!', backToMainKeyboard);
                return;
            }

            let lotteryMessage = '🎰 Доступные лотереи:\n\n';
            const lotteryKeyboard = {
                reply_markup: {
                    inline_keyboard: []
                }
            };

            lotteries.forEach((lottery, index) => {
                const remainingTickets = lottery.max_tickets - lottery.current_tickets;
                lotteryMessage += `${index + 1}. ${lottery.name}\n`;
                lotteryMessage += `💰 Цена билета: ${lottery.ticket_price} ⭐️\n`;
                lotteryMessage += `🎫 Осталось билетов: ${remainingTickets}/${lottery.max_tickets}\n`;
                lotteryMessage += `🏆 Победителей: ${lottery.winners_count}\n\n`;

                if (remainingTickets > 0) {
                    lotteryKeyboard.reply_markup.inline_keyboard.push([
                        { text: `🎫 Купить билет (${lottery.ticket_price} ⭐️)`, callback_data: `buy_ticket_${lottery.id}` }
                    ]);
                }
            });

            if (lotteryKeyboard.reply_markup.inline_keyboard.length === 0) {
                lotteryMessage += '❌ Все билеты проданы. Ожидайте результатов!';
            }

            bot.sendMessage(chatId, lotteryMessage, lotteryKeyboard);
        });

    } catch (error) {
        console.error('Error in lottery:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
});

// Function to draw lottery winners
function drawLotteryWinners(lotteryId) {
    db.get('SELECT * FROM lotteries WHERE id = ?', [lotteryId], (err, lottery) => {
        if (err || !lottery) return;

        // Get all participants
        db.all('SELECT * FROM lottery_tickets WHERE lottery_id = ?', [lotteryId], (err, tickets) => {
            if (err || tickets.length === 0) return;

            // Shuffle and select winners
            const shuffled = tickets.sort(() => 0.5 - Math.random());
            const winners = shuffled.slice(0, lottery.winners_count);

            // Calculate prize per winner (90% of total, 10% for bot)
            const totalPrize = lottery.max_tickets * lottery.ticket_price;
            const prizePool = totalPrize * 0.9;
            const prizePerWinner = prizePool / lottery.winners_count;

            // Award prizes
            winners.forEach(winner => {
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [prizePerWinner, winner.user_id]);

                // Notify winner
                bot.sendMessage(winner.user_id, `🎉 Поздравляем! Вы выиграли в лотерее "${lottery.name}"!

💰 Ваш выигрыш: ${prizePerWinner.toFixed(1)} ⭐️

Приз зачислен на ваш баланс!`);
            });

            // Mark lottery as inactive
            db.run('UPDATE lotteries SET is_active = 0 WHERE id = ?', [lotteryId]);

            // Notify all participants about results
            tickets.forEach(ticket => {
                const isWinner = winners.some(w => w.user_id === ticket.user_id);
                if (!isWinner) {
                    bot.sendMessage(ticket.user_id, `🎰 Результаты лотереи "${lottery.name}" объявлены!

К сожалению, вы не выиграли в этот раз.
Но не расстраивайтесь - скоро будут новые лотереи!`);
                }
            });
        });
    });
}

// Admin lottery management
bot.onText(/🎰 Управление лотереями/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    // Get current lotteries
    db.all('SELECT * FROM lotteries WHERE is_active = 1 ORDER BY id DESC', [], (err, lotteries) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка загрузки лотерей.');
            return;
        }

        let message = '🎰 **Управление лотереями**\n\n';

        if (lotteries.length === 0) {
            message += 'Активных лотерей нет.\n\n';
        } else {
            message += '**Активные лотереи:**\n';
            lotteries.forEach((lottery, index) => {
                message += `${index + 1}. ${lottery.name}\n`;
                message += `   Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
                message += `   Цена: ${lottery.ticket_price} ⭐️\n`;
                message += `   Победителей: ${lottery.winners_count}\n\n`;
            });
        }

        message += '**Команды:**\n';
        message += '• Создать: /add_lottery название|билеты|цена|победители|%\n';
        message += '• Пример: /add_lottery Супер лотерея|100|5|10|10';

        bot.sendMessage(chatId, message, {
            reply_markup: {
                keyboard: [['🔧 Админ-панель']],
                resize_keyboard: true
            },
            parse_mode: 'Markdown'
        });
    });
});

// Add lottery command
bot.onText(/\/add_lottery (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const params = match[1].split('|');
    if (params.length !== 5) {
        bot.sendMessage(chatId, '❌ Неверный формат. Используйте: /add_lottery название|билеты|цена|победители|%');
        return;
    }

    const [name, maxTicketsStr, priceStr, winnersStr, percentStr] = params;
    const maxTickets = parseInt(maxTicketsStr);
    const price = parseFloat(priceStr);
    const winners = parseInt(winnersStr);
    const percent = parseFloat(percentStr);

    if (isNaN(maxTickets) || isNaN(price) || isNaN(winners) || isNaN(percent) ||
        maxTickets <= 0 || price <= 0 || winners <= 0 || percent < 0 || percent > 100) {
        bot.sendMessage(chatId, '❌ Неверные числовые значения.');
        return;
    }

    db.run(
        'INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count) VALUES (?, ?, ?, ?)',
        [name.trim(), price, maxTickets, winners],
        function(err) {
            if (err) {
                console.error('Add lottery error:', err);
                bot.sendMessage(chatId, '❌ Ошибка со��дания лотереи.');
                return;
            }

            bot.sendMessage(chatId, `✅ Лотерея создана!\n\nНазвание: ${name.trim()}\nБилетов: ${maxTickets}\nЦена: ${price} ⭐️\nПобедителей: ${winners}\nПроцент боту: ${percent}%`);
        }
    );
});

// Admin promocodes management
bot.onText(/🎫 Промокоды/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    // Get current promocodes
    db.all('SELECT * FROM promocodes WHERE is_active = 1 ORDER BY id DESC', [], (err, promos) => {
        if (err) {
            bot.sendMessage(chatId, '❌ Ошибка загрузки промокодов.');
            return;
        }

        let message = '🎫 **Управление промокодами**\n\n';

        if (promos.length === 0) {
            message += 'Активных промокодов нет.\n\n';
        } else {
            message += '**Активные промокоды:**\n';
            promos.forEach((promo, index) => {
                message += `${index + 1}. **${promo.code}**\n`;
                message += `   Награда: ${promo.reward} ⭐️\n`;
                message += `   Использований: ${promo.current_uses}/${promo.max_uses}\n\n`;
            });
        }

        message += '**Команды:**\n';
        message += '• Создать: /add_promo код|звёзды|активации\n';
        message += '• Пример: /add_promo STARS50|0.5|100';

        bot.sendMessage(chatId, message, {
            reply_markup: {
                keyboard: [['🔧 Админ-панель']],
                resize_keyboard: true
            },
            parse_mode: 'Markdown'
        });
    });
});

// Add promocode command
bot.onText(/\/add_promo (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const params = match[1].split('|');
    if (params.length !== 3) {
        bot.sendMessage(chatId, '❌ Неверный формат. Используйте: /add_promo код|звёзды|активации');
        return;
    }

    const [code, rewardStr, maxUsesStr] = params;
    const reward = parseFloat(rewardStr);
    const maxUses = parseInt(maxUsesStr);

    if (isNaN(reward) || isNaN(maxUses) || reward <= 0 || maxUses <= 0) {
        bot.sendMessage(chatId, '❌ Неверные числовые значения.');
        return;
    }

    db.run(
        'INSERT INTO promocodes (code, reward, max_uses) VALUES (?, ?, ?)',
        [code.trim().toUpperCase(), reward, maxUses],
        function(err) {
            if (err) {
                if (err.code === 'SQLITE_CONSTRAINT') {
                    bot.sendMessage(chatId, '❌ Промокод уже существует.');
                } else {
                    console.error('Add promo error:', err);
                    bot.sendMessage(chatId, '❌ Ошибка создания промокода.');
                }
                return;
            }

            bot.sendMessage(chatId, `✅ Промокод создан!\n\nКод: **${code.trim().toUpperCase()}**\nНаграда: ${reward} ⭐️\nАктиваций: ${maxUses}`, {parse_mode: 'Markdown'});
        }
    );
});

// Promocode usage handler
bot.onText(/🎫 Промокод/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    bot.sendMessage(chatId, '🎫 Введите промокод:', {
        reply_markup: {
            force_reply: true
        }
    });
});

// Handle promocode input and custom broadcast input
bot.on('message', (msg) => {
    if (msg.reply_to_message && msg.reply_to_message.text === '🎫 Введите промокод:') {
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const code = msg.text.trim().toUpperCase();

        // Check if promocode exists and is active
        db.get('SELECT * FROM promocodes WHERE code = ? AND is_active = 1', [code], (err, promo) => {
            if (err || !promo) {
                bot.sendMessage(chatId, '❌ Промокод не найден или неактивен.');
                return;
            }

            // Check if user already used this promocode
            db.get('SELECT * FROM promocode_usage WHERE user_id = ? AND promocode_id = ?', [userId, promo.id], (err, usage) => {
                if (err) {
                    bot.sendMessage(chatId, '❌ Ошибка проверки промокода.');
                    return;
                }

                if (usage) {
                    bot.sendMessage(chatId, '❌ Вы уже использовали этот промокод.');
                    return;
                }

                // Check if promocode has uses left
                if (promo.current_uses >= promo.max_uses) {
                    bot.sendMessage(chatId, '❌ Промокод исчерпан.');
                    return;
                }

                // Use promocode
                db.run('INSERT INTO promocode_usage (user_id, promocode_id) VALUES (?, ?)', [userId, promo.id]);
                db.run('UPDATE promocodes SET current_uses = current_uses + 1 WHERE id = ?', [promo.id]);
                db.run('UPDATE users SET balance = balance + ? WHERE id = ?', [promo.reward, userId]);

                bot.sendMessage(chatId, `✅ Промокод активирован!\n\nВы получили ${promo.reward} ⭐️!`);
            });
        });
    }

    // Handle custom broadcast input
    if (msg.reply_to_message && msg.reply_to_message.text === '✍️ Введите текст для рассылки:') {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!isAdmin(userId)) {
            bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
            return;
        }

        const customMessage = msg.text;
        sendBroadcast(customMessage, null, chatId);
        bot.sendMessage(chatId, '📢 Рассылка запущена!');
    }
});

// Clicker handler
bot.onText(/🎯 Кликер/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    try {
        const user = await getUser(userId);
        
        if (!user) {
            bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
            return;
        }
        
        const today = new Date().toDateString();
        const lastClick = user.last_click ? new Date(user.last_click).toDateString() : null;
        
        if (lastClick === today) {
            bot.sendMessage(chatId, '⏰ Вы уже использовали кликер сегодня! Приходите завтра.', backToMainKeyboard);
            return;
        }
        
        // Add clicker reward
        const reward = 0.1;
        
        db.run(
            'UPDATE users SET balance = balance + ?, last_click = CURRENT_TIMESTAMP WHERE id = ?',
            [reward, userId],
            function(err) {
                if (err) {
                    console.error('Clicker error:', err);
                    bot.sendMessage(chatId, '❌ Произошла ошибка.');
                    return;
                }
                
                bot.sendMessage(chatId, `🎯 Отлично! Вы получили ${reward} ⭐️!\n\nПриходите завтра за новой наградой!`, backToMainKeyboard);
            }
        );
        
    } catch (error) {
        console.error('Error in clicker:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
});

// Withdrawal handler
bot.onText(/💰 Вывод звёзд/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const user = await getUser(userId);

        if (!user) {
            bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start');
            return;
        }

        if (user.referrals_count < 5) {
            const withdrawalMessage = `💰 Вывод звёзд

⭐️ Ваш баланс: ${user.balance.toFixed(1)} звёзд
👥 Рефералов: ${user.referrals_count}/5

❌ Для вывода средств требуется минимум 5 рефералов!

Пригласите ещё ${5 - user.referrals_count} друзей, чтобы разблокировать вывод.`;

            bot.sendMessage(chatId, withdrawalMessage, backToMainKeyboard);
            return;
        }

        const withdrawalMessage = `💰 Вывод звёзд

⭐️ Ваш баланс: ${user.balance.toFixed(1)} звёзд
👥 Рефералов: ${user.referrals_count}

Выберите сумму для вывода:`;

        const withdrawalKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '15 ⭐️', callback_data: 'withdraw_15' },
                        { text: '25 ⭐️', callback_data: 'withdraw_25' }
                    ],
                    [
                        { text: '50 ⭐️', callback_data: 'withdraw_50' },
                        { text: '100 ⭐️', callback_data: 'withdraw_100' }
                    ],
                    [
                        { text: 'Telegram Premium (1300 ⭐️)', callback_data: 'withdraw_premium' }
                    ]
                ]
            }
        };

        bot.sendMessage(chatId, withdrawalMessage, withdrawalKeyboard);

    } catch (error) {
        console.error('Error in withdrawal:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка.');
    }
});

// Instruction handler
bot.onText(/📖 Инструкция/, (msg) => {
    const chatId = msg.chat.id;

    const instruction = `📖 Инструкция по использованию бота

🌟 Как заработать звёзды:

1️⃣ Приглашайте друзей - получайте по 3 ⭐️ за каждого
2️⃣ Выполняйте задания - подписывайтесь на каналы
3️⃣ Используйте ежедневный кликер - получайте 0.1 ⭐️ в день
4️⃣ Открывайте кейсы (при 3+ рефералах в день)
5️⃣ Участвуйте в лотереях

💰 Вывод средств:
- Минимум 5 рефералов для вывода
- Доступные суммы: 15, 25, 50, 100 ⭐️
- Telegram Premium за 1300 ⭐️

🏆 Рейтинги:
- Общий рейтинг по количеству рефералов
- Рейтинг за неделю

❓ Вопросы? Обратитесь к администратору.`;

    bot.sendMessage(chatId, instruction, backToMainKeyboard);
});

// Admin broadcast management
bot.onText(/📢 Рассылка/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const broadcastMessage = `📢 **Управление рассылкой**

Выберите тип рассылки:`;

    const broadcastKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📋 Новые задания', callback_data: 'broadcast_tasks' },
                    { text: '🏆 Топ рефералов', callback_data: 'broadcast_top' }
                ],
                [
                    { text: '✍️ Своё сообщение', callback_data: 'broadcast_custom' }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, broadcastMessage, broadcastKeyboard);
});

// Function to send broadcast to all users
function sendBroadcast(message, keyboard, adminChatId) {
    db.all('SELECT id FROM users WHERE is_subscribed = 1', [], (err, users) => {
        if (err) {
            bot.sendMessage(adminChatId, '❌ Ошибка получения списка пользователей.');
            return;
        }

        let sent = 0;
        let failed = 0;

        bot.sendMessage(adminChatId, `📤 Начинаю рассылку для ${users.length} пользователей...`);

        users.forEach((user, index) => {
            setTimeout(() => {
                const options = keyboard ? keyboard : {};

                bot.sendMessage(user.id, message, options)
                    .then(() => {
                        sent++;
                    })
                    .catch((error) => {
                        failed++;
                        console.error(`Broadcast failed for user ${user.id}:`, error.message);
                    })
                    .finally(() => {
                        // Report progress every 50 users or at the end
                        if ((index + 1) % 50 === 0 || index === users.length - 1) {
                            bot.sendMessage(adminChatId,
                                `📊 Прогресс рассылки: ${index + 1}/${users.length}\n✅ Отправлено: ${sent}\n❌ Ошибок: ${failed}`
                            );
                        }
                    });
            }, index * 100); // 100ms delay between messages to avoid rate limits
        });
    });
}

// Admin panel shortcut
bot.onText(/🔧 Админ-панель/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа к админ-панели.');
        return;
    }

    const adminMessage = `🔧 Админ-панель

Добро пожаловать в панель администратора!
Выберите действие:`;

    const adminKeyboard = {
        reply_markup: {
            keyboard: [
                ['📊 Статистика', '📋 Управление заданиями'],
                ['📺 Обязательные каналы', '🎰 Управление лотереями'],
                ['�� Промокоды', '📢 Рассылка'],
                ['🏠 В главное меню']
            ],
            resize_keyboard: true
        }
    };

    bot.sendMessage(chatId, adminMessage, adminKeyboard);
});

// Back to main menu handler
bot.onText(/🏠 В главное меню/, (msg) => {
    const chatId = msg.chat.id;

    bot.sendMessage(chatId, '🏠 Главное меню:', mainKeyboard);
});

// Reset daily referrals at midnight
cron.schedule('0 0 * * *', () => {
    db.run('UPDATE users SET referrals_today = 0');
    console.log('Daily referrals reset');
});

console.log('Bot started successfully!');
