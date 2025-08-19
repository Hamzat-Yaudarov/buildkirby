/**
 * Очищенная версия index.js без дублированного кода
 * Использует модульную архитектуру для устранения дублирования
 */

console.log('[MAIN] Starting imports...');

const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');

// Импорт конфигурации и утилит
const { BOT_CONFIG, LIMITS_CONFIG, REWARDS_CONFIG, isAdmin } = require('./config');
const db = require('./database');
const { throttler } = require('./message-throttler');
const { captchaSystem } = require('./captcha-system');
const { subgramAPI } = require('./subgram-api');

// Импорт новых модулей
const { keyboards } = require('./keyboards');
const { editMessage, sendMessage, sendErrorMessage, cleanDisplayText } = require('./message-utils');
const { requireUser, withErrorHandling, withCooldown } = require('./middlewares');
const { createCallbackRouter } = require('./callback-router');

console.log('[MAIN] All modules imported successfully');

// Глобальные состояния
const userStates = new Map();
const withdrawalCooldowns = new Map();

// Инициализация бота
const token = BOT_CONFIG.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: false });

// Создание роутера для callback
const callbackRouter = createCallbackRouter(bot, { db });

// Экспорт бота для других модулей
module.exports = { bot };

// Утилиты для отправки сообщений
async function sendThrottledMessage(userId, message, options = {}) {
    return await throttler.sendMessage(() => bot.sendMessage(userId, message, options));
}

async function sendUniversalMessage(chatId, message, options = {}, useThrottling = false) {
    if (useThrottling) {
        return await sendThrottledMessage(chatId, message, options);
    } else {
        return await bot.sendMessage(chatId, message, options);
    }
}

// Инициализация бота
async function initializeBotMode() {
    try {
        console.log('🔄 Clearing any existing webhook...');
        await bot.deleteWebHook();
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('🔄 Starting polling mode...');
        await bot.startPolling({ restart: true });
        console.log('✅ Bot polling started successfully!');
    } catch (error) {
        console.error('❌ Error initializing bot mode:', error);
        throw error;
    }
}

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

// Функции проверки подписок (упрощенные)
async function getRequiredChannels() {
    try {
        const result = await db.executeQuery('SELECT channel_id FROM required_channels WHERE is_active = TRUE');
        return result.rows.map(row => row.channel_id);
    } catch (error) {
        console.error('Error getting required channels:', error);
        return [];
    }
}

async function checkAllSubscriptionsDetailed(userId, recordStats = false) {
    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) {
        return { allSubscribed: true, channels: [], hasErrors: false };
    }

    const result = { allSubscribed: true, channels: [], hasErrors: false };

    try {
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
                channelInfo.subscribed = true; // Считаем подписанным если н�� можем проверить
            }

            result.channels.push(channelInfo);

            if (!channelInfo.subscribed && channelInfo.canCheck) {
                result.allSubscribed = false;
            }
        }

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
        return { allSubscribed: false, channels: [], hasErrors: true };
    }
}

async function checkAllSubscriptions(userId, recordStats = false) {
    const detailed = await checkAllSubscriptionsDetailed(userId, recordStats);
    return detailed.allSubscribed;
}

