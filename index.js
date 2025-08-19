console.log('[MAIN] Starting imports...');

const TelegramBot = require('node-telegram-bot-api');
console.log('[MAIN] TelegramBot imported');

const cron = require('node-cron');
console.log('[MAIN] cron imported');

const { BOT_CONFIG, LIMITS_CONFIG, REWARDS_CONFIG } = require('./config');
console.log('[MAIN] config imported');

const db = require('./database');
console.log('[MAIN] database imported');

const adminHandlers = require('./admin-handlers-final');
console.log('[MAIN] admin-test imported, type:', typeof adminHandlers);
console.log('[MAIN] adminHandlers.handleAdminTasks type:', typeof adminHandlers.handleAdminTasks);

const { throttler } = require('./message-throttler');
console.log('[MAIN] message throttler imported');

const { captchaSystem } = require('./captcha-system');
console.log('[MAIN] captcha system imported');

const { subgramAPI } = require('./subgram-api');
console.log('[MAIN] SubGram API imported');

// User states for multi-step interactions
const userStates = new Map();

// Withdrawal cooldown protection
const withdrawalCooldowns = new Map();

// Автоотправка звёзд удалена - то��ько ручная обработка

// Helper function to send throttled messages
async function sendThrottledMessage(userId, message, options = {}) {
    return await throttler.sendMessage(() => bot.sendMessage(userId, message, options));
}

// Universal message sending function - automatically chooses throttled vs direct
async function sendMessage(chatId, message, options = {}, useThrottling = false) {
    if (useThrottling) {
        return await sendThrottledMessage(chatId, message, options);
    } else {
        return await bot.sendMessage(chatId, message, options);
    }
}

// Bot token - используем централизованную конфигурацию
const token = BOT_CONFIG.BOT_TOKEN;

if (token === BOT_CONFIG.BOT_TOKEN && !process.env.BOT_TOKEN) {
    console.warn('⚠️  WARNING: Using fallback BOT_TOKEN from config!');
    console.warn('   Set BOT_TOKEN environment variable for production!');
} else {
    console.log('✅ Bot starting with environment token (secure)');
}

// First, try to delete webhook and then use polling
const bot = new TelegramBot(token, { polling: false });

