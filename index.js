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

// Bot token - should be set via environment variable for security
let token = process.env.BOT_TOKEN;

if (!token) {
    console.warn('⚠️  WARNING: BOT_TOKEN environment variable not set!');
    console.warn('🔓 Using fallback token for development - NOT SECURE FOR PRODUCTION!');
    console.warn('📝 Please set BOT_TOKEN in your environment variables for production.');

    // Fallback token for development (replace with env variable in production)
    token = '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';

    console.log('🚀 Bot starting with fallback token (will fail without real env token)...');
} else {
    console.log('✅ Bot starting with environment token (secure)');
}

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
                // If bot can't check membership, return false for security
                console.log(`Cannot check subscription for channel ${channel}: ${error.message}`);
                // Only auto-approve if the error is specifically about chat not found or bot not having access
                if (error.response?.body?.error_code === 400 || error.response?.body?.description?.includes('chat not found')) {
                    console.log(`Auto-approving ${channel} - chat not accessible`);
                    continue;
                } else {
                    return false;
                }
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
    
    message += '\n📌 После подписки на все каналы нажмите кнопку проверки';
    buttons.push([{ text: '✅ Проверить подписки', callback_data: 'check_subscriptions' }]);
    
    return { message, buttons };
}

// Create inline keyboards (RESTORED)
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
                    { text: '📋 Зада��ия', callback_data: 'tasks' },
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
                    { text: '📢 Рассылк�� сообщений', callback_data: 'admin_broadcast' }
                ]
            ]
        }
    };
}