async function getEnhancedSubscriptionMessage(userId, showOnlyUnsubscribed = false) {
    let message = '🔔 Для использования бота необходимо подписаться на все каналы:\n\n';
    let buttons = [];
    let channelCount = 0;

    try {
        const subscriptionStatus = await checkAllSubscriptionsDetailed(userId, false);
        const channelsToShow = showOnlyUnsubscribed ?
            subscriptionStatus.channels.filter(channel => !channel.subscribed) :
            subscriptionStatus.channels;

        if (channelsToShow.length > 0) {
            message += '📺 **Обязательные каналы:**\n';
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

        // SubGram интеграция
        try {
            const user = await db.getUser(userId);
            if (user) {
                const subgramResponse = await subgramAPI.requestSponsors({
                    userId: userId.toString(),
                    chatId: userId.toString(),
                    firstName: user.first_name || 'Пользователь',
                    languageCode: 'ru',
                    premium: false,
                    maxOP: 3,
                    action: 'subscribe',
                    excludeChannelIds: []
                });

                if (subgramResponse.success && subgramResponse.data) {
                    const processedData = subgramAPI.processAPIResponse(subgramResponse.data);

                    await db.logSubGramAPIRequest(userId, 'request_sponsors', 
                        { action: 'subscribe', maxOP: 3 }, subgramResponse.data, true);
                    await db.saveSubGramUserSession(userId, subgramResponse.data, processedData);

                    if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                        await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);

                        message += '\n🎯 **Спонсорские каналы:**\n';
                        processedData.channelsToSubscribe.forEach((channel, index) => {
                            channelCount++;
                            message += `${channelCount}. ${channel.name}\n`;
                            buttons.push([{ text: `🎯 ${channel.name}`, url: channel.link }]);
                        });
                    }

                    if (processedData.needsGender) {
                        message += '\n🤖 **SubGram требует уточнения пола для подбора каналов**';
                        buttons.push([
                            { text: '👨 Мужской', callback_data: 'subgram_gender_male' },
                            { text: '👩 Женский', callback_data: 'subgram_gender_female' }
                        ]);
                    }
                }
            }
        } catch (subgramError) {
            console.error('[SUBGRAM] Error getting SubGram channels:', subgramError);
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
        return {
            message: '❌ Ошибка получения каналов для подписки.',
            buttons: [[{ text: '🏠 В главное меню', callback_data: 'main_menu' }]],
            hasSubgram: false
        };
    }
}

// Команда /start
bot.onText(/\/start(.*)/, withErrorHandling(async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const user = msg.from;
    const referralCode = match ? match[1].trim() : null;
    
    try {
        let dbUser = await db.getUser(userId);

        if (!dbUser) {
            dbUser = await db.createOrUpdateUser(user);

            if (referralCode) {
                if (referralCode.startsWith('track_')) {
                    console.log(`[TRACKING] User ${userId} came from tracking link: ${referralCode}`);
                    try {
                        await db.executeQuery(
                            'INSERT INTO tracking_clicks (tracking_id, user_id, clicked_at) VALUES ($1, $2, NOW())',
                            [referralCode, userId]
                        );
                        await db.executeQuery(
                            'UPDATE tracking_links SET clicks_count = clicks_count + 1 WHERE tracking_id = $1',
                            [referralCode]
                        );
                    } catch (error) {
                        console.error('[TRACKING] Error recording click:', error);
                    }
                } else if (!isNaN(referralCode)) {
                    const referrerId = parseInt(referralCode);
                    const referrer = await db.getUser(referrerId);
                    if (referrer && referrerId !== userId) {
                        await db.updateUserField(userId, 'pending_referrer', referrerId);
                    }
                }
            }
        }

        const captchaPassed = await db.getCaptchaStatus(userId);

        if (!captchaPassed) {
            if (captchaSystem.hasActiveSession(userId)) {
                const currentQuestion = captchaSystem.getCurrentQuestion(userId);
                await bot.sendMessage(chatId, `🤖 **Подтвердите, что вы не робот**\n\nРешите простой пример:\n**${currentQuestion}**\n\n💡 Введите только число (например: 18)`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]] }
                });
            } else {
                const question = captchaSystem.generateCaptcha(userId);
                await bot.sendMessage(chatId, `🤖 **Добро пожаловать!**\n\nПрежде чем начать пользоваться ботом, подтвердите, что вы не робот.\n\nРешите простой пример:\n**${question}**\n\n💡 Введите только число (например: 26)`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]] }
                });
            }
            return;
        }

        const subscriptionDetails = await checkAllSubscriptionsDetailed(userId);
        const hasChannelsToShow = subscriptionDetails.channels.length > 0;

        if (hasChannelsToShow) {
            const alreadyNotified = await db.isSubscriptionNotified(userId);

            if (!alreadyNotified) {
                const subData = await getEnhancedSubscriptionMessage(userId);
                await bot.sendMessage(chatId, subData.message, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: subData.buttons }
                });
                await db.setSubscriptionNotified(userId, true);
                return;
            } else {
                const isSubscribed = await checkAllSubscriptions(userId, true);
                if (!isSubscribed) {
                    const subData = await getEnhancedSubscriptionMessage(userId);
                    await bot.sendMessage(chatId, subData.message, {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: subData.buttons }
                    });
                    return;
                }
            }
        }
        
        await db.updateUserField(userId, 'is_subscribed', true);

        try {
            await db.addWeeklyPoints(userId, 1, 'bot_activation');
        } catch (pointsError) {
            console.error('Error adding weekly points for bot activation:', pointsError);
        }
        
        if (dbUser.pending_referrer) {
            const invitedBy = dbUser.pending_referrer;
            await db.updateUserField(userId, 'pending_referrer', null);
            await db.updateUserField(userId, 'invited_by', invitedBy);
        }

        const welcomeMessage = `🏠 **Добро пожаловать в StarBot!**\n\n💰 **Ваш персональный помощник для зарабо��ка Telegram Stars**\n\n🎯 **Доступные возможности:**\n• Ежедневные награды в кликере\n• Выполнение заданий за вознаграждение\n• Реферальная программа (3⭐ за друга)\n• Участие в лотереях и розыгрышах\n• Открытие призовых кейсов\n\nВыберите действие из меню ниже:`;

        await bot.sendMessage(chatId, welcomeMessage, {
            parse_mode: 'Markdown',
            reply_markup: { remove_keyboard: true },
            ...keyboards.getMainMenuKeyboard()
        });

    } catch (error) {
        console.error('Error in start command:', error);
        await sendErrorMessage(bot, chatId, null, 'Произошла ошибка. Попробуйте позже.');
    }
}, 'Ошибка команды /start'));

