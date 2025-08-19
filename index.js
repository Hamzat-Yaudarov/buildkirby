console.log('[MAIN] Starting imports...');

const TelegramBot = require('node-telegram-bot-api');
console.log('[MAIN] TelegramBot imported');

const cron = require('node-cron');
console.log('[MAIN] cron imported');

const db = require('./database');
console.log('[MAIN] database imported');

const adminHandlers = require('./admin-handlers-final');
console.log('[MAIN] admin-handlers imported');

const { throttler } = require('./message-throttler');
console.log('[MAIN] message throttler imported');

const { captchaSystem } = require('./captcha-system');
console.log('[MAIN] captcha system imported');

const { subgramAPI } = require('./subgram-api');
console.log('[MAIN] SubGram API imported');

// User states for multi-step interactions
const userStates = new Map();

// Withdrawal cooldown protection (5 seconds)
const withdrawalCooldowns = new Map();
const WITHDRAWAL_COOLDOWN_MS = 5000; // 5 seconds

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

// Bot token - should be set via environment variable for security
let token = process.env.BOT_TOKEN;

if (!token) {
    console.warn('⚠️  WARNING: BOT_TOKEN environment variable not set!');
    console.warn('   Using fallback token for development - NOT SECURE FOR PRODUCTION!');
    console.warn('📝 Please set BOT_TOKEN in your environment variables for production.');

    // Fallback token for development (replace with env variable in production)
    token = '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';

    console.log('🔄 Bot starting with fallback token (will fail without real env token)...');
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

                // ИСПРАВЛЕНО: Для каналов которые не можем проверить - считаем их подписанными
                // чтобы не блокировать пользователей из-за неправильных каналов
                channelInfo.subscribed = true;
            }

            result.channels.push(channelInfo);

            // ИСПРАВЛЕ��О: Блокируем только если пользователь точно не подписан на проверяемый канал
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

        // Send main menu
        const welcomeMessage = `🏠 **Добро пожаловать в StarBot!**

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
            reply_markup: { remove_keyboard: true }, // Remove custom keyboard
            ...getMainMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in start command:', error);
        bot.sendMessage(chatId, '❌ произошла ошибка. Попробуйте позже.');
    }
});

// Callback query handler
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const chatId = msg.chat.id;
    const messageId = msg.message_id;
    const userId = callbackQuery.from.id;

    try {
        // Get user from database
        const user = await db.getUser(userId);

        if (!user && !data.startsWith('admin_') && data !== 'main_menu') {
            await bot.editMessageText(
                '❌ Пользователь не найден. Нажмите /start для регистрации.',
                { chat_id: chatId, message_id: messageId }
            );
            await bot.answerCallbackQuery(callbackQuery.id);
            return;
        }

        switch (data) {
            case 'main_menu':
                const userBalance = user ? user.balance || 0 : 0;
                const userReferrals = user ? user.referrals_count || 0 : 0;
                const userWeeklyPoints = user ? user.weekly_points || 0 : 0;

                const welcomeMessage = `🏠 **Главное меню**

💫 Добро пожаловать в StarBot!

🎯 **Ваша статистика:**
💰 Баланс: ${userBalance} ⭐
👥 Рефералы: ${userReferrals}
📊 Недельные очки: ${userWeeklyPoints}

Выберите действие:`;

                await bot.editMessageText(welcomeMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    ...getMainMenuKeyboard()
                });
                break;

            case 'profile':
                const profileMessage = `👤 **Ваш профиль**

💫 **Имя:** ${user.first_name || 'Пользователь'}
🆔 **ID:** ${user.id}
💰 **Баланс:** ${user.balance || 0} ⭐
👥 **Рефералы:** ${user.referrals_count || 0}
📅 **Регистрация:** ${user.registered_at ? new Date(user.registered_at).toLocaleDateString('ru-RU') : 'Неизвестно'}
📊 **Недельные очки:** ${user.weekly_points || 0}

💡 **Приглашайте друзей и зарабатывайте 3⭐ за каждого активного реферала!**`;

                await bot.editMessageText(profileMessage, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    ...getProfileKeyboard()
                });
                break;

            default:
                // For all other callbacks, show "under development" message
                await bot.editMessageText(
                    `🚧 **Функция в разработке**\n\nCallback: ${data}\n\nДанная функция скоро будет доступна!`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        ...getBackToMainKeyboard()
                    }
                );
                break;
        }

        await bot.answerCallbackQuery(callbackQuery.id);

    } catch (error) {
        console.error('Error in callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка' });
    }
});

// Message handler for captcha
bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Skip commands

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageText = msg.text;

    // Check if user has active captcha session
    if (captchaSystem.hasActiveSession(userId)) {
        const isCorrect = captchaSystem.checkAnswer(userId, messageText);
        
        if (isCorrect) {
            // Captcha passed
            await db.setCaptchaPassed(userId, true);
            await bot.sendMessage(chatId, '✅ Капча пройдена! Теперь вы можете пользоваться ботом.\n\nНажмите /start для продолжения.', {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 Начать', callback_data: 'main_menu' }]
                    ]
                }
            });
        } else {
            // Wrong answer
            if (captchaSystem.hasActiveSession(userId)) {
                const newQuestion = captchaSystem.generateCaptcha(userId);
                await bot.sendMessage(chatId, `❌ Неверный ответ. Попробуйте еще раз:\n\n**${newQuestion}**`, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]
                        ]
                    }
                });
            } else {
                await bot.sendMessage(chatId, '⏰ Время на решение истекло. Нажмите /start для новой попытки.');
            }
        }
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

        const message = `⚙️ **Админ-панель**

📊 **Быстрая статистика:**
👥 Пользователей: ${stats.total_users}
💰 Общий баланс: ${stats.total_balance} ⭐

Выберите действие:`;

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📊 Статистика', callback_data: 'admin_stats' },
                        { text: '👥 Пользователи', callback_data: 'admin_users' }
                    ],
                    [
                        { text: '🏠 В главное меню', callback_data: 'main_menu' }
                    ]
                ]
            }
        });

    } catch (error) {
        console.error('Error in admin command:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при загрузке админ панели.');
    }
});

// Start the bot
startBot();

console.log('✅ Simple bot version loaded - emergency rollback!');
