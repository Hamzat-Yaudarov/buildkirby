const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const config = require('./config');
const Database = require('./database');
const SubGram = require('./subgram');
const WebhookHandler = require('./webhook-handler');

const bot = new TelegramBot(config.BOT_TOKEN, {
    polling: {
        interval: 1000,
        autoStart: true,
        params: {
            timeout: 10
        }
    }
});

// Временное хранение состояний пользовате��ей
const userStates = new Map();

// Инициализация webhook handler
const webhookHandler = new WebhookHandler(bot);

// Инициализация бота
async function initBot() {
    try {
        await Database.init();
        console.log('Бот запущен успешно!');

        // Запуск webhook сервера
        const webhookPort = process.env.PORT || process.env.WEBHOOK_PORT || 3000;
        console.log('🔧 Переменные окружения:');
        console.log('- PORT:', process.env.PORT);
        console.log('- WEBHOOK_PORT:', process.env.WEBHOOK_PORT);
        console.log('- Используемый порт:', webhookPort);
        await webhookHandler.start(webhookPort);

        // Уст��новка команд бота
        await bot.setMyCommands([
            { command: 'start', description: 'Запустить бота' },
            { command: 'menu', description: 'Главное меню' },
            { command: 'admin', description: 'Админ панель' }
        ]);
        
    } catch (error) {
        console.error('Ошибка за��уска бота:', error);
        process.exit(1);
    }
}

// Создание клавиатур
function createMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 Профиль', callback_data: 'profile' }],
            [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
            [{ text: '🖱 Кликер', callback_data: 'clicker' }],
            [{ text: '💰 Вывод звёзд', callback_data: 'withdraw' }],
            [{ text: '📋 Задания', callback_data: 'tasks' }],
            [{ text: '📖 Инструкция', callback_data: 'instructions' }],
            [{ text: '🏆 Рейтинги', callback_data: 'ratings' }],
            [{ text: '🎁 Кейсы', callback_data: 'cases' }],
            [{ text: '🎲 Лотерея', callback_data: 'lottery' }]
        ]
    };
}

function createBackToMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };
}

function createProfileKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🎫 Промокод', callback_data: 'promocode' }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };
}

// Обработчик команды /start
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referralCode = match[1] ? match[1].trim() : null;
    
    try {
        let user = await Database.getUser(userId);
        
        if (!user) {
            // Создаем нового пользователя
            const referrerId = referralCode ? parseInt(referralCode) : null;
            user = await Database.createUser({
                userId: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                languageCode: msg.from.language_code || 'ru',
                isPremium: msg.from.is_premium || false,
                referrerId: referrerId
            });
            
            // Награда рефереру
            if (referrerId) {
                await Database.updateUserBalance(referrerId, 2);
                await Database.updateUserPoints(referrerId, 2);
                
                try {
                    await bot.sendMessage(referrerId, 
                        '🎉 По вашей ссылке зарегистрировался новый пользователь!\n' +
                        '💰 Вы получили 2 звезды\n' +
                        '🏆 Вы получили 2 очка'
                    );
                } catch (e) {
                    console.log('Не удалось отправить уведомле��ие рефереру');
                }
            }
        }
        
        // Проверяем подписку на спонсорские каналы
        const subscriptionCheck = await SubGram.checkSubscription(
            userId,
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );

        console.log('SubGram ответ:', JSON.stringify(subscriptionCheck, null, 2));

        // Проверяем есть ли неподписанные ка��алы
        if (subscriptionCheck.links && subscriptionCheck.links.length > 0) {
            // Есть ка��алы для подписки - ТОЛЬКО показываем их, НЕ отправл��ем приветственное сообщение
            const message = SubGram.formatSubscriptionMessage(subscriptionCheck.links, subscriptionCheck.additional?.sponsors);
            const keyboard = SubGram.createSubscriptionKeyboard(subscriptionCheck.links);

            await bot.sendMessage(chatId, message, { reply_markup: keyboard });
        } else if (subscriptionCheck.status === 'ok') {
            // Пользователь полностью подписан, показы��аем главное меню
            await showMainMenu(chatId, userId);
        } else {
            // Ошибка SubGram или нет каналов - показываем меню (fallback)
            await showMainMenu(chatId, userId);
        }
        
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Проверка подписки пользователя (для блокировки функций)
async function checkUserSubscription(userId, chatId) {
    try {
        // Сначала проверяем кеш вебхуков
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);

        // Если есть свежи�� данные из вебхуков (не старше 10 минут)
        if (cachedStatus.lastUpdate && (Date.now() - cachedStatus.lastUpdate) < 10 * 60 * 1000) {
            console.log(`Используем кешированные данные подписки для пользователя ${userId}`);

            if (cachedStatus.isSubscribed === false) {
                // Пользователь точно не подписан
                return {
                    isSubscribed: false,
                    subscriptionData: {
                        links: cachedStatus.unsubscribedLinks,
                        status: 'webhook_cache'
                    }
                };
            }

            if (cachedStatus.isSubscribed === true) {
                // Пользователь точно подписан
                return {
                    isSubscribed: true,
                    subscriptionData: { status: 'webhook_cache' }
                };
            }
        }

        // Если нет кешированных данных, делаем запрос к SubGram
        console.log(`Запрос к SubGram API для пользователя ${userId}`);
        const subscriptionCheck = await SubGram.checkSubscription(userId, chatId);

        // Ес��и есть ссылки ��ля подписки - значит пользователь не подписан
        if (subscriptionCheck.links && subscriptionCheck.links.length > 0) {
            return {
                isSubscribed: false,
                subscriptionData: subscriptionCheck
            };
        }

        return {
            isSubscribed: true,
            subscriptionData: subscriptionCheck
        };
    } catch (error) {
        console.error('Ошибка проверки подписки:', error);
        // В случае ошибки ра��решаем дост��п
        // В случае ошибки проверяем кеш как fallback
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);
        if (cachedStatus.lastUpdate) {
            console.log('Используем кеш как fallback после ошибки API');
            return {
                isSubscribed: cachedStatus.isSubscribed !== false,
                subscriptionData: { status: 'fallback_cache' }
            };
        }

        // Если нет ни API, ни кеша - разрешаем доступ
        return { isSubscribed: true, subscriptionData: null };
    }
}

