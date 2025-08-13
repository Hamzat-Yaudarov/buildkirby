const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const db = require('./database');
const adminHandlers = require('./admin-handlers');

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

// Create inline keyboards
function getMainMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
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
            ]
        }
    };
}

function getProfileKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🎁 Промокод', callback_data: 'promocode' },
                    { text: '👥 Пригласить друзей', callback_data: 'invite' }
                ],
                [
                    { text: '🏠 В главное меню', callback_data: 'main_menu' }
                ]
            ]
        }
    };
}

function getBackToMainKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        }
    };
}

function getTaskKeyboard(taskId) {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Выполнить', callback_data: `task_execute_${taskId}` },
                    { text: '🔍 Проверить', callback_data: `task_check_${taskId}` }
                ],
                [
                    { text: '⏭️ Пропустить задание', callback_data: 'task_skip' },
                    { text: '🏠 В главное меню', callback_data: 'main_menu' }
                ]
            ]
        }
    };
}

function getWithdrawKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '15 ⭐', callback_data: 'withdraw_15' },
                    { text: '25 ⭐', callback_data: 'withdraw_25' }
                ],
                [
                    { text: '50 ⭐', callback_data: 'withdraw_50' },
                    { text: '100 ⭐', callback_data: 'withdraw_100' }
                ],
                [
                    { text: '🔥 Telegram Premium на 3 месяца (1300⭐)', callback_data: 'withdraw_premium' }
                ],
                [
                    { text: '🏠 В главное меню', callback_data: 'main_menu' }
                ]
            ]
        }
    };
}

function getRatingsKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🏆 Общий рейтинг', callback_data: 'ratings_all' },
                    { text: '📅 Рейтинг за неделю', callback_data: 'ratings_week' }
                ],
                [
                    { text: '🏠 В главное меню', callback_data: 'main_menu' }
                ]
            ]
        }
    };
}

function getAdminMenuKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
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
                ]
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

            // Send notification to referrer if exists
            if (invitedBy) {
                try {
                    const message = `🎉 **Поздравляем!**

👤 По вашей реферальной ссылке присоединился новый пользователь: **${user.first_name}**

💰 **Вы получили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзей и ��арабатывайте еще больше звёзд!`;

                    await bot.sendMessage(invitedBy, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error('Error sending referral notification:', error);
                }
            }
        }
        
        // Check subscriptions
        const isSubscribed = await checkSubscriptions(userId);
        const requiredChannels = await getRequiredChannels();

        if (!isSubscribed && requiredChannels.length > 0) {
            let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';

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

            message += '\n📌 После подписки нажмите /start снова';
            bot.sendMessage(chatId, message);
            return;
        }
        
        // Update subscription status
        await db.updateUserField(userId, 'is_subscribed', true);
        
        // Send main menu
        const welcomeMessage = `🌟 **Добро пожаловать в StarBot!**

💰 **Ваш персональный помощник для заработка Telegram Stars**

🎯 **Доступные возможности:**
• Ежедневные награды в кликере
• Выполнение заданий за вознаграждение
• Реферальная программа (3⭐ за друга)
• Участие в лотереях и розыгрышах
• Открытие призовых кейсов

Выберите действие из меню ниже:`;

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            ...getMainMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
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

        const message = `🔧 **Админ-панель**

📊 **Быстрая статистика:**
👥 ��ользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

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

// Admin task creation
bot.onText(/\/create_task (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const params = match[1].split('|');
        if (params.length !== 4) {
            bot.sendMessage(chatId, '❌ Неверный формат! Используйте: /create_task тип|название|награда|лимит');
            return;
        }

        const [type, channelId, reward, limit] = params;

        await db.executeQuery(
            'INSERT INTO tasks (channel_id, channel_name, reward) VALUES ($1, $2, $3)',
            [channelId.trim(), `${type} ${channelId}`.trim(), parseFloat(reward)]
        );

        bot.sendMessage(chatId, `✅ Задание создано!\n📺 Канал: ${channelId}\n💰 Награда: ${reward} ⭐`);

    } catch (error) {
        console.error('Error creating task:', error);
        bot.sendMessage(chatId, '❌ Ошибка создания задания.');
    }
});

// Admin channel management
bot.onText(/\/add_channel (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const params = match[1].split('|');
        const channelId = params[0].trim();
        const channelName = params[1] ? params[1].trim() : channelId;

        await db.executeQuery(
            'INSERT INTO required_channels (channel_id, channel_name) VALUES ($1, $2) ON CONFLICT (channel_id) DO NOTHING',
            [channelId, channelName]
        );

        bot.sendMessage(chatId, `✅ Канал добавлен!\n📺 ${channelName} (${channelId})`);

    } catch (error) {
        console.error('Error adding channel:', error);
        bot.sendMessage(chatId, '❌ Ошибка добавления канала.');
    }
});

// Admin lottery creation
bot.onText(/\/create_lottery (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const params = match[1].split('|');
        if (params.length !== 5) {
            bot.sendMessage(chatId, '❌ Неверный формат! Используйте: /create_lottery название|билеты|цена|победители|процент');
            return;
        }

        const [name, maxTickets, ticketPrice, winnersCount, botPercent] = params;

        await db.executeQuery(
            'INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count) VALUES ($1, $2, $3, $4)',
            [name.trim(), parseFloat(ticketPrice), parseInt(maxTickets), parseInt(winnersCount)]
        );

        bot.sendMessage(chatId, `✅ Лотерея создана!\n🎰 ${name}\n🎫 ${maxTickets} билетов по ${ticketPrice} ⭐\n🏆 ${winnersCount} победителей`);

    } catch (error) {
        console.error('Error creating lottery:', error);
        bot.sendMessage(chatId, '❌ Ошибка создания ло��ереи.');
    }
});

// Admin promocode creation
bot.onText(/\/create_promo (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const params = match[1].split('|');
        if (params.length !== 3) {
            bot.sendMessage(chatId, '❌ Неверный формат! Используйте: /create_promo КОД|награда|использования');
            return;
        }

        const [code, reward, maxUses] = params;

        await db.executeQuery(
            'INSERT INTO promocodes (code, reward, max_uses, created_by) VALUES ($1, $2, $3, $4)',
            [code.trim().toUpperCase(), parseFloat(reward), parseInt(maxUses), userId]
        );

        bot.sendMessage(chatId, `✅ Промокод создан!\n🎁 Код: ${code.toUpperCase()}\n💰 Награда: ${reward} ⭐\n📊 Использований: ${maxUses}`);

    } catch (error) {
        console.error('Error creating promocode:', error);
        bot.sendMessage(chatId, '❌ Ошибка создания промокода (возможно, код уже существует).');
    }
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    try {
        // Get user data
        const user = await db.getUser(userId);
        
        if (!user && !data.startsWith('admin_') && data !== 'main_menu') {
            await bot.editMessageText(
                '❌ Пользователь не найден. Нажмите /start для регистрации.',
                {
                    chat_id: chatId,
                    message_id: msg.message_id
                }
            );
            return;
        }

        // Handle different callback data
        switch (data) {
            case 'main_menu':
                await handleMainMenu(chatId, msg.message_id);
                break;
            case 'profile':
                await handleProfile(chatId, msg.message_id, user);
                break;
            case 'invite':
                await handleInvite(chatId, msg.message_id, user);
                break;
            case 'clicker':
                await handleClicker(chatId, msg.message_id, user);
                break;
            case 'withdraw':
                await handleWithdraw(chatId, msg.message_id, user);
                break;
            case 'tasks':
                await handleTasks(chatId, msg.message_id, user);
                break;
            case 'instruction':
                await handleInstruction(chatId, msg.message_id);
                break;
            case 'ratings':
                await handleRatings(chatId, msg.message_id);
                break;
            case 'ratings_all':
                await handleRatingsAll(chatId, msg.message_id);
                break;
            case 'ratings_week':
                await handleRatingsWeek(chatId, msg.message_id);
                break;
            case 'cases':
                await handleCases(chatId, msg.message_id, user);
                break;
            case 'lottery':
                await handleLottery(chatId, msg.message_id);
                break;
            case 'promocode':
                await handlePromocodeInput(chatId, msg.message_id, userId);
                break;
            
            // Withdraw handlers
            case 'withdraw_15':
            case 'withdraw_25':
            case 'withdraw_50':
            case 'withdraw_100':
            case 'withdraw_premium':
                await handleWithdrawRequest(chatId, msg.message_id, userId, data);
                break;
            
            // Task handlers
            case 'task_skip':
                await handleTaskSkip(chatId, msg.message_id, userId);
                break;
            
            // Admin handlers
            case 'admin_stats':
                if (isAdmin(userId)) await handleAdminStats(chatId, msg.message_id);
                break;
            case 'admin_tasks':
                if (isAdmin(userId)) await adminHandlers.handleAdminTasks(bot, chatId, msg.message_id);
                break;
            case 'admin_channels':
                if (isAdmin(userId)) await adminHandlers.handleAdminChannels(bot, chatId, msg.message_id);
                break;
            case 'admin_lottery':
                if (isAdmin(userId)) await adminHandlers.handleAdminLottery(bot, chatId, msg.message_id);
                break;
            case 'admin_promocodes':
                if (isAdmin(userId)) await adminHandlers.handleAdminPromocodes(bot, chatId, msg.message_id);
                break;
            case 'admin_broadcast':
                if (isAdmin(userId)) await adminHandlers.handleAdminBroadcast(bot, chatId, msg.message_id);
                break;
            case 'broadcast_tasks':
                if (isAdmin(userId)) await adminHandlers.handleBroadcastTasks(bot, chatId, msg.message_id);
                break;
            case 'broadcast_referrals':
                if (isAdmin(userId)) await adminHandlers.handleBroadcastReferrals(bot, chatId, msg.message_id);
                break;
            case 'admin_list_tasks':
                if (isAdmin(userId)) await adminHandlers.handleAdminListTasks(bot, chatId, msg.message_id);
                break;
            case 'admin_list_channels':
                if (isAdmin(userId)) await adminHandlers.handleAdminListChannels(bot, chatId, msg.message_id);
                break;
            case 'admin_list_lotteries':
                if (isAdmin(userId)) await adminHandlers.handleAdminListLotteries(bot, chatId, msg.message_id);
                break;
            case 'admin_list_promos':
                if (isAdmin(userId)) await adminHandlers.handleAdminListPromos(bot, chatId, msg.message_id);
                break;
            case 'admin_menu':
                if (isAdmin(userId)) await handleAdminMenu(chatId, msg.message_id);
                break;
            
            default:
                // Handle dynamic callback data
                if (data.startsWith('task_execute_')) {
                    const taskId = data.replace('task_execute_', '');
                    await handleTaskExecute(chatId, msg.message_id, userId, taskId);
                } else if (data.startsWith('task_check_')) {
                    const taskId = data.replace('task_check_', '');
                    await handleTaskCheck(chatId, msg.message_id, userId, taskId);
                } else if (data.startsWith('lottery_buy_')) {
                    const lotteryId = data.replace('lottery_buy_', '');
                    await handleLotteryBuy(chatId, msg.message_id, userId, lotteryId);
                }
                break;
        }

        // Answer callback query
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
async function handleMainMenu(chatId, messageId) {
    const welcomeMessage = `🌟 **Главное меню StarBot**