// Clear any existing webhook and enable polling
async function initializeBotMode() {
    try {
        console.log(' Clearing any existing webhook...');
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

// Admin configuration из централизованной конфигурации
const { ADMIN_ID, ADMIN_CHANNEL, PAYMENTS_CHANNEL } = BOT_CONFIG;

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

// Helper function to check if user is admin (из конфигурации)
const { isAdmin } = require('./config');

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

// Check subscription status for all channels and return detailed result
async function checkAllSubscriptionsDetailed(userId, recordStats = false) {
    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) {
        return { allSubscribed: true, channels: [], hasErrors: false };
    }

    const result = {
        allSubscribed: true,
        channels: [],
        hasErrors: false
    };

    try {
        // Get channel names from database
        const channelsData = await db.executeQuery(
            'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE'
        );
        const channelMap = new Map();
        channelsData.rows.forEach(ch => {
            channelMap.set(ch.channel_id, ch.channel_name);
        });

        for (const channel of requiredChannels) {
            const channelInfo = {
                id: channel,
                name: channelMap.get(channel) || channel,
                subscribed: false,
                canCheck: true,
                error: null
            };

            try {
                const member = await bot.getChatMember(channel, userId);
                channelInfo.subscribed = !(member.status === 'left' || member.status === 'kicked');
            } catch (error) {
                console.log(`Cannot check subscription for channel ${channel}: ${error.message}`);
                channelInfo.canCheck = false;
                channelInfo.error = error.message;
                result.hasErrors = true;

                // ИСПРАВЛЕНО: Для канало�� которые не можем проверить - считаем их подписанными
                // чтобы не блокиров��ть пользователей из-за неправильных каналов
                channelInfo.subscribed = true;
            }

            result.channels.push(channelInfo);

            // ИСПРАВЛЕНО: Блокируем только если пользователь точно не подписан на проверяемый канал
            if (!channelInfo.subscribed && channelInfo.canCheck) {
                result.allSubscribed = false;
            }
        }

        // Record stats
        if (recordStats) {
            try {
                await db.recordSubscriptionCheck(userId, result.allSubscribed || result.hasErrors);
            } catch (statError) {
                console.error('Error recording subscription check:', statError);
            }
        }

        // Reset notification status ONLY if user was marked as subscribed but now clearly unsubscribed
        // This happens when they unsubscribe after being notified
        if (!result.allSubscribed && !result.hasErrors) {
            try {
                const user = await db.getUser(userId);
                // Only reset if user was marked as subscribed in DB but now clearly not subscribed
                // AND has checkable channels that they're not subscribed to
                if (user && user.subscription_notified && user.is_subscribed) {
                    const unsubscribedCheckableChannels = result.channels.filter(ch => !ch.subscribed && ch.canCheck);
                    if (unsubscribedCheckableChannels.length > 0) {
                        // User was previously subscribed but now unsubscribed from checkable channels
                        await db.resetSubscriptionNotified(userId);
                        await db.updateUserField(userId, 'is_subscribed', false);
                        console.log(`[SUBSCRIPTION] Reset notification status for user ${userId} due to unsubscription from ${unsubscribedCheckableChannels.length} channels`);
                    }
                }
            } catch (error) {
                console.error('Error resetting notification status on unsubscription:', error);
            }
        }

        return result;
    } catch (error) {
        console.error('Error checking subscriptions:', error);
        if (recordStats) {
            try {
                await db.recordSubscriptionCheck(userId, false);
            } catch (statError) {
                console.error('Error recording subscription check (error):', statError);
            }
        }
        return { allSubscribed: false, channels: [], hasErrors: true };
    }
}

// Helper function to check if user is subscribed to all required channels (enhanced)
async function checkAllSubscriptions(userId, recordStats = false) {
    const detailed = await checkAllSubscriptionsDetailed(userId, recordStats);
    // ИСПРАВЛЕНО: Пропускаем пользователя если подписан на все проверяемые каналы
    return detailed.allSubscribed;
}

// Legacy function for backward compatibility
async function checkSubscriptions(userId) {
    return await checkAllSubscriptions(userId);
}

// Helper function to get subscription message with channel links
async function getSubscriptionMessage(userId = null, showOnlyUnsubscribed = false) {
    let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';
    let buttons = [];
    let channelsToShow = [];

    try {
        if (userId) {
            // Get detailed subscription status
            const subscriptionStatus = await checkAllSubscriptionsDetailed(userId, false);

            if (showOnlyUnsubscribed) {
                // Filter to show only unsubscribed channels (for re-check)
                channelsToShow = subscriptionStatus.channels.filter(channel => !channel.subscribed);

                if (channelsToShow.length === 0) {
                    // All channels are subscribed or can't be checked
                    message = '✅ Все подписки проверены! Можете пользоваться ботом.';
                    buttons.push([{ text: '✅ Проверить подписки', callback_data: 'check_subscriptions' }]);
                    return { message, buttons };
                }
            } else {
                // Show all channels (for first-time display)
                channelsToShow = subscriptionStatus.channels;
            }
        } else {
            // Fallback to showing all channels if no userId provided
            const result = await db.executeQuery('SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE');
            channelsToShow = result.rows.map(ch => ({
                id: ch.channel_id,
                name: ch.channel_name || ch.channel_id,
                canCheck: true
            }));
        }

        channelsToShow.forEach((channel, index) => {
            const statusIcon = channel.canCheck ? '📺' : '⚠️';
            const statusText = channel.canCheck ? '' : ' (не можем проверить)';

            message += `${index + 1}. ${channel.name}${statusText}\n`;

            // Create button for each channel
            const channelLink = channel.id.startsWith('@') ?
                `https://t.me/${channel.id.substring(1)}` :
                channel.id;

            buttons.push([{ text: `${statusIcon} ${channel.name}`, url: channelLink }]);
        });

    } catch (error) {
        console.error('Error getting channel data:', error);
        // Fallback to old method
        const result = await db.executeQuery('SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE');
        result.rows.forEach((channel, index) => {
            message += `${index + 1}. ${channel.channel_name || channel.channel_id}\n`;

            const channelLink = channel.channel_id.startsWith('@') ?
                `https://t.me/${channel.channel_id.substring(1)}` :
                channel.channel_id;

            buttons.push([{ text: `📺 ${channel.channel_name || channel.channel_id}`, url: channelLink }]);
        });
    }

    if (channelsToShow.length > 0) {
        message += '\n📌 После подписки нажмите кнопку проверки';
        if (userId) {
            const subscriptionStatus = await checkAllSubscriptionsDetailed(userId, false);
            if (subscriptionStatus.hasErrors) {
                message += '\n⚠️ Некоторые каналы не могут быть проверены автоматически';
            }
        }
    }

    buttons.push([{ text: '✅ Прове��ить подписки', callback_data: 'check_subscriptions' }]);

    return { message, buttons };
}

// Enhanced subscription message with SubGram integration
async function getEnhancedSubscriptionMessage(userId, showOnlyUnsubscribed = false) {
    try {
        let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';
        let buttons = [];
        let channelCount = 0;

        // Get subscription status
        const subscriptionStatus = await checkAllSubscriptionsDetailed(userId, false);
        const channelsToShow = showOnlyUnsubscribed ?
            subscriptionStatus.channels.filter(channel => !channel.subscribed) :
            subscriptionStatus.channels;

        if (channelsToShow.length > 0) {
            message += ' **Обязательные каналы:**\n';
            channelsToShow.forEach((channel, index) => {
                channelCount++;
                const statusIcon = channel.canCheck ? '📺' : '';
                const statusText = channel.canCheck ? '' : ' (не можем проверить)';

                message += `${channelCount}. ${channel.name}${statusText}\n`;

                const channelLink = channel.id.startsWith('@') ?
                    `https://t.me/${channel.id.substring(1)}` :
                    channel.id;

                buttons.push([{ text: `${statusIcon} ${channel.name}`, url: channelLink }]);
            });

            if (subscriptionStatus.hasErrors) {
                message += '\n⚠️ Некоторые каналы не могут быть проверены автоматически\n';
            }
        }

        // Try to get SubGram channels
        try {
            console.log('[SUBGRAM] Getting SubGram channels for user:', userId);

            const user = await db.getUser(userId);
            if (!user) {
                console.log('[SUBGRAM] User not found, skipping SubGram channels');
                return { message, buttons, hasSubgram: false };
            }

            const subgramResponse = await subgramAPI.requestSponsors({
                userId: userId.toString(),
                chatId: userId.toString(), // Using userId as chatId for private messages
                firstName: user.first_name || 'Пользователь',
                languageCode: 'ru',
                premium: false, // Default to false, можно улучшить позже
                maxOP: 3,
                action: 'subscribe',
                excludeChannelIds: []
            });

            console.log('[SUBGRAM] API Response:', subgramResponse.success, subgramResponse.data?.status);

            if (subgramResponse.success && subgramResponse.data) {
                const processedData = subgramAPI.processAPIResponse(subgramResponse.data);

                // Save API request log
                const apiSuccess = subgramResponse.success && subgramResponse.data &&
                    (subgramResponse.data.status === 'ok' || subgramResponse.data.status === 'warning' || subgramResponse.data.status === 'gender');
                await db.logSubGramAPIRequest(
                    userId,
                    'request_sponsors',
                    { action: 'subscribe', maxOP: 3 },
                    subgramResponse.data,
                    apiSuccess
                );

                // Save session data
                await db.saveSubGramUserSession(userId, subgramResponse.data, processedData);

                if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                    // Save channels to database
                    await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);

                    message += '\n🎯 **Спонсорские каналы:**\n';
                    processedData.channelsToSubscribe.forEach((channel, index) => {
                        channelCount++;
                        message += `${channelCount}. ${channel.name}\n`;
                        buttons.push([{ text: ` ${channel.name}`, url: channel.link }]);
                    });
                }

                // Handle special SubGram statuses
                if (processedData.needsGender) {
                    message += '\n🤖 **SubGram требует уточнения пола для подбора каналов**';
                    buttons.push([
                        { text: '👨 Мужской', callback_data: 'subgram_gender_male' },
                        { text: '👩 Женский', callback_data: 'subgram_gender_female' }
                    ]);
                }
            } else {
                console.log('[SUBGRAM] Failed to get sponsors or no sponsors available');

                // Log failed request
                await db.logSubGramAPIRequest(
                    userId,
                    'request_sponsors',
                    { action: 'subscribe', maxOP: 3 },
                    subgramResponse.data || {},
                    false,
                    subgramResponse.error || 'Unknown error'
                );
            }
        } catch (subgramError) {
            console.error('[SUBGRAM] Error getting SubGram channels:', subgramError);

            // Log error
            await db.logSubGramAPIRequest(
                userId,
                'request_sponsors',
                { action: 'subscribe', maxOP: 3 },
                {},
                false,
                subgramError.message
            );
        }

        if (channelCount === 0) {
            message = '✅ На данный момент нет обязательных каналов для подписки!\n\nВы можете продолжать использование бота.';
            buttons.push([{ text: '🏠 В главное меню', callback_data: 'main_menu' }]);
        } else {
            message += '\n📌 После подписки на все каналы нажмите кнопку проверки';
            buttons.push([{ text: '✅ Проверить подписки', callback_data: 'subgram-op' }]);
        }

        return { message, buttons, hasSubgram: true };

    } catch (error) {
        console.error('Error getting enhanced subscription message:', error);
        // Fallback to regular subscription message
        return await getSubscriptionMessage(userId, showOnlyUnsubscribed);
    }
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
                    { text: '🎁 промокод', callback_data: 'promocode' },
                    { text: '👥 Пригласить друзей', callback_data: 'invite' }
                ],
                [
                    { text: '◀️ В главное меню', callback_data: 'main_menu' }
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
                    { text: '⏭️ Пропустить задани', callback_data: 'task_skip' },
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
                    { text: ' Telegram Premium на 3 месяца (1300⭐)', callback_data: 'withdraw_premium' }
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
                    { text: '   Обязательные каналы', callback_data: 'admin_channels' },
                    { text: '🎰 Управление лотереями', callback_data: 'admin_lottery' }
                ],
                [
                    { text: '🎁 Управление промокодами', callback_data: 'admin_promocodes' },
                    { text: '📢 Рассылка сообщений', callback_data: 'admin_broadcast' }
                ],
                [
                    { text: '🏆 Недельные награды', callback_data: 'admin_weekly_rewards' },
                    { text: '   SubGram управление', callback_data: 'admin_subgram' }
                ],
                [
                    { text: '💸 Управление выводом', callback_data: 'admin_withdrawals' },
                    { text: '📊 Статистика подписок', callback_data: 'admin_subscription_stats' }
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

        // Check if user passed captcha
        const captchaPassed = await db.getCaptchaStatus(userId);

        if (!captchaPassed) {
            // User hasn't passed captcha - show captcha
            if (captchaSystem.hasActiveSession(userId)) {
                // User has active captcha session - show current question
                const currentQuestion = captchaSystem.getCurrentQuestion(userId);
                await bot.sendMessage(chatId, `🤖 **Подтвердите, что вы не робот**

Решите простой пример:
**${currentQuestion}**

💡 Введите только число (например: 18)`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]
                        ]
                    }
                });
            } else {
                // Generate new captcha
                const question = captchaSystem.generateCaptcha(userId);
                await bot.sendMessage(chatId, `🤖 **Добро пожаловать!**

Прежде чем начать пользоваться ботом, подтвердите, что вы не робот.

Решите простой пример:
**${question}**

💡 Введите только число (например: 26)`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 новый пример', callback_data: 'new_captcha' }]
                        ]
                    }
                });
            }
            return;
        }

        // Check subscriptions with detailed status
        const subscriptionDetails = await checkAllSubscriptionsDetailed(userId);
        const hasChannelsToShow = subscriptionDetails.channels.length > 0;

        if (hasChannelsToShow) {
            const alreadyNotified = await db.isSubscriptionNotified(userId);

            if (!alreadyNotified) {
                // FIRST TIME: Always show subscription message if there are any channels
                console.log(`[SUBSCRIPTION] First time /start - showing subscription message`);
                const subData = await getEnhancedSubscriptionMessage(userId);

                await bot.sendMessage(chatId, subData.message, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: subData.buttons }
                });

                // Mark user as notified
                await db.setSubscriptionNotified(userId, true);
                console.log(`[SUBSCRIPTION] Marked user ${userId} as notified`);
                return;
            } else {
                // REPEAT /START: ИСПРАВЛЕНО - автоматически проверяем все каналы
                console.log(`[SUBSCRIPTION] Repeat /start - auto-checking subscriptions`);
                const isSubscribed = await checkAllSubscriptions(userId, true);

                if (!isSubscribed) {
                    // User is not subscribed to some checkable channels - show subscription message
                    console.log(`[SUBSCRIPTION] User not subscribed to some checkable channels - showing subscription message`);
                    const subData = await getEnhancedSubscriptionMessage(userId);

                    await bot.sendMessage(chatId, subData.message, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: subData.buttons }
                    });
                    return;
                } else {
                    // User is subscribed to all checkable channels - proceed to main menu
                    console.log(`[SUBSCRIPTION] User passed subscription check - proceeding to main menu`);
                }
            }
        }
        
        // User is subscribed - update subscription status
        await db.updateUserField(userId, 'is_subscribed', true);

        // Add weekly points for bot activation
        try {
            await db.addWeeklyPoints(userId, 1, 'bot_activation');
        } catch (pointsError) {
            console.error('Error adding weekly points for bot activation:', pointsError);
        }
        
        // Process pending referrer (set invited_by but don't award bonus yet)
        if (dbUser.pending_referrer) {
            const invitedBy = dbUser.pending_referrer;

            // Clear pending referrer and set invited_by
            await db.updateUserField(userId, 'pending_referrer', null);
            await db.updateUserField(userId, 'invited_by', invitedBy);

            console.log(`[REFERRAL] User ${userId} linked to referrer ${invitedBy} - bonus will be awarded when qualified`);
        }
        
                // Check if user now qualifies for referral processing (new system)
        try {
            const qualification = await db.checkReferralQualification(userId);
            if (qualification.qualified) {
                const result = await db.checkAndProcessPendingReferrals(userId);
                if (result.processed > 0) {
                    // Send notification to referrer
                    try {
                        const message = `🎉 **Поздравляем!**

👤 Приглашённый вами пользователь **${user.first_name}** выполнил все условия:
✅ Прошёл капчу
✅ Подписался на все каналы
✅ Пригласил своего первого реферала

💰 **Вы пол��чили:** +3 ⭐
💎 **Ваш баланс пополнен!**

   Продолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

                        await bot.sendMessage(result.referrerId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                    [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                                ]
                            }
                        });
                    } catch (error) {
                        console.error('Error sending qualified referral notification:', error);
                    }
                }
            }
        } catch (error) {
            console.error('Error checking referral qualification:', error);
        }

        // Check for retroactive referral activation (old referrals)
        try {
            const retroResult = await db.activateRetroactiveReferral(userId);
            if (retroResult.success) {
                // Send notification to referrer about retroactive activation
                try {
                    const message = `🔄 **Возврат звёзд!**

👤 Ваш реферал **${user.first_name}** активировался:
✅ Прошёл капчу
✅ Подписался на все каналы

🎉 **Возвращены:** +3 ⭐
💎 **За активного реферала!**

🎯 Теперь этот реферал засчитывается полностью!`;

                    await bot.sendMessage(retroResult.referrerId, message, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error('Error sending retroactive activation notification:', error);
                }
            }
        } catch (error) {
            console.error('Error checking retroactive activation:', error);
        }

        // Send main menu
        const welcomeMessage = ` **Добро пожаловать в StarBot!**

💰 **Ваш персональный помощник для заработка Telegram Stars**

 **Доступные возможности:**
• Ежедневные награды в кликере
• Выпо��нение заданий за вознагражденое
• Реферальная программа (3⭐ за друга)
• Участие в лотереях и розыгрышах
• Открытие призовых кейсов

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
⚙️ **Обр��ботка:** ${status.processing ? 'Активна' : 'Неактивна'}
⏱️ **Сообщений в секунду:** ${status.messagesPerSecond}
⏰ **Интервал между сообщениями:** ${status.intervalMs}ms

${status.queueLength > 0 ? '📤 В очереди есть сообщения для отправки...' : ' Очередь пуста'}`;

    bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

// Test command to verify version
bot.onText(/\/test_version/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const testMessage = ` **Тест версии бета**

📅 Версия: ОБНОВЛЕННАЯ v5.0 - С КНОПКАМИ И УЛУЧШЕНИЯМИ!
🕒 Время: ${new Date().toLocaleString('ru-RU')}
👤 Ваш ID: ${userId}
🔧 Admin ID: ${isAdmin(userId) ? 'ВЫ АДМИН' : 'НЕ АДМИН'}

✅ Если вы видите это сообщение - работает НОВАЯ версия!
🎯 Inline-кнопки восстановлены, улучшения сохранены!`;

    bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });
});

// Test subscription notification logic (admin only)
bot.onText(/\/test_subscription_logic/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const testMessage = `🧪 **Тестирование логики подписок**

🔍 Тестируем новую систему уведомлений о подписках...`;

        await bot.sendMessage(chatId, testMessage, { parse_mode: 'Markdown' });

        // Проверя��м статус для т��стово���� поль��ователя
        const testUserId = 7972065986; // админ

        const initialStatus = await db.isSubscriptionNotified(testUserId);

        // Устанавливаем статус
        await db.setSubscriptionNotified(testUserId, true);
        const afterSet = await db.isSubscriptionNotified(testUserId);

        // Сбрасываем с��атус
        await db.resetSubscriptionNotified(testUserId);
        const afterReset = await db.isSubscriptionNotified(testUserId);

        const resultMessage = `📊 **Результаты тестирования:**

🔹 Начальный статус: ${initialStatus}
🔹 После установки: ${afterSet}
🔹 После сброса: ${afterReset}

✅ **Статус:** ${
    !initialStatus && afterSet && !afterReset
        ? 'Все функции работают корректно!'
        : 'Обнаружены проблемы'
}

📝 **Но��ая логика:**
• При первом /start - отправляется сообщение о подписках
• При повторном /start - только краткое напоминание
• При успешной проверке - статус сбрасывается
• При добавлении каналов - статус сбрасывается для всех`;

        await bot.sendMessage(chatId, resultMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error testing subscription logic:', error);
        bot.sendMessage(chatId, '❌ Ошибка при тестировании: ' + error.message);
    }
});

// Detailed subscription diagnostic (admin only)
bot.onText(/\/subscription_diagnostic/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const testUserId = userId; // используем ID админа

        // Собираем все данные для диагностики
        const user = await db.getUser(testUserId);
        const subscriptionDetails = await checkAllSubscriptionsDetailed(testUserId);
        const isNotified = await db.isSubscriptionNotified(testUserId);

        const diagnosticMessage = `🔍 **Диагностика подписок для User ${testUserId}**

👤 **Данные пользователя:**
• subscription_notified: ${user?.subscription_notified || 'не установлено'}
• is_subscribed: ${user?.is_subscribed || false}
• captcha_passed: ${user?.captcha_passed || false}

🔍 **Функция isSubscriptionNotified():** ${isNotified}

📋 **Детали подписок:**
• allSubscribed: ${subscriptionDetails.allSubscribed}
• hasErrors: ${subscriptionDetails.hasErrors}
• Количество каналов: ${subscriptionDetails.channels.length}

📊 **Каналы:**
${subscriptionDetails.channels.map((ch, i) =>
    `${i+1}. ${ch.name} - ${ch.subscribed ? '✅ Подписан' : '❌ Не подписан'} ${ch.canCheck ? '' : '(❗ Не можем проверить)'}`
).join('\n') || 'Нет каналов'}

🔄 **Логика /start:**
• Должен получить сообщение: ${(!subscriptionDetails.allSubscribed && subscriptionDetails.channels.length > 0) ? 'ДА' : 'НЕТ'}
• Уже уведомлен: ${isNotified ? 'ДА' : 'НЕТ'}
• Результ��т: ${!isNotified && !subscriptionDetails.allSubscribed && subscriptionDetails.channels.length > 0 ? '📨 ОТПРАВИТ полное сообщение' : isNotified && !subscriptionDetails.allSubscribed ? '📝 ОТПРАВИТ напоминание' : '✅ НЕ ОТПРАВИТ (подписан)'}`;

        await bot.sendMessage(chatId, diagnosticMessage, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error in subscription diagnostic:', error);
        bot.sendMessage(chatId, '❌ Ошибка диагностики: ' + error.message);
    }
});

// Admin captcha stats command
bot.onText(/\/captcha_stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const stats = captchaSystem.getStats();
        const statsMessage = `🤖 **Статистика системы капчи**

📊 **Активные сессии:** ${stats.activeSessions}
🔢 **Всего примеров:** ${stats.totalProblems}

📝 **Доступные примеры:**
${stats.problems.map((problem, index) => `${index + 1}. ${problem}`).join('\n')}

   **Время сессии:** 10 минут
🎯 **Максимум попыток:** 3

${stats.activeSessions > 0 ? '⚠️ Есть пользователи, проходящие капчу...' : '✅ Все се��сии завершены'}`;

        bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error getting captcha stats:', error);
        bot.sendMessage(chatId, ' Ошибка получения статистики капчи.');
    }
});

// Admin command to reset user captcha
bot.onText(/\/reset_captcha (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const targetUserId = parseInt(match[1]);

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, ' У вас нет прав доступа.');
        return;
    }

    try {
        // Clear captcha session
        const sessionCleared = captchaSystem.clearSession(targetUserId);

        // Reset captcha status in database
        await db.setCaptchaPassed(targetUserId, false);

        const message = sessionCleared
            ? `✅ Капча сброшена для пользователя ${targetUserId}. Активная сессия очи��ена.`
            : `✅ Капча сброшена для пользователя ${targetUserId}. Активной сессии не было.`;

        bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('Error resetting captcha:', error);
        bot.sendMessage(chatId, '❌ Ошибка при сбросе капчи.');
    }
});

// Admin command to test captcha for current user
bot.onText(/\/test_my_captcha/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        // Reset admin's captcha for testing
        captchaSystem.clearSession(userId);
        await db.setCaptchaPassed(userId, false);

        bot.sendMessage(chatId, '✅ Ваша капча сброшена для тестирования. Нажмите /start для прохождения капчи.');
    } catch (error) {
        console.error('Error resetting captcha for test:', error);
        bot.sendMessage(chatId, '❌ Ошибка при сбросе капчи для тестирования.');
    }
});

// Admin command to run referral audit (dry run)
bot.onText(/\/audit_referrals/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        bot.sendMessage(chatId, '🔍 Запуск аудита реферальной системы...');

        const auditSystem = require('./referral-audit-system');
        const auditResults = await auditSystem.analyzeExistingReferrals();

        // Generate summary
        const summary = await auditSystem.applyReferralCorrections(auditResults, true); // dry run

        let message = `📊 **АУДИТ РЕФЕРАЛЬНОЙ СИСТЕМЫ**\n\n`;
        message += `👥 Пользователей с рефералами: ${auditResults.length}\n`;
        message += `   Требуют корректировки: ${summary.totalUsersAffected}\n`;
        message += `💸 Звёзд к списанию: ${summary.totalStarsDeducted}⭐\n\n`;

        if (summary.totalUsersAffected > 0) {
            message += `🔴 **ПРОБЛЕМЫ НАЙДЕНЫ!**\n`;
            message += `Используйте /apply_referral_corrections для применения изменений.\n\n`;
            message += `⚠️ **ВНИМАНИЕ**: Это спишет звёзды у пользователей за неактивных рефералов!`;
        } else {
            message += `✅ **ВСЁ В ПОРЯДКЕ!**\nВсе рефералы соответству��т новым требованиям.`;
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error running referral audit:', error);
        bot.sendMessage(chatId, '❌ Ошибка при выполнении аудита.');
    }
});

// Admin command to apply referral corrections
bot.onText(/\/apply_referral_corrections/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, 'У вас нет прав доступа.');
        return;
    }

    try {
        bot.sendMessage(chatId, '⚠️ Применение корректировок реферальной системы...');

        const auditSystem = require('./referral-audit-system');
        const auditResults = await auditSystem.analyzeExistingReferrals();

        // Apply corrections
        const summary = await auditSystem.applyReferralCorrections(auditResults, false); // real application

        let message = `✅ **КОРРЕКТИРОВКИ ПРИМЕНЕНЫ!**\n\n`;
        message += `👥 Пользователей скорректировано: ${summary.totalUsersAffected}\n`;
        message += `⭐ Звёзд списано: ${summary.totalStarsDeducted}⭐\n\n`;

        if (summary.totalUsersAffected > 0) {
            message += `📋 **ЧТО ИЗМЕНИЛОСЬ:**\n`;
            for (const correction of summary.corrections.slice(0, 10)) { // Show first 10
                message += ` ${correction.referrerName}: -${correction.starsDeducted}⭐ (${correction.inactiveReferrals} неактивных)\n`;
            }

            if (summary.corrections.length > 10) {
                message += `... и еще ${summary.corrections.length - 10} пользователей\n`;
            }

            message += `\n🔄 **Звёзды вернутся когда рефералы станут активными!**`;
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error applying referral corrections:', error);
        bot.sendMessage(chatId, '❌ Ошибка при применении корректировок.');
    }
});

// Admin command to get detailed audit report
bot.onText(/\/detailed_audit_report/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        bot.sendMessage(chatId, '📊 Генерация детального ��тчёта...');

        const auditSystem = require('./referral-audit-system');
        const auditResults = await auditSystem.analyzeExistingReferrals();
        const report = await auditSystem.generateAuditReport(auditResults);

        // Split long report into chunks
        const maxLength = 4000;
        if (report.length <= maxLength) {
            bot.sendMessage(chatId, report);
        } else {
            const chunks = [];
            for (let i = 0; i < report.length; i += maxLength) {
                chunks.push(report.substring(i, i + maxLength));
            }

            for (let i = 0; i < chunks.length; i++) {
                const chunkHeader = i === 0 ? '' : `📄 **Часть ${i + 1}/${chunks.length}**\n\n`;
                bot.sendMessage(chatId, chunkHeader + chunks[i]);
            }
        }

    } catch (error) {
        console.error('Error generating detailed audit report:', error);
        bot.sendMessage(chatId, '❌ Ошибка при генерации отчёта.');
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
            bot.sendMessage(chatId, `❌ ивная лотерея с ID ${lotteryId} не найдена.`);
            return;
        }

        const lottery = lotteryResult.rows[0];
        
        const participantsResult = await db.executeQuery('SELECT COUNT(*) as count FROM lottery_tickets WHERE lottery_id = $1', [lotteryId]);
        const participantCount = participantsResult.rows[0].count;
        
        if (participantCount === 0) {
            bot.sendMessage(chatId, `❌ В лотерея ${lottery.name} нет участников!`);
            return;
        }

        await distributeLotteryRewards(lotteryId, lottery);
        
        bot.sendMessage(chatId, `✅ Лотерея "${lottery.name}" завершена!\n Участников: ${participantCount}\n🏆 Награды распределены между ${Math.min(lottery.winners_count, participantCount)} победителями.`);

    } catch (error) {
        console.error('Error ending lottery:', error);
        bot.sendMessage(chatId, '❌ Ошибка завершнии лотереи.');
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
            // Check if this user now qualifies for referral processing
            try {
                const qualificationResult = await db.handleNewReferralEarned(targetUserId);

                let message = `✅ Пользователю ${targetUserId} добавлено ${refCount} рефералов!`;

                if (qualificationResult.qualified && qualificationResult.processed) {
                    message += `\n🎉 Пользователь квалифицирован - бонус выплачен рефереру!`;
                } else if (qualificationResult.qualified) {
                    message += `\n✅ Пользователь квалифицирован (все условия выполнены)`;
                } else {
                    message += `\n⏳ Пользователь пока не квалифицирован (нужны: капча + подписка + 1 реферал)`;
                }

                bot.sendMessage(chatId, message);
            } catch (error) {
                bot.sendMessage(chatId, `✅ Пользователю ${targetUserId} добавлено ${refCount} рефералов!`);
                console.error('Error checking qualification:', error);
            }

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
                await bot.sendMessage(targetUserId, `🎉 **Бонус от администрации!**\n\nВам добавлено **${starsCount} ⭐** от администрации!\n\n💫 Спасибо за активность!`, { parse_mode: 'Markdown' });
            } catch (error) {
                console.log('Could not notify user about stars bonus');
            }
        } else {
            bot.sendMessage(chatId, ` Пользователь с ID ${targetUserId} не найден.`);
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

        const message = ` **Адиин-панель**

📊 **Быстрая статистика:**
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

**Дополнительные команды:**
🎰 **/endlottery [ID]** - завершить лотерею вручную
👥 **/refupplayer [ID] [число]** - добавить рефералов пользователю
   **/starsupplayer [ID] [число]** - добавить звёзды пользователи

**Трекинговые ссылки:**
🔗 **/create_tracking_link название** - создать ссылку для рекламы
📊 **/list_tracking** - список всех ссылок
📈 **/tracking_stats ID** - статистика ссы��ки

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
            bot.sendMessage(chatId, '❌ Неверный формат!\n\nИспользуйте:\n`/create_task канал|название|награда|лимит`\n\nГде лимит - максимальное количество выполнений (необязательно).\n\nПримера:\n• `/create_task @channel|Мой канал|1.5`\n `/create_task @channel|Мой канал|1.5|100`', { parse_mode: 'Markdown' });
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

        let message = ` Задание создано!\n📺 Канал: ${channelId.trim()}\n📝 Название: ${channelName.trim()}\n💰 Награда: ${rewardAmount} `;
        if (limit) {
            message += `\n   Лимит выполнений: ${limit}`;
        } else {
            message += `\n🔢 Лимит выпоолнений: Без ограничение`;
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
        bot.sendMessage(chatId, '�� У вас нет прав доступа.');
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

        // Reset notification status for all users since new channel was added
        const resetCount = await db.resetAllSubscriptionNotifications();

        bot.sendMessage(chatId, `✅ Канал добавлен!\n📺 ${channelName} (${channelId})\n🔄 Сброшен статус уведомлений для ${resetCount} пользователей.`);

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
            bot.sendMessage(chatId, '❌ Веверный формат! Используйте: /create_lottery название|билеты|цена|победители|процент');
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

        bot.sendMessage(chatId, `✅ Лотерея создана!\n ${lotteryName}\n🎫 ${maxTicketsNum} билетов по ${ticketPriceNum} ⭐\n🏆 ${winnersCountNum} победителей\n Процент бота: ${botPercentNum}%`);
        console.log('[CREATE-LOTTERY] Lottery created successfully');

    } catch (error) {
        console.error('Error creating lottery:', error);
        console.error('Full error:', error.stack);
        bot.sendMessage(chatId, `❌ Ошибка создание лотереи: ${error.message}`);
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

• Название: Недельная
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
                bot.sendMessage(chatId, '❌ Неверный формат призов! Используйте: место:сумма');
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

        let message = `✅ **Реферальная лотерея создана!**

🎰 **Название:** ${name}
   **Длительность:** ${timeHours} часов
👥 **Условие:** пригласить ${minReferrals} рефералов
💰 **Цена данного билета:** ${ticketPrice} ⭐
🏆 **Призовые места:** ${prizes.length}

**Призы:**`;

        for (let i = 0; i < prizes.length; i++) {
            const place = i + 1;
            const emoji = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏅';
            message += `\n${emoji} ${place} место: ${prizes[i]} ⭐`;
        }

        message += `\n\n⏰ **завершние:** ${endsAt.toLocaleString('ru-RU')}`;

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
• Вр��мя: 72 часа (3 дня)
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
            bot.sendMessage(chatId, '❌ Необходимо указать хотя бы один приз!');
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
            const emoji = place === 1 ? '🥇' : place === 2 ? '' : place === 3 ? '🥇' : '🏅';
            message += `\n${emoji} ${place} место: ${prizes[i]} ⭐`;
        }

        message += `\n\n **Завершение:** ${endsAt.toLocaleString('ru-RU')}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log('[CREATE-AUTO-REF-LOTTERY] Auto referral lottery created successfully, ID:', lotteryId);

    } catch (error) {
        console.error('Error creating auto referral lottery:', error);
        bot.sendMessage(chatId, `Ошибка создания лотереи: ${error.message}`);
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
                bot.sendMessage(chatId, '❌ Неверный формат! Используйте: /select_lottery_winners ID место1:userID место2:userID');
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
        bot.sendMessage(chatId, `❌ Ошибка в��бора победителей: ${error.message}`);
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

            await bot.editMessageText(`✅ **Поздравляем!**\n\nВы пополнили условие участия в лотерее!\n\n👥 приглашено рефералов: ${condition.referralCount}/${condition.required}\n🎫 Вы получили бессплатный билет!\n\n💰 Теперь вы можете купить дополнительные билеты для увеличения шансов на победу.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎫 Купить доп. билет', callback_data: `ref_lottery_buy_${lotteryId}` }],
                        [{ text: '🎰  лотереям', callback_data: 'lottery' }],
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
            await bot.editMessageText('🎰 Лотерея уже завершена.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Check user balance
        const user = await db.getUser(userId);
        if (user.balance < lottery.additional_ticket_price) {
            await bot.editMessageText(`❌ **Недостаточно средств!**\n\nДля покупки дополнительного билета нужно ${lottery.additional_ticket_price} ⭐\nВаш баланс: ${user.balance} ⭐\n\nВыполняйте задания и приглашайте друзей для заработка звёзд!`, {
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

            await bot.editMessageText(`✅ **Билет куплен!**\n\nВы успешно приобрети дополнительный билет в лотерею "${lottery.name}"!\n\n💰 списано: ${lottery.additional_ticket_price} ⭐\n💎 ваш баланс: ${user.balance - lottery.additional_ticket_price} ⭐\n\n🍀 Удачи в розыгрыше!`, {
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
        await bot.editMessageText('❌ Ошибка покупки билета.', {
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

        const message = `✅ запрос на вывод №${completedCount}

👤 Пользователь: ${displayName}${usernameText}| ID: ${user.id}
👥 Количество: ${typeText}

🔄 Статус: Подарок отправлен 🎁`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📺 Основной канал', url: 'https://t.me/kirbyvivodstars' },
                        { text: '💬 Наш чат', url: 'https://t.me/kirbychat_stars' },
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

        let message = ` **Лотерея "${lotteryName}" завершена!**\n\n🏆 **Победители:**\n`;

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
                    [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
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

// Admin subscription statistics command
bot.onText(/\/subscription_stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const stats = await db.getChannelSubscriptionStats();
        const uniqueUsersCount = await db.getUniqueSubscriptionUsersCount();

        if (stats.length === 0) {
            bot.sendMessage(chatId, `📈 **Статистика подписок**\n\n❌ Нет данных о подписках.\n\nДобавьте обязательные каналы и дождитесь первых проверок подписок.`, { parse_mode: 'Markdown' });
            return;
        }

        let message = `📈 **Статистика подписок по каналам**\n\n`;
        message += `👥 **Уникальных пользователей прошла проверку:** ${uniqueUsersCount}\n`;
        message += `🔄 *(Каждый пользователь считается только один раз)*\n\n`;

        let totalChecks = 0;

        for (const stat of stats) {
            const channelName = stat.channel_name || stat.channel_id;
            const addedDate = stat.channel_added_at ? new Date(stat.channel_added_at).toLocaleDateString('ru-RU') : 'Неизвестно';
            const lastCheck = stat.last_check_at ? new Date(stat.last_check_at).toLocaleString('ru-RU') : 'Никогда';
            const activeStatus = stat.is_active ? '✅' : '❌';

            message += `${activeStatus} **${channelName}**\n`;
            message += `   📊 Уникальных проверок: **${stat.successful_checks}**\n`;
            message += `   📅 Добавлен: ${addedDate}\n`;
            message += `   ⏰ Последняя п��оверка: ${lastCheck}\n\n`;

            totalChecks += parseInt(stat.successful_checks);
        }

        message += `📊 **Общая статистика:**\n`;
        message += `• Всего уникальных пользователей: **${uniqueUsersCount}**\n`;
        message += `• Активных каналов: **${stats.filter(s => s.is_active).length}**\n`;
        message += `• Всего каналов: **${stats.length}**`;

        bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 Последние пользователи', callback_data: 'admin_unique_users' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error getting subscription stats:', error);
        bot.sendMessage(chatId, '❌ Ошибка загрузки статистики подписок.');
    }
});

// Admin command to view latest unique subscription users
bot.onText(/\/unique_users/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const uniqueUsers = await db.getLatestUniqueSubscriptionUsers(15);
        const totalCount = await db.getUniqueSubscriptionUsersCount();

        let message = `👥 **Последние уникальные пользователи** (${totalCount} всего)\n\n`;

        if (uniqueUsers.length === 0) {
            message += '📋 Нет данных о пользователях.';
        } else {
            for (let i = 0; i < uniqueUsers.length; i++) {
                const user = uniqueUsers[i];
                const cleanName = cleanDisplayText(user.first_name || 'Неизвестный');
                const date = new Date(user.first_success_at).toLocaleString('ru-RU');

                message += `${i + 1}. **${cleanName}**\n`;
                message += `   🆔 ID: ${user.user_id}\n`;
                if (user.username) {
                    message += `    @${user.username}\n`;
                }
                message += `   📅 Первая проверка: ${date}\n\n`;
            }
        }

        bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Error getting unique users:', error);
        bot.sendMessage(chatId, '❌ Ошибка получения данных о пользователях.');
    }
});

// Admin promocode creation
bot.onText(/\/create_promo (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, ' У вас нет прав доступа.');
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
        // Check captcha first (except for captcha-related buttons)
        if (data !== 'new_captcha' && data !== 'restart_after_captcha' && !isAdmin(userId)) {
            const captchaPassed = await db.getCaptchaStatus(userId);
            if (!captchaPassed) {
                // User hasn't passed captcha - show captcha
                if (captchaSystem.hasActiveSession(userId)) {
                    const currentQuestion = captchaSystem.getCurrentQuestion(userId);
                    await bot.editMessageText(`🤖 **Подтвердите, что вы не робт**

Решите простой пример:
**${currentQuestion}**

💡 Введите только число (например: 26)`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 новый пример', callback_data: 'new_captcha' }]
                            ]
                        }
                    });
                } else {
                    const question = captchaSystem.generateCaptcha(userId);
                    await bot.editMessageText(`🤖 **Подтвердите, что вы не робот**

Решите простой пример:
**${question}**

💡 Введите только число (например: 26)`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]
                            ]
                        }
                    });
                }
                await bot.answerCallbackQuery(callbackQuery.id);
                return;
            }
        }

        // Check subscription for all important buttons (except admin functions)
        if (data !== 'check_subscriptions' && data !== 'check_subscriptions_enhanced' && data !== 'main_menu' && data !== 'new_captcha' && data !== 'restart_after_captcha' && !data.startsWith('admin_') && !isAdmin(userId)) {
            const subscriptionDetails = await checkAllSubscriptionsDetailed(userId);
            const isSubscribed = await checkAllSubscriptions(userId);

            console.log(`[SUBSCRIPTION] Callback detailed check for user ${userId}: allSubscribed=${subscriptionDetails.allSubscribed}, hasErrors=${subscriptionDetails.hasErrors}, final=${isSubscribed}`);

            if (!isSubscribed) {
                // Check if user was already notified
                const alreadyNotified = await db.isSubscriptionNotified(userId);

                console.log(`[SUBSCRIPTION] Callback ${data} for user ${userId}: isSubscribed=${isSubscribed}, alreadyNotified=${alreadyNotified}`);

                if (!alreadyNotified) {
                    // Send subscription message and mark as notified
                    console.log(`[SUBSCRIPTION] Sending subscription message to user ${userId} via callback`);
                    const subData = await getEnhancedSubscriptionMessage(userId);
                    await bot.editMessageText(subData.message, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: subData.buttons }
                    });
                    await db.setSubscriptionNotified(userId, true);
                    console.log(`[SUBSCRIPTION] Marked user ${userId} as notified via callback`);
                } else {
                    // User already notified - SKIP reminder per user request
                    console.log(`[SUBSCRIPTION] User ${userId} already notified via callback, allowing action`);
                    // Skip the reminder and allow user to proceed
                    await bot.answerCallbackQuery(callbackQuery.id);
                    // Don't return here - let user proceed with action
                    await bot.editMessageText(`🔔 Пожалуйста, подпишитесь на все необходимые каналы и нажмите "✅ Проверить подписки".`, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: ' Проверить подписки', callback_data: 'check_subscriptions_enhanced' }]
                            ]
                        }
                    });
                }
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
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        // Handle different callback data
        switch (data) {
            case 'new_captcha':
                // Generate new captcha for user
                const newQuestion = captchaSystem.generateCaptcha(userId);
                await bot.editMessageText(` **Подтвердите, что вы не робот**

Решите простой пример:
**${newQuestion}**

💡 Введите только число (например: 26)`, {
                    chat_id: chatId,
                    message_id: msg.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]
                        ]
                    }
                });
                await bot.answerCallbackQuery(callbackQuery.id, { text: '🔄 Новый ��ример сгенерирован!' });
                break;

            case 'restart_after_captcha':
                // User passed captcha and wants to restart bot
                await bot.editMessageText(' Перезапуск...', {
                    chat_id: chatId,
                    message_id: msg.message_id
                });

                // Simulate /start command
                setTimeout(async () => {
                    try {
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
                            reply_markup: { remove_keyboard: true },
                            ...getMainMenuKeyboard()
                        });
                    } catch (error) {
                        console.error('Error in restart after captcha:', error);
                    }
                }, 1000);

                await bot.answerCallbackQuery(callbackQuery.id);
                break;

            case 'check_subscriptions':
                // Get detailed subscription status
                const subscriptionDetails = await checkAllSubscriptionsDetailed(userId, true);

                // Calculate if user should pass: all subscribed OR only errors preventing check
                let canPass = subscriptionDetails.allSubscribed;
                if (!canPass && subscriptionDetails.hasErrors) {
                    // Check if ALL remaining unsubscribed channels have errors (can't be checked)
                    const unsubscribedChannels = subscriptionDetails.channels.filter(ch => !ch.subscribed);
                    const allUnsubscribedHaveErrors = unsubscribedChannels.every(ch => !ch.canCheck);
                    canPass = allUnsubscribedHaveErrors;
                }

                const isSubscribed = canPass;

                if (isSubscribed) {
                    await db.updateUserField(userId, 'is_subscribed', true);
                    // Keep notification status - user shouldn't receive subscription messages again

                    // Add weekly points for bot activation
                    try {
                        await db.addWeeklyPoints(userId, 1, 'bot_activation');
                    } catch (pointsError) {
                        console.error('Error adding weekly points for bot activation:', pointsError);
                    }
                    
                    // Process pending referrer (set invited_by but don't award bonus yet)
                    const user = await db.getUser(userId);
                    if (user && user.pending_referrer) {
                        const invitedBy = user.pending_referrer;

                        // Clear pending referrer and set invited_by
                        await db.updateUserField(userId, 'pending_referrer', null);
                        await db.updateUserField(userId, 'invited_by', invitedBy);

                        console.log(`[REFERRAL] User ${userId} linked to referrer ${invitedBy} - bonus will be awarded when qualified`);
                    }

                    // Check if user now qualifies for referral processing (new system)
                    try {
                        const qualification = await db.checkReferralQualification(userId);
                        if (qualification.qualified) {
                            const result = await db.checkAndProcessPendingReferrals(userId);
                            if (result.processed > 0) {
                                // Send notification to referrer
                                try {
                                    const userInfo = await db.getUser(userId);
                                    const message = `🎉 **Поздравляем!**

👤 Приглашённый вами пользователь **${userInfo.first_name}** выполнил все условия:
✅ Прошёл капчу
✅ Подписался на все каналы
👥 Пригласил своего первого реферала

🎉 **Вы получили:** +3 ⭐
💎 **Ваш баланс пополнен!**

👥 Продолжайте приглашать друзей и зарабатывайте еще больше звёзд!`;

                                    await bot.sendMessage(result.referrerId, message, {
                                        parse_mode: 'Markdown',
                                        reply_markup: {
                                            inline_keyboard: [
                                                [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                                [{ text: '◀️ Главное меню', callback_data: 'main_menu' }]
                                            ]
                                        }
                                    });
                                } catch (error) {
                                    console.error('Error sending qualified referral notification:', error);
                                }
                            }
                        }
                    } catch (error) {
                        console.error('Error checking referral qualification:', error);
                    }

                    // Check for retroactive referral activation (old referrals)
                    try {
                        const retroResult = await db.activateRetroactiveReferral(userId);
                        if (retroResult.success) {
                            // Send notification to referrer about retroactive activation
                            try {
                                const userInfo = await db.getUser(userId);
                                const message = `🔄 **Возрат звёзд!**

👤 Ваш реферал **${userInfo.first_name}** активировался:
✅ Прошёл капчу
✅ Подписался на все каналы

💰 **Возвращено:** +3 ⭐
💎 **За активного реферала!**

🎯 Теперь этот реферал засчитыв��ется полностью!`;

                                await bot.sendMessage(retroResult.referrerId, message, {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [
                                            [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                            [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                                        ]
                                    }
                                });
                            } catch (error) {
                                console.error('Error sending retroactive activation notification:', error);
                            }
                        }
                    } catch (error) {
                        console.error('Error checking retroactive activation:', error);
                    }

                    await handleMainMenu(chatId, msg.message_id);
                } else {
                    // Show updated subscription message with only unsubscribed channels
                    const subData = await getEnhancedSubscriptionMessage(userId, true);

                    await bot.editMessageText(subData.message, {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: subData.buttons }
                    });

                    await bot.answerCallbackQuery(callbackQuery.id, {
                        text: subscriptionDetails.hasErrors ?
                            '❌ Некоторые каналы не могут быть проверены, но вы можете продолжить' :
                            '❌ Подпишитесь на оставшиеся каналы',
                        show_alert: false
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
                console.log(`[WITHDRAWAL_CALLBACK] User ${userId} requested withdrawal: ${data} at ${new Date().toISOString()}`);
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
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '✅ Автомати��еские награды включены!' });
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
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ У вас нет прав доступа!', show_alert: true });
                }
                break;
            case 'admin_weekly_trigger':
                if (isAdmin(userId)) {
                    await bot.answerCallbackQuery(callbackQuery.id, { text: '🏆 Запускаю распределение наград...' });
                    try {
                        const result = await distributeWeeklyRewards(true);
                        if (result.success) {
                            await bot.editMessageText(`🎉 **Награды распределены!**\n\n👥 Награждено пользователей: ${result.users}\n📊 Очки всех пользователей сброшены\n\n🎯 Новая неделя началась!`, {
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
                        await bot.editMessageText('❌ Ошибка запуска недельных наград.', {
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

📊 **Быстрая статистика:**
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

            // Stars Agent функциональность удалена - только ручная обработка заявок

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
                            reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'admin_menu' }]] }
                        });
                    }
                }
                break;
            case 'admin_subscription_stats':
                if (isAdmin(userId)) {
                    await handleSubscriptionStats(chatId, msg.message_id);
                }
                break;
            case 'admin_subgram':
                if (isAdmin(userId)) {
                    await handleAdminSubGram(chatId, msg.message_id);
                }
                break;
            case 'admin_subgram_settings':
                if (isAdmin(userId)) {
                    await handleAdminSubGramSettings(chatId, msg.message_id);
                }
                break;
            case 'admin_subgram_stats':
                if (isAdmin(userId)) {
                    await handleAdminSubGramStats(chatId, msg.message_id);
                }
                break;
            case 'admin_subgram_logs':
                if (isAdmin(userId)) {
                    await handleAdminSubGramLogs(chatId, msg.message_id);
                }
                break;
            case 'admin_subscription_history':
                if (isAdmin(userId)) {
                    await handleSubscriptionHistory(chatId, msg.message_id);
                }
                break;
            case 'admin_unique_users':
                if (isAdmin(userId)) {
                    await handleUniqueUsers(chatId, msg.message_id);
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
            case 'admin_withdrawals':
                if (isAdmin(userId)) await handleAdminWithdrawals(chatId, msg.message_id);
                break;
            case 'admin_withdrawal_reject_all':
                if (isAdmin(userId)) await handleAdminWithdrawalRejectAll(chatId, msg.message_id);
                break;
            case 'admin_withdrawal_list':
                if (isAdmin(userId)) await handleAdminWithdrawalList(chatId, msg.message_id);
                break;
            case 'admin_withdrawal_stats':
                if (isAdmin(userId)) await handleAdminWithdrawalStats(chatId, msg.message_id);
                break;
            case 'reject_all_technical':
                if (isAdmin(userId)) await executeRejectAllWithdrawals(chatId, msg.message_id, userId, 'Технические работы по обслуживанию системы выводов');
                break;
            case 'reject_all_violation':
                if (isAdmin(userId)) await executeRejectAllWithdrawals(chatId, msg.message_id, userId, 'Нарушение правил использования бота');
                break;
            case 'reject_all_payment':
                if (isAdmin(userId)) await executeRejectAllWithdrawals(chatId, msg.message_id, userId, 'Технические проблемы с платёжной системой');
                break;
            case 'reject_all_custom':
                if (isAdmin(userId)) {
                    await bot.editMessageText('✍️ **Кастомная причина отклонения**\n\nОтправьте сообщение с причиной отклонения всех заявок:', {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: [[{ text: '🔙 Отмена', callback_data: 'admin_withdrawal_reject_all' }]] }
                    });
                    // Set user state for custom reason input
                    userStates.set(userId, { state: 'waiting_reject_all_reason', chatId, messageId: msg.message_id });
                }
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
                            reply_markup: { inline_keyboard: [[{ text: '◀️ Назад к рассылке', callback_data: 'admin_broadcast' }]] }
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
                    await bot.editMessageText('❌ Создание рассылки отме��ено.', {
                        chat_id: chatId,
                        message_id: msg.message_id,
                        reply_markup: {
                            inline_keyboard: [[{ text: '◀️ Назад к рассылке', callback_data: 'admin_broadcast' }]]
                        }
                    });
                }
                break;

            // SubGram handlers
            case 'check_subscriptions_enhanced':
                await handleEnhancedSubscriptionCheck(chatId, msg.message_id, userId);
                break;
            case 'subgram_check':
                await handleSubGramCheck(chatId, msg.message_id, userId);
                break;
            case 'subgram_gender_male':
                await handleSubGramGender(chatId, msg.message_id, userId, 'male');
                break;
            case 'subgram_gender_female':
                await handleSubGramGender(chatId, msg.message_id, userId, 'female');
                break;
            case 'subgram-op':
                // Основной callback для проверки SubGram подписок согласно документации
                await handleSubGramOfficialCheck(chatId, msg.message_id, userId);
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
            text: '❌ Произошла ошибка. Порробуйте позже.',
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

 **Информация о пользователе:**