// Показать главное меню
async function showMainMenu(chatId, userId = null) {
    const message = '🌟 Добро пожаловать в бота для заработка звёзд!\n\n' +
                   '⭐ Зарабатывайте звёзды различными способами:\n' +
                   '• Приглашайте друзей\n' +
                   '• Выполняйте задания\n' +
                   '• Используйте к��икер\n' +
                   '• Участвуйте в лотереях\n\n' +
                   'Выберите дейс��вие:';

    const keyboard = createMainMenuKeyboard();

    try {
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    } catch (error) {
        console.error('Ошибка отправки главного меню:', error);
    }
}

// Обработчик callback запросов
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    try {
        // Получаем пользователя
        let user = await Database.getUser(userId);
        if (!user) {
            await bot.answerCallbackQuery(callbackQuery.id, '❌ Пользователь не найден. Нажмите /start');
            return;
        }

        // Проверяем подписку (кроме команд проверк�� подписки и админских)
        if (!data.startsWith('check_subscription') && !data.startsWith('admin_') && !data.startsWith('approve_') && !data.startsWith('reject_')) {
            const subscriptionStatus = await checkUserSubscription(userId, chatId);

            if (!subscriptionStatus.isSubscribed) {
                // Пользователь не подписан - пока��ы��аем каналы для подпис��и
                const subscriptionData = subscriptionStatus.subscriptionData;
                const message = SubGram.formatSubscriptionMessage(subscriptionData.links, subscriptionData.additional?.sponsors);
                const keyboard = SubGram.createSubscriptionKeyboard(subscriptionData.links);

                try {
                    await bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        reply_markup: keyboard
                    });
                } catch (e) {
                    // Если не удает��я редактировать, отправляем новое сообщение
                    await bot.sendMessage(chatId, message, { reply_markup: keyboard });
                }

                await bot.answerCallbackQuery(callbackQuery.id, '❌ Сначала подпишитесь на спонсорские каналы!');
                return;
            }
        }

        // Отв��чаем на callback_query
        await bot.answerCallbackQuery(callbackQuery.id);
        
        switch (data) {
            case 'check_subscription':
                await handleSubscriptionCheck(chatId, userId, message.message_id, callbackQuery.id);
                break;
                
            case 'main_menu':
                await editMainMenu(chatId, message.message_id);
                break;
                
            case 'profile':
                await showProfile(chatId, userId, message.message_id);
                break;
                
            case 'invite':
                await showInviteInfo(chatId, userId, message.message_id);
                break;
                
            case 'clicker':
                await showClicker(chatId, userId, message.message_id);
                break;
                
            case 'click':
                await handleClick(chatId, userId, message.message_id, callbackQuery.id);
                break;
                
            case 'withdraw':
                await showWithdrawOptions(chatId, userId, message.message_id);
                break;
                
            case 'tasks':
                await showTasks(chatId, userId, message.message_id);
                break;
                
            case 'instructions':
                await showInstructions(chatId, message.message_id);
                break;
                
            case 'ratings':
                await showRatings(chatId, message.message_id);
                break;
                
            case 'cases':
                await showCases(chatId, userId, message.message_id);
                break;
                
            case 'lottery':
                await showLottery(chatId, message.message_id);
                break;
                
            case 'promocode':
                await handlePromocodeInput(chatId, userId);
                break;
                
            default:
                if (data.startsWith('withdraw_')) {
                    const amount = parseInt(data.split('_')[1]);
                    await handleWithdraw(chatId, userId, amount, message.message_id, callbackQuery.id);
                } else if (data.startsWith('rating_')) {
                    const type = data.split('_')[1];
                    await showRatingType(chatId, type, message.message_id);
                } else if (data.startsWith('admin_')) {
                    await handleAdminCallback(chatId, userId, data, message.message_id, callbackQuery.id);
                } else if (data.startsWith('approve_') || data.startsWith('reject_')) {
                    await handleWithdrawalAction(chatId, userId, data, callbackQuery.id);
                } else if (data.startsWith('broadcast_')) {
                    const type = data.split('_')[1];
                    await handleBroadcast(type);
                    await bot.answerCallbackQuery(callbackQuery.id, '📢 Рассылка запущена!');
                } else if (data === 'admin_back') {
                    await showAdminPanel(chatId);
                } else if (data === 'open_case') {
                    await handleOpenCase(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data === 'check_task') {
                    await handleTaskCheck(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data === 'skip_task') {
                    await showTasks(chatId, userId, message.message_id);
                }
                break;
        }
        
    } catch (error) {
        console.error('Ошибка обработки callback:', error);
        try {
            await bot.answerCallbackQuery(callbackQuery.id, '❌ Произошла ошибка');
        } catch (e) {}
    }
});