💰 **Ваш персональный центр заработка Telegram Stars**

🎯 **Доступные возможности:**
• 🎯 **Кликер** - ежедневная награда 0.1 ⭐
• 📋 **Задания** - выполняйте задачи за вознаграждение
• 👥 **Рефералы** - приглашайте друзей (3 ⭐ за каждого)
• 🎁 **Кейсы** - призы от 1 до 10 ⭐
• 🎰 **Лотерея** - участвуйте в розыгрышах

Выберите нужный раздел:`;

    await bot.editMessageText(welcomeMessage, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard()
    });
}

async function handleProfile(chatId, messageId, user) {
    const registrationDate = new Date(user.registered_at).toLocaleDateString('ru-RU');
    const totalEarned = user.referrals_count * 3; // From referrals

    const message = `👤 **Личный профиль**

🆔 **Информация о пользователе:**
• Имя: **${user.first_name}**
• ID: \`${user.id}\`
• Дата регистрации: **${registrationDate}**

💰 **Финанс��вая статистика:**
• Текущий баланс: **${user.balance} ⭐**
• Заработано с рефералов: **${totalEarned} ⭐**

👥 **Реферальная активность:**
• Всего приглашено: **${user.referrals_count}**
• Приглашено сегодня: **${user.referrals_today}**

🎯 **Игровая статистика:**
${user.last_click ? `• Последний клик: ${new Date(user.last_click).toLocaleDateString('ru-RU')}` : '• Кликер еще не использовался'}
${user.last_case_open ? `• Последний к��йс: ${new Date(user.last_case_open).toLocaleDateString('ru-RU')}` : '• Кейсы еще не открывались'}`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getProfileKeyboard()
    });
}