• Имя: **${user.first_name}**
• ID: \`${user.id}\`
• Дата регистрации: **${registrationDate}**

💰 **Финансовая статистика:**
• Текущий баланс: **${user.balance} ⭐**
• Заработано с рефералов: **${totalEarned} ⭐**

���� **Реферальная активность:**
• Всего приглашено: **${user.referrals_count}**
• Приглашено сегодня: **${user.referrals_today}**

🎯 **Игровая статистика:**
${user.last_click ? `• Последний клик: ${new Date(user.last_click).toLocaleDateString('ru-RU')}` : '• Кликер еще не использовался'}
${user.last_case_open ? `• Последний кейс: ${new Date(user.last_case_open).toLocaleDateString('ru-RU')}` : '• Кейсы еще не открывались'}`;

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
Приглашайте друзей и получайте **3 ��** за каждого нового пользователя!

🔗 **Ваша персональная ссылка:**
\`${inviteLink}\`

📊 **Статистика приглашений:**
👥 Всего друзей приглашено: **${user.referrals_count}**
👥 Приглашено сегодня: **${user.referrals_today}**
💰 Заработано с рефералов: **${user.referrals_count * 3} ⭐**

🎯 **Как это работает:**
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

⏳ **До обновления:** ${hoursLeft}ч ${minutesLeft}м
🎁 **Завтка доступно:** 10 новых кликов

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

📊 **Сегодня кликнули:** ${currentClicks}/10
💰 **Ваш баланс:** ${user.balance} ⭐

⏳ **До следующего клика:** ${minutesLeft} мин
⏰ **Следующая награда:** 0.1 ⭐

⌛ **Время ожидания:** ${delayMinutes} мин (увеличивается с каждым кликом)`;

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
💰 **Начислено: **+${reward} ⭐** (+1 очко)

 **Статистика:**
