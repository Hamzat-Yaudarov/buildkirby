const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./database');

// Bot token - should be set via environment variable
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';
const bot = new TelegramBot(token, { polling: true });

// Admin configuration
const ADMIN_ID = 6910097562;
const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';

// Initialize database
async function startBot() {
    try {
        console.log('🚀 Starting Telegram bot with PostgreSQL...');
        
        // Initialize database schema
        await db.initializeDatabase();
        
        console.log('✅ Bot started successfully!');
    } catch (error) {
        console.error('❌ Error starting bot:', error);
        process.exit(1);
    }
}

// Helper function to check if user is admin
function isAdmin(userId) {
    return userId === ADMIN_ID;
}

// Helper function to get required channels from database
async function getRequiredChannels() {
    try {
        const result = await db.executeQuery('SELECT channel_id FROM required_channels WHERE is_active = TRUE');
        return result.rows.map(row => row.channel_id);
    } catch (error) {
        console.error('Error getting required channels:', error);
        return [];
    }
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

// Helper function to create main menu inline keyboard
function getMainMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '👤 Профиль', callback_data: 'menu_profile' },
                    { text: '👥 Пригласить друзей', callback_data: 'menu_invite' }
                ],
                [
                    { text: '🎯 Кликер', callback_data: 'menu_clicker' },
                    { text: '⭐ Вывод звёзд', callback_data: 'menu_withdraw' }
                ],
                [
                    { text: '📋 Задания', callback_data: 'menu_tasks' },
                    { text: '📖 Инструкция', callback_data: 'menu_instruction' }
                ],
                [
                    { text: '🏆 Рейтинги', callback_data: 'menu_ratings' },
                    { text: '🎁 Кейсы', callback_data: 'menu_cases' }
                ],
                [
                    { text: '🎰 Лотерея', callback_data: 'menu_lottery' }
                ]
            ]
        }
    };
}

// Helper function to create admin menu inline keyboard
function getAdminMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '📊 Статистика', callback_data: 'admin_stats' },
                    { text: '📋 Управление задачами', callback_data: 'admin_tasks' }
                ],
                [
                    { text: '🎰 Управление лотереей', callback_data: 'admin_lottery' },
                    { text: '🎁 Промокоды', callback_data: 'admin_promocodes' }
                ],
                [
                    { text: '📢 Рассылка', callback_data: 'admin_broadcast' },
                    { text: '💰 Заявки на вывод', callback_data: 'admin_withdrawals' }
                ],
                [
                    { text: '🔙 Главное меню', callback_data: 'back_to_main' }
                ]
            ]
        }
    };
}

// Helper function to create back button
function getBackButton(callbackData = 'back_to_main') {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔙 Назад', callback_data: callbackData }]
            ]
        }
    };
}

// Start command handler
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = msg.from;
    const referralCode = match ? match[1].trim() : null;
    
    try {
        // Check if user exists
        let dbUser = await db.getUser(userId);
        
        if (!dbUser) {
            // New user - check for referral
            let invitedBy = null;
            if (referralCode && !isNaN(referralCode)) {
                const referrer = await db.getUser(parseInt(referralCode));
                if (referrer) {
                    invitedBy = parseInt(referralCode);
                }
            }
            
            // Create user
            dbUser = await db.createOrUpdateUser(user, invitedBy);
        }
        
        // Check subscriptions
        const isSubscribed = await checkSubscriptions(userId);
        const requiredChannels = await getRequiredChannels();

        if (!isSubscribed && requiredChannels.length > 0) {
            let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';

            // Get channel names from database
            try {
                const result = await db.executeQuery('SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE');
                result.rows.forEach((channel, index) => {
                    message += `${index + 1}. ${channel.channel_name || channel.channel_id}\n`;
                });
            } catch (error) {
                requiredChannels.forEach((channel, index) => {
                    message += `${index + 1}. ${channel}\n`;
                });
            }

            message += '\nПосле подпис��и нажмите /start снова';
            bot.sendMessage(chatId, message);
            return;
        }
        
        // Update subscription status
        await db.updateUserField(userId, 'is_subscribed', true);
        
        // Send welcome message with main menu
        const welcomeMessage = `🌟 **Добро пожаловать в официальный бот для заработка звёзд!**

💰 **Баланс:** ${dbUser.balance} ⭐
👥 **Рефералов:** ${dbUser.referrals_count}

🎯 **Доступные возможности:**
• 🎯 **Кликер** - зарабатывайте звёзды каждый день
• 📋 **Задания** - выполняйте задачи за вознаграждение  
• 🎁 **Кейсы** - открывайте кейсы с призами
• 🎰 **Лотерея** - участвуйте в розыгрышах
• 👥 **Реферальная система** - приглашайте друзей

⭐ **За каждого приглашенного друга вы получаете 3 звезды!**

Выберите действие из меню ниже:`;

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже или обратитесь к администратору.');
    }
});