// Проверка подписки
async function handleSubscriptionCheck(chatId, userId, messageId, callbackQueryId = null) {
    const subscriptionCheck = await SubGram.checkSubscription(userId, chatId);

    console.log('Проверка подписки:', JSON.stringify(subscriptionCheck, null, 2));

    // Если нет ссылок для подписки - значит пользователь подписан
    if (!subscriptionCheck.links || subscriptionCheck.links.length === 0) {
        await editMainMenu(chatId, messageId);
        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Прове��ка пройдена!');
        }
    } else {
        // Все еще есть каналы для подписки
        const message = SubGram.formatSubscriptionMessage(subscriptionCheck.links, subscriptionCheck.additional?.sponsors);
        const keyboard = SubGram.createSubscriptionKeyboard(subscriptionCheck.links);

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Вы ещё не подписались на все каналы!');
        }
    }
}

// Редактирование сообщения с главным меню
async function editMainMenu(chatId, messageId) {
    const message = '����� Главное меню\n\nВыберите действие:';
    const keyboard = createMainMenuKeyboard();
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать профиль
async function showProfile(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const completedTasks = await Database.getUserCompletedTasks(userId);
    
    const message = `👤 Ва�� профиль\n\n` +
                   `🆔 ID: ${user.user_id}\n` +
                   `👤 Имя: ${user.first_name}\n` +
                   `🌟 Баланс: ${user.balance} звёзд\n` +
                   `💰 Заработано за рефер��ло��: ${user.referral_earned}\n` +
                   `💎 Всего заработано: ${user.total_earned}\n` +
                   `👥 Всего рефералов: ${user.total_referrals}\n` +
                   `📈 Рефералов за день: ${user.daily_referrals}\n` +
                   `✅ Вып��лнено заданий: ${completedTasks}\n` +
                   `🏆 Очки: ${user.points}`;
    
    const keyboard = createProfileKeyboard();
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать информацию о приглашениях
async function showInviteInfo(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const botUsername = (await bot.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;
    
    const message = `👥 Пригласить друзей\n\n` +
                   `🎯 Приглашайте друзей и зарабатывайте звёзды!\n\n` +
                   `💰 За каждого реферала: 2 звезды\n` +
                   `📋 Реферал засчитывается когда:\n` +
                   `• Подписался на сп��нсор��кие каналы\n` +
                   `• Выполнил 2 задания\n\n` +
                   `🔗 Ваша ссылка:\n${referralLink}\n\n` +
                   `📊 Статистика:\n` +
                   `👥 Всего рефералов: ${user.total_referrals}\n` +
                   `📈 За сегодня: ${user.daily_referrals}\n` +
                   `💰 Заработано: ${user.referral_earned} звёзд`;
    
    const keyboard = createBackToMenuKeyboard();
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать кликер
async function showClicker(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const today = new Date().toDateString();
    const lastClickDate = user.last_click_time ? new Date(user.last_click_time).toDateString() : null;
    
    let clicksToday = 0;
    if (lastClickDate === today) {
        clicksToday = user.clicks_today || 0;
    }
    
    const remainingClicks = Math.max(0, 10 - clicksToday);
    const nextClickDelay = clicksToday > 0 ? clicksToday * 5 : 0;
    
    let canClick = true;
    let timeToWait = 0;
    
    if (user.last_click_time && lastClickDate === today) {
        const timeSinceLastClick = Date.now() - new Date(user.last_click_time).getTime();
        const requiredWait = nextClickDelay * 60 * 1000; // в миллисекундах
        
        if (timeSinceLastClick < requiredWait) {
            canClick = false;
            timeToWait = Math.ceil((requiredWait - timeSinceLastClick) / 1000 / 60);
        }
    }
    
    const message = `🖱 Кликер\n\n` +
                   `💰 За клик: 0.1 звезды\n` +
                   `📊 ��ликов сегодня: ${clicksToday}/10\n` +
                   `⏳ Осталось кликов: ${remainingClicks}\n\n` +
                   `${canClick ? '✅ Можете кликать!' : `⏰ Ждите ${timeToWait} мин.`}\n\n` +
                   `ℹ️ После каждого клика время ожидания\nувеличивается на 5 минут`;
    
    const keyboard = {
        inline_keyboard: [
            [{ 
                text: canClick && remainingClicks > 0 ? '🖱 КЛИК!' : '❌ Недоступно', 
                callback_data: canClick && remainingClicks > 0 ? 'click' : 'disabled'
            }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Обработка клика
async function handleClick(chatId, userId, messageId, callbackQueryId) {
    try {
        const clicksToday = await Database.updateUserClicks(userId);
        await Database.updateUserBalance(userId, 0.1);
        await Database.updateUserPoints(userId, 1);

        await bot.answerCallbackQuery(callbackQueryId, '🎉 +0.1 звезды! +1 очко!');
        await showClicker(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошиб��а клика:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка клика');
    }
}

// Показать варианты вывода
async function showWithdrawOptions(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    
    const message = `💰 Вывод звёзд\n\n` +
                   `💎 Ваш баланс: ${user.balance} звёзд\n\n` +
                   `📋 Выберите сумму для выв��да:`;
    
    const amounts = [15, 25, 50, 100, 1300];
    const keyboard = {
        inline_keyboard: []
    };
    
    amounts.forEach(amount => {
        keyboard.inline_keyboard.push([{
            text: `💰 ${amount} звёзд`,
            callback_data: `withdraw_${amount}`
        }]);
    });
    
    keyboard.inline_keyboard.push([{
        text: '🏠 В главное меню',
        callback_data: 'main_menu'
    }]);
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Обработка заявки на вывод
async function handleWithdraw(chatId, userId, amount, messageId, callbackQueryId) {
    const user = await Database.getUser(userId);

    if (user.balance < amount) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Недостаточно средств!');
        return;
    }
    
    try {
        // Списываем средства
        await Database.updateUserBalance(userId, amount, 'subtract');
        
        // Создаем заявку
        const request = await Database.createWithdrawalRequest(userId, amount);
        
        // Отправляем в админ чат
        const adminMessage = `💰 Новая заявка на вывод #${request.id}\n\n` +
                            `👤 Пользователь: ${user.first_name}\n` +
                            `🆔 ID: ${user.user_id}\n` +
                            `📱 Username: @${user.username || 'отсутствует'}\n` +
                            `💰 Сумма: ${amount} звёзд\n` +
                            `💎 Остаток: ${user.balance - amount} звёзд\n` +
                            `��� [Профиль](tg://user?id=${user.user_id})`;
        
        const adminKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Выполнено', callback_data: `approve_${request.id}` },
                    { text: '❌ ��тклонить', callback_data: `reject_${request.id}` }
                ]
            ]
        };
        
        await bot.sendMessage(config.ADMIN_CHAT_ID, adminMessage, {
            reply_markup: adminKeyboard,
            parse_mode: 'Markdown'
        });
        
        // Уведомляем по��ьзователя
        const userMessage = `✅ Заявка на вывод ${amount} звёзд отправлена!\n\n` +
                           `📋 Номер заявки: #${request.id}\n` +
                           `⏳ Ожидайте обработки администра��ором`;
        
        await bot.editMessageText(userMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });
        
    } catch (error) {
        console.error('Ошибка вывода:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка создания заявки');
    }
}

// Показать задания
async function showTasks(chatId, userId, messageId) {
    // Получаем задание от SubGram
    const subgramTask = await SubGram.getTaskChannels(userId, chatId);
    console.log('Ответ задания SubGram:', JSON.stringify(subgramTask, null, 2));
    
    if (subgramTask.status === 'error') {
        // Ошибка SubGram - показываем сообщение об ошибке
        const message = `📋 Задания\n\n` +
                       `⚠️ Временные проблемы с получением заданий.\n` +
                       `🔄 Попробуйте позже или обратитесь к администратору.`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });
    } else if (subgramTask.links && subgramTask.links.length > 0) {
        // Показываем первое задание от SubGram
        const link = subgramTask.links[0];
        const sponsor = subgramTask.additional?.sponsors?.[0];
        const channelName = sponsor?.resource_name || 'Канал';
        
        const message = `📋 Доступное ��адание\n\n` +
                       `📢 Подпишитесь на канал: ${channelName}\n` +
                       `💰 Награда: 0.3 звезды\n` +
                       `🏆 Бонус: +1 очко\n\n` +
                       `ℹ️ После подписки нажмите "Проверить выполнение"`;
        
        const keyboard = {
            inline_keyboard: [
                [{ text: '📢 Перейти на канал', url: link }],
                [{ text: '✅ Проверить выполнение', callback_data: 'check_task' }],
                [{ text: '⏭ Пропустить', callback_data: 'skip_task' }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } else {
        // Не�� заданий от SubGram, показываем кастомные
        const message = `📋 Задания\n\n` +
                       `ℹ️ В данный момент нет доступных заданий.\n` +
                       `⏰ Проверьте позже!`;
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });
    }
}

// Показать инструкции
async function showInstructions(chatId, messageId) {
    const message = `📖 Инструкция по боту\n\n` +
                   `🌟 Как зарабатывать з��ёзды:\n\n` +
                   `👥 Рефералы:\n` +
                   `• Приглашайте друзей по св��ей ссылке\n` +
                   `• За каждого реферала: 2 звезды\n` +
                   `• Реферал засчитывается после подписки на спонсоров и выполнения 2 заданий\n\n` +
                   `🖱 Кликер:\n` +
                   `• Кликайте до 10 раз в день\n` +
                   `• ��а клик: 0.1 звезды\n` +
                   `• Время ��жидания увеличивается\n\n` +
                   `📋 Задания:\n` +
                   `• Подписывайтесь на к��н����ы\n` +
                   `• За задание: 0.3 звезды\n\n` +
                   `• Рейтинги:\n` +
                   `�� Зарабатывайте очки\n` +
                   `• Топ 5 недели получают бонусы\n\n` +
                   `🎁 Кейсы:\n` +
                   `• 1 кейс в день за 5 рефералов\n` +
                   `• Выигрыш: 1-10 звёзд\n\n` +
                   `💰 Вывод:\n` +
                   `• Минимум: 15 звёзд\n` +
                   `• Обработка админами`;
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: createBackToMenuKeyboard()
    });
}

// Показать рейтинги
async function showRatings(chatId, messageId) {
    const message = `🏆 Рейтинги\n\n` +
                   `📊 Выберите тип рейтинга:`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🌟 Общий рейт��нг', callback_data: 'rating_overall' }],
            [{ text: '📅 Недельный рейтинг', callback_data: 'rating_weekly' }],
            [{ text: '🏠 В г��авное меню', callback_data: 'main_menu' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать рейтинг по типу
async function showRatingType(chatId, type, messageId) {
    let leaderboard, title;
    
    if (type === 'overall') {
        leaderboard = await Database.getOverallLeaderboard();
        title = '🌟 Общи�� рейтинг';
    } else {
        leaderboard = await Database.getWeeklyLeaderboard();
        title = '📅 Недельный р��йтинг';
    }
    
    let message = `${title}\n\n`;
    
    if (leaderboard.length === 0) {
        message += 'ℹ️ Рейтинг пуст';
    } else {
        leaderboard.forEach((user, index) => {
            const position = index + 1;
            const emoji = position <= 3 ? ['🥇', '🥈', '🥉'][position - 1] : `${position}.`;
            const points = type === 'overall' ? user.points : user.weekly_points;
            const name = user.first_name || 'Пользователь';
            
            message += `${emoji} ${name} - ${points} очков\n`;
        });
        
        if (type === 'weekly') {
            message += `\n🎁 Награды за топ 5:\n`;
            message += `🥇 1 ��есто: 100 звёзд\n`;
            message += `🥈 2 место: 75 звёзд\n`;
            message += `🥉 3 место: 50 звёзд\n`;
            message += `4 место: 25 звёзд\n`;
            message += `5 место: 15 звёзд`;
        }
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: createBackToMenuKeyboard()
    });
}

// Показать кейсы
async function showCases(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const today = new Date().toDateString();
    const lastCaseDate = user.last_case_open ? new Date(user.last_case_open).toDateString() : null;
    
    const canOpenCase = user.daily_referrals >= 5 && lastCaseDate !== today;
    
    const message = `🎁 Кейсы\n\n` +
                   `📋 Условия:\n` +
                   `• 5 рефералов за день\n` +
                   `• 1 кейс в день\n\n` +
                   `📊 Ваша статистика:\n` +
                   `👥 Рефералов сегодня: ${user.daily_referrals}\n` +
                   `🎁 Кей�� ${lastCaseDate === today ? 'уже открыт' : 'доступен'}\n\n` +
                   `💰 Возможный выигрыш: 1-10 звёзд`;
    
    const keyboard = {
        inline_keyboard: [
            [{ 
                text: canOpenCase ? '🎁 Открыть кейс' : '❌ Недоступно', 
                callback_data: canOpenCase ? 'open_case' : 'disabled'
            }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать лотереи
async function showLottery(chatId, messageId) {
    const lotteries = await Database.getActiveLotteries();
    
    let message = `🎲 Лотереи\n\n`;
    
    if (lotteries.length === 0) {
        message += 'ℹ️ Активных лотерей нет';
    } else {
        lotteries.forEach(lottery => {
            const progress = (lottery.sold_tickets / lottery.total_tickets * 100).toFixed(1);
            message += `🎟 ${lottery.name}\n`;
            message += `💰 Цена билета: ${lottery.ticket_price} звёзд\n`;
            message += `🎫 Билетов: ${lottery.sold_tickets}/${lottery.total_tickets} (${progress}%)\n`;
            message += `🏆 Победителей: ${lottery.winners_count}\n\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: createBackToMenuKeyboard()
    });
}

// обработка ��вода промокода
async function handlePromocodeInput(chatId, userId) {
    userStates.set(userId, 'waiting_promocode');
    await bot.sendMessage(chatId, '🎫 Введите промокод:');
}

// Обработчик текстовых сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    
    const userState = userStates.get(userId);
    
    if (userState === 'waiting_promocode') {
        userStates.delete(userId);
        
        try {
            const promocode = await Database.usePromocode(userId, text);
            await Database.updateUserBalance(userId, promocode.reward);
            
            await bot.sendMessage(chatId, 
                `✅ Промокод активирован!\n💰 Вы получили ${promocode.reward} звёзд`
            );
        } catch (error) {
            await bot.sendMessage(chatId, `❌ ${error.message}`);
        }
    }
});

// Команда /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Проверка админских прав (добавьте свой ID в config.ADMIN_IDS)
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '❌ У вас нет прав администратора');
        return;
    }

    await showAdminPanel(chatId);
});

// Показать админ-панель
async function showAdminPanel(chatId) {
    const message = '👨‍💼 Адм��н-панель\n\nВыберите действие:';

    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Статистика бота', callback_data: 'admin_stats' }],
            [{ text: '📋 Управление заданиями', callback_data: 'admin_tasks' }],
            [{ text: '🎲 Управление лотереями', callback_data: 'admin_lottery' }],
            [{ text: '🎫 Управление промокодами', callback_data: 'admin_promocodes' }],
            [{ text: '📢 Рассылка соо��щений', callback_data: 'admin_broadcast' }],
            [{ text: '🏆 Недельные награды', callback_data: 'admin_rewards' }],
            [{ text: '💰 Заявки на вывод', callback_data: 'admin_withdrawals' }]
        ]
    };

    await bot.sendMessage(chatId, message, { reply_markup: keyboard });
}

// Обработчик админских действий
async function handleAdminCallback(chatId, userId, data, messageId, callbackQueryId) {
    // Проверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    switch (data) {
        case 'admin_stats':
            await showBotStats(chatId, messageId);
            break;
        case 'admin_tasks':
            await showAdminTasks(chatId, messageId);
            break;
        case 'admin_lottery':
            await showAdminLottery(chatId, messageId);
            break;
        case 'admin_promocodes':
            await showAdminPromocodes(chatId, messageId);
            break;
        case 'admin_broadcast':
            await showAdminBroadcast(chatId, messageId);
            break;
        case 'admin_rewards':
            await showAdminRewards(chatId, messageId);
            break;
        case 'admin_withdrawals':
            await showAdminWithdrawals(chatId, messageId);
            break;
    }

    await bot.answerCallbackQuery(callbackQueryId);
}

// Показать ста��истику бота
async function showBotStats(chatId, messageId) {
    try {
        const totalUsers = await Database.pool.query('SELECT COUNT(*) as count FROM users');
        const totalStarsEarned = await Database.pool.query('SELECT SUM(total_earned) as sum FROM users');
        const totalWithdrawals = await Database.pool.query('SELECT SUM(amount) as sum FROM withdrawal_requests WHERE status = \'approved\'');
        const pendingWithdrawals = await Database.pool.query('SELECT COUNT(*) as count, SUM(amount) as sum FROM withdrawal_requests WHERE status = \'pending\'');

        const message = `📊 Статистика бота\n\n` +
                       `👥 Всего пользо��ателей: ${totalUsers.rows[0].count}\n` +
                       `⭐ Всего заработано звёзд: ${totalStarsEarned.rows[0].sum || 0}\n` +
                       `💰 Всего выведено: ${totalWithdrawals.rows[0].sum || 0}\n` +
                       `⏳ Заявок в ожидании: ${pendingWithdrawals.rows[0].count}\n` +
                       `💎 С��мма в ожидании: ${pendingWithdrawals.rows[0].sum || 0}`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка статистики:', error);
    }
}

// Показать управление заданиями
async function showAdminTasks(chatId, messageId) {
    const message = `📋 Управление заданиями\n\n` +
                   `Здесь вы можете создавать со��ственные задания\n` +
                   `помимо заданий от SubGram`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать задание', callback_data: 'create_task' }],
            [{ text: '📋 Список заданий', callback_data: 'list_tasks' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать рассылку
async function showAdminBroadcast(chatId, messageId) {
    const message = `📢 Рассылка сооб��ений\n\n` +
                   `Выберите готовое сообщение для рассылки:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Сообщени�� о рейтинге', callback_data: 'broadcast_rating' }],
            [{ text: '📋 Сообщение о заданиях', callback_data: 'broadcast_tasks' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Обработка рассылки
async function handleBroadcast(type) {
    try {
        const users = await Database.pool.query('SELECT user_id FROM users');
        let message, keyboard;

        if (type === 'rating') {
            message = `🏆 Быстрее попади в топ 5 по очкам в недельном рейтинге и получи дополнительные звёзды в конце недели!\n\n` +
                     `🥇 1 место: 100 зв��зд\n` +
                     `🥈 2 место: 75 звёзд\n` +
                     `🥉 3 место: 50 звёзд\n` +
                     `4 место: 25 звёзд\n` +
                     `5 место: 15 звёзд`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
                    [{ text: '📋 Задания', callback_data: 'tasks' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        } else {
            message = `📋 Новые задания уже ждут тебя!\n\n` +
                     `💰 Зарабатывай звёзды выполняя простые задани��!`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
                    [{ text: '📋 Задания', callback_data: 'tasks' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        }

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.user_id, message, { reply_markup: keyboard });
                await new Promise(resolve => setTimeout(resolve, 50)); // Задержка между отправ��ами
            } catch (error) {
                console.log(`Не удалось отп��авить сообщ��ние пользователю ${user.user_id}`);
            }
        }

        console.log(`Рассылка ${type} заверше��а`);
    } catch (error) {
        console.error('Ошибка расс��лки:', error);
    }
}

// Показать заявки на вывод
async function showAdminWithdrawals(chatId, messageId) {
    try {
        const pending = await Database.getPendingWithdrawals();

        let message = `💰 Заявки на вывод\n\n`;

        if (pending.length === 0) {
            message += 'ℹ️ Нет ожидающих заявок';
        } else {
            message += `📋 Ожидающих заявок: ${pending.length}\n\n`;

            for (const request of pending.slice(0, 5)) { // Показываем первые 5
                message += `📄 Заявка #${request.id}\n`;
                message += `👤 ${request.first_name} (@${request.username || 'нет'})\n`;
                message += `💰 Сумма: ${request.amount} звёзд\n`;
                message += `💎 Остаток: ${request.balance} зв��зд\n\n`;
            }
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Обновить', callback_data: 'admin_withdrawals' }],
                [{ text: '🔙 Назад ��� админ-панели', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа заявок:', error);
    }
}

// Обработка действий с заявками на вывод
async function handleWithdrawalAction(chatId, userId, data, callbackQueryId) {
    try {
        const [action, requestId] = data.split('_');
        const request = await Database.pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [requestId]);

        if (request.rows.length === 0) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка не найдена');
            return;
        }

        const requestData = request.rows[0];

        if (action === 'approve') {
            // Одобряем заявку
            await Database.processWithdrawal(requestId, 'approved');

            // Отправляем в чат платежей
            const paymentMessage = `✅ Выплата #${requestId} выполнена\n\n` +
                                 `👤 Пользователь: ${requestData.first_name}\n` +
                                 `💰 ��умма: ${requestData.amount} звёзд`;

            await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage);

            // Уведомляем пользователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `✅ Ваша заявка #${requestId} на вывод ${requestData.amount} звёзд одобрена и выполнена!`
                );
            } catch (e) {}

            await bot.answerCallbackQuery(callbackQueryId, '✅ Заявка одобрена');

        } else if (action === 'reject') {
            // Отклоняем заявку и возвращаем средства
            await Database.processWithdrawal(requestId, 'rejected', 'Отклонено администратором');
            await Database.updateUserBalance(requestData.user_id, requestData.amount, 'add');

            // Уведомляем пользователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `❌ Ваша заявка #${requestId} на вывод ${requestData.amount} звёзд была отклонена.\n` +
                    `💰 Средства возвращены на баланс.`
                );
            } catch (e) {}

            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка отклонена');
        }

    } catch (error) {
        console.error('Ошибка обработки заявки:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка обработки');
    }
}

// Показать ад��инские лотереи
async function showAdminLottery(chatId, messageId) {
    const message = `🎲 Управление лотереями\n\n` +
                   `Здесь вы можете создавать и упр��влять лотереями`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать лотерею', callback_data: 'create_lottery' }],
            [{ text: '📋 Активные лотереи', callback_data: 'list_lotteries' }],
            [{ text: '🔙 Назад к админ-пане��и', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать админск��е промокоды
async function showAdminPromocodes(chatId, messageId) {
    const message = `🎫 Управление промокодами\n\n` +
                   `Здесь вы можете соз��авать и упр��влять промокодами`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать промокод', callback_data: 'create_promocode' }],
            [{ text: '📋 Список промокодов', callback_data: 'list_promocodes' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать настройки наград
async function showAdminRewards(chatId, messageId) {
    const message = `🏆 Недельные награды\n\n` +
                   `Текущие награды за топ 5:\n` +
                   `🥇 1 место: ${config.WEEKLY_REWARDS[1]} звёзд\n` +
                   `🥈 2 место: ${config.WEEKLY_REWARDS[2]} звёзд\n` +
                   `🥉 3 место: ${config.WEEKLY_REWARDS[3]} звёзд\n` +
                   `4 место: ${config.WEEKLY_REWARDS[4]} звёз��\n` +
                   `5 место: ${config.WEEKLY_REWARDS[5]} звёзд\n\n` +
                   `⚙️ Автоматическое начисление: ВКЛ`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Выдать награды сейч��с', callback_data: 'give_rewards_now' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Обработка открытия кейса
async function handleOpenCase(chatId, userId, messageId, callbackQueryId) {
    try {
        const user = await Database.getUser(userId);
        const today = new Date().toDateString();
        const lastCaseDate = user.last_case_open ? new Date(user.last_case_open).toDateString() : null;

        if (user.daily_referrals < 5) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Нужно 5 рефералов за день!');
            return;
        }

        if (lastCaseDate === today) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Кейс уже ��ткрыт сегодня!');
            return;
        }

        // Генерируем случайный выигрыш (1-10 звёзд)
        const reward = Math.floor(Math.random() * 10) + 1;

        // Обновляем баланс и дату открытия кейса
        await Database.updateUserBalance(userId, reward);
        await Database.pool.query('UPDATE users SET last_case_open = CURRENT_DATE WHERE user_id = $1', [userId]);

        const message = `🎁 Кейс открыт!\n\n` +
                       `🎉 Поздравляем! Вы выиграли ${reward} звёзд!\n` +
                       `💰 Звёзды добавлены на ваш баланс`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });

        await bot.answerCallbackQuery(callbackQueryId, `🎉 Выиграли ${reward} звёзд!`);

    } catch (error) {
        console.error('Ошибка открытия ��ейса:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка открытия кейса');
    }
}

// Проверка выполнени�� задания
async function handleTaskCheck(chatId, userId, messageId, callbackQueryId) {
    try {
        // Получаем новое задание от SubGram чтобы проверить подписку
        const taskCheck = await SubGram.getTaskChannels(userId, chatId);

        console.log('Проверка задания:', JSON.stringify(taskCheck, null, 2));

        // Если н��т ссылок или статус ok - значит ��одписался
        if (!taskCheck.links || taskCheck.links.length === 0 || taskCheck.status === 'ok') {
            // Задан��е выполнено
            await Database.updateUserBalance(userId, 0.3);
            await Database.updateUserPoints(userId, 1);

            const message = `✅ Задание выполнено!\n\n` +
                           `💰 В�� получили 0.3 звезды\n` +
                           `🏆 Вы получили 1 очко\n\n` +
                           `Хотите выполнить ещё одно задание?`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '📋 Следующее задание', callback_data: 'tasks' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });

            await bot.answerCallbackQuery(callbackQueryId, '✅ Задание выполнено!');

        } else {
            // Все еще есть задание для выполнения
            await bot.answerCallbackQuery(callbackQueryId, '❌ Подп��шитесь на канал сначала!');
        }

    } catch (error) {
        console.error('Ошибка проверки задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки');
    }
}

// Еженедельное начисление наград (воскресенье в 20:00 МСК)
cron.schedule('0 20 * * 0', async () => {
    console.log('Начисление еженедельных наград...');
    
    try {
        const leaderboard = await Database.getWeeklyLeaderboard(5);
        
        for (let i = 0; i < leaderboard.length; i++) {
            const user = leaderboard[i];
            const position = i + 1;
            const reward = config.WEEKLY_REWARDS[position];
            
            if (reward) {
                await Database.updateUserBalance(user.user_id, reward);
                
                try {
                    await bot.sendMessage(user.user_id, 
                        `🏆 Поздравляем! Вы заняли ${position} место в недельном рейтинге!\n` +
                        `💰 Ваша награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалось от��равить наград�� по��ьзователю ${user.user_id}`);
                }
            }
        }
        
        // Сброс недельных очков
        await Database.resetWeeklyPoints();
        console.log('Еженедельные награды начи��лены');
        
    } catch (error) {
        console.error('Ошибка начисления еженедель��ых наград:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
    console.log('Polling error:', error.message);
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
        console.log('Конфликт polling - другой экземпляр бота уже запущен');
        // Не пытаемся переподключиться, так как эт�� усугубляет проблему
    }
});

// Обработка ошибок webhook
bot.on('webhook_error', (error) => {
    console.log('Webhook error:', error.message);
});

// Запуск бота
initBot();

// Обработка ошибок
process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nПолучен сигнал SIGINT. Завершение работы...');
    webhookHandler.stop();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nПолучен сигнал SIGTERM. Завершение работы...');
    webhookHandler.stop();
    process.exit(0);
});