💎 Ваш баланс: ${(parseFloat(user.balance) + parseFloat(reward)).toFixed(1)} ⭐
🔢 Осталось кликов: ${remainingClicks}
${remainingClicks > 0 ? `⏰ Следующий кликер через: ${nextDelayMinutes} мин` : '🎉 Все клики на сегодня использованы!'}

 **Совет:** С каждым кликом время ожидания увеличивается на 5 минут`;

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
}

async function handleWithdraw(chatId, messageId, user) {
    const message = `⭐ **Вывод звёзд**

**Ваш баланс:** ${user.balance} ⭐

${user.referrals_count < 5 ? 
    '❌ **Для вывода средств требуются минимум 5 рефералов**' : 
    '✅ **Вы можете выводить средства**'
}

Соберите сумму для вывода:`;

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        ...getWithdrawKeyboard()
    });
}

async function handleWithdrawRequest(chatId, messageId, userId, data) {
    console.log(`[WITHDRAWAL_HANDLER] Starting withdrawal process for user ${userId}, data: ${data}, time: ${new Date().toISOString()}`);

    try {
        // Check withdrawal cooldown
        const now = Date.now();
        const lastWithdrawal = withdrawalCooldowns.get(userId);

        if (lastWithdrawal && (now - lastWithdrawal) < WITHDRAWAL_COOLDOWN_MS) {
            const remainingSeconds = Math.ceil((WITHDRAWAL_COOLDOWN_MS - (now - lastWithdrawal)) / 1000);
            await bot.editMessageText(`⏳ **Подождите ${remainingSeconds} сек. перед следующей заявкой**\n\n🛡 Защита от случайных повторных нажатий`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Set cooldown immediately to prevent duplicates
        withdrawalCooldowns.set(userId, now);

        // Auto-cleanup cooldown after expiry
        setTimeout(() => {
            withdrawalCooldowns.delete(userId);
        }, WITHDRAWAL_COOLDOWN_MS);

        const user = await db.getUser(userId);

        if (!user) {
            await bot.editMessageText('❌ пользователь не найден.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        if (user.referrals_count < 5) {
            await bot.editMessageText('❌ Для вывода средств требуется минимум 5 рефералов!', {
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
            await bot.editMessageText('❌ Неверный тип вывода.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        // Проверка баланс��
        if (parseFloat(user.balance) < amount) {
            await bot.editMessageText('❌ Недостаточно звёзд для вывода!', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
            return;
        }

        try {
            // Use transaction to ensure atomicity
            await db.executeQuery('BEGIN');

            // Double-check balance in transaction to prevent race conditions
            const currentUser = await db.executeQuery(
                'SELECT balance FROM users WHERE id = $1 FOR UPDATE',
                [userId]
            );

            if (parseFloat(currentUser.rows[0].balance) < amount) {
                await db.executeQuery('ROLLBACK');
                await bot.editMessageText('Недостаточно звёзд для вывода!', {
                    chat_id: chatId,
                    message_id: messageId,
                    ...getBackToMainKeyboard()
                });
                return;
            }

            // Создание заявки на вывод
            const withdrawalResult = await db.executeQuery(
                'INSERT INTO withdrawal_requests (user_id, amount, type) VALUES ($1, $2, $3) RETURNING id',
                [userId, amount, type]
            );
            const withdrawalId = withdrawalResult.rows[0].id;

            // Списание средств с баланса
            await db.updateUserBalance(userId, -amount);

            // Commit transaction
            await db.executeQuery('COMMIT');

            console.log(`[WITHDRAWAL] Transaction completed successfully: User ${userId}, Amount ${amount}, ID ${withdrawalId}`);

            // Подготовка сообщения для ад��ина
            const cleanName = cleanDisplayText(user.first_name);
            const adminMessage = `**Новая заявка на вывод**