// Admin command handler
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа к панели администратора.');
        return;
    }

    try {
        const stats = await db.getUserStats();
        
        const message = `🔧 **Панель администратора**

📊 **Статистика:**
👥 Всего пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐
👥 Всего рефералов: ${stats.total_referrals}
📅 Новых сегодня: ${stats.today_users}

Выберите действие:`;

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            ...getAdminMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in admin command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке админ панели.');
    }
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    try {
        const user = await db.getUser(userId);
        
        if (!user) {
            await bot.editMessageText(
                '❌ Пользователь не найден. Нажмите /start для регистрации.',
                {
                    chat_id: chatId,
                    message_id: msg.message_id
                }
            );
            return;
        }

        switch (data) {
            case 'menu_profile':
                await handleProfileMenu(chatId, msg.message_id, user);
                break;
            case 'menu_invite':
                await handleInviteMenu(chatId, msg.message_id, user);
                break;
            case 'menu_clicker':
                await handleClickerMenu(chatId, msg.message_id, user);
                break;
            case 'menu_withdraw':
                await handleWithdrawMenu(chatId, msg.message_id, user);
                break;
            case 'menu_tasks':
                await handleTasksMenu(chatId, msg.message_id, user);
                break;
            case 'menu_instruction':
                await handleInstructionMenu(chatId, msg.message_id);
                break;
            case 'menu_ratings':
                await handleRatingsMenu(chatId, msg.message_id);
                break;
            case 'menu_cases':
                await handleCasesMenu(chatId, msg.message_id, user);
                break;
            case 'menu_lottery':
                await handleLotteryMenu(chatId, msg.message_id, user);
                break;
            case 'back_to_main':
                await handleBackToMain(chatId, msg.message_id, user);
                break;
            
            // Admin menu handlers
            case 'admin_stats':
                if (!isAdmin(userId)) return;
                await handleAdminStats(chatId, msg.message_id);
                break;
            case 'admin_tasks':
                if (!isAdmin(userId)) return;
                await handleAdminTasks(chatId, msg.message_id);
                break;
            case 'admin_lottery':
                if (!isAdmin(userId)) return;
                await handleAdminLottery(chatId, msg.message_id);
                break;
            case 'admin_promocodes':
                if (!isAdmin(userId)) return;
                await handleAdminPromocodes(chatId, msg.message_id);
                break;
            case 'admin_broadcast':
                if (!isAdmin(userId)) return;
                await handleAdminBroadcast(chatId, msg.message_id);
                break;
            case 'admin_withdrawals':
                if (!isAdmin(userId)) return;
                await handleAdminWithdrawals(chatId, msg.message_id);
                break;
        }

        // Answer callback query to remove loading state
        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Произошла ошибка. Попробуйте позже.',
            show_alert: true
        });
    }
});

// Menu handlers
async function handleProfileMenu(chatId, messageId, user) {
    const message = `👤 **Ваш профиль**

🆔 **ID:** ${user.id}
👤 **Имя:** ${user.first_name}
${user.username ? `📱 **Username:** @${user.username}` : ''}

💰 **Баланс:** ${user.balance} ⭐
👥 **Всего рефералов:** ${user.referrals_count}
📅 **Рефералов сегодня:** ${user.referrals_today}
📅 **Дата регистрации:** ${new Date(user.registered_at).toLocaleDateString('ru-RU')}

🎯 **Статистика:**
${user.last_click ? `• Последний клик: ${new Date(user.last_click).toLocaleDateString('ru-RU')}` : '• Кликер еще не использовался'}
${user.last_case_open ? `• Последний кейс: ${new Date(user.last_case_open).toLocaleDateString('ru-RU')}` : '• Кейсы еще не открывались'}`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackButton()
    });
}

