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

const { throttler } = require('./message-throttler');
console.log('[MAIN] message throttler imported');

// Автоотправка звёзд удалена - только ручная обработка

// Helper function to send throttled messages
async function sendThrottledMessage(userId, message, options = {}) {
    return await throttler.sendMessage(() => bot.sendMessage(userId, message, options));
}

// Helper function to safely edit messages (prevents "message is not modified" errors)
async function safeEditMessage(chatId, messageId, text, options = {}) {
    try {
        return await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...options
        });
    } catch (error) {
        // Игнорируем ошибку "message is not modified" - э��о нормально
        if (error.message?.includes('message is not modified')) {
            console.log(`[SAFE-EDIT] Message not modified for chat ${chatId} - это нормально`);
            return null; // Возвращаем null чтобы показать что сообщение не изменилось
        } else {
            console.error('[SAFE-EDIT] Unexpected error editing message:', error);
            throw error; // Перебрасываем другие ошибки
        }
    }
}

// Universal message sending function - automatically chooses throttled vs direct
async function sendMessage(chatId, message, options = {}, useThrottling = false) {
    if (useThrottling) {
        return await sendThrottledMessage(chatId, message, options);
    } else {
        return await bot.sendMessage(chatId, message, options);
    }
}

// Bot token - should be set via environment variable for security
let token = process.env.BOT_TOKEN;

if (!token) {
    console.warn('⚠️  WARNING: BOT_TOKEN environment variable not set!');
    console.warn('   Using fallback token for development - NOT SECURE FOR PRODUCTION!');
    console.warn('📝 Please set BOT_TOKEN in your environment variables for production.');

    // Fallback token for development (replace with env variable in production)
    token = '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';

    console.log(' Bot starting with fallback token (will fail without real env token)...');
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

        console.log(' Starting polling mode...');
        await bot.startPolling({ restart: true });
        console.log(' Bot polling started successfully!');
    } catch (error) {
        console.error('❌ Error initializing bot mode:', error);
        throw error;
    }
}

// Admin configuration
const ADMIN_ID = 7972065986;
const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';
const PAYMENTS_CHANNEL = process.env.PAYMENTS_CHANNEL || '@kirbystarspayments';

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

// Helper function to clean text for safe display (no Markdown)
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

// Helper function to escape Markdown special characters (keep for backward compatibility)
function escapeMarkdown(text) {
    return cleanDisplayText(text);
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

// Helper function to check if user is subscribed to all required channels (enhanced with retry)
async function checkAllSubscriptions(userId, skipRetry = false) {
    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) return true;

    try {
        for (const channel of requiredChannels) {
            let success = false;
            let attempts = 0;
            const maxAttempts = skipRetry ? 1 : 2;

            while (!success && attempts < maxAttempts) {
                attempts++;
                try {
                    const member = await bot.getChatMember(channel, userId);
                    if (member.status === 'left' || member.status === 'kicked') {
                        console.log(`[SUBSCRIPTION] User ${userId} not subscribed to ${channel}`);
                        return false;
                    }
                    success = true;
                } catch (error) {
                    console.log(`[SUBSCRIPTION] Check attempt ${attempts}/${maxAttempts} for channel ${channel}: ${error.message}`);

                    // Определяем тип ошибки
                    const errorCode = error.response?.body?.error_code;
                    const errorDesc = error.response?.body?.description || error.message;

                    // Автоматически одобряем при проблемах с доступом к каналу
                    if (errorCode === 400 ||
                        errorDesc.includes('chat not found') ||
                        errorDesc.includes('bot was kicked') ||
                        errorDesc.includes('bot is not a member')) {
                        console.log(`[SUBSCRIPTION] Auto-approving ${channel} - access issues: ${errorDesc}`);
                        success = true;
                        break;
                    }

                    // Для сетевых ошибок пробуем еще раз
                    if (attempts < maxAttempts && (
                        errorDesc.includes('network') ||
                        errorDesc.includes('timeout') ||
                        errorDesc.includes('connection') ||
                        errorCode === 502 || errorCode === 503 || errorCode === 504
                    )) {
                        console.log(`[SUBSCRIPTION] Retrying channel ${channel} due to network error`);
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза 1 сек
                        continue;
                    }

                    // Для неопределенных ошибок при последней попытке - одобряем для безопасности
                    if (attempts >= maxAttempts) {
                        console.log(`[SUBSCRIPTION] Auto-approving ${channel} after ${maxAttempts} attempts - preventing false blocks`);
                        success = true;
                    }
                }
            }
        }
        return true;
    } catch (error) {
        console.error('[SUBSCRIPTION] Critical error checking subscriptions:', error);
        // При критической ошибке одобряем, чтобы не блокировать пользователей
        return true;
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

function getTaskKeyboard(taskId, channelLink) {
    return {
        reply_markup: {
            inline_keyboard: [
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
                    { text: '⭐ Недельные очки', callback_data: 'ratings_week_points' }
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
                ],
                [
                    { text: '🏆 Недельные награды', callback_data: 'admin_weekly_rewards' }
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

        // Add weekly points for bot activation
        try {
            await db.addWeeklyPoints(userId, 1, 'bot_activation');
        } catch (pointsError) {
            console.error('Error adding weekly points for bot activation:', pointsError);
        }
        
        // Process pending referral if exists
        if (dbUser.pending_referrer) {
            const invitedBy = dbUser.pending_referrer;

            // Update referrer stats
            await db.executeQuery(
                'UPDATE users SET referrals_count = referrals_count + 1, referrals_today = referrals_today + 1, balance = balance + 3 WHERE id = $1',
                [invitedBy]
            );

            // Add tickets to active auto-referral lotteries
            try {
                const autoLotteries = await db.executeQuery(`
                    SELECT l.id
                    FROM lotteries l
                    JOIN referral_lotteries rl ON l.id = rl.lottery_id
                    WHERE l.is_active = TRUE
                    AND l.lottery_type = 'referral_auto'
                    AND rl.ends_at > NOW()
                `);

                for (const lottery of autoLotteries.rows) {
                    await db.addReferralTicket(lottery.id, invitedBy, 'referral', userId);
                }

                console.log(`[AUTO-REFERRAL] Added tickets to ${autoLotteries.rows.length} auto-referral lotteries for user ${invitedBy}`);
            } catch (error) {
                console.error('Error adding auto-referral tickets:', error);
            }

            // Clear pending referrer
            await db.updateUserField(userId, 'pending_referrer', null);
            await db.updateUserField(userId, 'invited_by', invitedBy);

            // Send notification to referrer
            try {
                const message = `🎉 **Поздравляем!**

👤 По вашей реферальной ссылке присоединился новый пользователь: **${user.first_name}**

💰 **Вы п��лучили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

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
        
        // Send main menu
        const welcomeMessage = `🌟 **Добро пожаловать в StarBot!**

💰 **Ваш персональный помощник для заработка Telegram Stars**

 **Доступные возможности:**
• Ежедневные награды в кликере
• Выполнение заданий за вознаграждение
• Реферальная программа (3⭐ за друга)
• Участие в лотереях и розыгрышах
• Открытие призов��х кейсов

Выберите действие из меню ниже:`;

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true }, // Remove custom keyboard
            ...getMainMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ произошла ошибка. Попробуйте позже.');
    }
});

// Throttler status command (admin only)
bot.onText(/\/throttler_status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    const status = throttler.getStatus();
    const statusMessage = `📊 **Статус Throttler**

📨 **Очередь сообщений:** ${status.queueLength}
⚙️ **Обработка:** ${status.processing ? 'Активна' : 'Неактивна'}
⏱️ **Сообщений в секунду:** ${status.messagesPerSecond}
⏰ **Интервал между сообщениями:** ${status.intervalMs}ms

${status.queueLength > 0 ? '📤 В очереди есть сообщения для отпра��ки...' : '✅ Очередь пуста'}`;

    bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

// Test command to verify version
bot.onText(/\/test_version/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const testMessage = `🔧 **Тест версии бета**

📅 Версия: ОБНОВЛЕННАЯ v5.0 - С КНОПКАМИ И УЛУЧШЕНИЯМИ!
🕒 Время: ${new Date().toLocaleString('ru-RU')}
👤 Ваш ID: ${userId}
🔧 Admin ID: ${isAdmin(userId) ? 'ВЫ АДМИН' : 'НЕ АДМИН'}

✅ Если вы видите это сообщение - работает НОВАЯ версия!
🎯 Inline-кнопки восстановлены, улучшения сохранены!`;

    bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });
});

// Команда для диагностики проблем с выводом звёзд
bot.onText(/\/check_withdrawals/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        bot.sendMessage(chatId, '🔍 Запуск диагностики системы вывода звёзд...');

        // Загружаем модуль ��иагностики
        const { checkWithdrawalSystem } = require('./check-withdrawal-system');

        // Перехватываем console.log для отправки в Telegram
        const originalLog = console.log;
        let output = [];

        console.log = (...args) => {
            const message = args.join(' ');
            output.push(message);
            originalLog(...args); // Также выводим в консоль
        };

        await checkWithdrawalSystem();

        // Восстанавливаем console.log
        console.log = originalLog;

        // Отправляем результат в Telegram (разбиваем на части если слишком длинно)
        const fullOutput = output.join('\n');
        const chunks = [];
        const maxLength = 4000;

        for (let i = 0; i < fullOutput.length; i += maxLength) {
            chunks.push(fullOutput.slice(i, i + maxLength));
        }

        for (let i = 0; i < chunks.length; i++) {
            await bot.sendMessage(chatId, `\`\`\`\n${chunks[i]}\n\`\`\``, { parse_mode: 'Markdown' });
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза между сообщениями
            }
        }

    } catch (error) {
        console.error('Error in withdrawal check:', error);
        bot.sendMessage(chatId, `❌ Ошибка диагностики: ${error.message}`);
    }
});

// Команда для тестирования проверки подписок
bot.onText(/\/test_subscriptions (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const testUserId = parseInt(match[1]);
        bot.sendMessage(chatId, `🧪 Тестирую проверку подписок для пользователя ${testUserId}...`);

        const requiredChannels = await getRequiredChannels();

        if (requiredChannels.length === 0) {
            bot.sendMessage(chatId, '✅ Нет активных каналов для проверки - все пользователи проходят проверку');
            return;
        }

        let message = `📋 **Результат проверки подписок**\n\n👤 **Пользователь:** ${testUserId}\n📺 **Каналов для проверки:** ${requiredChannels.length}\n\n`;

        let allPassed = true;
        let channelDetails = '';

        for (let i = 0; i < requiredChannels.length; i++) {
            const channel = requiredChannels[i];
            try {
                const member = await bot.getChatMember(channel, testUserId);
                const status = member.status;

                if (status === 'left' || status === 'kicked') {
                    channelDetails += `❌ ${channel}: НЕ подписан (${status})\n`;
                    allPassed = false;
                } else {
                    channelDetails += `✅ ${channel}: Подписан (${status})\n`;
                }
            } catch (error) {
                const errorCode = error.response?.body?.error_code;
                const errorDesc = error.response?.body?.description || error.message;

                if (errorCode === 400 ||
                    errorDesc.includes('chat not found') ||
                    errorDesc.includes('bot was kicked') ||
                    errorDesc.includes('bot is not a member')) {
                    channelDetails += `⚠️ ${channel}: Авто-одобрено (${errorDesc.substring(0, 50)}...)\n`;
                } else {
                    channelDetails += `❌ ${channel}: БЛОКИРУЕТ (${errorDesc.substring(0, 50)}...)\n`;
                    allPassed = false;
                }
            }
        }

        message += channelDetails;
        message += `\n🎯 **Результат:** ${allPassed ? '✅ ПРОЙДЕТ проверку' : '❌ ЗАБЛОКИРОВАН'}`;

        // Тестируем улучшенную функцию
        const improvedResult = await checkAllSubscriptions(testUserId, false);
        message += `\n🔄 **Улучшенная проверка:** ${improvedResult ? '✅ ОДОБРЕН' : '❌ ЗАБЛОКИРОВАН'}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in test_subscriptions:', error);
        bot.sendMessage(chatId, `❌ Ошибка тестирования: ${error.message}`);
    }
});

// Команда для поиска пользователя по ID для отправки звёзд
bot.onText(/\/find_user (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const targetUserId = parseInt(match[1]);
        const user = await db.getUser(targetUserId);

        if (!user) {
            bot.sendMessage(chatId, `❌ Пользователь с ID ${targetUserId} не найден в базе данных.`);
            return;
        }

        const registrationDate = new Date(user.registered_at).toLocaleDateString('ru-RU');

        const message = `👤 **Ин��ормация о пользователе**

🆔 **ID:** \`${user.id}\`
📝 **Имя:** ${cleanDisplayText(user.first_name)}
📱 **Username:** ${user.username ? `@${user.username}` : 'не указан'}
💰 **Баланс:** ${user.balance} ⭐
👥 **Рефералов:** ${user.referrals_count}
📅 **Регистрация:** ${registrationDate}

🔗 **Ссылка для отправки звёзд:**
tg://user?id=${user.id}

💡 **Инструкция:**
1. Нажмите на ссылку выше
2. Откроется чат с пользователем
3. Отправьте подарок звёздами через Telegram`;

        bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💬 Открыть чат', url: `tg://user?id=${user.id}` }],
                    [{ text: '🏠 В админ-панель', callback_data: 'admin_stats' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error in find_user command:', error);
        bot.sendMessage(chatId, `❌ Ошибка поиска пользователя: ${error.message}`);
    }
});

// Команда для просмотра pending заявок с кнопками для быстр��го поиска пользователей
bot.onText(/\/pending_withdrawals/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const pendingWithdrawals = await db.executeQuery(`
            SELECT wr.*, u.first_name, u.username
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.id
            WHERE wr.status = 'pending'
            ORDER BY wr.created_at ASC
            LIMIT 10
        `);

        if (pendingWithdrawals.rows.length === 0) {
            bot.sendMessage(chatId, '✅ Нет pending заявок на вывод!');
            return;
        }

        let message = `📋 **Pending заявки на вывод (${pendingWithdrawals.rows.length})**\n\n`;

        pendingWithdrawals.rows.forEach((withdrawal, index) => {
            const timeAgo = Math.floor((Date.now() - new Date(withdrawal.created_at)) / (1000 * 60 * 60));
            const typeDisplay = withdrawal.type === 'premium' ? 'Premium 3мес' : `${withdrawal.amount}⭐`;

            message += `${index + 1}. **${cleanDisplayText(withdrawal.first_name)}**\n`;
            message += `   💰 ${typeDisplay} | ⏰ ${timeAgo}ч назад\n`;
            message += `   ID: \`${withdrawal.user_id}\` | Username: ${withdrawal.username ? `@${withdrawal.username}` : 'нет'}\n\n`;
        });

        message += '💡 Используйте `/find_user ID` для поиска пользователя';

        bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔧 Исправить проблемы', callback_data: 'fix_withdrawals' }],
                    [{ text: '🏠 В админ-панель', callback_data: 'admin_stats' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error in pending_withdrawals command:', error);
        bot.sendMessage(chatId, `❌ Ошибка получения pending заявок: ${error.message}`);
    }
});

// Команда для автоматического исправления проблем с выводом
bot.onText(/\/fix_withdrawals/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        bot.sendMessage(chatId, '🔧 Запуск исправления проблем с выводом звёзд...');

        // Загружаем модуль исправления
        const { fixWithdrawalIssues } = require('./fix-withdrawal-issues');

        // Перехватываем console.log для отправки в Telegram
        const originalLog = console.log;
        let output = [];

        console.log = (...args) => {
            const message = args.join(' ');
            output.push(message);
            originalLog(...args);
        };

        await fixWithdrawalIssues();

        // Восстанавливаем console.log
        console.log = originalLog;

        // Отправляем результат
        const fullOutput = output.join('\n');
        const chunks = [];
        const maxLength = 4000;

        for (let i = 0; i < fullOutput.length; i += maxLength) {
            chunks.push(fullOutput.slice(i, i + maxLength));
        }

        for (let i = 0; i < chunks.length; i++) {
            await bot.sendMessage(chatId, `\`\`\`\n${chunks[i]}\n\`\`\``, { parse_mode: 'Markdown' });
            if (i < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

    } catch (error) {
        console.error('Error in withdrawal fix:', error);
        bot.sendMessage(chatId, `❌ Оши��ка исправления: ${error.message}`);
    }
});

// Admin commands for manual user management
bot.onText(/\/endlottery (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, ' У вас нет прав доступа.');
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
        bot.sendMessage(chatId, '❌ Ошибка завершении лотереи.');
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
                await bot.sendMessage(targetUserId, `⭐ **Бонус от администрации!**\n\nВам добавлено **${refCount} рефералов** от администрации!\n\n💫 Спасибо за активность!`, { parse_mode: 'Markdown' });
            } catch (error) {
                console.log('Could not notify user about referral bonus');
            }
        } else {
            bot.sendMessage(chatId, ` Пользователь с ID ${targetUserId} не найден.`);
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
                await bot.sendMessage(targetUserId, `🎉 **Бонус от администрации!**\n\nВам добавле��о **${starsCount} ⭐** от администрации!\n\n💫 Спасибо за активность!`, { parse_mode: 'Markdown' });
            } catch (error) {
                console.log('Could not notify user about stars bonus');
            }
        } else {
            bot.sendMessage(chatId, ` По��ьзователь с ID ${targetUserId} не найден.`);
        }
    } catch (error) {
        console.error('Error in starsupplayer:', error);
        bot.sendMessage(chatId, '❌ Ошибка добавления звёз��.');
    }
});