👤 **Пользователь:** ${cleanName}
🆔 **ID:** ${user.id}
${user.username ? `📱 **Username:** @${user.username}` : ''}
🔗 **Ссылка:** [Открыть профиль](tg://user?id=${user.id})

💰 **Сумма:** ${amount} ⭐
📦 **Тип:** ${type === 'premium' ? 'Telegram Premium на 3 месяца' : 'Звёзды'}
💎 **Баланс после вывода:** ${(parseFloat(user.balance) - amount).toFixed(2)} ⭐`;

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

            // ОСТ��ВЛЯЕМ: Отправка уведомления в админский кана��
            try {
                await bot.sendMessage(ADMIN_CHANNEL, adminMessage, {
                    parse_mode: 'Markdown',
                    ...adminKeyboard
                });
            } catch (adminError) {
                console.error('[WITHDRAWAL] Error sending to admin channel:', adminError.message);
                // Не останавливаем процесс, ��с��и админский канал недоступен
                // ��аявка у��е создана и средст��а с��исаны
            }

            // Уведомление поль���ователя об успехе
            await bot.editMessageText('✅ Заявка на вывод отправлена! Ожидайте обработки.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });

            console.log(`[WITHDRAWAL] Request created: User ${userId}, Amount ${amount}, Type ${type}, ID ${withdrawalId}`);

        } catch (error) {
            console.error('[WITHDRAWAL] Error processing withdrawal:', error);

            // Rollback transaction on error
            try {
                await db.executeQuery('ROLLBACK');
                console.log('[WITHDRAWAL] Transaction rolled back due to error');
            } catch (rollbackError) {
                console.error('[WITHDRAWAL] Error during rollback:', rollbackError);
            }

            await bot.editMessageText('❌ Ошибка обработки заявки. Попробуйте позже.', {
                chat_id: chatId,
                message_id: messageId,
                ...getBackToMainKeyboard()
            });
        }

    } catch (error) {
        console.error('[WITHDRAWAL] Main error:', error?.message || error);

        await bot.editMessageText('❌ Произошла ошибка. Попробуйте позже.', {
            chat_id: chatId,
            message_id: messageId,
            ...getBackToMainKeyboard()
        });
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
Подписки на канал **${task.channel_name || task.channel_id}**

💰 **Награда за выполнение:** ${task.reward} ���
📊 **Прогресс:** ${completedTasks.length}/${allTasks.length} заданий выполнено

📖 **Инструкция:**
1. Нажмите "Подписаться" для перехода к каналу
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
                await bot.editMessageText('Вы не подписаны на канал! Подпишитесь и попробуйте снова.', {
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
                    await bot.editMessageText('❌ **Лимит выполнений достигнут!**\n\nЭто заданий больше недоступно для выполнения.\n\nпопробуйте другие задания!', {
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
                        await bot.editMessageText(`✅ **Задание выполнено!**\n\nВы получили **${task.reward} ⭐**\n\n💰 Награда зачислена на баланс!\n\n⚠ *Канал недоступен для проверки*`, {
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
                        await bot.editMessageText(' **Лимит выполнений достигнут!**\n\nЭто задание больше недоступно для выполнения.', {
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

        const message = `➡️ **Следующее задание**

 **Задание:**
Подписка на канал **${nextTask.channel_name || nextTask.channel_id}**

🌟 **Награда за выполнение:** ${nextTask.reward} ⭐
📊 **Прогресс:** ${completedTasks.length}/${allTasks.length + completedTasks.length} заданий выполнено

📖 **Инструкция:**
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

🎯 **Как зарабатывать звёзды:**

1 **Кликер** - нажимайте каждый день и получайте 0.1 ⭐
2 **Задания** - подписывайтесь на каналы за награды
3 **Рефералы** - приглашайте друзей и получайте 3 ⭐ за каждого
4 **Кейсы** - открывайте кейсы с призами (нужно 3+ рефералов в день)
5 **Лотерея** - участвуйте в розыгрышах

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
            message += '\n👥 Приглашайте друзей и поднимайтесь в рейтинге!';
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: undefined, // Убираем Markdown для безопасност��
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
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥈' : `${index + 1}.`;
                const safeName = cleanDisplayText(user.first_name);
                message += `${medal} ${safeName} - ${user.referrals_count} рефералов\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: undefined, // Убираем Markdown для ��езопасн��сти
            ...getBackToMainKeyboard()
        });
    } catch (error) {
        console.error('Error in ratings week:', error);
        await bot.editMessageText('❌ Ошибка загрузки рйтинга.', {
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

            message += '\n📈 **Как заработать очки:**\n';
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

❌ **Вы уже открыли кейс сегодня!**

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

💰 **ваш баланс:** ${user.balance + reward} ⭐

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
            message += `📈 Цена билета: ${lottery.ticket_price} ⭐\n`;
            message += `🎯 Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
            message += `🏆 Победителей: ${lottery.winners_count}\n`;

            if (hasPurchased) {
                message += `✅ **Ваш билет куплен!**\n\n`;
            } else {
                message += `\n`;
                if (lottery.current_tickets >= lottery.max_tickets) {
                    keyboards.push([{ text: `🚫 ${lottery.name} - ПРОДАНО`, callback_data: 'lottery_sold_out' }]);
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
                message += `📋 Условие: пригласить ${refLottery.required_referrals} рефералов\n`;
                message += `💰 Доп. билет: ${refLottery.additional_ticket_price} 🎫\n`;
                message += `🎫 Ваши билеты: ${totalTickets}\n`;

                if (participant && participant.qualified) {
                    message += `✅ Условие выполнено!\n\n`;
                    keyboards.push([{ text: `🎫 Купить доп. билет - ${refLottery.name}`, callback_data: `ref_lottery_buy_${refLottery.id}` }]);
                } else {
                    message += `❌ Пригласите ${refLottery.required_referrals} рефералов для участия\n\n`;
                    keyboards.push([{ text: `👥 Проверить условие - ${refLottery.name}`, callback_data: `ref_lottery_check_${refLottery.id}` }]);
                }

            } else if (refLottery.lottery_type === 'referral_auto') {
                message += `👥 **${refLottery.name}** (авто-реферальная)\n`;
                message += `⏰ Остал��сь: ${hoursLeft} часов\n`;
                message += `🎫 Билеты за рефералов: ${totalTickets}\n`;
                message += `📋 каждый новый реферал = +1 билет\n\n`;

                keyboards.push([{ text: `👥 пригласить друзей - ${refLottery.name}`, callback_data: 'invite' }]);
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
            await bot.editMessageText('❌ Все би��еты в лотерею проданы!', {
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
            await bot.editMessageText('❌ Заявка на вывод не найдена или уже обработана.', {
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

✅ **Ваша заявка на вывод обмена!**

💰 **Сумма:** ${typeDisplay}

🎯 **Награда уже выплачена!** Спасибо за использование нашего бота!

👥 Продолжайте приглашать друзей и зарабатывать еще больше!`;

        await sendThrottledMessage(targetUserId, congratsMessage, { parse_mode: 'Markdown' });
        console.log('[WITHDRAWAL] Congratulations sent to user');

        // Update admin message
        const completedCount = await db.getCompletedWithdrawalsCount();
        await bot.editMessageText(`✅ **Заявка одобрена** (#${completedCount})

👤 Пользователь: ${cleanDisplayText(user.first_name)}
💰 Сумма: ${typeDisplay}

✅ Пользователь уведомлен об одобрении.
   Уведомление отправлено в канал платежей.`, {
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

✏ **Напишите причину отклонения:**`, {
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
    if (msg.text && !msg.text.startsWith('/') && !msg.from.is_bot) {
        const userId = msg.from.id;
        const chatId = msg.chat.id;

        try {
            console.log(`[MESSAGE] Received text message from user ${userId}: "${msg.text}"`);

            // Check if this message should be handled by broadcast handler
            let user = await db.getUser(userId);
            if (user && user.temp_action === 'waiting_broadcast_message' && isAdmin(userId)) {
                return; // Let the second handler process this
            }

            // Check if user has active captcha session
            if (captchaSystem.hasActiveSession(userId)) {
                console.log(`[MESSAGE] User ${userId} has active captcha session, processing answer: "${msg.text}"`);
                const result = captchaSystem.verifyAnswer(userId, msg.text);
                console.log(`[MESSAGE] Captcha verification result:`, result);

                if (result.success) {
                    // Captcha passed - update database and send success message
                    await db.setCaptchaPassed(userId, true);

                    // Check for retroactive referral activation after captcha
                    try {
                        const retroResult = await db.activateRetroactiveReferral(userId);
                        if (retroResult.success) {
                            // Send notification to referrer about retroactive activation
                            try {
                                const userInfo = await db.getUser(userId);
                                const message = `🔄 **Возврат звёзд!**

👤 Ваш реферал **${userInfo.first_name}** активировался:
✅ Прошёл капчу
✅ Подписался на все кан��лы

💰 **Возвращены:** +3 ⭐
💎 **За активного реферала!**

🎯 Теперь этот реферал засчитывается полностью!`;

                                await bot.sendMessage(retroResult.referrerId, message, {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [
                                            [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                            [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                                        ]
                                    }
                                });
                            } catch (error) {
                                console.error('Error sending retroactive activation notification:', error);
                            }
                        }
                    } catch (error) {
                        console.error('Error checking retroactive activation after captcha:', error);
                    }

                    await bot.sendMessage(chatId, `${result.message}

🎉 Теперь вы можете пользоваться ботом! Нажмите /start для продолжения.`, {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🚀 Начать', callback_data: 'restart_after_captcha' }]
                            ]
                        }
                    });
                } else {
                    // Wrong answer or no attempts left
                    if (result.shouldRestart) {
                        // Generate new captcha
                        const newQuestion = captchaSystem.generateCaptcha(userId);
                        await bot.sendMessage(chatId, `${result.message}

🔄 **Новый пример:**
**${newQuestion}**

💡 Введите только число (например: 26)`, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '🔄 Новый прмер', callback_data: 'new_captcha' }]
                                ]
                            }
                        });
                    } else {
                        // Still has attempts
                        const currentQuestion = captchaSystem.getCurrentQuestion(userId);
                        await bot.sendMessage(chatId, `${result.message}

Попробуйте еще раз:
**${currentQuestion}**

💡 Введите только число (например: 18)`, {
                            parse_mode: 'Markdown'
                        });
                    }
                }
                return; // Don't process other message handlers
            }

            // Check userStates for admin interactions
            if (userStates.has(userId)) {
                const state = userStates.get(userId);
                if (state.state === 'waiting_reject_all_reason') {
                    const customReason = msg.text.trim();
                    userStates.delete(userId);

                    // Execute rejection with custom reason
                    await executeRejectAllWithdrawals(state.chatId, state.messageId, userId, customReason);
                    return;
                }
            }

            // User already declared above as let, so we can just reassign
            user = await db.getUser(userId);

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
                    const rejectionTitle = rejectedWithdrawalId ? `❌ **Заявка на вывод #${rejectedWithdrawalId} отклонена**` : `❌ **Заявка на в��вод отклонена**`;
                    const rejectionMessage = `${rejectionTitle}

 **Сумма:** ${typeDisplay}

📝 **Причина отклонения:**
${rejectionReason}

💸 **Средства возвращены на баланс.**

Если у вас есть вопросы, обратитесь к администрации.`;

                    await sendThrottledMessage(targetUserId, rejectionMessage, { parse_mode: 'Markdown' });
                    console.log('[REJECTION] Rejection message sent to user');

                    // Confirm to admin
                    const adminTitle = rejectedWithdrawalId ? `**Заявка #${rejectedWithdrawalId} ��тклонена**` : `✅ **Заявка отклонена**`;
                    await bot.sendMessage(chatId, `${adminTitle}

👤 Пользователь: ${cleanDisplayText(targetUser.first_name)}
💰 Сумма: ${typeDisplay}
📝 Причина: ${rejectionReason}

✅ Пользователю отправлено уведомление.
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
🎰 **/endlottery [ID]** - завершить лотерею ��ручную
👥 **/refupplayer [ID] [число]** - добавить рефералов пользователю
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

// Admin withdrawals management
async function handleAdminWithdrawals(chatId, messageId) {
    try {
        // Get withdrawal statistics
        const pendingWithdrawals = await db.getAllPendingWithdrawals();
        const completedCount = await db.getCompletedWithdrawalsCount();

        // Calculate total amount in pending withdrawals
        const totalPendingAmount = pendingWithdrawals.reduce((sum, w) => sum + parseFloat(w.amount), 0);

        const message = `💸 **Управление выводом звёзд**

📊 **Статистика:**
• Ожидающих обработки: ${pendingWithdrawals.length}
• Общая сумма в ожидании: ${totalPendingAmount.toFixed(2)} ⭐
• Всего выполнено: ${completedCount}

🔧 **Доступные действия:**`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📋 Список заявок', callback_data: 'admin_withdrawal_list' },
                        { text: '❌ Отклонить все', callback_data: 'admin_withdrawal_reject_all' }
                    ],
                    [
                        { text: '📊 Статистика', callback_data: 'admin_withdrawal_stats' },
                        { text: '🔄 Обновить', callback_data: 'admin_withdrawals' }
                    ],
                    [
                        { text: '🔙 Админ панель', callback_data: 'admin_menu' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin withdrawals:', error);
        await bot.editMessageText('❌ Ошибка загрузки управления выводом.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'admin_menu' }]] }
        });
    }
}

// Admin function to reject all pending withdrawals
async function handleAdminWithdrawalRejectAll(chatId, messageId) {
    try {
        const message = `⚠️ **Массовое отклонение заявок**

❗ Вы действительно хотите отклонить ВСЕ ожидающие заявки на вывод?

💰 Звёзды будут возвращены пользователям
📩 Всем будет отправлено уведомление

✍️ Укажите причину отклонения:`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🚫 Технические работы', callback_data: 'reject_all_technical' },
                        { text: '⚠️ Нарушение правил', callback_data: 'reject_all_violation' }
                    ],
                    [
                        { text: '📝 Кастомная причина', callback_data: 'reject_all_custom' },
                        { text: '💳 Проблемы �� платежами', callback_data: 'reject_all_payment' }
                    ],
                    [
                        { text: '◀️ Назад', callback_data: 'admin_withdrawals' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in withdrawal reject all:', error);
        await bot.editMessageText('❌ Ошибка.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_withdrawals' }]] }
        });
    }
}

// Admin function to list pending withdrawals
async function handleAdminWithdrawalList(chatId, messageId) {
    try {
        const pendingWithdrawals = await db.getAllPendingWithdrawals();

        if (pendingWithdrawals.length === 0) {
            await bot.editMessageText('📋 **Список заявок на вывод**\n\n✅ Нет ожидающих заявок!', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_withdrawals' }]]
                }
            });
            return;
        }

        let message = `📋 **Заявки на вывод** (${pendingWithdrawals.length})\n\n`;

        pendingWithdrawals.slice(0, 10).forEach((withdrawal, index) => {
            const date = new Date(withdrawal.created_at).toLocaleDateString('ru-RU');
            message += `${index + 1}. **${withdrawal.first_name || 'Неизвестен'}** (@${withdrawal.username || 'нет'})\n`;
            message += `   💰 ${withdrawal.amount} ⭐ | 📅 ${date}\n`;
            message += `   🎯 Тип: ${withdrawal.type}\n\n`;
        });

        if (pendingWithdrawals.length > 10) {
            message += `\n... и ещё ${pendingWithdrawals.length - 10} заявок`;
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔄 Обновить', callback_data: 'admin_withdrawal_list' },
                        { text: '❌ Отклонить все', callback_data: 'admin_withdrawal_reject_all' }
                    ],
                    [
                        { text: '🔙 Назад', callback_data: 'admin_withdrawals' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in withdrawal list:', error);
        await bot.editMessageText('❌ Ошибка загрузки списка заявок.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_withdrawals' }]] }
        });
    }
}

// Admin function to show withdrawal statistics
async function handleAdminWithdrawalStats(chatId, messageId) {
    try {
        const pendingWithdrawals = await db.getAllPendingWithdrawals();
        const completedCount = await db.getCompletedWithdrawalsCount();

        // Group by type
        const typeStats = {};
        let totalPending = 0;

        pendingWithdrawals.forEach(w => {
            const type = w.type;
            if (!typeStats[type]) {
                typeStats[type] = { count: 0, amount: 0 };
            }
            typeStats[type].count++;
            typeStats[type].amount += parseFloat(w.amount);
            totalPending += parseFloat(w.amount);
        });

        let message = `📊 **Статистика выводов**\n\n`;
        message += `💰 **Общая статистика:**\n`;
        message += `• Ожидающих: ${pendingWithdrawals.length} заявок\n`;
        message += `• Сумма в ожидании: ${totalPending.toFixed(2)} ⭐\n`;
        message += `• Всего выполнено: ${completedCount}\n\n`;

        if (Object.keys(typeStats).length > 0) {
            message += ` **По типам:**\n`;
            for (const [type, stats] of Object.entries(typeStats)) {
                const typeEmoji = type === 'stars' ? '⭐' : type === 'crypto' ? '₿' : type === 'premium' ? '💎' : '💳';
                message += `${typeEmoji} ${type}: ${stats.count} (${stats.amount.toFixed(2)} ⭐)\n`;
            }
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔄 Обновить', callback_data: 'admin_withdrawal_stats' },
                        { text: '📋 Список заявок', callback_data: 'admin_withdrawal_list' }
                    ],
                    [
                        { text: '🔙 Назад', callback_data: 'admin_withdrawals' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in withdrawal stats:', error);
        await bot.editMessageText('❌ Ошибка загрузки статистики.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_withdrawals' }]] }
        });
    }
}

// Execute mass rejection of all pending withdrawals
async function executeRejectAllWithdrawals(chatId, messageId, adminId, reason) {
    try {
        // Show processing message
        await bot.editMessageText('⏳ **Обработка массового отклонения...**\n\nПожалуйста, подождите...', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });

        // Get all pending withdrawals before rejecting
        const pendingWithdrawals = await db.getAllPendingWithdrawals();

        if (pendingWithdrawals.length === 0) {
            await bot.editMessageText('ℹ️ **Нет заявок для отклонения**\n\nВсе заявки уже обработаны.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_withdrawals' }]] }
            });
            return;
        }

        // Execute mass rejection
        const result = await db.rejectAllPendingWithdrawals(adminId, reason);

        if (result.success) {
            // Update message to show notification progress
            await bot.editMessageText(`✅ **Заявки отклонены успешно**\n\n📬 **Отправка уведомлений пользователям...**\n⏳ Это может занять некоторое время`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown'
            });

            // Send notifications to all affected users with intervals
            let notificationsSent = 0;
            const failedNotifications = [];
            const totalUsers = pendingWithdrawals.length;

            console.log(`[MASS_REJECT] Starting to send ${totalUsers} notifications with 1 second intervals`);

            for (let i = 0; i < pendingWithdrawals.length; i++) {
                const withdrawal = pendingWithdrawals[i];

                try {
                    await sendThrottledMessage(withdrawal.user_id,
                        `❌ **Заявка на вывод отклонена**\n\n` +
                        `💰 **Сумма:** ${withdrawal.amount} ��\n` +
                        `📅 **Д��та по��ачи:** ${new Date(withdrawal.created_at).toLocaleDateString('ru-RU')}\n` +
                        `📝 **Причина:** ${reason}\n\n` +
                        `✅ Звёзды возвращены на ва�� баланс`,
                        { parse_mode: 'Markdown' }
                    );
                    notificationsSent++;
                    console.log(`[MASS_REJECT] Notification sent to user ${withdrawal.user_id} (${notificationsSent}/${totalUsers})`);
                } catch (notifyError) {
                    console.error(`Failed to notify user ${withdrawal.user_id}:`, notifyError);
                    failedNotifications.push(withdrawal.user_id);
                }

                // Add delay between notifications (1 second) to prevent rate limiting
                if (i < pendingWithdrawals.length - 1) {
                    console.log(`[MASS_REJECT] Waiting 1 second before next notification...`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            console.log(`[MASS_REJECT] Finished sending notifications. Sent: ${notificationsSent}, Failed: ${failedNotifications.length}`);

            // Show success message
            let successMessage = `✅ **Массов��е отклонение выполнено**\n\n`;
            successMessage += `📊 **Результат:**\n`;
            successMessage += `• От��лонено за��вок: ${result.count}\n`;
            successMessage += `• Уведомлений отправлено: ${notificationsSent}\n`;

            if (failedNotifications.length > 0) {
                successMessage += `⚠️ Не удалось уведомить: ${failedNotifications.length} пользователей\n`;
            }

            successMessage += `\n📝 **Причина:** ${reason}`;

            await bot.editMessageText(successMessage, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📊 ��т��тистика', callback_data: 'admin_withdrawal_stats' },
                            { text: '🔄 Обновить', callback_data: 'admin_withdrawals' }
                        ],
                        [
                            { text: '🔙 Управление выводом', callback_data: 'admin_withdrawals' }
                        ]
                    ]
                }
            });

        } else {
            await bot.editMessageText(`❌ **Ошибк�� при отклонении заявок**\n\n${result.message || 'Неизвест��ая ошибка'}`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Н��зад', callback_data: 'admin_withdrawals' }]] }
            });
        }

    } catch (error) {
        console.error('Error in execute reject all withdrawals:', error);
        await bot.editMessageText('❌ **Критическая ошибка**\n\nНе ��далось выполнить массо��ое отклонение.', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Наза��', callback_data: 'admin_withdrawals' }]] }
        });
    }
}

// Tracking links system
bot.onText(/\/create_tracking_link (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас н��т прав доступа.');
        return;
    }

    try {
        const linkName = match[1].trim();

        if (!linkName) {
            bot.sendMessage(chatId, '❌ укажите название ссылки! Ис��ользуйте: /create_tracking_link Название_р��кла��ы');
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

        const message = `✅ **��рекин��овая ссылка создана!**

📝 **Названи��:** ${linkName}
🔗 **Ссылка:** \`${trackingLink}\`
🆔 **ID:** \`${trackingId}\`

📊 **Статистика:** /tracking_stats ${trackingId}
📋 **Все ссылки:** /list_tracking`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        console.log(`[TRACKING] Created tracking link: ${trackingId} for ${linkName}`);

    } catch (error) {
        console.error('Error creating tracking link:', error);
        bot.sendMessage(chatId, `❌ ��шибка соз��ания ссылки: ${error.message}`);
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
            bot.sendMessage(chatId, '📋 **Трекинговых ссылок пока ��ет.**\n\n Создайте с����ылку: /create_tracking_link название', { parse_mode: 'Markdown' });
            return;
        }

        let message = '📋 **Сп����о�� тр��кинговых ссылок**\n\n';

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
        bot.sendMessage(chatId, `❌ Ошибк�� загрузки ��писка: ${error.message}`);
    }
});

// Tracking stats
bot.onText(/\/tracking_stats (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет прав до��тупа.');
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
            bot.sendMessage(chatId, '❌ трени�����говая ссылка не найдена.');
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

        const message = `📊 **Статистика трекинговой ссылки**\n\n📝 **Название:** ${link.name}\n🆔 **ID:** \`${trackingId}\`\n📅 **Создана:** ${createdDate}\n\n📈 **Статистика:**\n👥 В��его переходо��: **${stats.total_clicks || 0}**\n ��никальных по��ьзователей: **${stats.unique_users || 0}**\n⏰ З�� последние 24 ч��са: **${recentStats.recent_clicks || 0}**\n\n🔗 **Сс��лка:** \`https://t.me/YOUR_BOT?start=${trackingId}\``;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error getting tracking stats:', error);
        bot.sendMessage(chatId, `❌ Ошибка заг��узки статистики: ${error.message}`);
    }
});

// Admin delete commands
bot.onText(/\/delete_task (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет ��рав доступа.');
        return;
    }

    try {
        const taskId = parseInt(match[1]);
        const result = await db.executeQuery('DELETE FROM tasks WHERE id = $1', [taskId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Задание �� ID ${taskId} удалено!`);
        } else {
            bot.sendMessage(chatId, `��� Задание с ID ${taskId} не найд��но.`);
        }
    } catch (error) {
        console.error('Error deleting task:', error);
        bot.sendMessage(chatId, '�� Ошибка удаления зад��ни��.');
    }
});

bot.onText(/\/delete_channel (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас не�� прав д��ступа.');
        return;
    }

    try {
        const channelId = parseInt(match[1]);
        const result = await db.executeQuery('DELETE FROM required_channels WHERE id = $1', [channelId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Кан��л с ID ${channelId} удален!`);
        } else {
            bot.sendMessage(chatId, `❌ ��анал с ID ${channelId} не найден.`);
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
            bot.sendMessage(chatId, `❌ Нельз�� удалить лотерею с ID ${lotteryId} - в ней ест�� уча��тники! ��начала завершит�� лотер��ю ��оманд���� /endlottery ${lotteryId}`);
            return;
        }

        const result = await db.executeQuery('DELETE FROM lotteries WHERE id = $1', [lotteryId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Ло��ерея с ID ${lotteryId} у��алена!`);
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
            bot.sendMessage(chatId, '❌ Пустое сообщение! Используйт��: /custom_broadcast Ваше сообщение');
            return;
        }

        // Get all users
        const users = await db.executeQuery('SELECT id FROM users');
        const totalUsers = users.rows.length;
        let successCount = 0;
        let failCount = 0;

        // Send confirmation
        const confirmMsg = await bot.sendMessage(chatId, `📤 **��а��инаю рассылку...**\n\n👥 ��ользователей: ${totalUsers}\n Прогресс: 0%`);

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
                    await bot.editMessageText(`📤 **Ра��сыл��а в процессе...**\n\n👥 Пользователей: ${totalUsers}\n��� Отправлено: ${successCount}\n��� Ошибок: ${failCount}\n⏳ прогресс: ${progress}%`, {
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
        await bot.editMessageText(`��� **Рассы��ка ��авершена!**\n\n👥 Всего пользователе��: ${totalUsers}\n✅ Успешно отправлено: ${successCount}\n❌ Ошибок: ${failCount}\n📊 Успешность: ${Math.round(successCount/totalUsers*100)}%`, {
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

        const message = `✏��� **Создать свою рассылку**

📝 **Отправ��те ваше сообщение следующим с��обще��ие��.**

Бот буд��т ждать ваше сообщение и разошлет его всем пользо����телям.

⚠️ **Внимание:** Рассылка будет ����прав���ена сразу пос��е получения ��ообщения!

���� **Поддер��ивается Markdown-форматирование**`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '����� Отменить', callback_data: 'cancel_broadcast' }],
                    [{ text: '��� Назад к рассы���ке', callback_data: 'admin_broadcast' }]
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
        bot.sendMessage(chatId, '❌ ���� вас нет прав доступа.');
        return;
    }

    try {
        const promoId = parseInt(match[1]);
        const result = await db.executeQuery('DELETE FROM promocodes WHERE id = $1', [promoId]);

        if (result.rowCount > 0) {
            bot.sendMessage(chatId, `✅ Промокод с ID ${promoId} ��дален!`);
        } else {
            bot.sendMessage(chatId, `❌ Промокод с ID ${promoId} не ���айден.`);
        }
    } catch (error) {
        console.error('Error deleting promocode:', error);
        bot.sendMessage(chatId, '�� Ошибка удаления промокода.');
    }
});

// Daily reset cron job
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running daily reset...');
    try {
        await db.resetDailyData();
        console.log('✅ Daily reset completed successfully');
    } catch (error) {
        console.error('�� Critical error in daily reset:', error);
        // Send alert to admin if possible
        try {
            await bot.sendMessage(ADMIN_CHANNEL, ` **Ошиб����а сброса данных**\n\nОшибка: ${error.message}\nВремя: ${new Date().toLocaleString('ru-RU')}`, { parse_mode: 'Markdown' });
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
                return { success: false, message: 'Нет ��ктивных польз��ва��елей с очками за эту неделю' };
            }
            return;
        }

        const rewards = [100, 75, 50, 25, 15]; // Stars for positions 1-5
        const positions = ['🥇', '���', '🥉', '4️⃣', '5️⃣'];

        let rewardMessage = '🏆 **��женедельные награды!**\n\n📅 **Т��п-5 пользов��тел��й по очкам за неделю:**\n\n';

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
                const personalMessage = `🎉 **Поздр��вляем!**\n\n${position} **Вы заняли ${i + 1} место в недельном рейтинге по очкам!**\n\n⭐ **��чко�� за неделю:** ${user.weekly_points}\n💰 **Награда:** +${reward} ⭐\n\n🎯 Отличная работ��! Продолжайте активность!`;

                await sendThrottledMessage(user.id, personalMessage, { parse_mode: 'Markdown' });
                console.log(`[WEEKLY-REWARDS] Reward sent to ${user.first_name}: ${reward} stars`);
            } catch (error) {
                console.error(`[WEEKLY-REWARDS] Failed to notify user ${user.id}:`, error);
            }
        }

        rewardMessage += '\n🎯 **Увидимся на следую��ей неделе!**';

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
            return { success: true, message: `Награды распределены ��ежду ${users.length} пользователями`, users: users.length };
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

        let rewardMessage = '🏆 **Еженедельные награды!**\n\n📅 **Топ-5 пользователей по рефер��лам за неделю:**\n\n';

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
                const personalMessage = `🎉 **Поздра��ляем!**\n\n${position} **Вы заняли ${i + 1} место в недельном ��ейтинге!**\n\n👥 **Реферал��в за неделю:** ${user.referrals_today}\n💰 **Награда:** +${reward} ⭐\n\n🎯 Отличная работ��! продолжайте при��лашать друзей!`;

                await sendThrottledMessage(user.id, personalMessage, { parse_mode: 'Markdown' });
                console.log(`[WEEKLY-REWARDS] Reward sent to ${user.first_name}: ${reward} stars`);
            } catch (error) {
                console.error(`[WEEKLY-REWARDS] Failed to notify user ${user.id}:`, error);
            }
        }

        rewardMessage += '\n�� **Увидимся на следующей неделе!**';

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
        const status = settings.auto_rewards_enabled ? '✅ Включ��ны' : ' Отклю����ны';
        const lastManual = settings.last_manual_trigger ?
            new Date(settings.last_manual_trigger).toLocaleString('ru-RU') : 'Никогда';

        const message = `🏆 **Управление недельным�� награда��и**

������ **Теку��ее состояние:**
🔄 Автоматические награды: ${status}
⏰ Время запуска: Воскресенье 20:00 МСК
📅 Посл��дний ручной зап������ск: ${lastManual}

💡 **Ситтема очков:**
��� Акт��вация бо���� - 1 очко
• ��аж��ый клик - 1 очко
• Выполне��ное зада���ие - 2 очка
• Покупка лотерейного билета - 1 очко
• ��риглашен��ый ��еферал - 1 ����чко

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
                            text: settings.auto_rewards_enabled ? '🔴 Отключить авто' : '�� Включить авто',
                            callback_data: settings.auto_rewards_enabled ? 'admin_weekly_disable' : 'admin_weekly_enable'
                        },
                        { text: '🎯 Запустит�� сейчас', callback_data: 'admin_weekly_trigger' }
                    ],
                    [
                        { text: '⭐ Текущий ��ейтинг', callback_data: 'ratings_week_points' }
                    ],
                    [
                        { text: '🏠 Админ панел��', callback_data: 'admin_menu' }
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
        await bot.editMessageText('❌ Ошибка за��рузки управле��ия неде��ьными наградами.', {
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
        bot.sendMessage(chatId, '❌ У вас нет прав доступа.');
        return;
    }

    try {
        const settings = await db.getWeeklyRewardsSettings();
        const users = await db.getWeeklyTopUsers(5);

        let message = `🏆 **Стату�� недельных н��г����ад**\n\n`;
        message += `�� **��втоматичес��ие наг��ады:** ${settings.auto_rewards_enabled ? '✅ Включен��' : '❌ Отк��ючены'}\n`;
        message += `📅 **Последний ручной запуск:** ${settings.last_manual_trigger ? new Date(settings.last_manual_trigger).toLocaleString('ru-RU') : 'Никог��а'}\n\n`;

        message += `📊 **Текущ��й топ-5 по очкам:**\n`;
        if (users.length === 0) {
            message += 'Пок�� нет активных пользо��ател��й\n';
        } else {
            users.forEach((user, i) => {
                const pos = i + 1;
                const emoji = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '��' : `${pos}.`;
                message += `${emoji} ${cleanDisplayText(user.first_name)} - ${user.weekly_points} оч��ов\n`;
            });
        }

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Error in weekly rewards status:', error);
        bot.sendMessage(chatId, '❌ Ош��бка получе��ия с��атуса наград.');
    }
});

bot.onText(/\/weekly_rewards_enable/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ �� ��ас нет прав доступа.');
        return;
    }

    try {
        await db.updateWeeklyRewardsSettings(true);
        bot.sendMessage(chatId, '✅ Автоматические недельные награды включены!');
    } catch (error) {
        console.error('Error enabling weekly rewards:', error);
        bot.sendMessage(chatId, '❌ Ошибка включения ��аград.');
    }
});

bot.onText(/\/weekly_rewards_disable/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет ��рав доступа.');
        return;
    }

    try {
        await db.updateWeeklyRewardsSettings(false);
        bot.sendMessage(chatId, '❌ Автоматические недельные награды отключены!');
    } catch (error) {
        console.error('Error disabling weekly rewards:', error);
        bot.sendMessage(chatId, '���� Ошибка ��тключения наград.');
    }
});