async function handleInviteMenu(chatId, messageId, user) {
    const inviteLink = `https://t.me/${bot.options.username}?start=${user.id}`;
    
    const message = `👥 **Реферальная система**

🎁 **За каждого приглашенного друга вы получаете 3 ⭐**

📊 **Ваша статистика:**
• Всего приглашено: ${user.referrals_count}
• Приглашено сегодня: ${user.referrals_today}
• Заработано с рефералов: ${user.referrals_count * 3} ⭐

🔗 **Ваша реферальная ссылка:**
\`${inviteLink}\`

📢 **Поделитесь ссылкой с друзьями и зарабатывайте звёзды!**`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackButton()
    });
}

async function handleClickerMenu(chatId, messageId, user) {
    const now = new Date();
    const lastClick = user.last_click ? new Date(user.last_click) : null;
    const canClick = !lastClick || now.toDateString() !== lastClick.toDateString();

    if (canClick) {
        // Award clicker reward
        const reward = Math.floor(Math.random() * 3) + 1; // 1-3 stars
        await db.updateUserBalance(user.id, reward);
        await db.updateUserField(user.id, 'last_click', now);

        const message = `🎯 **Кликер**

🎉 **Поздравляем!** 
Вы получили ${reward} ⭐

💰 **Ваш баланс:** ${user.balance + reward} ⭐

⏰ Возвращайтесь завтра за новой наградой!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackButton()
        });
    } else {
        const message = `🎯 **Кликер**

⏰ **Вы уже получили награду сегодня!**

💰 **Ваш баланс:** ${user.balance} ⭐

🕐 Возвращайте��ь завтра за новой наградой!
Каждый день вы можете получить от 1 до 3 ⭐`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackButton()
        });
    }
}

async function handleTasksMenu(chatId, messageId, user) {
    try {
        const allTasks = await db.getTasks();
        const completedTasks = await db.getUserCompletedTasks(user.id);
        const completedTaskIds = completedTasks.map(t => t.id);
        
        const availableTasks = allTasks.filter(task => !completedTaskIds.includes(task.id));

        let message = '📋 **Доступные задания**\n\n';
        
        if (availableTasks.length === 0) {
            message += '✅ Все задания выполнены!\nОжидайте новых заданий.';
        } else {
            availableTasks.forEach((task, index) => {
                message += `${index + 1}. **${task.channel_name || task.channel_id}**\n`;
                message += `   💰 Награда: ${task.reward} ⭐\n`;
                message += `   📱 Канал: ${task.channel_id}\n\n`;
            });
            
            message += '📌 **Для выполнения задания:**\n';
            message += '1. Подпишитесь на канал\n';
            message += '2. Вернитесь и нажмите кнопку проверки\n';
        }

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    ...availableTasks.map(task => [
                        { text: `✅ Проверить: ${task.channel_name || task.channel_id}`, callback_data: `check_task_${task.id}` }
                    ]),
                    [{ text: '🔙 Назад', callback_data: 'back_to_main' }]
                ]
            }
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...keyboard
        });
    } catch (error) {
        console.error('Error in tasks menu:', error);
        await bot.editMessageText('❌ Ошибка загрузки заданий.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackButton()
        });
    }
}

async function handleBackToMain(chatId, messageId, user) {
    const welcomeMessage = `🌟 **Добро пожаловать в официальный бот для заработка звёзд!**

💰 **Баланс:** ${user.balance} ⭐
👥 **Рефералов:** ${user.referrals_count}

🎯 **Доступные возможности:**
• 🎯 **Кликер** - зарабатывайте звёзды каждый день
• 📋 **Задания** - выполняйте задачи за вознаграждение  
• 🎁 **Кейсы** - открывайте кейсы с призами
• 🎰 **Лотерея** - участвуйте в розыгрышах
• 👥 **Реферальная система** - приглашайте друзей

⭐ **За каждого приглашенного друга вы получаете 3 звезды!**

Выберите действие из меню ниже:`;

    await bot.editMessageText(welcomeMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard()
    });
}

// Placeholder handlers for other menus
async function handleWithdrawMenu(chatId, messageId, user) {
    const message = `⭐ **Вывод звёзд**

💰 **Ваш баланс:** ${user.balance} ⭐

🔄 Функция вывода находится в разработке.
Скоро вы сможете выводить звёзды!`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackButton()
    });
}

async function handleInstructionMenu(chatId, messageId) {
    const message = `📖 **Инструкция по использованию бота**

🎯 **Как зарабатывать звёзды:**

1️⃣ **Кликер** - нажимайте каждый день и получайте 1-3 ⭐
2️⃣ **Задания** - подписывайтесь на каналы за награды
3️⃣ **Рефералы** - приглашайте друзей и получайте 3 ⭐ за каждого
4️⃣ **Кейсы** - открывайте кейсы с призами
5️⃣ **Лотерея** - участвуйте в розыгрышах

💡 **Советы:**
• Заходите каждый день для получения награды
• Приглашайте активных друзей
• Выполняйте все доступные задания

⭐ **Звёзды можно будет выводить в ближайшее время!**`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackButton()
    });
}

async function handleRatingsMenu(chatId, messageId) {
    try {
        const result = await db.executeQuery(`
            SELECT first_name, balance, referrals_count 
            FROM users 
            ORDER BY balance DESC 
            LIMIT 10
        `);
        
        let message = '🏆 **Топ пользователей по балансу**\n\n';
        
        result.rows.forEach((user, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
            message += `${medal} **${user.first_name}**\n`;
            message += `   💰 ${user.balance} ⭐ | 👥 ${user.referrals_count} рефералов\n\n`;
        });

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackButton()
        });
    } catch (error) {
        console.error('Error in ratings menu:', error);
        await bot.editMessageText('❌ Ошибка загрузки рейтингов.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackButton()
        });
    }
}

async function handleCasesMenu(chatId, messageId, user) {
    const message = `🎁 **Кейсы**

💰 **Ваш баланс:** ${user.balance} ⭐

🔄 Система кейсов находится в разработке.
Скоро вы сможете открывать кейсы с приз��ми!`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackButton()
    });
}

async function handleLotteryMenu(chatId, messageId, user) {
    const message = `🎰 **Лотерея**

💰 **Ваш баланс:** ${user.balance} ⭐

🔄 Система лотереи находится в разработке.
Скоро вы сможете участвовать в розыгрышах призов!`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackButton()
    });
}

// Admin handlers (placeholders)
async function handleAdminStats(chatId, messageId) {
    try {
        const stats = await db.getUserStats();
        
        const message = `📊 **Детальная статистика**

👥 **Пользователи:**
• Всего: ${stats.total_users}
• Новых сегодня: ${stats.today_users}

💰 **Экономика:**
• Общий баланс: ${stats.total_balance} ⭐
• Всего рефералов: ${stats.total_referrals}
• Выплачено рефералам: ${stats.total_referrals * 3} ⭐

📈 **Средние показатели:**
• Средний баланс: ${stats.total_users > 0 ? (stats.total_balance / stats.total_users).toFixed(2) : 0} ⭐
• Рефералов на пользователя: ${stats.total_users > 0 ? (stats.total_referrals / stats.total_users).toFixed(2) : 0}`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackButton('admin_back')
        });
    } catch (error) {
        console.error('Error in admin stats:', error);
        await bot.editMessageText('❌ Ошибка загрузки статистики.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackButton('admin_back')
        });
    }
}

// Placeholder admin functions
async function handleAdminTasks(chatId, messageId) {
    await bot.editMessageText('🔄 Управление задачами в разработке.', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackButton('admin_back')
    });
}

async function handleAdminLottery(chatId, messageId) {
    await bot.editMessageText('🔄 Управление лотереей в разработке.', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackButton('admin_back')
    });
}

async function handleAdminPromocodes(chatId, messageId) {
    await bot.editMessageText('🔄 Управление промокодами в разработке.', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackButton('admin_back')
    });
}

async function handleAdminBroadcast(chatId, messageId) {
    await bot.editMessageText('🔄 Функция рассылки в разработке.', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackButton('admin_back')
    });
}

async function handleAdminWithdrawals(chatId, messageId) {
    await bot.editMessageText('🔄 Управление выводом в разработке.', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackButton('admin_back')
    });
}

// Daily reset cron job
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running daily reset...');
    try {
        await db.resetDailyData();
    } catch (error) {
        console.error('Error in daily reset:', error);
    }
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

process.on('SIGINT', async () => {
    console.log('🛑 Shutting down bot...');
    await db.closeConnection();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down bot...');
    await db.closeConnection();
    process.exit(0);
});

// Start the bot
startBot();