async function handleInvite(chatId, messageId, user) {
    // Get bot username
    let botUsername = 'starsbotexample'; // fallback
    try {
        const botInfo = await bot.getMe();
        botUsername = botInfo.username;
    } catch (error) {
        console.error('Error getting bot info:', error);
    }

    const inviteLink = `https://t.me/${botUsername}?start=${user.id}`;

    const message = `🌟 **Реферальная программа**

💰 **Зарабатывайте вместе с друзьями!**
Приглашайте друзей и получайте **3 ⭐** за каждого нового пользователя!

🔗 **Ваша персональная ссылка:**
\`${inviteLink}\`

📊 **Статистика приглашений:**
👥 Всего друзей приглашено: **${user.referrals_count}**
📅 Приглашено сегодня: **${user.referrals_today}**
💰 Заработано с рефералов: **${user.referrals_count * 3} ⭐**

🎯 **Как это работает:**
1. Поделитесь ссылкой с друзьями
2. Друг регистрируется по ссылке
3. Вы получаете 3 ⭐ на баланс!`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📤 Поделиться', switch_inline_query: `Присоединяйся к боту для заработка звёзд! ${inviteLink}` }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        }
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...keyboard
    });
}

async function handleClicker(chatId, messageId, user) {
    const now = new Date();
    const lastClick = user.last_click ? new Date(user.last_click) : null;
    const canClick = !lastClick || now.toDateString() !== lastClick.toDateString();

    if (canClick) {
        // Award clicker reward (0.1 stars)
        const reward = 0.1;
        await db.updateUserBalance(user.id, reward);
        await db.updateUserField(user.id, 'last_click', now);

        const message = `🎯 **Ежедневный кликер**

🎉 **Отлично!** Вы получили ежедневную награду!
💰 Начислено: **+${reward} ⭐**

💎 **Текущий баланс:** ${user.balance + reward} ⭐

⏰ **Следующая награда:** завтра в это же время
🕐 Не забудьте вернуться за новой наградой!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
    } else {
        // Calculate time until next click
        const nextClick = new Date(lastClick);
        nextClick.setDate(nextClick.getDate() + 1);
        nextClick.setHours(0, 0, 0, 0); // Start of next day

        const timeUntilNext = nextClick - now;
        const hoursLeft = Math.floor(timeUntilNext / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));

        const message = `🎯 **Ежедневный кликер**

⏰ **Награда уже получена сегодня!**

💰 **Ваш баланс:** ${user.balance} ⭐

⏳ **До следующей награды:** ${hoursLeft}ч ${minutesLeft}м
🎁 **Следующая награда:** 0.1 ⭐

💡 **Совет:** Пр��глашайте друзей и получайте 3 ⭐ за каждого!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
    }
}