bot.onText(/\/weekly_rewards_trigger/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '�� У вас нет пра��� доступ��.');
        return;
    }

    try {
        bot.sendMessage(chatId, '🏆 Запускаю распределе��ие нед��льных наград...');

        const result = await distributeWeeklyRewards(true);

        if (result.success) {
            bot.sendMessage(chatId, `✅ ${result.message}!\n\n🎯 Очки пользователей сбро��ены, новая неделя началась.`);
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
        bot.sendMessage(chatId, '❌ У вас н��т прав доступа.');
        return;
    }

    try {
        const targetUserId = parseInt(match[1]);
        const amount = parseInt(match[2]);

        bot.sendMessage(chatId, `🤖 Добавляем в очередь агента: ${amount} звёзд д��я польз��вателя ${targetUserId}...`);

        // Автоотправка Stars Agent отключе��а - требуется ручная обработка
        const result = { success: false, error: 'Stars Agent отк��ючен, только ручная обработка' };

        if (result.success) {
            bot.sendMessage(chatId, `✅ Задани�� добавлено в очередь агента!\n\n🎯 ${amount} звёзд будут отпра��лены пол��зователю ${targetUserId} автоматически.`);
        } else {
            bot.sendMessage(chatId, `❌ Ошибка: ${result.error}`);
        }

    } catch (error) {
        console.error('Error manual stars send:', error);
        bot.sendMessage(chatId, '❌ Ошибка д��бавления задания.');
    }
});

