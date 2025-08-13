console.log('[MAIN] Starting imports...');

const TelegramBot = require('node-telegram-bot-api');
console.log('[MAIN] TelegramBot imported');

const cron = require('node-cron');
console.log('[MAIN] cron imported');

const db = require('./database');
console.log('[MAIN] database imported');

const adminHandlers = require('./admin-handlers-final');
console.log('[MAIN] admin-test imported, type:', typeof adminHandlers);
console.log('[MAIN] adminHandlers.handleAdminTasks type:', typeof adminHandlers.handleAdminTasks);

// Bot token - should be set via environment variable
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';

// First, try to delete webhook and then use polling
const bot = new TelegramBot(token, { polling: false });

// Clear any existing webhook and enable polling
async function initializeBotMode() {
    try {
        console.log('🔄 Clearing any existing webhook...');
        await bot.deleteWebHook();
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second

        console.log('🔄 Starting polling mode...');
        await bot.startPolling({ restart: true });
        console.log('✅ Bot polling started successfully!');
    } catch (error) {
        console.error('❌ Error initializing bot mode:', error);
        throw error;
    }
}

// Admin configuration
const ADMIN_ID = 6910097562;
const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';

// Initialize database and bot
async function startBot() {
    try {
        console.log('🚀 Starting Telegram bot with PostgreSQL...');
        await db.initializeDatabase();
        await initializeBotMode();
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

// Helper function to check if user is subscribed to all required channels (enhanced)
async function checkAllSubscriptions(userId) {
    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) return true;
    
    try {
        for (const channel of requiredChannels) {
            try {
                const member = await bot.getChatMember(channel, userId);
                if (member.status === 'left' || member.status === 'kicked') {
                    return false;
                }
            } catch (error) {
                // If bot can't check membership (private channel or no admin rights), auto-approve
                console.log(`Auto-approving subscription for channel ${channel} due to access restriction`);
                continue;
            }
        }
        return true;
    } catch (error) {
        console.error('Error checking subscriptions:', error);
        return false;
    }
}

// Legacy function for backward compatibility
async function checkSubscriptions(userId) {
    return await checkAllSubscriptions(userId);
}

// Helper function to get subscription message with channel links
async function getSubscriptionMessage() {
    let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';
    let buttons = [];
    
    try {
        const result = await db.executeQuery('SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE');
        result.rows.forEach((channel, index) => {
            message += `${index + 1}. ${channel.channel_name || channel.channel_id}\n`;
            
            // Create button for each channel
            const channelLink = channel.channel_id.startsWith('@') ? 
                `https://t.me/${channel.channel_id.substring(1)}` : 
                channel.channel_id;
            
            buttons.push([{ text: `📺 ${channel.channel_name || channel.channel_id}`, url: channelLink }]);
        });
    } catch (error) {
        console.error('Error getting channel data:', error);
    }
    
    message += '\n📌 После подписки на все каналы используйте команды бота';
    buttons.push([{ text: '✅ Проверить подписки', callback_data: 'check_subscriptions' }]);
    
    return { message, buttons };
}

// Main menu text response
function getMainMenuText() {
    return `🌟 **Главное меню StarBot**

💰 **Доступные команды:**

👤 **/profile** - ваш профиль
👥 **/invite** - пригласить друзей
🎯 **/clicker** - ежедневная награда
⭐ **/withdraw** - вывод звёзд
📋 **/tasks** - выполнение заданий
📖 **/instruction** - инструкция по боту
🏆 **/ratings** - рейтинги пользователей
🎁 **/cases** - призовые кейсы
🎰 **/lottery** - участие в лотереях
🎁 **/promocode** - ввод промокода

💡 **Просто отправьте нужную команду!**`;
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
            // New user - create user first
            dbUser = await db.createOrUpdateUser(user);
            
            // Check for referral only after user is registered and subscribed
            if (referralCode && !isNaN(referralCode)) {
                const referrer = await db.getUser(parseInt(referralCode));
                if (referrer) {
                    // Store referral info temporarily, will be processed after subscription
                    await db.updateUserField(userId, 'pending_referrer', parseInt(referralCode));
                }
            }
        }
        
        // Check subscriptions
        const isSubscribed = await checkAllSubscriptions(userId);
        const requiredChannels = await getRequiredChannels();

        if (!isSubscribed && requiredChannels.length > 0) {
            const subData = await getSubscriptionMessage();
            
            await bot.sendMessage(chatId, subData.message, {
                reply_markup: { inline_keyboard: subData.buttons }
            });
            return;
        }
        
        // User is subscribed - update subscription status
        await db.updateUserField(userId, 'is_subscribed', true);
        
        // Process pending referral if exists
        if (dbUser.pending_referrer) {
            const invitedBy = dbUser.pending_referrer;
            
            // Update referrer stats
            await db.executeQuery(
                'UPDATE users SET referrals_count = referrals_count + 1, referrals_today = referrals_today + 1, balance = balance + 3 WHERE id = $1',
                [invitedBy]
            );
            
            // Clear pending referrer
            await db.updateUserField(userId, 'pending_referrer', null);
            await db.updateUserField(userId, 'invited_by', invitedBy);

            // Send notification to referrer
            try {
                const message = `🎉 **Поздравляем!**

👤 По вашей реферальной ссылке присоединился новый пользователь: **${user.first_name}**

💰 **Вы получили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

                await bot.sendMessage(invitedBy, message, {
                    parse_mode: 'Markdown'
                });
            } catch (error) {
                console.error('Error sending referral notification:', error);
            }
        }
        
        // Send main menu
        const welcomeMessage = `🌟 **Добро пожаловать в StarBot!**

💰 **Ваш персональный помощник для заработка Telegram Stars**

🎯 **Доступные возможности:**
• Ежедневные награды в кликере
• Выполнение заданий за вознаграждение
• Реферальная программа (3⭐ за друга)
• Участие в лотереях и розыгрышах
• Открытие призовых кейсов

${getMainMenuText()}`;

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Profile command
bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Нажмите /start для регистрации.');
            return;
        }

        const registrationDate = new Date(user.registered_at).toLocaleDateString('ru-RU');
        const totalEarned = user.referrals_count * 3;

        const message = `👤 **Личный профиль**

🆔 **Инфо��мация о пользователе:**
• Имя: **${user.first_name}**
• ID: \`${user.id}\`
• Дата регистрации: **${registrationDate}**

💰 **Финансовая статистика:**
• Текущий баланс: **${user.balance} ⭐**
• Заработано с рефералов: **${totalEarned} ⭐**

👥 **Реферальная активность:**
• Всего приглашено: **${user.referrals_count}**
• Приглашено сегодня: **${user.referrals_today}**

🎯 **Игровая статистика:**
${user.last_click ? `• Последний клик: ${new Date(user.last_click).toLocaleDateString('ru-RU')}` : '• Кликер еще не использовался'}
${user.last_case_open ? `• Последний кейс: ${new Date(user.last_case_open).toLocaleDateString('ru-RU')}` : '• Кейсы еще не открывались'}

💡 **Доступные команды:** /invite /promocode`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in profile:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки профиля.');
    }
});