async function handleWithdraw(chatId, messageId, user) {
    const message = `⭐ **Вывод звёзд**

**Ваш баланс:** ${user.balance} ⭐

${user.referrals_count < 5 ? 
    '❌ **Для вывода средств требуются минимум 5 рефералов**' : 
    '✅ **Вы можете выводить средства**'
}

Выберите сумму для вывода:`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getWithdrawKeyboard()
    });
}

async function handleWithdrawRequest(chatId, messageId, userId, data) {
    const user = await db.getUser(userId);
    
    if (user.referrals_count < 5) {
        await bot.editMessageText('❌ Для вы��ода средств требуются минимум 5 рефералов!', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
        return;
    }

    const amounts = {
        'withdraw_15': 15,
        'withdraw_25': 25,
        'withdraw_50': 50,
        'withdraw_100': 100,
        'withdraw_premium': 1300
    };

    const amount = amounts[data];
    const type = data === 'withdraw_premium' ? 'premium' : 'stars';

    if (user.balance < amount) {
        await bot.editMessageText('❌ Недостаточно средств на балансе!', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
        return;
    }

    // Create withdrawal request
    await db.executeQuery(
        'INSERT INTO withdrawal_requests (user_id, amount, type) VALUES ($1, $2, $3)',
        [userId, amount, type]
    );

    // Deduct from balance
    await db.updateUserBalance(userId, -amount);

    // Send notification to admin channel
    const adminMessage = `🔔 **Новая заявка на вывод**

👤 **Пользователь:** ${user.first_name}
🆔 **ID:** ${user.id}
${user.username ? `📱 **Username:** @${user.username}` : ''}
🔗 **Ссылка:** [Откры��ь профиль](tg://user?id=${user.id})

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}`;

    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Выполнено', callback_data: `approve_withdrawal_${userId}_${amount}` },
                    { text: '❌ Отклонено', callback_data: `reject_withdrawal_${userId}_${amount}` }
                ]
            ]
        }
    };

    await bot.sendMessage(ADMIN_CHANNEL, adminMessage, {
        parse_mode: 'Markdown',
        ...adminKeyboard
    });

    await bot.editMessageText('✅ Заявка на вывод отправлена! Ожидайте обработки.', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackToMainKeyboard()
    });
}