// Remove keyboard buttons
bot.onText(/\/start/, () => {}); // This will be handled by the main start handler

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

            // Check for referral or tracking link
            if (referralCode) {
                // Check if it's a tracking link
                if (referralCode.startsWith('track_')) {
                    // This is a tracking link, not a referral
                    console.log(`[TRACKING] User ${userId} came from tracking link: ${referralCode}`);

                    // Record tracking click
                    try {
                        await db.executeQuery(
                            'INSERT INTO tracking_clicks (tracking_id, user_id, clicked_at) VALUES ($1, $2, NOW())',
                            [referralCode, userId]
                        );

                        // Update tracking link counter
                        await db.executeQuery(
                            'UPDATE tracking_links SET clicks_count = clicks_count + 1 WHERE tracking_id = $1',
                            [referralCode]
                        );

                        console.log(`[TRACKING] Recorded click for tracking link: ${referralCode}`);
                    } catch (error) {
                        console.error('[TRACKING] Error recording click:', error);
                    }
                } else if (!isNaN(referralCode)) {
                    // This is a regular referral
                    const referrerId = parseInt(referralCode);
                    const referrer = await db.getUser(referrerId);
                    if (referrer && referrerId !== userId) { // Prevent self-referral
                        // Store referral info temporarily, will be processed after subscription
                        await db.updateUserField(userId, 'pending_referrer', referrerId);
                    }
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

👥 П��одолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

                await bot.sendMessage(invitedBy, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                            [{ text: '🏠 Главное ме��ю', callback_data: 'main_menu' }]
                        ]
                    }
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

Выберите действие из меню ниж��:`;

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }, // Remove custom keyboard
            ...getMainMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Test command to verify version
bot.onText(/\/test_version/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const testMessage = `🔧 **Тест версии бота**

📅 Версия: ОБНОВЛЕННАЯ v5.0 - С КНОПКАМИ И УЛУЧШЕНИЯМИ!
🕒 Время: ${new Date().toLocaleString('ru-RU')}
👤 Ваш ID: ${userId}
🔧 Admin ID: ${isAdmin(userId) ? 'ВЫ АДМИН' : 'НЕ АДМИН'}

✅ Если вы видите это сообщение - работает НОВАЯ версия!
🎯 Inline-кнопки восстановлены, улучшения сохранены!`;

    bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });
});

// Admin commands for manual user management
bot.onText(/\/endlottery (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const lotteryId = parseInt(match[1]);
        
        const lotteryResult = await db.executeQuery('SELECT * FROM lotteries WHERE id = $1 AND is_active = TRUE', [lotteryId]);
        
        if (lotteryResult.rows.length === 0) {
            bot.sendMessage(chatId, `❌ Активная лотерея с ID ${lotteryId} не найдена.`);
            return;
        }

        const lottery = lotteryResult.rows[0];
        
        const participantsResult = await db.executeQuery('SELECT COUNT(*) as count FROM lottery_tickets WHERE lottery_id = $1', [lotteryId]);
        const participantCount = participantsResult.rows[0].count;
        
        if (participantCount === 0) {
            bot.sendMessage(chatId, `❌ В лотерее ${lottery.name} нет участников!`);
            return;
        }

        await distributeLotteryRewards(lotteryId, lottery);
        
        bot.sendMessage(chatId, `✅ Лотерея "${lottery.name}" завершена!\n👥 Участников: ${participantCount}\n🏆 Награды распределены между ${Math.min(lottery.winners_count, participantCount)} победителями.`);

    } catch (error) {
        console.error('Error ending lottery:', error);
        bot.sendMessage(chatId, '❌ Ошибка завершения лотереи.');
    }
});

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

// Admin command handler
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    console.log(`[ADMIN] /admin command called by userId: ${userId}, isAdmin: ${isAdmin(userId)}`);

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

**Дополнительные команды:**
🎰 **/endlottery [ID]** - завершить лотерею вручную
👥 **/refupplayer [ID] [число]** - добавить рефералов пользователю
⭐ **/starsupplayer [ID] [число]** - добавить звёзды пользовател��

**Трекинговые ссылки:**
🔗 **/create_tracking_link название** - создать ссылку для рекламы
📊 **/list_tracking** - список всех ссылок
📈 **/tracking_stats ID** - статистика ссылки

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
        if (params.length < 3) {
            bot.sendMessage(chatId, '❌ Неверный формат! Используйте: /create_task канал|название|награда');
            return;
        }

        const [channelId, channelName, reward] = params;
        const rewardAmount = parseFloat(reward) || 1.0;

        console.log('[CREATE-TASK] Creating task:', { channelId, channelName, rewardAmount });

        await db.executeQuery(
            'INSERT INTO tasks (channel_id, channel_name, reward) VALUES ($1, $2, $3) ON CONFLICT (channel_id) DO UPDATE SET channel_name = $2, reward = $3',
            [channelId.trim(), channelName.trim(), rewardAmount]
        );

        bot.sendMessage(chatId, `✅ Задание создано!\n📺 Канал: ${channelId.trim()}\n📝 Название: ${channelName.trim()}\n💰 Награда: ${rewardAmount} ⭐`);
        console.log('[CREATE-TASK] Task created successfully');

    } catch (error) {
        console.error('Error creating task:', error);
        console.error('Full error:', error.stack);
        bot.sendMessage(chatId, `❌ Ошибка создания задания: ${error.message}`);
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
        const lotteryName = name.trim();
        const maxTicketsNum = parseInt(maxTickets);
        const ticketPriceNum = parseFloat(ticketPrice);
        const winnersCountNum = parseInt(winnersCount);
        const botPercentNum = parseInt(botPercent);

        console.log('[CREATE-LOTTERY] Creating lottery:', { lotteryName, maxTicketsNum, ticketPriceNum, winnersCountNum, botPercentNum });

        await db.executeQuery(
            'INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count, bot_percent, current_tickets) VALUES ($1, $2, $3, $4, $5, 0)',
            [lotteryName, ticketPriceNum, maxTicketsNum, winnersCountNum, botPercentNum]
        );

        bot.sendMessage(chatId, `✅ Лотерея создана!\n🎰 ${lotteryName}\n🎫 ${maxTicketsNum} билетов по ${ticketPriceNum} ⭐\n🏆 ${winnersCountNum} победителей\n💰 Процент бота: ${botPercentNum}%`);
        console.log('[CREATE-LOTTERY] Lottery created successfully');

    } catch (error) {
        console.error('Error creating lottery:', error);
        console.error('Full error:', error.stack);
        bot.sendMessage(chatId, `❌ Ошибка создания лотереи: ${error.message}`);
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

    console.log(`[CALLBACK] Received: ${data} from userId: ${userId}`);

    try {
        // Check subscription for all important buttons (except admin functions)
        if (data !== 'check_subscriptions' && data !== 'main_menu' && !data.startsWith('admin_') && !isAdmin(userId)) {
            const isSubscribed = await checkAllSubscriptions(userId);
            if (!isSubscribed) {
                const subData = await getSubscriptionMessage();
                await bot.editMessageText(subData.message, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    reply_markup: { inline_keyboard: subData.buttons }
                });
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
        }

        // Get user data
        const user = await db.getUser(userId);
        
        if (!user && !data.startsWith('admin_') && data !== 'main_menu' && data !== 'check_subscriptions') {
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
            case 'check_subscriptions':
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

👤 По вашей ��еферальной ссылке присоединился новый пользователь: **${userInfo.first_name}**

💰 **Вы получили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзе�� и зарабатывайте еще больше звёзд!`;

                            await bot.sendMessage(invitedBy, message, { parse_mode: 'Markdown' });
                        } catch (error) {
                            console.error('Error sending referral notification:', error);
                        }
                    }
                    
                    await handleMainMenu(chatId, msg.message_id);
                } else {
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: '❌ Вы подписаны не на все каналы!',
                        show_alert: true
                    });
                }
                break;
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
                await handleLottery(chatId, msg.message_id, userId);
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
                console.log(`[MAIN] Admin tasks called by userId: ${userId}, isAdmin: ${isAdmin(userId)}`);
                if (isAdmin(userId)) {
                    try {
                        console.log('[MAIN] Calling adminHandlers.handleAdminTasks...');
                        console.log('[MAIN] adminHandlers object:', typeof adminHandlers);
                        console.log('[MAIN] handleAdminTasks function:', typeof adminHandlers.handleAdminTasks);

                        if (typeof adminHandlers.handleAdminTasks !== 'function') {
                            throw new Error('handleAdminTasks is not a function');
                        }

                        await adminHandlers.handleAdminTasks(bot, chatId, msg.message_id);
                        console.log('[MAIN] handleAdminTasks completed successfully');
                    } catch (error) {
                        console.error('[MAIN] Error in handleAdminTasks:', error);
                        console.error('[MAIN] Error stack:', error.stack);
                        await bot.editMessageText(`❌ Ошибка: ${error.message}`, {
                            chat_id: chatId,
                            message_id: msg.message_id,
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
                        });
                    }
                }
                break;
            case 'admin_channels':
                console.log(`[MAIN] Admin channels called by userId: ${userId}, isAdmin: ${isAdmin(userId)}`);
                if (isAdmin(userId)) {
                    try {
                        console.log('[MAIN] Calling adminHandlers.handleAdminChannels...');
                        console.log('[MAIN] handleAdminChannels function:', typeof adminHandlers.handleAdminChannels);

                        if (typeof adminHandlers.handleAdminChannels !== 'function') {
                            throw new Error('handleAdminChannels is not a function');
                        }

                        await adminHandlers.handleAdminChannels(bot, chatId, msg.message_id);
                        console.log('[MAIN] handleAdminChannels completed successfully');
                    } catch (error) {
                        console.error('[MAIN] Error in handleAdminChannels:', error);
                        console.error('[MAIN] Error stack:', error.stack);
                        await bot.editMessageText(`❌ Ошибка: ${error.message}`, {
                            chat_id: chatId,
                            message_id: msg.message_id,
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
                        });
                    }
                }
                break;
            case 'admin_lottery':
                console.log(`[MAIN] Admin lottery called by userId: ${userId}, isAdmin: ${isAdmin(userId)}`);
                if (isAdmin(userId)) {
                    try {
                        console.log('[MAIN] Calling adminHandlers.handleAdminLottery...');
                        await adminHandlers.handleAdminLottery(bot, chatId, msg.message_id);
                    } catch (error) {
                        console.error('[MAIN] Error in handleAdminLottery:', error);
                        await bot.editMessageText('❌ Ошибка загрузки управления лотереями.', {
                            chat_id: chatId,
                            message_id: msg.message_id,
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
                        });
                    }
                }
                break;
            case 'admin_promocodes':
                console.log(`[MAIN] Admin promocodes called by userId: ${userId}, isAdmin: ${isAdmin(userId)}`);
                if (isAdmin(userId)) {
                    try {
                        console.log('[MAIN] Calling adminHandlers.handleAdminPromocodes...');
                        await adminHandlers.handleAdminPromocodes(bot, chatId, msg.message_id);
                    } catch (error) {
                        console.error('[MAIN] Error in handleAdminPromocodes:', error);
                        await bot.editMessageText('❌ Ошибка загрузки управления промокодами.', {
                            chat_id: chatId,
                            message_id: msg.message_id,
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_menu' }]] }
                        });
                    }
                }
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
            case 'broadcast_custom':
                if (isAdmin(userId)) {
                    try {
                        console.log('[MAIN] Calling adminHandlers.handleBroadcastCustom...');
                        await adminHandlers.handleBroadcastCustom(bot, chatId, msg.message_id);
                        console.log('[MAIN] handleBroadcastCustom completed successfully');
                    } catch (error) {
                        console.error('[MAIN] Error in handleBroadcastCustom:', error);
                        await bot.editMessageText('❌ Ошибка загрузки кастомной рассылки.', {
                            chat_id: chatId,
                            message_id: msg.message_id,
                            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]] }
                        });
                    }
                }
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
                } else if (data === 'lottery_sold_out') {
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: '🚫 Все билет�� в эту лотерею проданы!',
                        show_alert: true
                    });
                    return; // Don't process further
                } else if (data.startsWith('approve_withdrawal_')) {
                    if (isAdmin(userId)) await handleWithdrawalApproval(chatId, msg.message_id, data);
                } else if (data.startsWith('reject_withdrawal_')) {
                    if (isAdmin(userId)) await handleWithdrawalRejection(chatId, msg.message_id, data, userId);
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

// Lottery reward distribution
async function distributeLotteryRewards(lotteryId, lottery) {
    try {
        console.log(`[LOTTERY] Starting reward distribution for lottery ${lotteryId}`);

        // Get all participants
        const participants = await db.executeQuery(
            'SELECT user_id FROM lottery_tickets WHERE lottery_id = $1',
            [lotteryId]
        );

        if (participants.rows.length === 0) {
            console.log('[LOTTERY] No participants found');
            return;
        }

        // Select random winners
        const winnersCount = Math.min(lottery.winners_count, participants.rows.length);
        const shuffled = [...participants.rows].sort(() => 0.5 - Math.random());
        const winners = shuffled.slice(0, winnersCount);

        // Calculate reward per winner (with bot percentage)
        const totalPrizePool = lottery.ticket_price * lottery.max_tickets;
        const botPercent = lottery.bot_percent || 20; // Default 20% if not set
        const playersPrizePool = totalPrizePool * (1 - botPercent / 100);
        const botTake = totalPrizePool - playersPrizePool;
        const rewardPerWinner = Math.floor(playersPrizePool / winnersCount * 100) / 100; // Round to 2 decimals

        console.log(`[LOTTERY] Total pool: ${totalPrizePool} ⭐, Bot take (${botPercent}%): ${botTake} ⭐, Players pool: ${playersPrizePool} ⭐, ${winnersCount} winners, ${rewardPerWinner} ⭐ each`);

        // Distribute rewards
        for (const winner of winners) {
            await db.updateUserBalance(winner.user_id, rewardPerWinner);

            // Notify winner
            try {
                const user = await db.getUser(winner.user_id);
                const message = `🎉 **Поз��равляем! Вы выиграли в лотерее!**

🎰 Лотерея: **${lottery.name}**
💰 Ваш выигрыш: **${rewardPerWinner} ⭐**
🏆 Всего победителей: ${winnersCount}

✨ Награда зачислена на ваш баланс!`;

                await bot.sendMessage(winner.user_id, message, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '👤 Мой профиль', callback_data: 'profile' }],
                            [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                        ]
                    }
                });
                console.log(`[LOTTERY] Winner ${winner.user_id} notified`);
            } catch (notifyError) {
                console.error(`[LOTTERY] Failed to notify winner ${winner.user_id}:`, notifyError);
            }
        }

        // Mark lottery as inactive
        await db.executeQuery(
            'UPDATE lotteries SET is_active = FALSE WHERE id = $1',
            [lotteryId]
        );

        console.log(`[LOTTERY] Lottery ${lotteryId} completed successfully`);

    } catch (error) {
        console.error('[LOTTERY] Error distributing rewards:', error);
    }
}

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