// Команд�� для обработки старых зая��ок на вывод
bot.onText(/\/process_old_withdrawals/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас нет пр��в доступа.');
        return;
    }

    try {
        // Найти все pending заявки на вывод
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

        let message = `📋 **Найдено ${oldWithdrawals.rows.length} старых заявок на вывод**\n\n`;
        let processedCount = 0;
        let skippedCount = 0;

        for (const withdrawal of oldWithdrawals.rows) {
            try {
                // Получить информа���ию о п��льзователе
                const user = await db.getUser(withdrawal.user_id);
                if (!user) {
                    skippedCount++;
                    continue;
                }

                const cleanName = cleanDisplayText(user.first_name);

                // Автомат��чески о��рабатывать звёзды ��о 200
                if (withdrawal.type === 'stars' && withdrawal.amount <= 200) {
                    // Автоотправка Stars Agent отключена
                    const result = { success: false, error: 'Stars Agent отключен, только ����чная обработка' };

                    if (result.success) {
                        message += `✅ ${cleanName} - ${withdrawal.amount}⭐ (автомат)\n`;
                        processedCount++;
                    } else {
                        message += `⚠️ ${cleanName} - ${withdrawal.amount}⭐ (ошибка: ${result.error})\n`;
                        skippedCount++;
                    }
                } else {
                    message += `🔶 ${cleanName} - ${withdrawal.amount}⭐ (требует ручно�� обрабо��ки)\n`;
                    skippedCount++;
                }

                // Пауза между обрабо��ками
                if (processedCount > 0 && processedCount % 3 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

            } catch (error) {
                console.error('Error processing old withdrawal:', error);
                skippedCount++;
            }
        }

        message += `\n📊 **Итого:**\n`;
        message += `✅ Обработано а��томатически: ${processedCount}\n`;
        message += `🔶 Требуют р��чной о��работки: ${skippedCount}\n`;
        message += `\n�� Крупные сумм������ и Premium подпис��и обрабатывайте вручную через кнопки в уведомлен��ях.`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error processing old withdrawals:', error);
        bot.sendMessage(chatId, '❌ Ошибка обработки старых заявок.');
    }
});

// Команда для изменения лимитов аг��нта
bot.onText(/\/agent_limits(?:\s+(\d+)\s+(\d+)\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        bot.sendMessage(chatId, '❌ У вас н��т прав доступа.');
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
            bot.sendMessage(chatId, '❌ Дневной лимит дол��ен быть от 10 до 1000 звёзд.');
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
            bot.sendMessage(chatId, '❌ Часовой ��имит не может быть больше дневного.');
            return;
        }

        // Обновить ли��иты в агенте
        const { execSync } = require('child_process');
        const updateScript = `
import sqlite3
import json

# Создать таблицу настроек если не существует
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

# Обновить или создать настройки
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

            const riskLevel = dayLimit > 200 ? '🔴 ВЫСОКИЙ' : dayLimit > 100 ? '🟡 СРЕДНИЙ' : '🟢 Н��ЗКИЙ';

            const message = `✅ **Лимиты агента обновлены!**

�� **Новые лимиты:**
📅 **В день:** ${dayLimit} звёзд
🔢 **В час:** ${hourLimit} звёзд
🎯 **За раз:** ${maxAmount} звёзд

⚠️ **Уровень риска:** ${riskLevel}

${dayLimit > 25 ? '🔓 **Тест-режим отключён**' : '🔒 **Тест-режим активен**'}

💡 **Рекоменда��ии:**
• Начните с малых сумм для тестирования
• Следите за логами агента: \`/agent_logs\`
• При ошибках FloodWait снизьте лимиты

🔄 **Перезапустите агент** для приме��ения изменений:
\`/admin\` → \`🎆 Stars Agent\` или \`⏹️ Остановить\` → \`▶️ Запустить\``;

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

// Handle subscription statistics display
async function handleSubscriptionStats(chatId, messageId) {
    try {
        const stats = await db.getChannelSubscriptionStats();

        if (stats.length === 0) {
            await bot.editMessageText(`📈 **Статис��ика подписок**\n\n��� Нет дан��ых о подп��с��ах.\n\nДоб��вьте обязательные каналы и дожди��есь первых пр��верок подписок.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📺 Уп��авле��и�� каналами', callback_data: 'admin_channels' }],
                        [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                    ]
                }
            });
            return;
        }

        const uniqueUsersCount = await db.getUniqueSubscriptionUsersCount();

        let message = `📈 **Ст��тистика подпис���� ��о каналам**\n\n`;
        message += `👥 **Ун��кальных пользо��ателей ��рошло проверку:** ${uniqueUsersCount}\n`;
        message += `🔄 *(Каждый пользователь сч��тается только один раз)*\n\n`;

        let totalChecks = 0;

        for (const stat of stats) {
            const channelName = stat.channel_name || stat.channel_id;
            const addedDate = stat.channel_added_at ? new Date(stat.channel_added_at).toLocaleDateString('ru-RU') : 'Неизвестно';
            const lastCheck = stat.last_check_at ? new Date(stat.last_check_at).toLocaleString('ru-RU') : 'Никогда';
            const activeStatus = stat.is_active ? '✅' : '❌';

            message += `${activeStatus} **${channelName}**\n`;
            message += `   📊 Уникальных проверок: **${stat.successful_checks}**\n`;
            message += `   �� Добавлен: ${addedDate}\n`;
            message += `   ⏰ Последн��я проверка: ${lastCheck}\n\n`;

            totalChecks += parseInt(stat.successful_checks);
        }

        message += `📊 **Общая статистика:**\n`;
        message += `• Всего уни��ал��ны�� пользователей: **${uniqueUsersCount}**\n`;
        message += `• Активных каналов: **${stats.filter(s => s.is_active).length}**\n`;
        message += `• Всего канало��: **${stats.length}**\n\n`;

        message += `����� **Как ра��отае��:**\nКаждый пользовате��ь может увеличить сче��чик тол���ко один раз - при первой успешной проверке подписки. Повторные проверки того же пользователя не у��еличивают счёт��ик.`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 Уникальные пользователи', callback_data: 'admin_unique_users' }],
                    [{ text: '🔄 Обнови��ь', callback_data: 'admin_subscription_stats' }],
                    [{ text: '📋 История проверок', callback_data: 'admin_subscription_history' }],
                    [{ text: '📺 Управление каналами', callback_data: 'admin_channels' }],
                    [{ text: '🔙 Наз��д', callback_data: 'admin_menu' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error displaying subscription stats:', error);
        await bot.editMessageText('❌ Ошибка загрузки статис��ики подписок.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

// Handle unique subscription users display
async function handleUniqueUsers(chatId, messageId) {
    try {
        const uniqueUsers = await db.getLatestUniqueSubscriptionUsers(15);
        const totalCount = await db.getUniqueSubscriptionUsersCount();

        let message = `👥 **Пос��едние у��икальные поль��ователи** (${totalCount} всего)\n\n`;

        if (uniqueUsers.length === 0) {
            message += '📋 Нет д��нных о пользователях.';
        } else {
            for (let i = 0; i < uniqueUsers.length; i++) {
                const user = uniqueUsers[i];
                const cleanName = cleanDisplayText(user.first_name || 'Неизве��тный');
                const date = new Date(user.first_success_at).toLocaleString('ru-RU');

                message += `${i + 1}. **${cleanName}**\n`;
                message += `   �� ID: ${user.user_id}\n`;
                if (user.username) {
                    message += `   ��� @${user.username}\n`;
                }
                message += `   📅 Пе����ая ��роверка: ${date}\n\n`;
            }
        }

        message += `💡 **Пояснение:**\nКаждый пользователь учитывается в стати����тике только один раз - при первой успешной проверке подпис��и. Повторные проверки этого же поль���ователя не увелич���вают счётчик.`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📊 К статис��ике', callback_data: 'admin_subscription_stats' }],
                    [{ text: '���� Назад', callback_data: 'admin_menu' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error displaying unique users:', error);
        await bot.editMessageText('❌ Ошиб��а загру��ки да��ных о ��о��ьзователях.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

// Handle subscription check history display
async function handleSubscriptionHistory(chatId, messageId) {
    try {
        const history = await db.getSubscriptionCheckHistory(20);

        if (history.length === 0) {
            await bot.editMessageText(`�� **История проверок подписок**\n\n❌ Нет данн��х о про��ерках.`, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 К статистике', callback_data: 'admin_subscription_stats' }]
                    ]
                }
            });
            return;
        }

        let message = `���� **Последние 20 проверок подписок**\n\n`;

        for (const check of history) {
            const userName = check.first_name || 'Неизвестный';
            const checkTime = new Date(check.checked_at).toLocaleString('ru-RU');
            const status = check.success ? '���' : '❌';
            const channelsCount = check.active_channels_count;

            message += `${status} **${userName}** | ID: ${check.user_id}\n`;
            message += `   ⏰ ${checkTime}\n`;
            message += `   📺 Активных каналов: ${channelsCount}\n\n`;
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Обновить', callback_data: 'admin_subscription_history' }],
                    [{ text: '🔙 К статистике', callback_data: 'admin_subscription_stats' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error displaying subscription history:', error);
        await bot.editMessageText('❌ Ошибка загрузки истории пров����ок.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 К статистике', callback_data: 'admin_subscription_stats' }]
                ]
            }
        });
    }
}

// Error handling with 409 conflict management
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
        console.log('⚠️ 409 Conflict detected - another bot instance is running');
        console.log('ℹ️ This is normal when deploying updates');

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
    console.log('🔄 Shutting down bot...');
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
                        await bot.editMessageText(`📤 **Рассылка в процессе...**\n\n👥 По��ьзователей: ${progress.total}\n✅ О��правлено: ${progress.success}\n❌ Ошибок: ${progress.errors}\n Прогресс: ${progress.percentage}%`, {
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
            await bot.editMessageText(`✅ **Рассыл��а завершена!**\n\n👥 Всего пользователей: ${result.total}\n📤 Успешно отправлено: ${result.success}\n❌ Ошибок: ${result.errors}\n📊 У��пешность: ${Math.round(result.success/result.total*100)}%`, {
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

// ==================== SubGram Handlers ====================

// Handle official SubGram callback (subgram-op) согласно документации
async function handleSubGramOfficialCheck(chatId, messageId, userId) {
    try {
        console.log('[SUBGRAM] Official callback check for user:', userId);

        await bot.editMessageText('🔄 Проверяем ваши подписки на спонсорские каналы...', {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });

        // Получаем данные пользователя
        const user = await db.getUser(userId);
        if (!user) {
            await bot.editMessageText('❌ Пользователь не найден.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
            return;
        }

        // Запрос к SubGram API для проверки статуса
        const checkResponse = await subgramAPI.checkUserStatus({
            userId: userId.toString(),
            chatId: chatId.toString(),
            firstName: user.first_name || 'Пользователь',
            languageCode: user.language_code || 'ru',
            premium: false, // Можно улучшить позже через Telegram API
            maxOP: 3,
            action: 'subscribe',
            excludeChannelIds: []
        });

        if (!checkResponse.success) {
            await bot.editMessageText('❌ Ошибка проверки спонсорских каналов. Попробуйте позже.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Попробовать снова', callback_data: 'subgram-op' }],
                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
            return;
        }

        const processedData = subgramAPI.processAPIResponse(checkResponse.data);

        // Логируем запрос
        await db.logSubGramAPIRequest(
            userId,
            'official_check',
            { action: 'subscribe' },
            checkResponse.data,
            true
        );

        // Обновляем сессию
        await db.saveSubGramUserSession(userId, checkResponse.data, processedData);

        // Обрабатываем результат согласно документации
        if (processedData.status === 'ok' && processedData.code === 200) {
            // Пользователь подписан на все каналы - выдаем вознаграждение/контент
            await bot.editMessageText('✅ **Спасибо за подписку!** 👍\n\n🎉 Вы успешно подписались на все спонсорские каналы!\n\n💎 Тепер�� вы можете продолжать пользоваться ботом.', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });

            // Обновляем статус подписки пользователя
            await db.updateUserField(userId, 'is_subscribed', true);

        } else if (processedData.status === 'ok') {
            // Пропускаем пользователя дальше
            await bot.editMessageText('✅ **Спасибо за подписку!** 👍\n\n🎯 Проверка пройдена успешно!', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
        } else {
            // Пользователь не подписан - показываем каналы снова
            const channelsMessage = subgramAPI.formatChannelsMessage(processedData);
            await bot.editMessageText(channelsMessage.message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: channelsMessage.buttons }
            });
        }

    } catch (error) {
        console.error('Error in official SubGram check:', error);
        await bot.editMessageText('❌ Ошибка проверки спонсорских каналов.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Попробовать снова', callback_data: 'subgram-op' }],
                    [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                ]
            }
        });
    }
}

// Enhanced subscription check with SubGram integration
async function handleEnhancedSubscriptionCheck(chatId, messageId, userId) {
    try {
        console.log('[SUBGRAM] Enhanced subscription check for user:', userId);

        // Check regular required channels with detailed status
        const subscriptionDetails = await checkAllSubscriptionsDetailed(userId, true);

        // Calculate if user should pass: all subscribed OR only errors preventing check
        let canPass = subscriptionDetails.allSubscribed;
        if (!canPass && subscriptionDetails.hasErrors) {
            // Check if ALL remaining unsubscribed channels have errors (can't be checked)
            const unsubscribedChannels = subscriptionDetails.channels.filter(ch => !ch.subscribed);
            const allUnsubscribedHaveErrors = unsubscribedChannels.every(ch => !ch.canCheck);
            canPass = allUnsubscribedHaveErrors;
        }

        const allSubscribed = canPass;

        // Check SubGram channels
        let subgramAllowed = true;
        try {
            const user = await db.getUser(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Get current SubGram session if exists
            const session = await db.getSubGramUserSession(userId);
            let subgramResponse;

            if (session && session.session_data) {
                // Use existing session data for checking
                console.log('[SUBGRAM] Using existing session data for check');
                subgramResponse = await subgramAPI.checkUserStatus({
                    userId: userId.toString(),
                    chatId: userId.toString(),
                    firstName: user.first_name || 'Пользователь',
                    languageCode: 'ru',
                    premium: false,
                    gender: session.gender || undefined,
                    maxOP: 3,
                    action: 'subscribe'
                });
            } else {
                // Make new request
                console.log('[SUBGRAM] Making new SubGram check request');
                subgramResponse = await subgramAPI.requestSponsors({
                    userId: userId.toString(),
                    chatId: userId.toString(),
                    firstName: user.first_name || 'Пользователь',
                    languageCode: 'ru',
                    premium: false,
                    maxOP: 3,
                    action: 'subscribe'
                });
            }

            if (subgramResponse.success && subgramResponse.data) {
                const processedData = subgramAPI.processAPIResponse(subgramResponse.data);

                // Log the check
                await db.logSubGramAPIRequest(
                    userId,
                    'check_status',
                    { action: 'subscribe' },
                    subgramResponse.data,
                    true
                );

                // Update session if needed
                await db.saveSubGramUserSession(userId, subgramResponse.data, processedData);

                if (processedData.needsGender) {
                    const genderMessage = subgramAPI.formatChannelsMessage(processedData);
                    await bot.editMessageText(genderMessage.message, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: genderMessage.buttons }
                    });
                    return;
                }

                if (processedData.needsSubscription) {
                    subgramAllowed = false;
                    console.log('[SUBGRAM] User needs to subscribe to SubGram channels');
                } else if (processedData.allSubscribed || processedData.canProceed) {
                    subgramAllowed = true;
                    console.log('[SUBGRAM] SubGram subscriptions OK');
                }
            }
        } catch (subgramError) {
            console.error('[SUBGRAM] Error checking SubGram status:', subgramError);
            // Don't block user if SubGram service is down
            subgramAllowed = true;
        }

        if (allSubscribed && subgramAllowed) {
            // User has passed all checks
            await db.updateUserField(userId, 'is_subscribed', true);
            // Keep notification status - user shouldn't receive subscription messages again

            // Process referral logic like in the original handler
            const user = await db.getUser(userId);
            if (user && user.pending_referrer) {
                await db.updateUserField(userId, 'pending_referrer', null);
                await db.updateUserField(userId, 'invited_by', user.pending_referrer);
            }

            // Check referral qualification
            try {
                const qualification = await db.checkReferralQualification(userId);
                if (qualification.qualified) {
                    const result = await db.checkAndProcessPendingReferrals(userId);
                    if (result.processed > 0) {
                        // Notify referrer about successful qualification
                        try {
                            const userInfo = await db.getUser(userId);
                            const message = `��� **Поздравляем!**\n\n�� Приглашённый вами пользователь **${userInfo.first_name}** выполнил все услов��я:\n✅ Прошёл капчу\n✅ Подписался на вс�� каналы\n✅ Пригласи�� сво������о ��ервого реферала\n\n💰 **Вы п��л��чили:** +3 ⭐\n💎 **Ваш баланс пополнен!**`;

                            await bot.sendMessage(result.referrerId, message, {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                                    ]
                                }
                            });
                        } catch (error) {
                            console.error('Error sending qualified referral notification:', error);
                        }
                    }
                }
            } catch (error) {
                console.error('Error checking referral qualification:', error);
            }

            // Check retroactive referral activation
            try {
                const retroResult = await db.activateRetroactiveReferral(userId);
                if (retroResult.success) {
                    try {
                        const userInfo = await db.getUser(userId);
                        const message = `🔄 **Воз��рат зв������д!**\n\n👤 Ваш ре����ерал **${userInfo.first_name}** актив��ровался:\n✅ Прошёл капчу\n✅ Подп����с��лся на все каналы\n\n💰 **В��звращено:** +3 ⭐\n💎 **За активного реферала!**`;

                        await bot.sendMessage(retroResult.referrerId, message, {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '👥 Пригласить еще', callback_data: 'invite' }],
                                    [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                                ]
                            }
                        });
                    } catch (error) {
                        console.error('Error sending retroactive activation notification:', error);
                    }
                }
            } catch (error) {
                console.error('Error checking retroactive activation:', error);
            }

            // Show main menu
            await handleMainMenu(chatId, messageId);
        } else {
            // Show subscription requirements again with only unsubscribed channels
            const subData = await getEnhancedSubscriptionMessage(userId, true);
            await bot.editMessageText(subData.message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: subData.buttons }
            });
        }

    } catch (error) {
        console.error('Error in enhanced subscription check:', error);
        await bot.editMessageText('❌ Ошибка проверки подписок. Попробуйте позже.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Попробовать снова', callback_data: 'check_subscriptions_enhanced' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            }
        });
    }
}

// Handle SubGram subscription check
async function handleSubGramCheck(chatId, messageId, userId) {
    try {
        console.log('[SUBGRAM] Checking SubGram subscriptions for user:', userId);

        const user = await db.getUser(userId);
        if (!user) {
            await bot.editMessageText('❌ Пользователь не найден.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'main_menu' }]] }
            });
            return;
        }

        // Get current session
        const session = await db.getSubGramUserSession(userId);

        const checkResponse = await subgramAPI.checkUserStatus({
            userId: userId.toString(),
            chatId: userId.toString(),
            firstName: user.first_name || 'Пользователь',
            languageCode: 'ru',
            premium: false,
            gender: session?.gender || undefined,
            maxOP: 3,
            action: 'subscribe'
        });

        if (!checkResponse.success) {
            await bot.editMessageText('❌ Ошиб��а проверки SubGram кан��лов. П��пр��бу��те позже.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Попробовать снова', callback_data: 'subgram_check' }],
                        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
            return;
        }

        const processedData = subgramAPI.processAPIResponse(checkResponse.data);

        // Log the check
        await db.logSubGramAPIRequest(
            userId,
            'check_subgram',
            { action: 'subscribe' },
            checkResponse.data,
            true
        );

        // Update session
        await db.saveSubGramUserSession(userId, checkResponse.data, processedData);

        if (processedData.allSubscribed || processedData.canProceed) {
            await bot.editMessageText('✅ **Отлично!**\n\nВы подписались на все спонсорские каналы!\n\n🎉 Теперь проверим все подписки...', {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Про��е��ить все подписки', callback_data: 'check_subscriptions_enhanced' }]
                    ]
                }
            });
        } else {
            // Format message with current status
            const channelsMessage = subgramAPI.formatChannelsMessage(processedData);
            await bot.editMessageText(channelsMessage.message, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: channelsMessage.buttons }
            });
        }

    } catch (error) {
        console.error('Error in SubGram check:', error);
        await bot.editMessageText('❌ Ошибка проверки спонсорских каналов.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 ��оп��обовать снова', callback_data: 'subgram_check' }],
                    [{ text: '🏠 Главн��е меню', callback_data: 'main_menu' }]
                ]
            }
        });
    }
}

// Handle SubGram gender selection
async function handleSubGramGender(chatId, messageId, userId, gender) {
    try {
        console.log('[SUBGRAM] Setting gender for user:', userId, 'gender:', gender);

        const user = await db.getUser(userId);
        if (!user) {
            await bot.editMessageText('❌ Польз���ватель не найден.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: { inline_keyboard: [[{ text: '🏠 Главное меню', callback_data: 'main_menu' }]] }
            });
            return;
        }

        // Make request with gender
        const genderResponse = await subgramAPI.requestSponsors({
            userId: userId.toString(),
            chatId: userId.toString(),
            firstName: user.first_name || 'Поль��ователь',
            languageCode: 'ru',
            premium: false,
            gender: gender,
            maxOP: 3,
            action: 'subscribe'
        });

        if (!genderResponse.success) {
            await bot.editMessageText('❌ Ошибка получения ����налов с указанным полом.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Попробовать снова', callback_data: 'check_subscriptions_enhanced' }],
                        [{ text: '🏠 ��лавное меню', callback_data: 'main_menu' }]
                    ]
                }
            });
            return;
        }

        const processedData = subgramAPI.processAPIResponse(genderResponse.data);

        // Log the request
        await db.logSubGramAPIRequest(
            userId,
            'gender_request',
            { gender, action: 'subscribe' },
            genderResponse.data,
            true
        );

        // Save session with gender
        await db.saveSubGramUserSession(userId, genderResponse.data, processedData, gender);

        // Save channels
        if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
            await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);
        }

        // Format and show channels
        const channelsMessage = subgramAPI.formatChannelsMessage(processedData);
        await bot.editMessageText(channelsMessage.message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: channelsMessage.buttons }
        });

    } catch (error) {
        console.error('Error handling SubGram gender:', error);
        await bot.editMessageText('❌ Ошибка обработки выбор��� пола.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔄 Поп��обовать снова', callback_data: 'check_subscriptions_enhanced' }],
                    [{ text: '🏠 Глав����ое меню', callback_data: 'main_menu' }]
                ]
            }
        });
    }
}

// ==================== Admin SubGram Handlers ====================

// Main SubGram admin menu
async function handleAdminSubGram(chatId, messageId) {
    try {
        const settings = await db.getSubGramSettings();
        const config = subgramAPI.getConfig();

        const message = `��� **SubGram Управление**\n\n📊 **Статус интеграции:**\n• ${settings?.enabled ? '✅ Включена' : '❌ Отключена'}\n• API ключ: ${config.hasApiKey ? '✅ Настроен' : '❌ Не настроен'}\n• Максимум спонсоров: ${settings?.max_sponsors || 3}\n\n🔧 **Доступные действия:**`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '⚙️ Настройки', callback_data: 'admin_subgram_settings' },
                        { text: '📊 Статистика', callback_data: 'admin_subgram_stats' }
                    ],
                    [
                        { text: '📋 Л��ги запросов', callback_data: 'admin_subgram_logs' },
                        { text: '�� Очистить сессии', callback_data: 'admin_subgram_cleanup' }
                    ],
                    [
                        { text: settings?.enabled ? '⏸️ Отключить' : '▶️ Включить', callback_data: `admin_subgram_toggle_${settings?.enabled ? 'off' : 'on'}` }
                    ],
                    [
                        { text: '🔙 Админ панель', callback_data: 'admin_menu' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin SubGram handler:', error);
        await bot.editMessageText('❌ Ошибка ��агрузк�� SubGram управления.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 На��ад', callback_data: 'admin_menu' }]] }
        });
    }
}

// SubGram settings management
async function handleAdminSubGramSettings(chatId, messageId) {
    try {
        const settings = await db.getSubGramSettings();

        const message = `⚙️ **SubGram Настройки**\n\n🔧 **Текущие настройки:**\n• **Статус:** ${settings?.enabled ? '✅ Включена' : '❌ О��ключена'}\n• **API URL:** \`${settings?.api_url || 'Не настроен'}\`\n• **Максимум спонсор��в:** ${settings?.max_sponsors || 3}\n��� **Дейст��и�� по ��молчанию:** ${settings?.default_action || 'subscribe'}\n\n📝 **Последнее обновление:** ${settings?.updated_at ? new Date(settings.updated_at).toLocaleString('ru-RU') : 'Нет данных'}`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔄 Обновить настройки', callback_data: 'admin_subgram_refresh_settings' }
                    ],
                    [
                        { text: '🔙 SubGram управле��ие', callback_data: 'admin_subgram' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin SubGram settings:', error);
        await bot.editMessageText('❌ Ошибка загрузки настрое�� SubGram.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_subgram' }]] }
        });
    }
}