// Invite command
bot.onText(/\/invite/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Нажмите /start для регистрации.');
            return;
        }

        // Get bot username
        let botUsername = 'starsbotexample';
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

📊 **Стат��стика приглашений:**
👥 Всего друзей приглашено: **${user.referrals_count}**
📅 Приглашено сегодня: **${user.referrals_today}**
💰 Заработано с рефералов: **${user.referrals_count * 3} ⭐**

🎯 **Как это работает:**
1. Поделитесь ссылкой с друзьями
2. Друг регистрируется по ссылке
3. Друг подписывается на все обязательные каналы
4. Вы получаете 3 ⭐ на баланс!

⚠️ **Важно:** Реферал засчитывается только после подписки на все каналы!`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in invite:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки реферальной программы.');
    }
});

// Clicker command
bot.onText(/\/clicker/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Нажмите /start для регистрации.');
            return;
        }

        const now = new Date();
        const lastClick = user.last_click ? new Date(user.last_click) : null;
        const canClick = !lastClick || now.toDateString() !== lastClick.toDateString();

        if (canClick) {
            const reward = 0.1;
            await db.updateUserBalance(user.id, reward);
            await db.updateUserField(user.id, 'last_click', now);

            const message = `🎯 **Ежедневный кликер**

🎉 **Отлично!** Вы получили ежедневную награду!
💰 Начислено: **+${reward} ⭐**

💎 **Текущий баланс:** ${user.balance + reward} ⭐

⏰ **Следующая награда:** завтра в это же время
🕐 Не забудьте вернуться за новой наградой!`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        } else {
            const nextClick = new Date(lastClick);
            nextClick.setDate(nextClick.getDate() + 1);
            nextClick.setHours(0, 0, 0, 0);

            const timeUntilNext = nextClick - now;
            const hoursLeft = Math.floor(timeUntilNext / (1000 * 60 * 60));
            const minutesLeft = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));

            const message = `🎯 **Ежедневный кликер**

⏰ **Награда уже получена сегодня!**

💰 **Ваш баланс:** ${user.balance} ⭐

⏳ **До следующей награды:** ${hoursLeft}ч ${minutesLeft}м
🎁 **Следующая награда:** 0.1 ⭐

💡 **Совет:** Приглашайте друзей и получайте 3 ⭐ за каждого!`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }

    } catch (error) {
        console.error('Error in clicker:', error);
        await bot.sendMessage(chatId, '❌ Ошибка кликера.');
    }
});

// Withdraw command
bot.onText(/\/withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Нажмите /start для регистрации.');
            return;
        }

        const message = `⭐ **Вывод звёзд**

**Ваш баланс:** ${user.balance} ⭐

${user.referrals_count < 5 ? 
    '❌ **Для вывода средств требуются минимум 5 рефералов**' : 
    '✅ **Вы можете выводить средства**'
}