🆔 **Информа��ия о пользователе:**
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
${user.last_case_open ? `• Последний кейс: ${new Date(user.last_case_open).toLocaleDateString('ru-RU')}` : '• Кейсы еще не о��крывались'}`;

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
📅 Пр��глашено сегодня: **${user.referrals_today}**
💰 Заработано с рефералов: **${user.referrals_count * 3} ⭐**

🎯 **Как это работает:**
1. Поделитесь ссылкой с друзьями
2. Друг рег��стрируется по ссылке
3. Друг подписывается на все обязательные каналы
4. Вы получаете 3 ⭐ на баланс!

⚠️ **Важно:** Реферал засчитывается только после подписки на все каналы!`;

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

��� **Награда уже получена сегодня!**

💰 **Ваш баланс:** ${user.balance} ⭐

⏳ **До следующей награды:** ${hoursLeft}ч ${minutesLeft}м
🎁 **Следующая награда:** 0.1 ⭐

💡 **С��вет:** Приглашайте друзей и получайте 3 ⭐ за каждого!`;

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
        await bot.editMessageText('❌ Для вывода средств требуются минимум 5 рефералов!', {
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
🔗 **Ссылка:** [Открыть профиль](tg://user?id=${user.id})

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}`;

    const adminKeyboard = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '✅ Выполнено', callback_data: `approve_withdrawal_${userId}_${amount}_${type}` },
                    { text: '❌ Отклонено', callback_data: `reject_withdrawal_${userId}_${amount}_${type}` }
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
                await bot.editMessageText(`✅ Задание вы��олнено! Вы получили ${task.reward} ⭐`, {
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
            console.error(`Error checking task subscription: ${error.message}`);

            // Only auto-approve for specific errors (chat not found, private chat)
            if (error.response?.body?.error_code === 400 || error.response?.body?.description?.includes('chat not found')) {
                console.log(`Auto-approving task ${taskId} for user ${userId} - chat not accessible`);

                const completed = await db.completeTask(userId, taskId);

                if (completed) {
                    await bot.editMessageText(`✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!\n\n⚠️ *Канал недоступен для проверки*`, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        ...getBackToMainKeyboard()
                    });
                } else {
                    await bot.editMessageText('❌ Задание уже выполнено ранее.', {
                        chat_id: chatId,
                        message_id: messageId,
                        ...getBackToMainKeyboard()
                    });
                }
            } else {
                await bot.editMessageText('❌ Ошибка проверки подписки. Попробуйте позже или обратитесь к администрации.', {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getTaskKeyboard(taskId)
                });
            }
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
    const message = `📖 **Инструкция по ��оту**

🎯 **Как зарабатывать звёзды:**

1️⃣ **Кликер** - нажимайте каждый день и получайте 0.1 ⭐
2️⃣ **Задания** - подписывайтесь на каналы за награды
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
• Выполняйте все задания

⚠️ **Важно:** Рефералы засчитываются только после подписки на все каналы!`;

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

async function handleLottery(chatId, messageId, userId = null) {
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

        // Get user's tickets if userId provided
        let userTickets = [];
        if (userId) {
            const ticketsResult = await db.executeQuery(
                'SELECT lottery_id FROM lottery_tickets WHERE user_id = $1',
                [userId]
            );
            userTickets = ticketsResult.rows.map(row => row.lottery_id);
        }

        let message = '🎰 **Активные лотереи**\n\n';
        const keyboards = [];

        result.rows.forEach((lottery, index) => {
            const hasPurchased = userTickets.includes(lottery.id);

            message += `**${lottery.name}**\n`;
            message += `💰 Цена билета: ${lottery.ticket_price} ⭐\n`;
            message += `🎫 Биле��ов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
            message += `🏆 Победителей: ${lottery.winners_count}\n`;

            if (hasPurchased) {
                message += `✅ **Ваш билет куплен!**\n\n`;
                // Don't add button for purchased lottery
            } else {
                message += `\n`;
                // Check if lottery is full
                if (lottery.current_tickets >= lottery.max_tickets) {
                    keyboards.push([{ text: `🚫 ${lottery.name} - ПРОДАНО`, callback_data: 'lottery_sold_out' }]);
                } else {
                    keyboards.push([{ text: `🎫 Купить билет - ${lottery.name}`, callback_data: `lottery_buy_${lottery.id}` }]);
                }
            }
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
            await bot.editMessageText('❌ Вс�� билеты в лотерею проданы!', {
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

// Withdrawal approval handler
async function handleWithdrawalApproval(chatId, messageId, callbackData) {
    try {
        console.log('[WITHDRAWAL] Processing approval:', callbackData);
        const parts = callbackData.split('_');
        const targetUserId = parseInt(parts[2]);
        const amount = parseInt(parts[3]);
        const type = parts[4];

        console.log('[WITHDRAWAL] Parsed data:', { targetUserId, amount, type });

        // Get user info
        const user = await db.getUser(targetUserId);
        if (!user) {
            await bot.editMessageText('❌ Пользователь не найден.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        console.log('[WITHDRAWAL] User found:', user.first_name);

        // Send congratulations to user
        const congratsMessage = `🎉 **Поздравляем!**

✅ **Ваша заявка на вывод одобрена!**

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}

🎯 **Награда уже выплачена!** Спасибо за использование нашего б��та!

👥 Продолжайте приглашать друзей и зарабатывать еще больше!`;

        await bot.sendMessage(targetUserId, congratsMessage, { parse_mode: 'Markdown' });
        console.log('[WITHDRAWAL] Congratulations sent to user');

        // Update admin message
        await bot.editMessageText(`✅ **Заявка одобрена**

👤 Пользователь: ${user.first_name}
💰 Сумма: ${amount} ⭐
📦 Тип: ${type === 'premium' ? 'Telegram Premium' : 'Звёзды'}

✅ Пользователь уведомлен об одобрении.`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });

        console.log('[WITHDRAWAL] Admin message updated');

    } catch (error) {
        console.error('Error in withdrawal approval:', error);
        console.error('Full error:', error.stack);
        await bot.editMessageText(`❌ Ошибка обработки заявки: ${error.message}`, {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Withdrawal rejection handler
async function handleWithdrawalRejection(chatId, messageId, callbackData, adminId) {
    try {
        const parts = callbackData.split('_');
        const targetUserId = parseInt(parts[2]);
        const amount = parseInt(parts[3]);
        const type = parts[4];

        // Get user info
        const user = await db.getUser(targetUserId);
        if (!user) {
            await bot.editMessageText('❌ Пользователь не найден.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        // Set admin state to await rejection reason
        await db.updateUserField(adminId, 'temp_action', `rejecting_withdrawal_${targetUserId}_${amount}_${type}`);

        // Update message to ask for reason
        await bot.editMessageText(`❌ **Отклонение заявки**

👤 Пользователь: ${user.first_name}
💰 Сумма: ${amount} ⭐
📦 Тип: ${type === 'premium' ? 'Telegram Premium' : 'Звёзды'}

✏️ **Напишите причину отклонения:**`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });

    } catch (error) {
        console.error('Error in withdrawal rejection:', error);
        await bot.editMessageText('❌ Ошибка обработки заявки.', {
            chat_id: chatId,
            message_id: messageId
        });
    }
}

// Handle text messages (for promocodes and rejection reasons)
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        try {
            const user = await db.getUser(userId);

            if (user && user.temp_action) {
                if (user.temp_action === 'awaiting_promocode') {
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
                } else if (user.temp_action.startsWith('rejecting_withdrawal_')) {
                    console.log('[REJECTION] Processing rejection reason:', msg.text);
                    const rejectionReason = msg.text.trim();
                    const actionParts = user.temp_action.split('_');
                    const targetUserId = parseInt(actionParts[2]);
                    const amount = parseInt(actionParts[3]);
                    const type = actionParts[4];

                    console.log('[REJECTION] Parsed data:', { targetUserId, amount, type, rejectionReason });

                    // Clear temp action
                    await db.updateUserField(userId, 'temp_action', null);
                    console.log('[REJECTION] Temp action cleared');

                    // Return money to user
                    await db.updateUserBalance(targetUserId, amount);
                    console.log('[REJECTION] Money returned to user');

                    // Get target user info
                    const targetUser = await db.getUser(targetUserId);
                    console.log('[REJECTION] Target user found:', targetUser.first_name);

                    // Send rejection notice to user
                    const rejectionMessage = `❌ **Заявка на вывод отклонена**

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}

📝 **Причина отклонения:**
${rejectionReason}

💸 **Средства возвращены на баланс.**

Если у вас есть вопросы, обрати��есь к администрации.`;

                    await bot.sendMessage(targetUserId, rejectionMessage, { parse_mode: 'Markdown' });
                    console.log('[REJECTION] Rejection message sent to user');

                    // Confirm to admin
                    await bot.sendMessage(chatId, `✅ Заявка отклонена.\n👤 Пользовател�� ${targetUser.first_name} отправлено уведомление.\n💸 Средства (${amount} ⭐) возвращены на баланс.`);
                    console.log('[REJECTION] Confirmation sent to admin');
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

📊 **Быстрая статистика:**
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

**Дополнит��льные команды:**
🎰 **/endlottery [ID]** - завершить лотерею вручную
👥 **/refupplayer [ID] [число]** - добавить рефералов ��ользователю
⭐ **/starsupplayer [ID] [число]** - добавить звёзды пользователю

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

// Tracking links system
bot.onText(/\/create_tracking_link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const linkName = match[1].trim();

        if (!linkName) {
            bot.sendMessage(chatId, '❌ Укажите название ссылки! Используйте: /create_tracking_link Название_рекламы');
            return;
        }

        // Generate unique tracking ID
        const trackingId = 'track_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // Get bot username
        let botUsername = 'starsbotexample';
        try {
            const botInfo = await bot.getMe();
            botUsername = botInfo.username;
        } catch (error) {
            console.error('Error getting bot info:', error);
        }

        // Create tracking link
        const trackingLink = `https://t.me/${botUsername}?start=${trackingId}`;

        // Save to database
        await db.executeQuery(
            'INSERT INTO tracking_links (tracking_id, name, created_by, created_at) VALUES ($1, $2, $3, NOW())',
            [trackingId, linkName, userId]
        );

        const message = `✅ **Трекинговая ссылка создана!**

📝 **Название:** ${linkName}
🔗 **Ссылка:** \`${trackingLink}\`
🆔 **ID:** \`${trackingId}\`

📊 **Статистика:** /tracking_stats ${trackingId}
📋 **Все ссылки:** /list_tracking`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log(`[TRACKING] Created tracking link: ${trackingId} for ${linkName}`);

    } catch (error) {
        console.error('Error creating tracking link:', error);
        bot.sendMessage(chatId, `❌ Ошибка создания ссылки: ${error.message}`);
    }
});