// SubGram statistics
async function handleAdminSubGramStats(chatId, messageId) {
    try {
        // Get recent API requests
        const recentLogs = await db.getSubGramAPIRequestHistory(null, 10);

        // Count statistics
        const totalRequests = recentLogs.length;
        const successfulRequests = recentLogs.filter(log => log.success).length;
        const errorRequests = totalRequests - successfulRequests;

        // Get unique users who used SubGram
        const uniqueUsers = new Set(recentLogs.map(log => log.user_id)).size;

        // Get latest requests by status
        const statusCounts = {};
        recentLogs.forEach(log => {
            if (log.api_status) {
                statusCounts[log.api_status] = (statusCounts[log.api_status] || 0) + 1;
            }
        });

        let message = `📊 **SubGram Статистика**\n\n📈 **Общая статистика (��оследние ${totalRequests} запросов):**\n• Всего за��росов: ${totalRequests}\n��� Успеш��ых: ${successfulRequests}\n• ��шибок: ${errorRequests}\n• Уникальных пользова��елей: ${uniqueUsers}\n`;

        if (Object.keys(statusCounts).length > 0) {
            message += '\n🎯 **Статусы ответов API:**\n';
            for (const [status, count] of Object.entries(statusCounts)) {
                const emoji = status === 'ok' ? '✅' : status === 'warning' ? '⚠��' : status === 'gender' ? '👤' : '❓';
                message += `• ${emoji} ${status}: ${count}\n`;
            }
        }

        if (recentLogs.length > 0) {
            const latestLog = recentLogs[0];
            message += `\n⏰ **Последний зап��ос:**\n• ${new Date(latestLog.created_at).toLocaleString('ru-RU')}\n• Пользователь: ${latestLog.first_name || 'Неизвес��ен'}\n• Статус: ${latestLog.success ? '✅' : '❌'}\n• API ответ: ${latestLog.api_status || 'Нет данных'}`;
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔄 Обновить', callback_data: 'admin_subgram_stats' },
                        { text: '📋 Детальные лог��', callback_data: 'admin_subgram_logs' }
                    ],
                    [
                        { text: '🔙 SubGram управление', callback_data: 'admin_subgram' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin SubGram stats:', error);
        await bot.editMessageText('❌ Ошибка загрузки ста�����истики SubGram.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_subgram' }]] }
        });
    }
}

// SubGram API logs
async function handleAdminSubGramLogs(chatId, messageId) {
    try {
        const logs = await db.getSubGramAPIRequestHistory(null, 15);

        let message = `📋 **SubGram API Лог��**\n\n`;

        if (logs.length === 0) {
            message += '📝 Пока нет запросов к SubGram API.';
        } else {
            message += `📊 Показаны последние ${logs.length} запросов:\n\n`;

            for (let index = 0; index < logs.length; index++) {
                const log = logs[index];
                const date = new Date(log.created_at).toLocaleString('ru-RU');
                const user = log.first_name || `ID:${log.user_id}`;
                const status = log.success ? '✅' : '❌';
                const apiStatus = log.api_status ? ` (${log.api_status})` : '';

                message += `${index + 1}. ${status} ${date}\n   👤 ${user} | ${log.request_type}${apiStatus}\n`;

                if (log.error_message) {
                    message += `   ❌ ${log.error_message.substring(0, 50)}...\n`;
                }

                message += '\n';

                // Limit message length
                if (message.length > 3500) {
                    message += `... и еще ${logs.length - index - 1} записей`;
                    break;
                }
            }
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔄 Обновить', callback_data: 'admin_subgram_logs' },
                        { text: '📊 Статистика', callback_data: 'admin_subgram_stats' }
                    ],
                    [
                        { text: '🔙 SubGram управление', callback_data: 'admin_subgram' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin SubGram logs:', error);
        await bot.editMessageText('❌ Ошибка загрузки логов SubGram.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_subgram' }]] }
        });
    }
}

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process - just log the error
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Only exit on critical errors
    if (error.message && error.message.includes('ECONNRESET')) {
        console.log('⚠️ Network error - continuing...');
        return;
    }
    process.exit(1);
});

// Add global error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Don't exit the process - just log the error
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Only exit on critical errors
    if (error.message && error.message.includes('ECONNRESET')) {
        console.log('⚠️ Network error - continuing...');
        return;
    }
    process.exit(1);
});

// Start the bot
startBot();