**Доступные варианты вывода:**
• **/withdraw15** - 15 ⭐
• **/withdraw25** - 25 ⭐  
• **/withdraw50** - 50 ⭐
• **/withdraw100** - 100 ⭐
• **/withdrawpremium** - Telegram Premium (1300 ⭐)

Просто отправьте нужную команду!`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in withdraw:', error);
        await bot.sendMessage(chatId, '❌ Ошибка вывода.');
    }
});

// Withdraw amount commands
async function handleWithdrawCommand(msg, amount, type = 'stars') {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        
        if (user.referrals_count < 5) {
            await bot.sendMessage(chatId, '❌ Для вывода средств требуются минимум 5 рефералов!');
            return;
        }

        if (user.balance < amount) {
            await bot.sendMessage(chatId, '❌ Недостаточно средств на балансе!');
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
🔗 **Ссылка:** [Открыть профиль](tg://user?id=${user.id})

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}`;

        await bot.sendMessage(ADMIN_CHANNEL, adminMessage, { parse_mode: 'Markdown' });
        await bot.sendMessage(chatId, '✅ Заявка на вывод отправлена! Ожидайте обработки.');

    } catch (error) {
        console.error('Error in withdraw command:', error);
        await bot.sendMessage(chatId, '❌ Ошибка создания заявки на вывод.');
    }
}

bot.onText(/\/withdraw15/, (msg) => handleWithdrawCommand(msg, 15));
bot.onText(/\/withdraw25/, (msg) => handleWithdrawCommand(msg, 25));
bot.onText(/\/withdraw50/, (msg) => handleWithdrawCommand(msg, 50));
bot.onText(/\/withdraw100/, (msg) => handleWithdrawCommand(msg, 100));
bot.onText(/\/withdrawpremium/, (msg) => handleWithdrawCommand(msg, 1300, 'premium'));

// Tasks command
bot.onText(/\/tasks/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Нажмите /start для регистрации.');
            return;
        }

        const allTasks = await db.getTasks();
        const completedTasks = await db.getUserCompletedTasks(user.id);
        const completedTaskIds = completedTasks.map(t => t.id);
        const availableTasks = allTasks.filter(task => !completedTaskIds.includes(task.id));

        if (availableTasks.length === 0) {
            await bot.sendMessage(chatId, '✅ Все задания выполнены! Ожидайте новых заданий.');
            return;
        }

        let message = `📋 **Активные задания**

📊 **Прогресс:** ${completedTasks.length}/${allTasks.length} заданий выполнено

🎯 **Доступные задания:**\n\n`;

        availableTasks.forEach((task, index) => {
            message += `**${index + 1}. ${task.channel_name || task.channel_id}**\n`;
            message += `💰 Награда: ${task.reward} ⭐\n`;
            message += `📺 Канал: ${task.channel_id}\n`;
            message += `🔗 Команда: /task${task.id}\n\n`;
        });

        message += `💡 **Для выполнения задания используйте /task[ID]**\nНапример: /task${availableTasks[0].id}`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in tasks:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки заданий.');
    }
});