// List tracking links
bot.onText(/\/list_tracking/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const result = await db.executeQuery(
            'SELECT tracking_id, name, clicks_count, created_at FROM tracking_links ORDER BY created_at DESC'
        );

        if (result.rows.length === 0) {
            bot.sendMessage(chatId, '📋 **Трекинговых ссылок пока нет.**\n\n💡 Создайте ссылку: /create_tracking_link Название', { parse_mode: 'Markdown' });
            return;
        }

        let message = '📋 **Список трекинговых ссылок**\n\n';

        result.rows.forEach((link, index) => {
            const date = new Date(link.created_at).toLocaleDateString('ru-RU');
            message += `${index + 1}. **${link.name}**\n`;
            message += `   🔗 ID: \`${link.tracking_id}\`\n`;
            message += `   👥 Переходов: ${link.clicks_count || 0}\n`;
            message += `   📅 Создана: ${date}\n\n`;
        });

        message += '💡 **Статистика ссылки:** /tracking_stats ID';

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error listing tracking links:', error);
        bot.sendMessage(chatId, `❌ Ошибка загрузки списка: ${error.message}`);
    }
});

// Tracking stats
bot.onText(/\/tracking_stats (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const trackingId = match[1].trim();

        // Get tracking link info
        const linkResult = await db.executeQuery(
            'SELECT * FROM tracking_links WHERE tracking_id = $1',
            [trackingId]
        );

        if (linkResult.rows.length === 0) {
            bot.sendMessage(chatId, '❌ Тре��инговая ссылка не найдена.');
            return;
        }

        const link = linkResult.rows[0];

        // Get detailed stats
        const statsResult = await db.executeQuery(
            'SELECT COUNT(*) as total_clicks, COUNT(DISTINCT user_id) as unique_users FROM tracking_clicks WHERE tracking_id = $1',
            [trackingId]
        );

        const recentResult = await db.executeQuery(
            'SELECT COUNT(*) as recent_clicks FROM tracking_clicks WHERE tracking_id = $1 AND clicked_at > NOW() - INTERVAL \'24 hours\'',
            [trackingId]
        );

        const stats = statsResult.rows[0];
        const recentStats = recentResult.rows[0];

        const createdDate = new Date(link.created_at).toLocaleDateString('ru-RU');

        const message = `📊 **Статистика трекинговой ссылки**\n\n📝 **Название:** ${link.name}\n🆔 **ID:** \`${trackingId}\`\n📅 **Создана:** ${createdDate}\n\n📈 **Статистика:**\n👥 Всего переходов: **${stats.total_clicks || 0}**\n🔄 Уникальных пользователей: **${stats.unique_users || 0}**\n⏰ За последние 24 часа: **${recentStats.recent_clicks || 0}**\n\n🔗 **Ссылка:** \`https://t.me/YOUR_BOT?start=${trackingId}\``;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error getting tracking stats:', error);
        bot.sendMessage(chatId, `❌ Ошибка загрузки статистики: ${error.message}`);
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
        bot.sendMessage(chatId, '❌ Ошибка удаления канала.');
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

        // Check if lottery has participants
        const ticketsResult = await db.executeQuery('SELECT COUNT(*) as count FROM lottery_tickets WHERE lottery_id = $1', [lotteryId]);
        const hasTickets = ticketsResult.rows[0].count > 0;

        if (hasTickets) {
            bot.sendMessage(chatId, `❌ Нельзя удалить лотерею с ID ${lotteryId} - в ней есть учас��ники! Сначала завершите лотерею командой /endlottery ${lotteryId}`);
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
        bot.sendMessage(chatId, '❌ Ошибка удаления лотереи.');
    }
});