// Admin command handler
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    console.log(`[ADMIN] /admin command called by userId: ${userId}, isAdmin: ${isAdmin(userId)}`);

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа к панели адм��нистратора.');
        return;
    }

    try {
        const stats = await db.getUserStats();

        const message = `🔧 **Админ-панель**

📊 **Быстрая статистика:**
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

**Управление выводом звёзд:**
📋 **/pending_withdrawals** - список pending заявок
👤 **/find_user [ID]** - найти пользователя для отправки звёзд
🧪 **/test_subscriptions [ID]** - проверить подписки пользователя
🔍 **/check_withdrawals** - диагностика проблем с выводом
🔧 **/fix_withdrawals** - автоисправление проблем

**Дополнительные команды:**
🎰 **/endlottery [ID]** - завершить лотерею вручную
👥 **/refupplayer [ID] [число]** - добавить рефералов пользователю
⭐ **/starsupplayer [ID] [число]** - добавить звёзды пользователи

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
            bot.sendMessage(chatId, '❌ Неверный формат!\n\nИспользуйте:\n`/create_task канал|название|награда|лимит`\n\nГде лимит - максимальное количество выполнений (необязательно).\n\nПримеры:\n• `/create_task @channel|Мой канал|1.5`\n• `/create_task @channel|Мой канал|1.5|100`', { parse_mode: 'Markdown' });
            return;
        }

        const [channelId, channelName, reward, maxCompletions] = params;
        const rewardAmount = parseFloat(reward) || 1.0;
        const limit = maxCompletions ? parseInt(maxCompletions) : null;

        console.log('[CREATE-TASK] Creating task:', { channelId, channelName, rewardAmount, limit });

        await db.executeQuery(
            'INSERT INTO tasks (channel_id, channel_name, reward, max_completions) VALUES ($1, $2, $3, $4) ON CONFLICT (channel_id) DO UPDATE SET channel_name = $2, reward = $3, max_completions = $4',
            [channelId.trim(), channelName.trim(), rewardAmount, limit]
        );

        let message = `✅ Задание создано!\n📺 Канал: ${channelId.trim()}\n📝 Название: ${channelName.trim()}\n💰 Награда: ${rewardAmount} ⭐`;
        if (limit) {
            message += `\n🔢 Лимит выполнений: ${limit}`;
        } else {
            message += `\n🔢 Лимит выполне��ий: Без ограничений`;
        }

        bot.sendMessage(chatId, message);
        console.log('[CREATE-TASK] Task created successfully');

    } catch (error) {
        console.error('Error creating task:', error);
        console.error('Full error:', error.stack);
        bot.sendMessage(chatId, ` Ошибка создания задания: ${error.message}`);
    }
});

// Admin task deletion
bot.onText(/\/delete_task (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const taskId = parseInt(match[1]);

        // Check if task exists
        const taskResult = await db.executeQuery('SELECT * FROM tasks WHERE id = $1', [taskId]);
        if (taskResult.rows.length === 0) {
            bot.sendMessage(chatId, `❌ Задание с ID ${taskId} не найдено.`);
            return;
        }

        const task = taskResult.rows[0];

        // Delete task (this will also delete related user_tasks due to foreign key)
        await db.executeQuery('DELETE FROM tasks WHERE id = $1', [taskId]);

        bot.sendMessage(chatId, `✅ Задание удалено!\n📺 Канал: ${task.channel_name || task.channel_id}\n Награда: ${task.reward} ⭐`);

    } catch (error) {
        console.error('Error deleting task:', error);
        bot.sendMessage(chatId, `❌ Ошибка удаления задания: ${error.message}`);
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
            bot.sendMessage(chatId, '❌ Н��верный формат! Используйте: /create_lottery назв��ние|билеты|цена|победители|процент');
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

        bot.sendMessage(chatId, `✅ Лотерея создана!\n ${lotteryName}\n🎫 ${maxTicketsNum} билетов по ${ticketPriceNum} ⭐\n🏆 ${winnersCountNum} победителей\n💰 Процент бота: ${botPercentNum}%`);
        console.log('[CREATE-LOTTERY] Lottery created successfully');

    } catch (error) {
        console.error('Error creating lottery:', error);
        console.error('Full error:', error.stack);
        bot.sendMessage(chatId, `❌ О��ибка создания лотереи: ${error.message}`);
    }
});

// Admin referral lottery creation (Type 1: with condition)
bot.onText(/\/create_referral_lottery (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const params = match[1].split('|');
        if (params.length < 5) {
            bot.sendMessage(chatId, `❌ Неверный формат!

Используйте:
\`/create_referral_lottery название|время_часов|мин_рефералов|цена_билета|место1:приз1|мессо2:приз2|...\`

Пример:
\`/create_referral_lottery Недельная|168|3|1.5|1:50|2:30|3:20\`

👥 Название: Недельная
• Время: 168 часов (неделя)
• Условие: пригласить 3 рефералов
• Цена доп. билета: 1.5 ⭐
• Призы: 1м-50⭐, 2м-30⭐, 3м-20⭐`, { parse_mode: 'Markdown' });
            return;
        }

        const [name, timeHours, minReferrals, ticketPrice, ...prizeParams] = params;

        // Parse prizes
        const prizes = [];
        for (const prizeParam of prizeParams) {
            const [place, amount] = prizeParam.split(':');
            if (!place || !amount) {
                bot.sendMessage(chatId, '❌ Неверный формат при��ов! Используйте: место:сумма');
                return;
            }
            prizes.push(parseFloat(amount));
        }

        if (prizes.length === 0) {
            bot.sendMessage(chatId, '❌ Необходимо указать хотя бы один приз!');
            return;
        }

        // Create lottery
        const timeHoursNum = parseInt(timeHours);
        const endsAt = new Date();
        endsAt.setHours(endsAt.getHours() + timeHoursNum);

        const lotteryData = {
            name: name.trim(),
            ticket_price: 0, // Free base ticket
            max_tickets: 999999, // No limit for referral lotteries
            winners_count: prizes.length,
            lottery_type: 'referral_condition'
        };

        const refLotteryData = {
            required_referrals: parseInt(minReferrals),
            referral_time_hours: timeHoursNum,
            additional_ticket_price: parseFloat(ticketPrice),
            ends_at: endsAt
        };

        const lotteryId = await db.createReferralLottery(lotteryData, refLotteryData, prizes);

        let message = `✅ **Реферальная ло��е��ея создана!**

🎰 **Название:** ${name}
   **Длительность:** ${timeHours} часов
👥 **Условие:** пригласить ${minReferrals} рефералов
💰 **Цена доп. билета:** ${ticketPrice} ⭐
🏆 **Призовые места:** ${prizes.length}

**Призы:**`;

        for (let i = 0; i < prizes.length; i++) {
            const place = i + 1;
            const emoji = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏅';
            message += `\n${emoji} ${place} место: ${prizes[i]} ⭐`;
        }

        message += `\n\n⏰ **Завершение:** ${endsAt.toLocaleString('ru-RU')}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log('[CREATE-REF-LOTTERY] Referral lottery created successfully, ID:', lotteryId);

    } catch (error) {
        console.error('Error creating referral lottery:', error);
        bot.sendMessage(chatId, `❌ Ошибка создания лотереи: ${error.message}`);
    }
});

// Admin auto referral lottery creation (Type 2: automatic)
bot.onText(/\/create_auto_referral_lottery (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const params = match[1].split('|');
        if (params.length < 3) {
            bot.sendMessage(chatId, `❌ Неверный формат!