// Task execution command
bot.onText(/\/task(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const taskId = parseInt(match[1]);
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const result = await db.executeQuery('SELECT * FROM tasks WHERE id = $1 AND is_active = TRUE', [taskId]);
        
        if (result.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ Задание не найдено.');
            return;
        }

        const task = result.rows[0];
        
        // Check if already completed
        const completed = await db.executeQuery('SELECT 1 FROM completed_tasks WHERE user_id = $1 AND task_id = $2', [userId, taskId]);
        if (completed.rows.length > 0) {
            await bot.sendMessage(chatId, '❌ Это задание уже выполнено.');
            return;
        }

        // Check subscription to task channel
        try {
            const member = await bot.getChatMember(task.channel_id, userId);
            
            if (member.status === 'left' || member.status === 'kicked') {
                const channelLink = task.channel_id.startsWith('@') ? 
                    `https://t.me/${task.channel_id.substring(1)}` : 
                    task.channel_id;

                const keyboard = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📺 Перейти к каналу', url: channelLink }],
                            [{ text: '✅ Проверить подписку', callback_data: `check_task_${taskId}` }]
                        ]
                    }
                };

                await bot.sendMessage(chatId, `📋 **Задание: ${task.channel_name || task.channel_id}**\n\n❌ Вы не подписаны на канал!\n\n💰 **Награда:** ${task.reward} ⭐\n\n**Инструкция:**\n1. Перейдите к каналу\n2. Подпишитесь\n3. Нажмите "Проверить подписку"`, {
                    parse_mode: 'Markdown',
                    ...keyboard
                });
                return;
            }

            // User is subscribed - complete task
            const taskCompleted = await db.completeTask(userId, taskId);
            
            if (taskCompleted) {
                await bot.sendMessage(chatId, `✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, '❌ Ошибка при завершении задания.');
            }

        } catch (error) {
            // Auto-approve if bot can't check (private channel or no admin rights)
            console.log(`Auto-approving task ${taskId} for user ${userId} due to access restriction`);
            
            const taskCompleted = await db.completeTask(userId, taskId);
            
            if (taskCompleted) {
                await bot.sendMessage(chatId, `✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!\n\n⚠️ *Подписка автоматически засчитана*`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, '❌ Ошибка при завершении задания.');
            }
        }

    } catch (error) {
        console.error('Error in task execution:', error);
        await bot.sendMessage(chatId, '❌ Ошибка выполнения задания.');
    }
});

// Instruction command
bot.onText(/\/instruction/, async (msg) => {
    const chatId = msg.chat.id;
    
    const message = `📖 **Инструкция по боту**

🎯 **Как зарабатывать звёзды:**

1️⃣ **Кликер** - нажимайте /clicker каждый день и получайте 0.1 ⭐
2️⃣ **Задания** - используйте /tasks и подписывайтесь на каналы за награды
3️⃣ **Рефералы** - /invite друзей и получайте 3 ⭐ за каждого
4️⃣ **Кейсы** - /cases открывайте кейсы с призами (нужно 3+ рефералов в день)
5️⃣ **Лотерея** - /lottery участвуйте в розыгрышах

💰 **Вывод средств:**
• Минимум 5 рефералов для вывода
• /withdraw - все варианты вывода
• Доступны суммы: 15, 25, 50, 100 ⭐
• Telegram Premium на 3 месяца за 1300 ⭐

📈 **Советы:**
• Заходите каждый день
• Приглашайте активных друзей
• Выполняйте все задания
• Используйте /promocode для получения бонусов

🎮 **Основные команды:**
/profile /invite /clicker /withdraw /tasks /cases /lottery /ratings`;

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
});

// Ratings command
bot.onText(/\/ratings/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        const allResult = await db.executeQuery(`
            SELECT first_name, referrals_count 
            FROM users 
            ORDER BY referrals_count DESC 
            LIMIT 10
        `);
        
        const weekResult = await db.executeQuery(`
            SELECT first_name, referrals_today 
            FROM users 
            WHERE updated_at > CURRENT_DATE - INTERVAL '7 days'
            ORDER BY referrals_today DESC 
            LIMIT 10
        `);
        
        let message = '🏆 **Рейтинги пользователей**\n\n';
        
        message += '**🏆 Общий рейтинг по рефералам:**\n';
        if (allResult.rows.length === 0) {
            message += 'Пока нет данных.\n\n';
        } else {
            allResult.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} **${user.first_name}** - ${user.referrals_count} рефералов\n`;
            });
            message += '\n';
        }
        
        message += '**📅 Рейтинг за неделю:**\n';
        if (weekResult.rows.length === 0) {
            message += 'Пока нет данных.\n';
        } else {
            weekResult.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                message += `${medal} **${user.first_name}** - ${user.referrals_today} рефералов\n`;
            });
        }

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in ratings:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки рейтинга.');
    }
});

// Cases command
bot.onText(/\/cases/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        if (!user) {
            await bot.sendMessage(chatId, '❌ Пользователь не найден. Нажмите /start для регистрации.');
            return;
        }

        const now = new Date();
        const lastCaseOpen = user.last_case_open ? new Date(user.last_case_open) : null;
        const canOpen = !lastCaseOpen || now.toDateString() !== lastCaseOpen.toDateString();
        const hasEnoughReferrals = user.referrals_today >= 3;

        if (!hasEnoughReferrals) {
            const message = `🎁 **Кейс��**

❌ **Для открытия кейса нужно привести 3+ рефералов в день**

**Ваши рефералы сегодня:** ${user.referrals_today}/3

Приглашайте друзей командой /invite и возвращайтесь!`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }

        if (!canOpen) {
            const message = `🎁 **Кейсы**

⏰ **Вы уже открыли кейс сегодня!**

Возвращайтесь завтра за новым кейсом!`;

            await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
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

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in cases:', error);
        await bot.sendMessage(chatId, '❌ Ошибка открытия кейса.');
    }
});