// Обработка callback запросов
bot.on('callback_query', withErrorHandling(async (callbackQuery) => {
    try {
        await callbackRouter.route(callbackQuery);
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Error in callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка' });
    }
}, 'Ошибка обработки callback'));

// Обработка текстовых сообщений (капча)
bot.on('message', withErrorHandling(async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Пропускаем команды

    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageText = msg.text;

    // Проверка капчи
    if (captchaSystem.hasActiveSession(userId)) {
        const isCorrect = captchaSystem.checkAnswer(userId, messageText);
        
        if (isCorrect) {
            await db.setCaptchaPassed(userId, true);
            await bot.sendMessage(chatId, '✅ Капча пройдена! Теперь вы можете пользоваться ботом.\n\nНажмите /start для продолжения.', {
                reply_markup: {
                    inline_keyboard: [[{ text: '🚀 Начать', callback_data: 'main_menu' }]]
                }
            });
        } else {
            if (captchaSystem.hasActiveSession(userId)) {
                const newQuestion = captchaSystem.generateCaptcha(userId);
                await bot.sendMessage(chatId, `❌ Неверный ответ. Попробуйте еще раз:\n\n**${newQuestion}**`, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: [[{ text: '🔄 Новый пример', callback_data: 'new_captcha' }]] }
                });
            } else {
                await bot.sendMessage(chatId, '⏰ Время на решение истекло. Нажмите /start для новой попытки.');
            }
        }
    }
}, 'Ошибка обработки сообщения'));

// Админские команды (упрощенные)
bot.onText(/\/admin/, withErrorHandling(async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!isAdmin(userId)) {
        await bot.sendMessage(chatId, '❌ У вас нет прав доступа к панели администратора.');
        return;
    }

    try {
        const stats = await db.getUserStats();
        const message = `⚙️ **Админ-панель**\n\n📊 **Быстрая статистика:**\n👥 Пользователей: ${stats.total_users}\n💰 Общий баланс: ${stats.total_balance} ⭐\n\nВыберите действие:`;

        await bot.sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            ...keyboards.getAdminMenuKeyboard()
        });
    } catch (error) {
        console.error('Error in admin command:', error);
        await sendErrorMessage(bot, chatId, null, 'Ошибка загрузки админ панели');
    }
}, 'Ошибка админской команды'));

// Запуск бота
startBot();

// Экспорт для использования в других модулях
module.exports = { 
    bot, 
    checkAllSubscriptions, 
    checkAllSubscriptionsDetailed, 
    getEnhancedSubscriptionMessage,
    sendUniversalMessage,
    sendThrottledMessage
};

console.log('✅ Clean index.js loaded successfully - Code duplication eliminated!');