Используйте:
\`/create_auto_referral_lottery название|время_часов|место1:приз1|место2:приз2|...\`

Пример:
\`/create_auto_referral_lottery Авто|72|1:100|2:60|3:40|4:20|5:10\`

• Название: Авто
• Время: 72 часа (3 дня)
• Призы: 1м-100⭐, 2м-60⭐, 3м-40⭐, 4м-20⭐, 5м-10⭐
• Билеты: автоматически за каждого нового реферала`, { parse_mode: 'Markdown' });
            return;
        }

        const [name, timeHours, ...prizeParams] = params;

        // Parse prizes
        const prizes = [];
        for (const prizeParam of prizeParams) {
            const [place, amount] = prizeParam.split(':');
            if (!place || !amount) {
                bot.sendMessage(chatId, '❌ Неверный формат призов! Используйте: место:сумма');
                return;
            }
            prizes.push(parseFloat(amount));
        }

        if (prizes.length === 0) {
            bot.sendMessage(chatId, '❌ Необхо��имо указать хотя бы один приз!');
            return;
        }

        // Create lottery
        const timeHoursNum = parseInt(timeHours);
        const endsAt = new Date();
        endsAt.setHours(endsAt.getHours() + timeHoursNum);

        const lotteryData = {
            name: name.trim(),
            ticket_price: 0, // No purchasing for auto referral
            max_tickets: 999999, // No limit
            winners_count: prizes.length,
            lottery_type: 'referral_auto'
        };

        const refLotteryData = {
            required_referrals: 1, // Each referral = 1 ticket
            referral_time_hours: timeHoursNum,
            additional_ticket_price: 0, // No additional tickets
            ends_at: endsAt
        };

        const lotteryId = await db.createReferralLottery(lotteryData, refLotteryData, prizes);

        let message = `✅ **Автоматическая реферальная лотерея создана!**

🎰 **Название:** ${name}
⏰ **Длительность:** ${timeHours} часов
🎫 **Билеты:** каждый новый реферал = +1 билет
🏆 **Призовые места:** ${prizes.length}

**Призы:**`;

        for (let i = 0; i < prizes.length; i++) {
            const place = i + 1;
            const emoji = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏅';
            message += `\n${emoji} ${place} место: ${prizes[i]} ⭐`;
        }

        message += `\n\n⏰ **Завершение:** ${endsAt.toLocaleString('ru-RU')}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log('[CREATE-AUTO-REF-LOTTERY] Auto referral lottery created successfully, ID:', lotteryId);

    } catch (error) {
        console.error('Error creating auto referral lottery:', error);
        bot.sendMessage(chatId, `❌ Ошибка создания лотереи: ${error.message}`);
    }
});

// Admin command to select lottery winners manually
bot.onText(/\/select_lottery_winners (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const lotteryId = parseInt(match[1]);
        const winnersData = match[2].split(' ');

        const winners = {};
        for (const winnerStr of winnersData) {
            const [place, winnerUserId] = winnerStr.split(':');
            if (!place || !winnerUserId) {
                bot.sendMessage(chatId, '❌ Неверный формат! Испол��зуйте: /select_lottery_winners ID место1:userID место2:userID');
                return;
            }
            winners[place] = parseInt(winnerUserId);
        }

        // Select winners and distribute prizes
        await db.selectLotteryWinners(lotteryId, winners);

        // Get lottery info and prizes for broadcast
        const lotteryResult = await db.executeQuery('SELECT name FROM lotteries WHERE id = $1', [lotteryId]);
        const prizes = await db.getLotteryPrizes(lotteryId);

        if (lotteryResult.rows.length === 0) {
            bot.sendMessage(chatId, '❌ Лотерея не найдена.');
            return;
        }

        const lotteryName = lotteryResult.rows[0].name;

        // Send broadcast message to all users
        await broadcastLotteryResults(lotteryName, prizes);

        bot.sendMessage(chatId, `✅ Победители выбраны и награды распределены!\n\n🎉 Всем пользователям отправлено уведомление о результатах лотереи "${lotteryName}".`);

    } catch (error) {
        console.error('Error selecting lottery winners:', error);
        bot.sendMessage(chatId, `❌ Ошибка выбора победителей: ${error.message}`);
    }
});

// Referral lottery handlers
async function handleReferralLotteryCheck(chatId, messageId, userId, lotteryId) {
    try {
        // Check if user meets referral condition
        const condition = await db.checkReferralCondition(lotteryId, userId);

        if (condition.qualified) {
            // Add free ticket for qualified user
            await db.addReferralTicket(lotteryId, userId, 'free');

            await bot.editMessageText(`✅ **Поздравляем!**\n\nВы выполнили условие участия в лотерее!\n\n👥 приглашено рефералов: ${condition.referralCount}/${condition.required}\n🎫 Вы получили бесплатный билет!\n\n💰 Теперь вы можете купить дополнительные билеты для увеличения шансов на победу.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎫 Купить доп. билет', callback_data: `ref_lottery_buy_${lotteryId}` }],
                        [{ text: '🎰 К лотереям', callback_data: 'lottery' }],
                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
        } else {
            await bot.editMessageText(`❌ **Условие не выполнено**\n\n👥 Приглашено рефералов: ${condition.referralCount}/${condition.required}\n\n📋 Для участия в лотерее необходимо пригласить еще ${condition.required - condition.referralCount} рефералов.\n\n💡 Приглашайте друзей по вашей реферальной ссылке!`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
                        [{ text: '🎰 К лотереям', callback_data: 'lottery' }],
                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
        }
    } catch (error) {
        console.error('Error checking referral lottery condition:', error);
        await bot.editMessageText('❌ Ошибка проверки условий участия.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handleReferralLotteryBuy(chatId, messageId, userId, lotteryId) {
    try {
        // Get lottery details
        const lotteryResult = await db.executeQuery(`
            SELECT l.name, rl.additional_ticket_price, rl.ends_at
            FROM lotteries l
            JOIN referral_lotteries rl ON l.id = rl.lottery_id
            WHERE l.id = $1 AND l.is_active = TRUE
        `, [lotteryId]);

        if (lotteryResult.rows.length === 0) {
            await bot.editMessageText('❌ Лотерея не найдена или неактивна.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        const lottery = lotteryResult.rows[0];

        // Check if lottery is still active
        if (new Date() > new Date(lottery.ends_at)) {
            await bot.editMessageText('❌ Лотерея уже завершена.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Check user balance
        const user = await db.getUser(userId);
        if (user.balance < lottery.additional_ticket_price) {
            await bot.editMessageText(`❌ **Недостаточно средств!**\n\nДля покупки дополнительного билета нужно: ${lottery.additional_ticket_price} ⭐\nВаш баланс: ${user.balance} ⭐\n\nВыполняйте задания и приглашайте друзей для заработка звёзд!`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Задания', callback_data: 'tasks' }],
                        [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
                        [{ text: '🎰 К лотереям', callback_data: 'lottery' }]
                    ]
                }
            });
            return;
        }

        // Buy additional ticket
        await db.executeQuery('BEGIN');

        try {
            // Deduct balance
            await db.updateUserBalance(userId, -lottery.additional_ticket_price);

            // Add weekly points for lottery ticket purchase
            try {
                await db.addWeeklyPoints(userId, 1, 'lottery_ticket_purchase');
            } catch (pointsError) {
                console.error('Error adding weekly points for lottery purchase:', pointsError);
            }

            // Add purchased ticket
            await db.addReferralTicket(lotteryId, userId, 'purchased');

            await db.executeQuery('COMMIT');

            await bot.editMessageText(`✅ **Билет куплен!**\n\nВы успешно приобрели дополнительный билет в лотерею "${lottery.name}"!\n\n💰 Списано: ${lottery.additional_ticket_price} ⭐\n💎 Ваш баланс: ${user.balance - lottery.additional_ticket_price} ⭐\n\n🍀 Удачи в розыгрыше!`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎫 Купить еще билет', callback_data: `ref_lottery_buy_${lotteryId}` }],
                        [{ text: '🎰 К лотереям', callback_data: 'lottery' }],
                        [{ text: '◀️ Главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });

        } catch (error) {
            await db.executeQuery('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error buying referral lottery ticket:', error);
        await bot.editMessageText('❌ О��ибка покупки билета.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

// Function to send completed withdrawal notification to payments channel
async function sendPaymentNotification(withdrawalId, user, amount, type) {
    try {
        const completedCount = await db.getCompletedWithdrawalsCount();

        // Clean user display name
        const displayName = cleanDisplayText(user.first_name);
        const usernameText = user.username ? ` | @${user.username}` : '';

        const typeText = type === 'premium' ? 'Telegram Premium на 3 месяца' : `${amount}⭐️`;

        const message = `✅ Заявка на вывод №${completedCount} одобрена

👤 Пользователь: ${displayName}${usernameText}| ID: ${user.id}
💫 Количество: ${typeText}

⏳ Статус: Ожидает отправки администратором 📧
📝 Заявка одобрена, награда будет отправлена вручную`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📺 Ос��овной канал', url: 'https://t.me/kirbyvivodstars' },
                        { text: '💬 На�� чат', url: 'https://t.me/kirbychat_stars' },
                        { text: '🤖 Бот', url: 'https://t.me/kirby_stars_bot' }
                    ]
                ]
            }
        };

        await bot.sendMessage(PAYMENTS_CHANNEL, message, {
            parse_mode: 'Markdown',
            ...keyboard
        });

        console.log(`[PAYMENT] Notification sent to ${PAYMENTS_CHANNEL} for withdrawal #${completedCount}`);
        return true;
    } catch (error) {
        console.error('Error sending payment notification:', error);
        return false;
    }
}

// Function to broadcast lottery results to all users
async function broadcastLotteryResults(lotteryName, prizes) {
    try {
        const users = await db.executeQuery('SELECT id FROM users WHERE is_subscribed = TRUE');

        let message = `🎉 **Лотерея "${lotteryName}" завершена!**\n\n🏆 **Победители:**\n`;

        for (const prize of prizes) {
            if (prize.winner_user_id) {
                const winnerResult = await db.executeQuery('SELECT first_name, username FROM users WHERE id = $1', [prize.winner_user_id]);
                if (winnerResult.rows.length > 0) {
                    const winner = winnerResult.rows[0];
                    const displayName = winner.username ? `@${winner.username}` : winner.first_name;
                    const emoji = prize.place === 1 ? '🥇' : prize.place === 2 ? '🥈' : prize.place === 3 ? '🥉' : '🏅';
                    message += `${emoji} ${prize.place} место: ${displayName} - ${prize.prize_amount} ⭐\n`;
                }
            }
        }

        message += '\nПоздравляем победителей! 🎊';

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎰 Участвовать в лотереях', callback_data: 'lottery' }],
                    [{ text: '🏠 Глав��ое меню', callback_data: 'main_menu' }]
                ]
            }
        };

        // Use throttler for broadcast
        const result = await throttler.broadcastMessages(
            users.rows,
            (user) => bot.sendMessage(user.id, message, {
                parse_mode: 'Markdown',
                ...keyboard
            })
        );

        console.log(`[LOTTERY-BROADCAST] Results sent to ${result.success} out of ${result.total} users, ${result.errors} errors`);
        return result.success;

    } catch (error) {
        console.error('Error broadcasting lottery results:', error);
        throw error;
    }
}

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
        // Check subscription for all important buttons (except admin functions and withdrawal actions)
        const skipSubscriptionCheck = [
            'check_subscriptions',
            'main_menu',
            'withdraw',
            'withdraw_15',
            'withdraw_25',
            'withdraw_50',
            'withdraw_100',
            'withdraw_premium'
        ];

        if (!skipSubscriptionCheck.includes(data) && !data.startsWith('admin_') && !data.startsWith('approve_withdrawal_') && !data.startsWith('reject_withdrawal_') && !isAdmin(userId)) {
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

                    // Add weekly points for bot activation
                    try {
                        await db.addWeeklyPoints(userId, 1, 'bot_activation');
                    } catch (pointsError) {
                        console.error('Error adding weekly points for bot activation:', pointsError);
                    }
                    
                    // Process pending referral if exists
                    const user = await db.getUser(userId);
                    if (user && user.pending_referrer) {
                        const invitedBy = user.pending_referrer;

                        // Update referrer stats
                        await db.executeQuery(
                            'UPDATE users SET referrals_count = referrals_count + 1, referrals_today = referrals_today + 1, balance = balance + 3 WHERE id = $1',
                            [invitedBy]
                        );

                        // Add weekly points for successful referral
                        try {
                            await db.addWeeklyPoints(invitedBy, 1, 'referral_success');
                        } catch (pointsError) {
                            console.error('Error adding weekly points for referral:', pointsError);
                        }

                        // Add tickets to active auto-referral lotteries
                        try {
                            const autoLotteries = await db.executeQuery(`
                                SELECT l.id
                                FROM lotteries l
                                JOIN referral_lotteries rl ON l.id = rl.lottery_id
                                WHERE l.is_active = TRUE
                                AND l.lottery_type = 'referral_auto'
                                AND rl.ends_at > NOW()
                            `);

                            for (const lottery of autoLotteries.rows) {
                                await db.addReferralTicket(lottery.id, invitedBy, 'referral', userId);
                            }

                            console.log(`[AUTO-REFERRAL] Added tickets to ${autoLotteries.rows.length} auto-referral lotteries for user ${invitedBy}`);
                        } catch (error) {
                            console.error('Error adding auto-referral tickets:', error);
                        }

                        // Clear pending referrer
                        await db.updateUserField(userId, 'pending_referrer', null);
                        await db.updateUserField(userId, 'invited_by', invitedBy);

                        // Send notification to referrer
                        try {
                            const userInfo = await db.getUser(userId);
                            const message = `🎉 **Поздравляем!**

🎉 По вашей реферальной ссылке присоединился новый пользователь: **${userInfo.first_name}**

💰 **Вы получили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

                            await bot.sendMessage(invitedBy, message, { parse_mode: 'Markdown' });
                        } catch (error) {
                            console.error('Error sending referral notification:', error);
                        }
                    }
                    
                    await handleMainMenu(chatId, msg.message_id);
                } else {
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: '❌ Вы подписаны не на ��се каналы!',
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
            case 'ratings_week_points':
                await handleRatingsWeekPoints(chatId, msg.message_id);
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
            case 'admin_weekly_rewards':
                if (isAdmin(userId)) {
                    await handleAdminWeeklyRewards(chatId, msg.message_id);
                } else {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ У вас нет прав доступа!', show_alert: true });
                }
                break;
            case 'admin_weekly_enable':
                if (isAdmin(userId)) {
                    await db.updateWeeklyRewardsSettings(true);
                    await handleAdminWeeklyRewards(chatId, msg.message_id);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Автоматические наг��ады включены!' });
                } else {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ У вас нет прав доступа!', show_alert: true });
                }
                break;
            case 'admin_weekly_disable':
                if (isAdmin(userId)) {
                    await db.updateWeeklyRewardsSettings(false);
                    await handleAdminWeeklyRewards(chatId, msg.message_id);
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Автоматические награды отключены!' });
                } else {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ У в��с нет прав доступа!', show_alert: true });
                }
                break;
            case 'admin_weekly_trigger':
                if (isAdmin(userId)) {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '🏆 Запускаю распределение наград...' });
                    try {
                        const result = await distributeWeeklyRewards(true);
                        if (result.success) {
                            await bot.editMessageText(`✅ **Награды распределены!**\n\n👥 Награждено пользователей: ${result.users}\n📊 Очки всех пользователей сброшены\n\n🎯 Новая неделя началась!`, {
                                chat_id: chatId,
                                message_id: msg.message_id,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🏆 Управление наградами', callback_data: 'admin_weekly_rewards' }],
                                        [{ text: '🏠 Админ панель', callback_data: 'admin_menu' }]
                                    ]
                                }
                            });
                        } else {
                            await bot.editMessageText(`❌ **Ошибка распределения наград**\n\n${result.message}`, {
                                chat_id: chatId,
                                message_id: msg.message_id,
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '🏆 Управление наградами', callback_data: 'admin_weekly_rewards' }],
                                        [{ text: '🏠 Админ панель', callback_data: 'admin_menu' }]
                                    ]
                                }
                            });
                        }
                    } catch (error) {
                        console.error('Error in manual weekly rewards trigger:', error);
                        await bot.editMessageText('❌ Ошибка запу��ка недельных наград.', {
                            chat_id: chatId,
                            message_id: msg.message_id,
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '🏆 Управление наградами', callback_data: 'admin_weekly_rewards' }],
                                    [{ text: '🏠 Админ панель', callback_data: 'admin_menu' }]
                                ]
                            }
                        });
                    }
                }
                break;
            case 'admin_menu':
                if (isAdmin(userId)) {
                    const stats = await db.getUserStats();
                    const message = `🔧 **Админ-панель**

���� **Быстрая статистика:**
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

Выберите действие:`;

                    await bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        ...getAdminMenuKeyboard()
                    });
                }
                break;

            // Система вывода работает только в ручном режиме через администратора

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
                        console.log('[MAIN] Calling handleBroadcastCustom...');
                        await handleBroadcastCustom(chatId, msg.message_id, userId);
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
            case 'cancel_broadcast':
                if (isAdmin(userId)) {
                    await db.updateUserField(userId, 'temp_action', null);
                    await bot.editMessageText('❌ Создание рассылки отменено.', {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        reply_markup: {
                            inline_keyboard: [[{ text: '◀️ Назад к рассылке', callback_data: 'admin_broadcast' }]]
                        }
                    });
                }
                break;

            default:
                // Handle dynamic callback data
                if (data.startsWith('task_check_')) {
                    const taskId = data.replace('task_check_', '');
                    await handleTaskCheck(chatId, msg.message_id, userId, taskId);
                } else if (data.startsWith('lottery_buy_')) {
                    const lotteryId = data.replace('lottery_buy_', '');
                    await handleLotteryBuy(chatId, msg.message_id, userId, lotteryId);
                } else if (data.startsWith('ref_lottery_check_')) {
                    const lotteryId = data.replace('ref_lottery_check_', '');
                    await handleReferralLotteryCheck(chatId, msg.message_id, userId, lotteryId);
                } else if (data.startsWith('ref_lottery_buy_')) {
                    const lotteryId = data.replace('ref_lottery_buy_', '');
                    await handleReferralLotteryBuy(chatId, msg.message_id, userId, lotteryId);
                } else if (data === 'lottery_sold_out') {
                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: '🚫 Все билеты в эту лотерею проданы!',
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
                const message = `🎉 **Поздравляем! Вы выиграли в лотерее!**

🎰 Лотерея: **${lottery.name}**
💰 Ваш выигрыш: **${rewardPerWinner} ⭐**
🏆 Всего победителей: ${winnersCount}

🎉 Награда зачислена на ваш баланс!`;

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

💰 **Ваш персональный цент заработка Telegram Stars**

🎯 **Доступные возможности:**
• 🎯 **Кликер** - ежедневная награда 0.1 ⭐
• 📋 **Задания** - выполняйте задачи за вознаграждение
• 👥 **Рефералы** - приглашайте друзей (3 ⭐ за каждого)
• 🎁 **Кейсы** - призы от 1 до 10 ⭐
• 🎰 **Л��терея** - участвуйте в розыгрышах

Выберите нужный раздел:`;

    await safeEditMessage(chatId, messageId, welcomeMessage, {
        parse_mode: 'Markdown',
        ...getMainMenuKeyboard()
    });
}

async function handleProfile(chatId, messageId, user) {
    const registrationDate = new Date(user.registered_at).toLocaleDateString('ru-RU');
    const totalEarned = user.referrals_count * 3; // From referrals

    const message = `👤 **Личный профиль**

 **Информация о пользователе:**
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
${user.last_case_open ? `• Последний кейс: ${new Date(user.last_case_open).toLocaleDateString('ru-RU')}` : '• Кейсы еще не открывались'}`;

    await safeEditMessage(chatId, messageId, message, {
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
👥 Всего друзей пригл��шено: **${user.referrals_count}**
📅 Приглашено сегодня: **${user.referrals_today}**
💰 Заработано с рефералов: **${user.referrals_count * 3} ⭐**

🎯 **Как это работа��т:**
1. Поделитесь ссылкой с друзьями
2. Друг регистрируется по ссылке
3. Друг подписывается на все обязательные каналы
4. Вы получаете 3 ⭐ на баланс!

⚠️ **Важно:** Реферал засчитывается только после подписки на все каналы!`;

    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '📥 поделиться', switch_inline_query: `Присоединяйся к боту для заработка звёзд! ${inviteLink}` }],
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
    const clicksToday = user.clicks_today || 0;

    // Check if it's a new day (reset clicks)
    const isNewDay = !lastClick || now.toDateString() !== lastClick.toDateString();
    const currentClicks = isNewDay ? 0 : clicksToday;

    // Maximum 10 clicks per day
    if (currentClicks >= 10) {
        const nextDay = new Date(now);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(0, 0, 0, 0);

        const timeUntilNext = nextDay - now;
        const hoursLeft = Math.floor(timeUntilNext / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeUntilNext % (1000 * 60 * 60)) / (1000 * 60));

        const message = `🎯 **Кликер**

❌ **Лимит кликов исчерпан!**

📊 **Сегодня кликнуто:** ${currentClicks}/10
💰 **Ваш баланс:** ${user.balance} ⭐

⏳ **До ��бновления:** ${hoursLeft}ч ${minutesLeft}м
🎁 **Завтра доступно:** 10 новых кликов

💡 **Совет:** Выполняйте задания и приглашайте друзей!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
        return;
    }

    // Check cooldown for next click (if not first click of the day)
    if (!isNewDay && lastClick && currentClicks > 0) {
        // Progressive delay: 5, 10, 15, 20, 25, 30, 35, 40, 45 minutes (max 45 for 9th click)
        const delayMinutes = Math.min(currentClicks * 5, 45);
        const nextClickTime = new Date(lastClick.getTime() + delayMinutes * 60 * 1000);

        if (now < nextClickTime) {
            const timeLeft = nextClickTime - now;
            const minutesLeft = Math.ceil(timeLeft / (1000 * 60));

            const message = `🎯 **Кликер**

⏰ **Подождите перед следующим кликом!**

📊 **Сегодня кликнуло:** ${currentClicks}/10
💰 **Ваш баланс:** ${user.balance} ⭐

⏳ **До следующего клика:** ${minutesLeft} мин
⏰ **Следующая награда:** 0.1 ⭐

⌛ **Время ож��дания:** ${delayMinutes} мин (увеличивается с каждым кликом)`;

            try {
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Обновить', callback_data: 'clicker' }],
                            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                        ]
                    }
                });
            } catch (editError) {
                // Игнорируем ошибку "message is not modified" - это нормально
                if (!editError.message?.includes('message is not modified')) {
                    console.error('Error editing clicker message:', editError);
                }
            }
            return;
        }
    }

    // Can click - award reward
    const reward = 0.1;
    const newClicks = currentClicks + 1;

    try {
        await db.executeQuery('BEGIN');

        await db.updateUserBalance(user.id, reward);
        await db.updateUserField(user.id, 'last_click', now);
        await db.updateUserField(user.id, 'clicks_today', newClicks);

        await db.executeQuery('COMMIT');

        // Add weekly points for click (separate transaction to not break main clicker if points fail)
        try {
            await db.addWeeklyPoints(user.id, 1, 'click');
        } catch (pointsError) {
            console.error('Error adding weekly points for click:', pointsError);
            // Continue - don't break clicker functionality for points error
        }

    } catch (error) {
        try {
            await db.executeQuery('ROLLBACK');
        } catch (rollbackError) {
            console.error('Error rolling back clicker transaction:', rollbackError);
        }

        console.error('Error in clicker operation:', error);

        try {
            await bot.editMessageText('❌ Ошибка обработки клика. Попробуйте позже.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
        } catch (botError) {
            console.error('Error sending clicker error message:', botError);
        }
        return;
    }

    // Calculate next wait time
    const nextDelayMinutes = newClicks < 10 ? newClicks * 5 : 'Завтра';
    const remainingClicks = 10 - newClicks;

    const message = `🎯 **Кликер**

🎉 **Отлично!** Клик ${newClicks}/10 выполнен!
💰 Начислено: **+${reward} ⭐** (+1 очко)

 **Статистика:**
💎 Ваш баланс: ${(parseFloat(user.balance) + parseFloat(reward)).toFixed(1)} ⭐
🔢 Осталось кликов: ${remainingClicks}
${remainingClicks > 0 ? `⏰ Следующий клик через: ${nextDelayMinutes} мин` : '🎉 Все клики на сегодня использованы!'}

 **Совет:** С каждым кликом время ожидания увеличивается на 5 минут`;

    try {
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    remainingClicks > 0 ? [{ text: '🔄 Обновить', callback_data: 'clicker' }] : [],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ].filter(row => row.length > 0)
            }
        });
    } catch (editError) {
        // Игнорируем ошибку "message is not modified" - это нормально
        if (!editError.message?.includes('message is not modified')) {
            console.error('Error editing clicker success message:', editError);
        }
    }
}