// Lottery command
bot.onText(/\/lottery/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const result = await db.executeQuery('SELECT * FROM lotteries WHERE is_active = TRUE ORDER BY id');

        if (result.rows.length === 0) {
            await bot.sendMessage(chatId, '🎰 На данный момент нет активных лотерей.');
            return;
        }

        // Get user's tickets
        const ticketsResult = await db.executeQuery(
            'SELECT lottery_id FROM lottery_tickets WHERE user_id = $1',
            [userId]
        );
        const userTickets = ticketsResult.rows.map(row => row.lottery_id);

        let message = '🎰 **Активные лотереи**\n\n';
        const keyboards = [];

        result.rows.forEach((lottery, index) => {
            const hasPurchased = userTickets.includes(lottery.id);

            message += `**${lottery.name}**\n`;
            message += `💰 Цена билета: ${lottery.ticket_price} ⭐\n`;
            message += `🎫 Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
            message += `🏆 Победителей: ${lottery.winners_count}\n`;

            if (hasPurchased) {
                message += `✅ **Ваш билет куплен!**\n`;
            } else {
                if (lottery.current_tickets >= lottery.max_tickets) {
                    message += `🚫 **ПРОДАНО**\n`;
                } else {
                    message += `🔗 Команда: /buy${lottery.id}\n`;
                    keyboards.push([{ text: `🎫 Купить билет - ${lottery.name}`, callback_data: `lottery_buy_${lottery.id}` }]);
                }
            }
            message += '\n';
        });

        message += '💡 **Для покупки билета используйте /buy[ID]**\nНапример: /buy1';

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboards }
        });

    } catch (error) {
        console.error('Error in lottery:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки лотерей.');
    }
});

// Buy lottery ticket command
bot.onText(/\/buy(\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const lotteryId = parseInt(match[1]);
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    try {
        const user = await db.getUser(userId);
        
        // Get lottery details
        const lotteryResult = await db.executeQuery('SELECT * FROM lotteries WHERE id = $1 AND is_active = TRUE', [lotteryId]);
        
        if (lotteryResult.rows.length === 0) {
            await bot.sendMessage(chatId, '❌ Лотерея не найдена.');
            return;
        }

        const lottery = lotteryResult.rows[0];

        // Check if user already has a ticket
        const ticketCheck = await db.executeQuery(
            'SELECT 1 FROM lottery_tickets WHERE lottery_id = $1 AND user_id = $2',
            [lotteryId, userId]
        );

        if (ticketCheck.rows.length > 0) {
            await bot.sendMessage(chatId, '❌ Вы у��е купили билет в эту лотерею!');
            return;
        }

        // Check balance
        if (user.balance < lottery.ticket_price) {
            await bot.sendMessage(chatId, '❌ Недостаточно средств для покупки билета!');
            return;
        }

        // Check if lottery is full
        if (lottery.current_tickets >= lottery.max_tickets) {
            await bot.sendMessage(chatId, '❌ Все билеты в лотерею проданы!');
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
            const updatedLottery = await db.executeQuery(
                'UPDATE lotteries SET current_tickets = current_tickets + 1 WHERE id = $1 RETURNING current_tickets, max_tickets',
                [lotteryId]
            );

            // Deduct from balance
            await db.updateUserBalance(userId, -lottery.ticket_price);

            await db.executeQuery('COMMIT');

            // Check if lottery is now full and distribute rewards
            const newTicketCount = updatedLottery.rows[0].current_tickets;
            const maxTickets = updatedLottery.rows[0].max_tickets;

            if (newTicketCount >= maxTickets) {
                console.log(`[LOTTERY] Lottery ${lotteryId} is full, distributing rewards...`);
                await distributeLotteryRewards(lotteryId, lottery);
            }

            await bot.sendMessage(chatId, `✅ Билет успешно куплен за ${lottery.ticket_price} ⭐!`);

        } catch (error) {
            await db.executeQuery('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error in lottery buy:', error);
        await bot.sendMessage(chatId, '❌ Ошибка покупки билета.');
    }
});

// Promocode command
bot.onText(/\/promocode/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Check subscription first
    const isSubscribed = await checkAllSubscriptions(userId);
    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await bot.sendMessage(chatId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }
    
    // Set temp action for user
    await db.updateUserField(userId, 'temp_action', 'awaiting_promocode');
    
    await bot.sendMessage(chatId, '🎁 Введите промокод:');
});

// Admin commands
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
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

**Доступные команды:**
📊 **/adminstats** - подробная статистика
🎰 **/endlottery [ID]** - завершить лотерею вручную
👥 **/refupplayer [ID] [число]** - добавить рефералов пользователю
⭐ **/starsupplayer [ID] [число]** - добавить звёзды пользователю

**Управление контентом:**
📋 /create_task тип|канал|награда|лимит
📺 /add_channel канал|название  
🎰 /create_lottery название|билеты|цена|победители|процент
🎁 /create_promo КОД|награда|использования

**Удаление:**
❌ /delete_task [ID] /delete_channel [ID] /delete_lottery [ID] /delete_promo [ID]`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in admin command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке админ панели.');
    }
});

// Admin stats command
bot.onText(/\/adminstats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const stats = await db.getUserStats();
        
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

        const message = `📊 **Детальная статистика бота**

👥 **Всего пользователей:** ${stats.total_users}
📅 **Активные за неделю:** ${weeklyResult.rows[0]?.weekly_active || 0}
📅 **Активные за день:** ${dailyResult.rows[0]?.daily_active || 0}
💰 **Общий баланс:** ${stats.total_balance} ⭐
👥 **Всего рефералов:** ${stats.total_referrals}`;

        await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in admin stats:', error);
        await bot.sendMessage(chatId, '❌ Ошибка загрузки статистики.');
    }
});