async function handleTasks(chatId, messageId, user) {
    try {
        // Get all tasks
        const allTasks = await db.getTasks();
        
        // Get completed tasks for user
        const completedTasks = await db.getUserCompletedTasks(user.id);
        const completedTaskIds = completedTasks.map(t => t.id);
        
        // Filter available tasks
        const availableTasks = allTasks.filter(task => !completedTaskIds.includes(task.id));

        if (availableTasks.length === 0) {
            await bot.editMessageText('✅ Все задания выполнены! Ожидайте новых заданий.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Show first available task
        const task = availableTasks[0];
        const message = `📋 **Активные задания**

🎯 **Текущее задание:**
Подписка на канал **${task.channel_name || task.channel_id}**

💰 **Награда за выполнение:** ${task.reward} ⭐
📊 **Прогресс:** ${completedTasks.length}/${allTasks.length} заданий выполнено

📝 **Инструкция:**
1. Нажмите "Выполнить" для перехода к каналу
2. Подпишитесь на канал
3. Вернитесь и нажмите "Проверить"
4. Получите награду!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getTaskKeyboard(task.id)
        });

    } catch (error) {
        console.error('Error in tasks:', error);
        await bot.editMessageText('❌ Ошибка загрузки заданий.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handleTaskExecute(chatId, messageId, userId, taskId) {
    try {
        const result = await db.executeQuery('SELECT * FROM tasks WHERE id = $1 AND is_active = TRUE', [taskId]);
        
        if (result.rows.length === 0) {
            await bot.editMessageText('❌ Задание не найдено.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        const task = result.rows[0];
        const channelLink = task.channel_id.startsWith('@') ? 
            `https://t.me/${task.channel_id.substring(1)}` : 
            task.channel_id;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📺 Перейти к каналу', url: channelLink }],
                    [{ text: '🔍 Проверить', callback_data: `task_check_${taskId}` }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            }
        };

        await bot.editMessageText(`📋 Подпишитесь на канал и нажмите "Проверить"`, {
            chat_id: chatId,
            message_id: messageId,
            ...keyboard
        });

    } catch (error) {
        console.error('Error in task execute:', error);
    }
}

async function handleTaskCheck(chatId, messageId, userId, taskId) {
    try {
        const result = await db.executeQuery('SELECT * FROM tasks WHERE id = $1 AND is_active = TRUE', [taskId]);
        
        if (result.rows.length === 0) {
            await bot.editMessageText('❌ Задание не найдено.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        const task = result.rows[0];

        // Check if user is subscribed to the channel
        try {
            const member = await bot.getChatMember(task.channel_id, userId);
            
            if (member.status === 'left' || member.status === 'kicked') {
                await bot.editMessageText('❌ Вы не подписаны на канал! Подпишитесь и попробуйте снова.', {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getTaskKeyboard(taskId)
                });
                return;
            }

            // Complete the task
            const completed = await db.completeTask(userId, taskId);
            
            if (completed) {
                await bot.editMessageText(`✅ Задание выполнено! В�� получили ${task.reward} ⭐`, {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getBackToMainKeyboard()
                });
            } else {
                await bot.editMessageText('❌ Задание уже выполнено ранее.', {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getBackToMainKeyboard()
                });
            }

        } catch (error) {
            await bot.editMessageText('❌ Ошибка проверки подписки. Убедитесь, что канал публичный или бот добавлен в него.', {
                chat_id: chatId,
                message_id: messageId,
                ...getTaskKeyboard(taskId)
            });
        }

    } catch (error) {
        console.error('Error in task check:', error);
    }
}

async function handleTaskSkip(chatId, messageId, userId) {
    // Show next task or return to tasks menu
    await handleTasks(chatId, messageId, await db.getUser(userId));
}

async function handleInstruction(chatId, messageId) {
    const message = `📖 **Инструкция по боту**

🎯 **Как зарабатывать звёзды:**

1️⃣ **Кликер** - нажимайте каждый день и получайте 0.1 ⭐
2️⃣ **З��дания** - подписывайтесь на каналы за награды
3️⃣ **Рефералы** - приглашайте друзей и получайте 3 ⭐ за каждого
4️⃣ **Кейсы** - открывайте кейсы с призами (нужно 3+ рефералов в день)
5️⃣ **Лотерея** - участвуйте в розыгрышах

💰 **Вывод средств:**
• Минимум 5 рефералов для вывода
• Доступны суммы: 15, 25, 50, 100 ⭐
• Telegram Premium на 3 месяца за 1300 ⭐

📈 **Советы:**
• Заходите каждый день
• Приглашайте активных друзей
• Выполняйте все задания`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getBackToMainKeyboard()
    });
}

async function handleRatings(chatId, messageId) {
    const message = `🏆 **Рейтинги**

Выберите тип рейтинга:`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getRatingsKeyboard()
    });
}