async function handleWithdraw(chatId, messageId, user) {
    // Безопасная проверка подписок (с retry и автоодобрением при ошибках)
    const isSubscribed = await checkAllSubscriptions(user.id, false);

    if (!isSubscribed) {
        const subData = await getSubscriptionMessage();
        await safeEditMessage(chatId, messageId, subData.message, {
            reply_markup: { inline_keyboard: subData.buttons }
        });
        return;
    }

    const message = `⭐ **Вывод звёзд**

**Ваш баланс:** ${user.balance} ⭐

${user.referrals_count < 5 ?
    '❌ **Для вывода средств требуются минимум 5 рефералов**' :
    '✅ **Вы можете выводить средства**'
}

Выберите сумму для вывода:`;

    await safeEditMessage(chatId, messageId, message, {
        parse_mode: 'Markdown',
        ...getWithdrawKeyboard()
    });
}

async function handleWithdrawRequest(chatId, messageId, userId, data) {
    try {
        const user = await db.getUser(userId);

        if (!user) {
            await bot.editMessageText('❌ Пользователь не найден. Попробуйте позже.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

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

        if (!amount) {
            await bot.editMessageText('❌ Неверный тип вывода. Попробуйте позже.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Check balance BEFORE starting transaction
        if (parseFloat(user.balance) < amount) {
            await bot.editMessageText('❌ Недостаточно звёзд для вывода!', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Start transaction for withdrawal - but DON'T deduct balance yet
        await db.executeQuery('BEGIN');

        try {
            // Double-check balance in transaction (in case of concurrent requests)
            const currentUser = await db.getUser(userId);
            if (parseFloat(currentUser.balance) < amount) {
                await db.executeQuery('ROLLBACK');
                await bot.editMessageText('❌ Недостаточно звёзд для вывода!', {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getBackToMainKeyboard()
                });
                return;
            }

            // Create withdrawal request WITHOUT deducting balance first
            const withdrawalResult = await db.executeQuery(
                'INSERT INTO withdrawal_requests (user_id, amount, type) VALUES ($1, $2, $3) RETURNING id',
                [userId, amount, type]
            );
            const withdrawalId = withdrawalResult.rows[0].id;

            // Prepare admin notification
            const cleanName = cleanDisplayText(user.first_name);
            const adminMessage = `🔔 **Новая заявка на вывод #${withdrawalId}**

👤 **Пользователь:** ${cleanName}
🆔 **ID:** ${user.id}
${user.username ? `📱 **Username:** @${user.username}` : ''}
🔗 **Ссылка:** [Открыть профиль](tg://user?id=${user.id})

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}
💎 **Тек��щий балан��:** ${currentUser.balance} ⭐
${amount > 50 ? '\n⚠️ **КРУПНАЯ СУММА - требует ручной обработки**' : ''}`;

            const adminKeyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Выполнено', callback_data: `approve_withdrawal_${userId}_${amount}_${type}_${withdrawalId}` },
                            { text: '❌ Отклонено', callback_data: `reject_withdrawal_${userId}_${amount}_${type}_${withdrawalId}` }
                        ]
                    ]
                }
            };

            // Send admin notification - if this fails, rollback
            await bot.sendMessage(ADMIN_CHANNEL, adminMessage, {
                parse_mode: 'Markdown',
                ...adminKeyboard
            });

            // ONLY deduct balance AFTER successful admin notification
            await db.updateUserBalance(userId, -amount);

            // Commit transaction only after everything succeeded
            await db.executeQuery('COMMIT');

            await bot.editMessageText('✅ Заявка на вывод отправлена! Ожидайте обработки.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });

            console.log(`[WITHDRAWAL] Request created safely: User ${userId}, Amount ${amount}, Type ${type}, ID ${withdrawalId}`);

        } catch (error) {
            // Rollback transaction on ANY error - this ensures balance is never deducted if something fails
            await db.executeQuery('ROLLBACK');
            console.error('[WITHDRAWAL] Error in transaction:', error);

            await bot.editMessageText('❌ Ошибка обработки заявки. Ваши звёзды не были списаны. Попробуйте позже.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
        }

    } catch (error) {
        console.error('[WITHDRAWAL] Error in transaction:', error?.message || error);
        try {
            await bot.sendMessage(ADMIN_CHANNEL, adminMessage, {
                parse_mode: 'Markdown',
                ...adminKeyboard
            });
        } catch (sendError) {
            console.error('[WITHDRAWAL] Error sending admin message:', sendError.message, adminMessage);
            throw sendError; // чтобы откат сработал
        }
    }
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
            await bot.editMessageText('✅ Все задания выполнено! Ожидайте новых заданий.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Show first available task with channel link
        const task = availableTasks[0];
        const channelLink = task.channel_id.startsWith('@') ?
            `https://t.me/${task.channel_id.substring(1)}` :
            task.channel_id;

        const message = `📋 **Активные задания**

📋 **Текущее задание:**
Подписка на канал **${task.channel_name || task.channel_id}**

💰 **Награда за выполнение:** ${task.reward} ⭐
📊 **Прогресс:** ${completedTasks.length}/${allTasks.length} заданий выполнено

📝 **Инструкция:**
1. На��мите "Подпи��аться" для перехода к каналу
2. Подпишитесь на канал
3. Вернитесь и нажмите "проверить"
4. Получите награду!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getTaskKeyboard(task.id, channelLink)
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


async function handleTaskCheck(chatId, messageId, userId, taskId) {
    try {
        const result = await db.executeQuery('SELECT * FROM tasks WHERE id = $1 AND is_active = TRUE', [taskId]);

        if (result.rows.length === 0) {
            await bot.editMessageText('❌ Задание не найдено или неактивно.', {
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
            try {
                const completed = await db.completeTask(userId, taskId);

                if (completed) {
                    await bot.editMessageText(`✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!`, {
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
            } catch (taskError) {
                if (taskError.message === 'Task completion limit reached') {
                    await bot.editMessageText('❌ **Лимит выполнений достигнут!**\n\nЭто задание больше недоступно для выполнения.\n\nпопробуйте другие задания!', {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        ...getBackToMainKeyboard()
                    });
                } else {
                    await bot.editMessageText('❌ Ошибка выполнения задания. Попробуйте позже.', {
                        chat_id: chatId,
                        message_id: messageId,
                        ...getBackToMainKeyboard()
                    });
                }
            }

        } catch (error) {
            console.error(`Error checking task subscription: ${error.message}`);

            // Only auto-approve for specific errors (chat not found, private chat)
            if (error.response?.body?.error_code === 400 || error.response?.body?.description?.includes('chat not found')) {
                console.log(`Auto-approving task ${taskId} for user ${userId} - chat not accessible`);

                try {
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
                } catch (taskError) {
                    if (taskError.message === 'Task completion limit reached') {
                        await bot.editMessageText(' **Л��мит выполнений достигнут!**\n\nЭто задание больше недоступно для выполнения.', {
                            chat_id: chatId,
                            message_id: messageId,
                            parse_mode: 'Markdown',
                            ...getBackToMainKeyboard()
                        });
                    } else {
                        await bot.editMessageText('❌ Ошибка выполнения задания. Попробуйте позже.', {
                            chat_id: chatId,
                            message_id: messageId,
                            ...getBackToMainKeyboard()
                        });
                    }
                }
            } else {
                await bot.editMessageText('❌ Ошибка проверки подписки. Попробуйте позже или обратитесь к администрации.', {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getBackToMainKeyboard()
                });
            }
        }

    } catch (error) {
        console.error('Error in task check:', error);
    }
}

async function handleTaskSkip(chatId, messageId, userId) {
    try {
        const user = await db.getUser(userId);

        // Get all tasks
        const allTasks = await db.getTasks();

        // Get completed tasks for user
        const completedTasks = await db.getUserCompletedTasks(userId);
        const completedTaskIds = completedTasks.map(t => t.id);

        // Filter available tasks
        const availableTasks = allTasks.filter(task => !completedTaskIds.includes(task.id));

        if (availableTasks.length <= 1) {
            // No more tasks available
            await bot.editMessageText('✅ Больше доступных заданий нет!\n\nОжидайте новых задания или проверьте выполненные.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Show next available task (skip first one)
        const nextTask = availableTasks[1];
        const channelLink = nextTask.channel_id.startsWith('@') ?
            `https://t.me/${nextTask.channel_id.substring(1)}` :
            nextTask.channel_id;

        const message = `📋 **Следующее задание**

🎯 **Задание:**
Подписка на канал **${nextTask.channel_name || nextTask.channel_id}**

💰 **Награда за выполнение:** ${nextTask.reward} ⭐
📊 **Прогресс:** ${completedTasks.length}/${allTasks.length + completedTasks.length} заданий выполнено

📝 **Инстр��кция:**
1. Нажмите "Подписаться" для перехода к каналу
2. Подпишитесь на канал
3. Вернитесь и нажмите "Проверить"
4. получите награду!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getTaskKeyboard(nextTask.id, channelLink)
        });

    } catch (error) {
        console.error('Error in task skip:', error);
        await bot.editMessageText('❌ Ошибка загрузки следующего задания.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

async function handleInstruction(chatId, messageId) {
    const message = `📖 **Инструкция по боту**

🎯 **Как зарабатыват�� звёзды:**

1️⃣ **Кликер** - нажимайте каждый день и получайте 0.1 ⭐
2️⃣ **Задания** - подписывайтесь на каналы за награды
3️⃣ **Рефералы** - приглашайте друзей и получайте 3 ⭐ за каждого
4️⃣ **Кейсы** - откр��вайте кейсы с призами (нужно 3+ рефералов в день)
5️⃣ **Лотерея** - участвуйте в розыгрышах

💰 **Вывод средств:**
• Минимум 5 рефералов для вывода
• Доступны суммы: 15, 25, 50, 100 ⭐
• Telegram Premium на 3 месяца за 1300 ⭐

📈 **Советы:**
• Заходите каждый день
• Приглашайте активных друзей
• Выполняйте все задания

⚠️ **Важно:** Рефе��алы засчитываются только после подписки на все каналы!`;

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
            WHERE referrals_count > 0
            ORDER BY referrals_count DESC
            LIMIT 10
        `);

        let message = '🏆 Общий рейтинг по рефералам\n\n';

        if (result.rows.length === 0) {
            message += '📊 Пока нет пользователей с рефералами.\n\n Станьте первым - пригласите друзей и получайте 3 ⭐ за каждого!';
        } else {
            result.rows.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const safeName = cleanDisplayText(user.first_name);
                message += `${medal} ${safeName} - ${user.referrals_count} рефералов\n`;
            });
            message += '\n💪 Приглашайте друзей и поднимайтесь в рейтинге!';
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: undefined, // Убираем Markdown для безопасности
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
        // Получаем рейтинг по рефералам за последние 7 дней
        const result = await db.executeQuery(`
            SELECT first_name, referrals_count
            FROM users
            WHERE registered_at > NOW() - INTERVAL '7 days' OR updated_at > NOW() - INTERVAL '7 days'
            ORDER BY referrals_count DESC
            LIMIT 10
        `);

        let message = '📅 Рейтинг за неделю по рефералам\n\n';

        if (result.rows.length === 0) {
            message += 'Пока нет активных пользователей за эту неделю.';
        } else {
            result.rows.forEach((user, index) => {
                const medal = index === 0 ? '��' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const safeName = cleanDisplayText(user.first_name);
                message += `${medal} ${safeName} - ${user.referrals_count} рефералов\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: undefined, // Убираем Markdown для безопасности
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

async function handleRatingsWeekPoints(chatId, messageId) {
    try {
        // Get weekly top users by points
        const users = await db.getWeeklyTopUsers(10);

        let message = '⭐ **Недельный рейтинг по очкам**\n\n';

        if (users.length === 0) {
            message += 'Пока нет активных пользователей за эту неделю.';
        } else {
            message += '🏆 **Топ-10 по очкам за неделю:**\n\n';

            users.forEach((user, index) => {
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
                const safeName = cleanDisplayText(user.first_name);
                message += `${medal} ${safeName} - ${user.weekly_points} очков\n`;
            });

            message += '\n📈 **Как зараб��тать очки:**\n';
            message += '• Активация бота - 1 очко\n';
            message += '• Каждый клик - 1 очко\n';
            message += '• Выполненное задание - 2 очка\n';
            message += '• Купленный билет лотереи - 1 очко\n';
            message += '• Приглашенный реферал - 1 очко\n';
            message += '\n🎁 **Топ-5 в воскресенье получат награды!**';
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...getBackToMainKeyboard()
        });
    } catch (error) {
        console.error('Error in ratings week points:', error);
        await bot.editMessageText('❌ ошибка загрузки рейтинга по очкам.', {
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

    const message = `🎁 **��ейсы**

🎉 **Позд��авляем!** Вы открыли кейс и получили **${reward} ⭐**

💰 **Ваш баланс:** ${user.balance + reward} ⭐

⏰ Возврашайтесь завтра за новым кейсом!`;

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
        // Get standard lotteries
        const standardResult = await db.executeQuery('SELECT * FROM lotteries WHERE is_active = TRUE AND (lottery_type = $1 OR lottery_type IS NULL) ORDER BY id', ['standard']);

        // Get referral lotteries
        const referralLotteries = await db.getReferralLotteries();

        if (standardResult.rows.length === 0 && referralLotteries.length === 0) {
            await bot.editMessageText('🎰 **Лотереи**\n\n❌ Активных лотерей пока нет.\n\nОжидайте новых розыгрышей!', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
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

        // Standard lotteries
        standardResult.rows.forEach((lottery) => {
            const hasPurchased = userTickets.includes(lottery.id);

            message += `🎫 **${lottery.name}** (обычная)\n`;
            message += `💰 Цена билета: ${lottery.ticket_price} ⭐\n`;
            message += `🎯 Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
            message += `🏆 Победителей: ${lottery.winners_count}\n`;

            if (hasPurchased) {
                message += `✅ **Ваш билет куплен!**\n\n`;
            } else {
                message += `\n`;
                if (lottery.current_tickets >= lottery.max_tickets) {
                    keyboards.push([{ text: `🚫 ${lottery.name} - ��РОДАНО`, callback_data: 'lottery_sold_out' }]);
                } else {
                    keyboards.push([{ text: `🎫 Купить билет - ${lottery.name}`, callback_data: `lottery_buy_${lottery.id}` }]);
                }
            }
        });

        // Referral lotteries
        for (const refLottery of referralLotteries) {
            const timeLeft = new Date(refLottery.ref_ends_at) - new Date();
            const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));

            if (timeLeft <= 0) continue; // Skip expired lotteries

            // Get user participation info
            let participant = null;
            if (userId) {
                const participantResult = await db.executeQuery(
                    'SELECT * FROM lottery_participants WHERE lottery_id = $1 AND user_id = $2',
                    [refLottery.id, userId]
                );
                participant = participantResult.rows[0];
            }

            const totalTickets = participant ? participant.total_tickets : 0;

            if (refLottery.lottery_type === 'referral_condition') {
                message += `👥 **${refLottery.name}** (реферальная)\n`;
                message += `⏰ Осталось: ${hoursLeft} часов\n`;
                message += `📋 Условие: пригла��ить ${refLottery.required_referrals} рефералов\n`;
                message += `💰 Доп. билет: ${refLottery.additional_ticket_price} 🎫\n`;
                message += `🎫 Ваши билеты: ${totalTickets}\n`;

                if (participant && participant.qualified) {
                    message += `✅ Условие выполнено!\n\n`;
                    keyboards.push([{ text: `🎫 Купить доп. билет - ${refLottery.name}`, callback_data: `ref_lottery_buy_${refLottery.id}` }]);
                } else {
                    message += `❌ Пригласите ${refLottery.required_referrals} р��фералов для участия\n\n`;
                    keyboards.push([{ text: `👥 Проверить условие - ${refLottery.name}`, callback_data: `ref_lottery_check_${refLottery.id}` }]);
                }

            } else if (refLottery.lottery_type === 'referral_auto') {
                message += `👥 **${refLottery.name}** (авто-реферальная)\n`;
                message += `⏰ Осталось: ${hoursLeft} часов\n`;
                message += `🎫 Билеты за рефералов: ${totalTickets}\n`;
                message += `📋 каждый новый реферал = +1 биле��\n\n`;

                keyboards.push([{ text: `👥 Пригласить друзей - ${refLottery.name}`, callback_data: 'invite' }]);
            }
        }

        keyboards.push([{ text: '◀️ В главное меню', callback_data: 'main_menu' }]);

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
            const updatedLottery = await db.executeQuery(
                'UPDATE lotteries SET current_tickets = current_tickets + 1 WHERE id = $1 RETURNING current_tickets, max_tickets',
                [lotteryId]
            );

            // Deduct from balance
            await db.updateUserBalance(userId, -lottery.ticket_price);

            // Add weekly points for lottery ticket purchase
            try {
                await db.addWeeklyPoints(userId, 1, 'lottery_ticket_purchase');
            } catch (pointsError) {
                console.error('Error adding weekly points for lottery purchase:', pointsError);
            }

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
        const amount = parseFloat(parts[3]);
        const type = parts[4];
        const withdrawalId = parts[5] ? parseInt(parts[5]) : null; // Support both old and new format

        console.log('[WITHDRAWAL] Parsed data:', { targetUserId, amount, type, withdrawalId });

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

        // Approve withdrawal in database - use specific withdrawal ID if available
        let approvedWithdrawalId;
        if (withdrawalId) {
            // Use specific withdrawal ID for newer format
            approvedWithdrawalId = await db.approveWithdrawalRequestById(withdrawalId, ADMIN_ID);
        } else {
            // Fallback to old method for backward compatibility
            approvedWithdrawalId = await db.approveWithdrawalRequest(targetUserId, amount, type, ADMIN_ID);
        }

        if (!approvedWithdrawalId) {
            await bot.editMessageText('❌ Заявка на вывод не найдена или уже ��бработана.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        console.log('[WITHDRAWAL] Withdrawal approved in database, ID:', approvedWithdrawalId);

        // Send payment notification to payments channel
        await sendPaymentNotification(approvedWithdrawalId, user, amount, type);

        // Send congratulations to user
        const typeDisplay = type === 'premium' ? 'Telegram Premium на 3 месяца' : `${amount} ⭐`;
        const congratsMessage = `🎉 **Поздравляем!**

✅ **Ваша заявка на вывод одобрена!**

💰 **Сумма:** ${typeDisplay}

⏳ **Награда будет отправлена в течение 24 часов!**

📧 Администратор лично отправит вам звёзды в Telegram.

👥 Продолжайте приглашать друзей и зарабатывать еще больше!`;

        await sendThrottledMessage(targetUserId, congratsMessage, { parse_mode: 'Markdown' });
        console.log('[WITHDRAWAL] Congratulations sent to user');

        // Update admin message
        const completedCount = await db.getCompletedWithdrawalsCount();
        await bot.editMessageText(`✅ **Заявка одобрена** (#${completedCount})

👤 Пользователь: ${cleanDisplayText(user.first_name)} (ID: ${targetUserId})
💰 Сумма: ${typeDisplay}

⚠️ **ТРЕБУЕТСЯ ДЕЙСТВИЕ АДМИНИСТРАТОРА:**
🎯 Отправьте ${typeDisplay} пользователю @${user.username || targetUserId} вручную в Telegram

✅ Пользователь уведомлен об одобрении.
📢 Уведомление отправлено в канал платежей.

💡 Инструкция: Найдите пользователя в Telegram и отправьте ему подарок звёздами`, {
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
        const withdrawalId = parts[5] ? parseInt(parts[5]) : null; // Support both old and new format

        // Get user info
        const user = await db.getUser(targetUserId);
        if (!user) {
            await bot.editMessageText('❌ Пользователь не найден.', {
                chat_id: chatId,
                message_id: messageId
            });
            return;
        }

        // Set admin state to await rejection reason - include withdrawal ID if available
        const rejectionAction = withdrawalId ?
            `rejecting_withdrawal_${targetUserId}_${amount}_${type}_${withdrawalId}` :
            `rejecting_withdrawal_${targetUserId}_${amount}_${type}`;
        await db.updateUserField(adminId, 'temp_action', rejectionAction);

        // Update message to ask for reason
        const rejectionTitle = withdrawalId ? `❌ **Отклонение заявки #${withdrawalId}**` : `❌ **Отклонение заявки**`;
        await bot.editMessageText(`${rejectionTitle}

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
                        bot.sendMessage(chatId, '❌ ��ром��код не найден!');
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
                    const amount = parseFloat(actionParts[3]);
                    const type = actionParts[4];
                    const withdrawalId = actionParts[5] ? parseInt(actionParts[5]) : null; // Support new format with ID

                    console.log('[REJECTION] Parsed data:', { targetUserId, amount, type, withdrawalId, rejectionReason });

                    // Clear temp action
                    await db.updateUserField(userId, 'temp_action', null);
                    console.log('[REJECTION] Temp action cleared');

                    // Reject withdrawal in database (this will also return money to user)
                    let rejectedWithdrawalId;
                    if (withdrawalId) {
                        // Use specific withdrawal ID for newer format
                        rejectedWithdrawalId = await db.rejectWithdrawalRequestById(withdrawalId, userId, rejectionReason);
                    } else {
                        // Fallback to old method for backward compatibility
                        rejectedWithdrawalId = await db.rejectWithdrawalRequest(targetUserId, amount, type, userId, rejectionReason);
                    }

                    if (!rejectedWithdrawalId) {
                        await bot.sendMessage(chatId, '❌ Заявка на вывод не найдена или уже обработана.');
                        return;
                    }

                    console.log('[REJECTION] Withdrawal rejected in database, ID:', rejectedWithdrawalId);

                    // Get target user info
                    const targetUser = await db.getUser(targetUserId);
                    console.log('[REJECTION] Target user found:', targetUser.first_name);

                    // Send rejection notice to user
                    const typeDisplay = type === 'premium' ? 'Telegram Premium на 3 месяца' : `${amount} ⭐`;
                    const rejectionTitle = rejectedWithdrawalId ? `❌ **Заявка на вывод #${rejectedWithdrawalId} отклонена**` : `❌ **Заявка на вывод отклонена**`;
                    const rejectionMessage = `${rejectionTitle}

 **Сумма:** ${typeDisplay}

📝 **Причина отклонения:**
${rejectionReason}

💸 **Средства возвращены на баланс.**

Если у вас есть вопросы, обратитесь к администрации.`;

                    await sendThrottledMessage(targetUserId, rejectionMessage, { parse_mode: 'Markdown' });
                    console.log('[REJECTION] Rejection message sent to user');

                    // Confirm to admin
                    const adminTitle = rejectedWithdrawalId ? `✅ **Заявка #${rejectedWithdrawalId} отклонена**` : `✅ **Заявка отклонена**`;
                    await bot.sendMessage(chatId, `${adminTitle}

👤 Пользователь: ${cleanDisplayText(targetUser.first_name)}
💰 Сумма: ${typeDisplay}
📝 Причина: ${rejectionReason}

✅ Пользователю отпр��в��ено уведомление.
💸 Средства возвращены на баланс.`, { parse_mode: 'Markdown' });
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
💰 общий баланс: ${stats.total_balance} ⭐

**Дополнительные команды:**
🎰 **/endlottery [ID]** - завершить лотерею вручную
👥 **/refupplayer [ID] [число]** - доба��ить рефералов пользователю
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
            bot.sendMessage(chatId, '❌ укажите название ссылки! Используйте: /create_tracking_link Название_рекламы');
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
            bot.sendMessage(chatId, '📋 **Трекинговых ссылок пока нет.**\n\n Создайте ссылку: /create_tracking_link название', { parse_mode: 'Markdown' });
            return;
        }

        let message = '📋 **Список трекинговых ссылок**\n\n';

        result.rows.forEach((link, index) => {
            const date = new Date(link.created_at).toLocaleDateString('ru-RU');
            message += `${index + 1}. **${link.name}**\n`;
            message += `   🔗 ID: \`${link.tracking_id}\`\n`;
            message += `     Переходов: ${link.clicks_count || 0}\n`;
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
            bot.sendMessage(chatId, '❌ тренинговая ссылка не найдена.');
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

        const message = `📊 **Статистика трекинговой с��ылки**\n\n📝 **Название:** ${link.name}\n🆔 **ID:** \`${trackingId}\`\n📅 **Создана:** ${createdDate}\n\n📈 **Статистика:**\n👥 Всего переходов: **${stats.total_clicks || 0}**\n Уникальных пользователей: **${stats.unique_users || 0}**\n⏰ За последние 24 часа: **${recentStats.recent_clicks || 0}**\n\n🔗 **Ссылка:** \`https://t.me/YOUR_BOT?start=${trackingId}\``;

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
        bot.sendMessage(chatId, '❌ Ошибка удаления лотер��и.');
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
        const confirmMsg = await bot.sendMessage(chatId, `📤 **Начинаю рассылку...**\n\n👥 Пользователей: ${totalUsers}\n Прогресс: 0%`);

        // Send to all users
        for (let i = 0; i < users.rows.length; i++) {
            const user = users.rows[i];
            try {
                await bot.sendMessage(user.id, `\n\n${broadcastMessage}`, { parse_mode: 'Markdown' });
                successCount++;
            } catch (error) {
                failCount++;
                console.log(`Failed to send to user ${user.id}: ${error.message}`);
            }

            // Update progress every 10 users
            if (i % 10 === 0 || i === users.rows.length - 1) {
                const progress = Math.round((i + 1) / totalUsers * 100);
                try {
                    await bot.editMessageText(`📤 **Рассылка в процессе...**\n\n👥 Пользователей: ${totalUsers}\n✅ Отправлено: ${successCount}\n❌ Ошибок: ${failCount}\n⏳ прогресс: ${progress}%`, {
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
        bot.sendMessage(chatId, `❌ Ошибки рассылки: ${error.message}`);
    }
});

// Handle broadcast custom (inline interface)
async function handleBroadcastCustom(chatId, messageId, userId) {
    try {
        // Set user in broadcast mode
        await db.updateUserField(userId, 'temp_action', 'waiting_broadcast_message');

        const message = `✏️ **Создать свою рассылку**

📝 **Отправьте ваше сообщение следующим сообщением.**

Бот будет ждать ваше сообщение и разошлет его всем пользователям.

⚠️ **Внимание:** Рассылка будет отправлена сразу после получения сообщения!

💡 **Поддерживается Markdown-форматирование**`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '�� Отменить', callback_data: 'cancel_broadcast' }],
                    [{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in handleBroadcastCustom:', error);
        throw error;
    }
}

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
            await bot.sendMessage(ADMIN_CHANNEL, ` **Ошибка сброса данных**\n\nОшибка: ${error.message}\nВремя: ${new Date().toLocaleString('ru-RU')}`, { parse_mode: 'Markdown' });
        } catch (alertError) {
            console.error('Failed to send alert to admin:', alertError);
        }
    }
}, {
    timezone: 'Europe/Moscow'
});

// Function to distribute weekly rewards
async function distributeWeeklyRewards(isManual = false) {
    console.log(`🏆 ${isManual ? 'Manual' : 'Automatic'} weekly rewards distribution...`);
    try {
        // Get top 5 users by weekly points
        const users = await db.getWeeklyTopUsers(5);

        if (users.length === 0) {
            console.log('[WEEKLY-REWARDS] No users with points this week');
            if (isManual) {
                return { success: false, message: 'Нет активных польз��вателей с очками за эту неделю' };
            }
            return;
        }

        const rewards = [100, 75, 50, 25, 15]; // Stars for positions 1-5
        const positions = ['🥇', '🥈', '🥉', '4️⃣', '5️���'];

        let rewardMessage = '🏆 **Еженедельные награды!**\n\n📅 **Топ-5 пользователей по очкам за неделю:**\n\n';

        for (let i = 0; i < users.length; i++) {
            const user = users[i];
            const reward = rewards[i];
            const position = positions[i];

            // Give reward to user
            await db.updateUserBalance(user.id, reward);

            // Add to message
            const safeName = cleanDisplayText(user.first_name);
            rewardMessage += `${position} **${safeName}** - ${user.weekly_points} очков (+${reward} ⭐)\n`;

            // Send personal congratulations
            try {
                const personalMessage = `🎉 **Поздравляем!**\n\n${position} **Вы заняли ${i + 1} место в недельном рейтинге по очкам!**\n\n⭐ **Очков за неделю:** ${user.weekly_points}\n💰 **Награда:** +${reward} ⭐\n\n🎯 Отличная работа! Продолжайте активность!`;

                await sendThrottledMessage(user.id, personalMessage, { parse_mode: 'Markdown' });
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

        // Reset weekly points for all users
        await db.resetWeeklyData();

        console.log('[WEEKLY-REWARDS] Weekly rewards completed successfully');

        if (isManual) {
            await db.recordManualRewardsTrigger();
            return { success: true, message: `Награды распределены между ${users.length} пользователями`, users: users.length };
        }

    } catch (error) {
        console.error('Error in weekly rewards:', error);
        if (isManual) {
            return { success: false, message: `Ошибка распределения наград: ${error.message}` };
        }
    }
}

// Weekly rewards for top 5 users (Sundays at 20:00 MSK)
cron.schedule('0 20 * * 0', async () => {
    try {
        // Check if automatic rewards are enabled
        const settings = await db.getWeeklyRewardsSettings();
        if (!settings.auto_rewards_enabled) {
            console.log('[WEEKLY-REWARDS] Automatic rewards are disabled, skipping...');
            return;
        }

        await distributeWeeklyRewards(false);
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
                const personalMessage = `🎉 **Поздравляем!**\n\n${position} **Вы заняли ${i + 1} место в недельном рейтинге!**\n\n👥 **Рефералов за неделю:** ${user.referrals_today}\n💰 **Награда:** +${reward} ⭐\n\n🎯 Отличная работа! продолжайте приглашать друзей!`;

                await sendThrottledMessage(user.id, personalMessage, { parse_mode: 'Markdown' });
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
        console.error('Error in scheduled weekly rewards:', error);
    }
}, {
    timezone: 'Europe/Moscow'
});

// Admin function for weekly rewards management
async function handleAdminWeeklyRewards(chatId, messageId) {
    try {
        const settings = await db.getWeeklyRewardsSettings();
        const status = settings.auto_rewards_enabled ? '✅ Включены' : ' Отключены';
        const lastManual = settings.last_manual_trigger ?
            new Date(settings.last_manual_trigger).toLocaleString('ru-RU') : 'Никогда';

        const message = `🏆 **Управление недельными наградами**

📊 **Текущее состояние:**
🔄 Автоматические награды: ${status}
⏰ Время запуска: Воскресенье 20:00 МСК
📅 Последний ручной запуск: ${lastManual}

💡 **Ситтема очков:**
• Активация бота - 1 очко
• Каждый клик - 1 очко
• Выполненное задание - 2 очка
• Покупка лотерейного билета - 1 очко
• Приглашенный реферал - 1 очко

🏆 **Награды топ-5:**
🥇 1 место: 100 ⭐
🥈 2 место: 75 ⭐
🥉 3 место: 50 ⭐
4 место: 25 ⭐
5 место: 15 ⭐`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: settings.auto_rewards_enabled ? '🔴 Отключить авто' : '🟢 Включить авто',
                            callback_data: settings.auto_rewards_enabled ? 'admin_weekly_disable' : 'admin_weekly_enable'
                        },
                        { text: '🎯 Запустить сейчас', callback_data: 'admin_weekly_trigger' }
                    ],
                    [
                        { text: '⭐ Текущий рейтинг', callback_data: 'ratings_week_points' }
                    ],
                    [
                        { text: '🏠 Админ панель', callback_data: 'admin_menu' }
                    ]
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
        console.error('Error in admin weekly rewards:', error);
        await bot.editMessageText('❌ Ошибка загрузки управления недельными наградами.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
    }
}

// Admin commands for managing weekly rewards
bot.onText(/\/weekly_rewards_status/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '��� У вас нет прав доступа.');
        return;
    }

    try {
        const settings = await db.getWeeklyRewardsSettings();
        const users = await db.getWeeklyTopUsers(5);

        let message = `🏆 **Статус недельных наград**\n\n`;
        message += `🔄 **Автоматические награды:** ${settings.auto_rewards_enabled ? '✅ Включены' : '❌ Отключены'}\n`;
        message += `📅 **Последний ручной запуск:** ${settings.last_manual_trigger ? new Date(settings.last_manual_trigger).toLocaleString('ru-RU') : 'Никогда'}\n\n`;

        message += `📊 **Текущий топ-5 по очк��м:**\n`;
        if (users.length === 0) {
            message += 'Пока нет активных пользователей\n';
        } else {
            users.forEach((user, i) => {
                const pos = i + 1;
                const emoji = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}.`;
                message += `${emoji} ${cleanDisplayText(user.first_name)} - ${user.weekly_points} очков\n`;
            });
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in weekly rewards status:', error);
        bot.sendMessage(chatId, '❌ Ошибка получения статуса наград.');
    }
});

bot.onText(/\/weekly_rewards_enable/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        await db.updateWeeklyRewardsSettings(true);
        bot.sendMessage(chatId, '✅ Автоматические недельные награды включены!');
    } catch (error) {
        console.error('Error enabling weekly rewards:', error);
        bot.sendMessage(chatId, '❌ Ошибка включения наград.');
    }
});

bot.onText(/\/weekly_rewards_disable/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        await db.updateWeeklyRewardsSettings(false);
        bot.sendMessage(chatId, '❌ Автоматические недельные награды отключены!');
    } catch (error) {
        console.error('Error disabling weekly rewards:', error);
        bot.sendMessage(chatId, '❌ Ошибка отключения наград.');
    }
});

bot.onText(/\/weekly_rewards_trigger/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        bot.sendMessage(chatId, '🏆 Запускаю распределение недельных наград...');

        const result = await distributeWeeklyRewards(true);

        if (result.success) {
            bot.sendMessage(chatId, `✅ ${result.message}!\n\n🎯 Очки пользователей сброшены, новая неделя началась.`);
        } else {
            bot.sendMessage(chatId, `❌ ${result.message}`);
        }
    } catch (error) {
        console.error('Error triggering weekly rewards:', error);
        bot.sendMessage(chatId, '❌ Ошибка запуска недельных наград.');
    }
});



bot.onText(/\/send_stars_manual (\d+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const targetUserId = parseInt(match[1]);
        const amount = parseInt(match[2]);

        bot.sendMessage(chatId, `🤖 Добавляем в очередь агента: ${amount} звёзд для пользователя ${targetUserId}...`);

        // Система работает только в ручном режиме - все заявки обрабатываются администратором
        const result = { success: false, error: 'Система вывода работает только в ручном режиме' };

        if (result.success) {
            bot.sendMessage(chatId, `✅ Зада��ие добавлено в очередь агента!\n\n🎯 ${amount} звёзд будут отправлены пользователю ${targetUserId} автоматически.`);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`);
        }

    } catch (error) {
        console.error('Error manual stars send:', error);
        bot.sendMessage(chatId, '❌ Ошибка добавления задания.');
    }
});

// Команда для обработки старых зая��ок на вывод
bot.onText(/\/process_old_withdrawals/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        // Найти все pending з��явки на вывод
        const oldWithdrawals = await db.executeQuery(`
            SELECT id, user_id, amount, type, created_at
            FROM withdrawal_requests
            WHERE status = 'pending'
            ORDER BY created_at ASC
        `);

        if (oldWithdrawals.rows.length === 0) {
            bot.sendMessage(chatId, '✅ Нет старых заявок для обработки.');
            return;
        }

        let message = `���� **Найдено ${oldWithdrawals.rows.length} старых заявок на вывод**\n\n`;
        let processedCount = 0;
        let skippedCount = 0;

        for (const withdrawal of oldWithdrawals.rows) {
            try {
                // Получить информацию о пользователе
                const user = await db.getUser(withdrawal.user_id);
                if (!user) {
                    skippedCount++;
                    continue;
                }

                const cleanName = cleanDisplayText(user.first_name);

                // Автоматически обрабатывать звёзды до 200
                if (withdrawal.type === 'stars' && withdrawal.amount <= 200) {
                    // Все заявки обрабатываются только вручную администратором
                    const result = { success: false, error: 'Система работает только в ручном режиме' };

                    if (result.success) {
                        message += `✅ ${cleanName} - ${withdrawal.amount}⭐ (автомат)\n`;
                        processedCount++;
                    } else {
                        message += `⚠️ ${cleanName} - ${withdrawal.amount}⭐ (ошибка: ${result.error})\n`;
                        skippedCount++;
                    }
                } else {
                    message += `🔶 ${cleanName} - ${withdrawal.amount}⭐ (требует ручной обработки)\n`;
                    skippedCount++;
                }

                // Пауза между обработками
                if (processedCount > 0 && processedCount % 3 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error) {
                console.error('Error processing old withdrawal:', error);
                skippedCount++;
            }
        }

        message += `\n📊 **Итого:**\n`;
        message += `✅ Обработано автоматически: ${processedCount}\n`;
        message += `🔶 Требуют ручной обработки: ${skippedCount}\n`;
        message += `\n�� Крупные суммы и Premium подписки обрабатывайте вручную через кнопки в уведомлениях.`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error processing old withdrawals:', error);
        bot.sendMessage(chatId, '❌ Ошибка обработки старых заявок.');
    }
});

// Команда для изменения лимитов агента
bot.onText(/\/agent_limits(?:\s+(\d+)\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        if (!match[1] || !match[2] || !match[3]) {
            // Показать текущие лимиты
            const message = `⚙️ **Текущие лимиты Stars Agent:**

🔢 **Звёзд в час:** 10 максимум
📅 **Звёзд в день:** 80 максимум
🎯 **За раз (тест-режим):** 25 максимум

💡 **Для изменения используйте:**
\`/agent_limits ДЕНЬ ЧАС ЗАРАЗРАЗ\`

**Примеры:**
• \`/agent_limits 150 20 50\` - 150/день, 20/час, 50 за раз
• \`/agent_limits 200 25 100\` - снять тест-режим

⚠️ **ОСТОРОЖНО:** Высокие лимиты увеличивают риск блокировки!

🔒 **Рекомендуемые безопасные лимиты:**
• Начинающие: 80/день, 10/час, 25 за раз
• Опытные: 150/день, 15/час, 50 за раз
• Агрессивные: 300/день, 30/час, 100 за раз`;

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }

        const dayLimit = parseInt(match[1]);
        const hourLimit = parseInt(match[2]);
        const maxAmount = parseInt(match[3]);

        // Валидация лимитов
        if (dayLimit < 10 || dayLimit > 100000) {
            bot.sendMessage(chatId, '❌ Дневной лимит должен быть от 10 до 1000 звёзд.');
            return;
        }

        if (hourLimit < 5 || hourLimit > 10000) {
            bot.sendMessage(chatId, '❌ Часовой лимит должен быть от 5 до 100 звёзд.');
            return;
        }

        if (maxAmount < 5 || maxAmount > 500) {
            bot.sendMessage(chatId, '❌ Максимум за раз должен быть от 5 до 500 звёзд.');
            return;
        }

        if (hourLimit > dayLimit) {
            bot.sendMessage(chatId, '❌ Часовой лимит не может быть больше дневного.');
            return;
        }

        // Обновить лимиты в агенте
        const { execSync } = require('child_process');
        const updateScript = `
import sqlite3
import json

# Создать таблицу ��астроек если не существует
conn = sqlite3.connect('userbot_queue.db')
cursor = conn.cursor()

cursor.execute('''
    CREATE TABLE IF NOT EXISTS agent_settings (
        id INTEGER PRIMARY KEY,
        daily_limit INTEGER DEFAULT 80,
        hourly_limit INTEGER DEFAULT 10,
        max_amount INTEGER DEFAULT 25,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
''')

# Обновить или ��оздать настройки
cursor.execute('''
    INSERT OR REPLACE INTO agent_settings (id, daily_limit, hourly_limit, max_amount, updated_at)
    VALUES (1, ${dayLimit}, ${hourLimit}, ${maxAmount}, CURRENT_TIMESTAMP)
''')

conn.commit()
conn.close()
print('✅ Лимиты обновлены')
`;

        try {
            execSync(`python3 -c "${updateScript}"`, { encoding: 'utf8' });

            const riskLevel = dayLimit > 200 ? '🔴 ВЫСОКИЙ' : dayLimit > 100 ? '🟡 СРЕДНИЙ' : '🟢 НИЗКИЙ';

            const message = `✅ **Лимиты агента обновлены!**

📊 **Новые лимиты:**
📅 **В день:** ${dayLimit} звёзд
🔢 **В час:** ${hourLimit} звёзд
🎯 **За раз:** ${maxAmount} звёзд

⚠️ **Уровень риска:** ${riskLevel}

${dayLimit > 25 ? '🔓 **Тест-режим отключён**' : '🔒 **Тест-режим активен**'}

💡 **Рекомендации:**
• Начните с малых сумм для тестирования
• Следите за логами агента: \`/agent_logs\`
• При ошибках FloodWait снизьте лимиты

🤖 **Перезапустите агент** для применения изменений:
\`/admin\` → \` Stars Agent\` → \`⏹️ ��становить\` → \`▶️ Запустить\``;

            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error updating agent limits:', error);
            bot.sendMessage(chatId, '❌ Ошибка обновления лимитов. Попробуйте позже.');
        }

    } catch (error) {
        console.error('Error in agent limits command:', error);
        bot.sendMessage(chatId, '❌ Ошибка команды лимитов.');
    }
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

// Handle all messages for custom broadcast
bot.on('message', async (msg) => {
    // Skip commands and callback queries
    if (msg.text && msg.text.startsWith('/')) return;
    if (msg.from.is_bot) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
        const user = await db.getUser(userId);

        // Check if user is waiting to send broadcast message
        if (user && user.temp_action === 'waiting_broadcast_message' && isAdmin(userId)) {
            console.log('[BROADCAST] Admin sent custom broadcast message');

            // Clear temp action
            await db.updateUserField(userId, 'temp_action', null);

            const broadcastMessage = msg.text || msg.caption || '📢 Сообщение от администрации';

            // Get all users
            const users = await db.executeQuery('SELECT id FROM users WHERE is_subscribed = TRUE');
            const totalUsers = users.rows.length;

            // Send confirmation
            const confirmMsg = await bot.sendMessage(chatId, `📤 **Начинаю рассылку...**\n\n👥 Пользователей: ${totalUsers}\n⏳ Прогресс: 0%`, { parse_mode: 'Markdown' });

            // Use throttler for broadcast with progress tracking
            const result = await throttler.broadcastMessages(
                users.rows,
                (user) => bot.sendMessage(user.id, `📢 **Сообщение от администрации**\n\n${broadcastMessage}`, { parse_mode: 'Markdown' }),
                // Progress callback
                async (progress) => {
                    try {
                        await bot.editMessageText(`📤 **Рассылка в процессе...**\n\n👥 Пользователей: ${progress.total}\n✅ Отправлено: ${progress.success}\n❌ Ошибок: ${progress.errors}\n Прогресс: ${progress.percentage}%`, {
                            chat_id: chatId,
                            message_id: confirmMsg.message_id,
                            parse_mode: 'Markdown'
                        });
                    } catch (e) {
                        // Ignore edit errors
                    }
                }
            );

            // Final report
            await bot.editMessageText(`✅ **Рассылка завершена!**\n\n👥 Всего пользователей: ${result.total}\n✅ Успешно отправлено: ${result.success}\n❌ Ошибок: ${result.errors}\n📊 Успешность: ${Math.round(result.success/result.total*100)}%`, {
                chat_id: chatId,
                message_id: confirmMsg.message_id,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]]
                }
            });

            console.log(`[BROADCAST] Custom broadcast completed: ${result.success}/${result.total} successful`);
        }
    } catch (error) {
        console.error('Error handling message for broadcast:', error);
    }
});

// Start the bot
startBot();