// Custom broadcast command
bot.onText(/\/custom_broadcast\s+([\s\S]+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const broadcastMessage = match[1].trim();

        if (!broadcastMessage) {
            bot.sendMessage(chatId, '❌ Пустое сообщение! Используйте: /custom_broadcast Ваше сообщение');
            return;
        }

        // Get all users
        const users = await db.executeQuery('SELECT id FROM users');
        const totalUsers = users.rows.length;
        let successCount = 0;
        let failCount = 0;

        // Send confirmation
        const confirmMsg = await bot.sendMessage(chatId, `📤 **Начинаю рассылку...**\n\n👥 Пользователей: ${totalUsers}\n⏳ Прогресс: 0%`);

        // Send to all users
        for (let i = 0; i < users.rows.length; i++) {
            const user = users.rows[i];
            try {
                await bot.sendMessage(user.id, `📢 **Сообщение от администрации**\n\n${broadcastMessage}`, { parse_mode: 'Markdown' });
                successCount++;
            } catch (error) {
                failCount++;
                console.log(`Failed to send to user ${user.id}: ${error.message}`);
            }

            // Update progress every 10 users
            if (i % 10 === 0 || i === users.rows.length - 1) {
                const progress = Math.round((i + 1) / totalUsers * 100);
                try {
                    await bot.editMessageText(`📤 **Рассылка в процессе...**\n\n👥 Пользователей: ${totalUsers}\n✅ Отправлено: ${successCount}\n❌ Ошибок: ${failCount}\n⏳ Прогресс: ${progress}%`, {
                        chat_id: chatId,
                        message_id: confirmMsg.message_id,
                        parse_mode: 'Markdown'
                    });
                } catch (e) {
                    // Ignore edit errors
                }
            }

            // Small delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Final report
        await bot.editMessageText(`✅ **Рассылка завершена!**\n\n👥 Всего пользователей: ${totalUsers}\n✅ Успешно отправлено: ${successCount}\n❌ Ошибок: ${failCount}\n📊 Успешность: ${Math.round(successCount/totalUsers*100)}%`, {
            chat_id: chatId,
            message_id: confirmMsg.message_id,
            parse_mode: 'Markdown'
        });

        console.log(`[BROADCAST] Custom broadcast completed: ${successCount}/${totalUsers} successful`);

    } catch (error) {
        console.error('Error in custom broadcast:', error);
        bot.sendMessage(chatId, `❌ Ошибка рассылки: ${error.message}`);
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
        console.log('✅ Daily reset completed successfully');
    } catch (error) {
        console.error('❌ Critical error in daily reset:', error);
        // Send alert to admin if possible
        try {
            await bot.sendMessage(ADMIN_CHANNEL, `⚠️ **Ошибка сброса данных**\n\nОшибка: ${error.message}\nВремя: ${new Date().toLocaleString('ru-RU')}`, { parse_mode: 'Markdown' });
        } catch (alertError) {
            console.error('Failed to send alert to admin:', alertError);
        }
    }
}, {
    timezone: 'Europe/Moscow'
});