// End lottery command
bot.onText(/\/endlottery (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const lotteryId = parseInt(match[1]);
        
        // Get lottery details
        const lotteryResult = await db.executeQuery('SELECT * FROM lotteries WHERE id = $1 AND is_active = TRUE', [lotteryId]);
        
        if (lotteryResult.rows.length === 0) {
            bot.sendMessage(chatId, `❌ Активная лотерея с ID ${lotteryId} не найдена.`);
            return;
        }

        const lottery = lotteryResult.rows[0];
        
        // Check if there are participants
        const participantsResult = await db.executeQuery('SELECT COUNT(*) as count FROM lottery_tickets WHERE lottery_id = $1', [lotteryId]);
        const participantCount = participantsResult.rows[0].count;
        
        if (participantCount === 0) {
            bot.sendMessage(chatId, `❌ В лотерее ${lottery.name} нет участников!`);
            return;
        }

        // Distribute rewards
        await distributeLotteryRewards(lotteryId, lottery);
        
        bot.sendMessage(chatId, `✅ Лотерея "${lottery.name}" завершена!\n👥 Участников: ${participantCount}\n🏆 Награды распределены между ${Math.min(lottery.winners_count, participantCount)} победителями.`);

    } catch (error) {
        console.error('Error ending lottery:', error);
        bot.sendMessage(chatId, '❌ Ошибка завершения лотереи.');
    }
});