async function handleRatingsAll(chatId, messageId) {
    try {
        const result = await db.executeQuery(`
            SELECT first_name, referrals_count 
            FROM users 
            ORDER BY referrals_count DESC 
            LIMIT 10
        `);
        
        let message = '🏆 **Общий рейтинг по рефералам**\n\n';
        
        if (result.rows.length === 0) {
            message += 'Пока нет данных для рейтинга.';
        } else {
            result.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} **${user.first_name}** - ${user.referrals_count} рефералов\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
    } catch (error) {
        console.error('Error in ratings all:', error);
        await bot.editMessageText('❌ Ошибка загрузки рейтинга.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handleRatingsWeek(chatId, messageId) {
    try {
        const result = await db.executeQuery(`
            SELECT first_name, referrals_today 
            FROM users 
            WHERE updated_at > CURRENT_DATE - INTERVAL '7 days'
            ORDER BY referrals_today DESC 
            LIMIT 10
        `);
        
        let message = '📅 **Рейтинг за неделю по рефералам**\n\n';
        
        if (result.rows.length === 0) {
            message += 'Пока нет данных для рейтинга.';
        } else {
            result.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} **${user.first_name}** - ${user.referrals_today} рефералов\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
    } catch (error) {
        console.error('Error in ratings week:', error);
        await bot.editMessageText('❌ Ошибка загрузки рейтинга.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handleCases(chatId, messageId, user) {
    const now = new Date();
    const lastCaseOpen = user.last_case_open ? new Date(user.last_case_open) : null;
    const canOpen = !lastCaseOpen || now.toDateString() !== lastCaseOpen.toDateString();
    const hasEnoughReferrals = user.referrals_today >= 3;

    if (!hasEnoughReferrals) {
        const message = `🎁 **Кейсы**

❌ **Для открытия кейса нужно привести 3+ рефералов в день**

**Ваши рефералы сегодня:** ${user.referrals_today}/3

Приглашайте друзей и возвращайтесь!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
        return;
    }

    if (!canOpen) {
        const message = `🎁 **Кейсы**

⏰ **Вы уже открыли кейс сегодня!**

Возвращайтесь завтра за новым кейсом!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
        return;
    }

    // Open case
    const reward = Math.floor(Math.random() * 10) + 1; // 1-10 stars
    await db.updateUserBalance(user.id, reward);
    await db.updateUserField(user.id, 'last_case_open', now);

    const message = `🎁 **Кейсы**

🎉 **Поздравляем!** Вы открыли кейс и получили **${reward} ⭐**

💰 **Ваш баланс:** ${user.balance + reward} ⭐

⏰ Возвращайтесь завтра за новым кейсом!`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎁 Открыть кейс', callback_data: 'cases' }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        }
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...keyboard
    });
}

async function handleLottery(chatId, messageId) {
    try {
        const result = await db.executeQuery('SELECT * FROM lotteries WHERE is_active = TRUE ORDER BY id');
        
        if (result.rows.length === 0) {
            await bot.editMessageText('🎰 На данный момент нет активных лотерей.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        let message = '🎰 **Активные лотереи**\n\n';
        const keyboards = [];

        result.rows.forEach((lottery, index) => {
            message += `**${lottery.name}**\n`;
            message += `💰 Цена билета: ${lottery.ticket_price} ⭐\n`;
            message += `🎫 Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
            message += `🏆 Победителей: ${lottery.winners_count}\n\n`;
            
            keyboards.push([{ text: `🎫 Купить билет - ${lottery.name}`, callback_data: `lottery_buy_${lottery.id}` }]);
        });

        keyboards.push([{ text: '🏠 В главное меню', callback_data: 'main_menu' }]);

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboards }
        });

    } catch (error) {
        console.error('Error in lottery:', error);
        await bot.editMessageText('❌ Ошибка загрузки лотерей.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handleLotteryBuy(chatId, messageId, userId, lotteryId) {
    try {
        const user = await db.getUser(userId);
        
        // Get lottery details
        const lotteryResult = await db.executeQuery('SELECT * FROM lotteries WHERE id = $1 AND is_active = TRUE', [lotteryId]);
        
        if (lotteryResult.rows.length === 0) {
            await bot.editMessageText('❌ Лотерея не найдена.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        const lottery = lotteryResult.rows[0];

        // Check if user already has a ticket
        const ticketCheck = await db.executeQuery(
            'SELECT 1 FROM lottery_tickets WHERE lottery_id = $1 AND user_id = $2',
            [lotteryId, userId]
        );

        if (ticketCheck.rows.length > 0) {
            await bot.editMessageText('❌ Вы уже купили билет в эту лотерею!', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Check balance
        if (user.balance < lottery.ticket_price) {
            await bot.editMessageText('❌ Недостаточно средств для покупки билета!', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Check if lottery is full
        if (lottery.current_tickets >= lottery.max_tickets) {
            await bot.editMessageText('❌ Все билеты в лотерею проданы!', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Buy ticket
        await db.executeQuery('BEGIN');
        
        try {
            // Add ticket
            await db.executeQuery(
                'INSERT INTO lottery_tickets (lottery_id, user_id) VALUES ($1, $2)',
                [lotteryId, userId]
            );

            // Update lottery count
            await db.executeQuery(
                'UPDATE lotteries SET current_tickets = current_tickets + 1 WHERE id = $1',
                [lotteryId]
            );

            // Deduct from balance
            await db.updateUserBalance(userId, -lottery.ticket_price);

            await db.executeQuery('COMMIT');

            await bot.editMessageText(`✅ Билет успешно куплен за ${lottery.ticket_price} ⭐!`, {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });

        } catch (error) {
            await db.executeQuery('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error in lottery buy:', error);
        await bot.editMessageText('❌ Ошибка покупки билета.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handlePromocodeInput(chatId, messageId, userId) {
    // Set temp action for user
    await db.updateUserField(userId, 'temp_action', 'awaiting_promocode');
    
    await bot.editMessageText('🎁 Введите промокод:', {
        chat_id: chatId,
        message_id: messageId,
        ...getBackToMainKeyboard()
    });
}

// Handle text messages (for promocodes)
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        
        try {
            const user = await db.getUser(userId);
            
            if (user && user.temp_action === 'awaiting_promocode') {
                const promocode = msg.text.trim().toUpperCase();
                
                // Clear temp action
                await db.updateUserField(userId, 'temp_action', null);
                
                // Check promocode
                const promoResult = await db.getPromocode(promocode);
                
                if (!promoResult) {
                    bot.sendMessage(chatId, '❌ Промокод не найден!');
                    return;
                }

                // Use promocode
                const success = await db.usePromocode(userId, promoResult.id);
                
                if (success) {
                    bot.sendMessage(chatId, `✅ Промокод активирован! Вы получили ${promoResult.reward} ⭐`);
                } else {
                    bot.sendMessage(chatId, '❌ Промокод уже использован или недействителен!');
                }
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }
});

// Admin handlers
async function handleAdminStats(chatId, messageId) {
    try {
        const stats = await db.getUserStats();
        
        // Get weekly active users
        const weeklyResult = await db.executeQuery(`
            SELECT COUNT(*) as weekly_active 
            FROM users 
            WHERE updated_at > CURRENT_DATE - INTERVAL '7 days'
        `);
        
        const dailyResult = await db.executeQuery(`
            SELECT COUNT(*) as daily_active 
            FROM users 
            WHERE updated_at > CURRENT_DATE
        `);

        const message = `📊 **Статистика бота**

👥 **Всего пользователей:** ${stats.total_users}
📅 **Активные за неделю:** ${weeklyResult.rows[0]?.weekly_active || 0}
📅 **Активные за день:** ${dailyResult.rows[0]?.daily_active || 0}
💰 **Общий баланс:** ${stats.total_balance} ⭐
👥 **Всего рефералов:** ${stats.total_referrals}`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin stats:', error);
        await bot.editMessageText('❌ Ошибка загрузки статистики.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

async function handleAdminMenu(chatId, messageId) {
    try {
        const stats = await db.getUserStats();

        const message = `🔧 **Админ-панель**

�� **Быстрая статистика:**
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

Выберите действие:`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getAdminMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in admin menu:', error);
        await bot.editMessageText('❌ Ошибка загрузки админ панели.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
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