// Weekly rewards for top 5 users (Sundays at 20:00 MSK)
cron.schedule('0 20 * * 0', async () => {
    console.log('🏆 Running weekly top-5 rewards...');
    try {
        // Get top 5 users by referrals this week
        const result = await db.executeQuery(`
            SELECT id, first_name, referrals_today
            FROM users
            WHERE referrals_today > 0
            ORDER BY referrals_today DESC
            LIMIT 5
        `);

        if (result.rows.length === 0) {
            console.log('[WEEKLY-REWARDS] No users with referrals this week');
            return;
        }

        const rewards = [100, 75, 50, 25, 15]; // Stars for positions 1-5
        const positions = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];

        let rewardMessage = '🏆 **Еженедельные награды!**\n\n📅 **Топ-5 пользователей по рефералам за неделю:**\n\n';

        for (let i = 0; i < result.rows.length; i++) {
            const user = result.rows[i];
            const reward = rewards[i];
            const position = positions[i];

            // Give reward to user
            await db.updateUserBalance(user.id, reward);

            // Add to message
            rewardMessage += `${position} **${user.first_name}** - ${user.referrals_today} рефералов (+${reward} ⭐)\n`;

            // Send personal congratulations
            try {
                const personalMessage = `🎉 **Поздравляем!**\n\n${position} **Вы заняли ${i + 1} место в недельном рейтинге!**\n\n👥 **Рефералов за неделю:** ${user.referrals_today}\n💰 **Награда:** +${reward} ⭐\n\n🎯 Отличная работа! Продолжайте приглашать друзей!`;

                await bot.sendMessage(user.id, personalMessage, { parse_mode: 'Markdown' });
                console.log(`[WEEKLY-REWARDS] Reward sent to ${user.first_name}: ${reward} stars`);
            } catch (error) {
                console.error(`[WEEKLY-REWARDS] Failed to notify user ${user.id}:`, error);
            }
        }

        rewardMessage += '\n🎯 **Увидимся на следующей неделе!**';

        // Send summary to admin channel
        try {
            await bot.sendMessage(ADMIN_CHANNEL, rewardMessage, { parse_mode: 'Markdown' });
            console.log('[WEEKLY-REWARDS] Summary sent to admin channel');
        } catch (error) {
            console.error('[WEEKLY-REWARDS] Failed to send summary to admin:', error);
        }

        console.log('[WEEKLY-REWARDS] Weekly rewards completed successfully');

    } catch (error) {
        console.error('Error in weekly rewards:', error);
    }
}, {
    timezone: 'Europe/Moscow'
});

// Error handling with 409 conflict management
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
        console.log('⚠️ 409 Conflict detected - another bot instance is running');
        console.log('🔄 This is normal when deploying updates');

        // Try to clear webhook just in case
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