// Ref up player command
bot.onText(/\/refupplayer (\d+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const targetUserId = parseInt(match[1]);
        const refCount = parseInt(match[2]);
        
        const result = await db.executeQuery(
            'UPDATE users SET referrals_count = referrals_count + $1, referrals_today = referrals_today + $2 WHERE id = $3',
            [refCount, refCount, targetUserId]
        );

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Пользователю ${targetUserId} добавлено ${refCount} рефералов!`);
            
            // Notify user
            try {
                await bot.sendMessage(targetUserId, `🎉 **Бонус от администрации!**\n\nВам добавлено **${refCount} рефералов** от администрации!\n\n💫 Спасибо за активность!`, { parse_mode: 'Markdown' });
            } catch (error) {
                console.log('Could not notify user about referral bonus');
            }
        } else {
            bot.sendMessage(chatId, `❌ Пользователь с ID ${targetUserId} не найден.`);
        }
    } catch (error) {
        console.error('Error in refupplayer:', error);
        bot.sendMessage(chatId, '❌ Ошибка добавления рефералов.');
    }
});

// Stars up player command
bot.onText(/\/starsupplayer (\d+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const targetUserId = parseInt(match[1]);
        const starsCount = parseInt(match[2]);
        
        const result = await db.updateUserBalance(targetUserId, starsCount);

        if (result) {
            bot.sendMessage(chatId, `✅ Пользователю ${targetUserId} добавлено ${starsCount} ⭐!`);
            
            // Notify user
            try {
                await bot.sendMessage(targetUserId, `🎉 **Бонус от администрации!**\n\nВам добавлено **${starsCount} ⭐** от администрации!\n\n💫 Спасибо за активность!`, { parse_mode: 'Markdown' });
            } catch (error) {
                console.log('Could not notify user about stars bonus');
            }
        } else {
            bot.sendMessage(chatId, `❌ Пользователь с ID ${targetUserId} не найден.`);
        }
    } catch (error) {
        console.error('Error in starsupplayer:', error);
        bot.sendMessage(chatId, '❌ Ошибка добавления звёзд.');
    }
});

// Test command to verify version
bot.onText(/\/test_version/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const testMessage = `🔧 **Тест версии бота**

📅 Версия: ОБНОВЛЕННАЯ v4.0 - БЕЗ INLINE КНОПОК!
🕒 Время: ${new Date().toLocaleString('ru-RU')}
👤 Ваш ID: ${userId}
🔧 Admin ID: ${isAdmin(userId) ? 'ВЫ АДМИН' : 'НЕ АДМИН'}

✅ Если вы видите это сообщение - работает НОВАЯ версия!
🎯 Все функции переведены на команды!`;

    bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });
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
        bot.sendMessage(chatId, '❌ Ошибка создания лотереи.');
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

// Callback query handler (for subscription check and task check)
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    try {
        if (data === 'check_subscriptions') {
            const isSubscribed = await checkAllSubscriptions(userId);
            
            if (isSubscribed) {
                await db.updateUserField(userId, 'is_subscribed', true);
                
                // Process pending referral if exists
                const user = await db.getUser(userId);
                if (user && user.pending_referrer) {
                    const invitedBy = user.pending_referrer;
                    
                    // Update referrer stats
                    await db.executeQuery(
                        'UPDATE users SET referrals_count = referrals_count + 1, referrals_today = referrals_today + 1, balance = balance + 3 WHERE id = $1',
                        [invitedBy]
                    );
                    
                    // Clear pending referrer
                    await db.updateUserField(userId, 'pending_referrer', null);
                    await db.updateUserField(userId, 'invited_by', invitedBy);

                    // Send notification to referrer
                    try {
                        const userInfo = await db.getUser(userId);
                        const message = `🎉 **Поздравляем!**

👤 По вашей реферальной ссылке присоединился новый пользователь: **${userInfo.first_name}**

💰 **Вы получили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

                        await bot.sendMessage(invitedBy, message, { parse_mode: 'Markdown' });
                    } catch (error) {
                        console.error('Error sending referral notification:', error);
                    }
                }
                
                await bot.editMessageText(`✅ **Отлично! Вы подписаны на все каналы!**\n\nТеперь вы можете использовать все функции бота.\n\n${getMainMenuText()}`, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown'
                });
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '❌ ��ы подписаны не на все каналы!',
                    show_alert: true
                });
            }
        } else if (data.startsWith('check_task_')) {
            const taskId = data.replace('check_task_', '');
            
            const result = await db.executeQuery('SELECT * FROM tasks WHERE id = $1 AND is_active = TRUE', [taskId]);
            
            if (result.rows.length === 0) {
                await bot.editMessageText('❌ Задание не найдено.', {
                    chat_id: chatId,
                    message_id: msg.message_id
                });
                return;
            }

            const task = result.rows[0];

            try {
                const member = await bot.getChatMember(task.channel_id, userId);
                
                if (member.status === 'left' || member.status === 'kicked') {
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: '❌ Вы не подписаны на канал!',
                        show_alert: true
                    });
                    return;
                }

                // Complete the task
                const taskCompleted = await db.completeTask(userId, taskId);
                
                if (taskCompleted) {
                    await bot.editMessageText(`✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.editMessageText('❌ Задание уже выполнено ранее.', {
                        chat_id: chatId,
                        message_id: msg.message_id
                    });
                }

            } catch (error) {
                // Auto-approve if bot can't check
                console.log(`Auto-approving task ${taskId} for user ${userId} due to access restriction`);
                
                const taskCompleted = await db.completeTask(userId, taskId);
                
                if (taskCompleted) {
                    await bot.editMessageText(`✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!\n\n⚠️ *Подписка автоматически засчитана*`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.editMessageText('❌ Ошибка при завершении задания.', {
                        chat_id: chatId,
                        message_id: msg.message_id
                    });
                }
            }
        } else if (data.startsWith('lottery_buy_')) {
            const lotteryId = data.replace('lottery_buy_', '');
            await handleLotteryBuy(chatId, msg.message_id, userId, lotteryId);
        }

        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '❌ Произошла ошибка. Попробуйте позже.',
            show_alert: true
        });
    }
});

// Handle lottery buy (kept for backward compatibility)
async function handleLotteryBuy(chatId, messageId, userId, lotteryId) {
    try {
        const user = await db.getUser(userId);
        
        const lotteryResult = await db.executeQuery('SELECT * FROM lotteries WHERE id = $1 AND is_active = TRUE', [lotteryId]);
        
        if (lotteryResult.rows.length === 0) {
            await bot.editMessageText('❌ Лотерея не найдена.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        const lottery = lotteryResult.rows[0];

        const ticketCheck = await db.executeQuery(
            'SELECT 1 FROM lottery_tickets WHERE lottery_id = $1 AND user_id = $2',
            [lotteryId, userId]
        );

        if (ticketCheck.rows.length > 0) {
            await bot.editMessageText('❌ Вы уже купили билет в эту лотерею!', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        if (user.balance < lottery.ticket_price) {
            await bot.editMessageText('❌ Недостаточно средств для покупки билета!', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        if (lottery.current_tickets >= lottery.max_tickets) {
            await bot.editMessageText('❌ Все билеты в лотерею проданы!', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        await db.executeQuery('BEGIN');
        
        try {
            await db.executeQuery(
                'INSERT INTO lottery_tickets (lottery_id, user_id) VALUES ($1, $2)',
                [lotteryId, userId]
            );

            const updatedLottery = await db.executeQuery(
                'UPDATE lotteries SET current_tickets = current_tickets + 1 WHERE id = $1 RETURNING current_tickets, max_tickets',
                [lotteryId]
            );

            await db.updateUserBalance(userId, -lottery.ticket_price);
            await db.executeQuery('COMMIT');

            const newTicketCount = updatedLottery.rows[0].current_tickets;
            const maxTickets = updatedLottery.rows[0].max_tickets;

            if (newTicketCount >= maxTickets) {
                console.log(`[LOTTERY] Lottery ${lotteryId} is full, distributing rewards...`);
                await distributeLotteryRewards(lotteryId, lottery);
            }

            await bot.editMessageText(`✅ Билет успешно куплен за ${lottery.ticket_price} ⭐!`, {
                chat_id: chatId,
                message_id: messageId
            });

        } catch (error) {
            await db.executeQuery('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error in lottery buy:', error);
        await bot.editMessageText('❌ Ошибка покупки билета.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Lottery reward distribution
async function distributeLotteryRewards(lotteryId, lottery) {
    try {
        console.log(`[LOTTERY] Starting reward distribution for lottery ${lotteryId}`);

        const participants = await db.executeQuery(
            'SELECT user_id FROM lottery_tickets WHERE lottery_id = $1',
            [lotteryId]
        );

        if (participants.rows.length === 0) {
            console.log('[LOTTERY] No participants found');
            return;
        }

        const winnersCount = Math.min(lottery.winners_count, participants.rows.length);
        const shuffled = [...participants.rows].sort(() => 0.5 - Math.random());
        const winners = shuffled.slice(0, winnersCount);

        const totalPrizePool = lottery.ticket_price * lottery.max_tickets;
        const rewardPerWinner = Math.floor(totalPrizePool / winnersCount * 100) / 100;

        console.log(`[LOTTERY] Prize pool: ${totalPrizePool} ⭐, ${winnersCount} winners, ${rewardPerWinner} ⭐ each`);

        for (const winner of winners) {
            await db.updateUserBalance(winner.user_id, rewardPerWinner);

            try {
                const message = `🎉 **Поздравляем! Вы выиграли в лотерее!**

🎰 Лотерея: **${lottery.name}**
💰 Ваш выигрыш: **${rewardPerWinner} ⭐**
🏆 Всего победителей: ${winnersCount}

✨ Награда зачислена на ваш баланс!`;

                await bot.sendMessage(winner.user_id, message, { parse_mode: 'Markdown' });
                console.log(`[LOTTERY] Winner ${winner.user_id} notified`);
            } catch (notifyError) {
                console.error(`[LOTTERY] Failed to notify winner ${winner.user_id}:`, notifyError);
            }
        }

        await db.executeQuery(
            'UPDATE lotteries SET is_active = FALSE WHERE id = $1',
            [lotteryId]
        );

        console.log(`[LOTTERY] Lottery ${lotteryId} completed successfully`);

    } catch (error) {
        console.error('[LOTTERY] Error distributing rewards:', error);
    }
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

// Admin delete commands
bot.onText(/\/delete_task (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const taskId = parseInt(match[1]);
        const result = await db.executeQuery('DELETE FROM tasks WHERE id = $1', [taskId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Задание с ID ${taskId} удалено!`);
        } else {
            bot.sendMessage(chatId, `❌ Задание с ID ${taskId} не найдено.`);
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        bot.sendMessage(chatId, '❌ Ошибка удаления задания.');
    }
});

bot.onText(/\/delete_channel (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const channelId = parseInt(match[1]);
        const result = await db.executeQuery('DELETE FROM required_channels WHERE id = $1', [channelId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Канал с ID ${channelId} удален!`);
        } else {
            bot.sendMessage(chatId, `❌ Канал с ID ${channelId} не найден.`);
        }
    } catch (error) {
        console.error('Error deleting channel:', error);
        bot.sendMessage(chatId, '❌ Ошибка уда��ения канала.');
    }
});

bot.onText(/\/delete_lottery (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const lotteryId = parseInt(match[1]);

        const ticketsResult = await db.executeQuery('SELECT COUNT(*) as count FROM lottery_tickets WHERE lottery_id = $1', [lotteryId]);
        const hasTickets = ticketsResult.rows[0].count > 0;

        if (hasTickets) {
            bot.sendMessage(chatId, `❌ Нельзя удалить лотерею с ID ${lotteryId} - в ней есть участники! Сначала завершите лотерею командой /endlottery ${lotteryId}`);
            return;
        }

        const result = await db.executeQuery('DELETE FROM lotteries WHERE id = $1', [lotteryId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Лотерея с ID ${lotteryId} удалена!`);
        } else {
            bot.sendMessage(chatId, `❌ Лотерея с ID ${lotteryId} не найдена.`);
        }
    } catch (error) {
        console.error('Error deleting lottery:', error);
        bot.sendMessage(chatId, '❌ Ошибка удален��я лотереи.');
    }
});

bot.onText(/\/delete_promo (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const promoId = parseInt(match[1]);
        const result = await db.executeQuery('DELETE FROM promocodes WHERE id = $1', [promoId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Промокод с ID ${promoId} удален!`);
        } else {
            bot.sendMessage(chatId, `❌ Промокод с ID ${promoId} не найден.`);
        }
    } catch (error) {
        console.error('Error deleting promocode:', error);
        bot.sendMessage(chatId, '❌ Ошибка удаления промокода.');
    }
});

// Daily reset cron job
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running daily reset...');
    try {
        await db.resetDailyData();
    } catch (error) {
        console.error('Error in daily reset:', error);
    }
});

// Error handling with 409 conflict management
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
        console.log('⚠️ 409 Conflict detected - another bot instance is running');
        console.log('🔄 This is normal when deploying updates');

        setTimeout(async () => {
            try {
                await bot.deleteWebHook();
                console.log('🧹 Webhook cleared due to 409 conflict');
            } catch (e) {
                console.log('ℹ️ Webhook clear attempt (may fail, that\'s ok)');
            }
        }, 5000);
    } else {
        console.error('Polling error:', error.message);
    }
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
