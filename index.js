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

// Временное хранение состояний пользователей
const userStates = new Map();

// Проверка выполнения условий для засчитывания реферала
async function checkReferralConditions(userId) {
    try {
        const user = await Database.getUser(userId);
        if (!user || !user.referrer_id) {
            return; // Нет реферера
        }

        // Проверяем подписку на спонсорски�� каналы
        const subscriptionStatus = await checkUserSubscription(userId, userId);
        if (!subscriptionStatus.isSubscribed) {
            console.log(`👥 Реферал ${userId} еще не подписан на спонсорские каналы`);
            return;
        }

        // Проверяем количество выполненных SubGram заданий (именно заданий, а не общих задач)
        const completedSubgramTasks = await Database.getUserSubgramTasksCount(userId);
        if (completedSubgramTasks < 2) {
            console.log(`👥 Реферал ${userId} выполнил только ${completedSubgramTasks}/2 SubGram заданий`);
            return;
        }

        // Проверяем не была ли уже начислена награда
        if (user.referral_completed) {
            console.log(`👥 Реферальная награда за пользователя ${userId} уже была начислена`);
            return;
        }

        // Все условия выполнены - начисляем награду
        console.log(`🎉 Реферал ${userId} выполнил все условия! Начисляем награду рефереру ${user.referrer_id}`);

        await Database.updateUserBalance(user.referrer_id, 2);
        await Database.updateUserPoints(user.referrer_id, 1);

        // Отмечаем что реферальная награда начислена
        await Database.pool.query(
            'UPDATE users SET referral_completed = TRUE WHERE user_id = $1',
            [userId]
        );

        // Увеличиваем счетчики рефералов
        await Database.pool.query(
            'UPDATE users SET total_referrals = total_referrals + 1, daily_referrals = daily_referrals + 1, referral_earned = referral_earned + 2 WHERE user_id = $1',
            [user.referrer_id]
        );

        // Уведомляем реферера
        try {
            await bot.sendMessage(user.referrer_id,
                '🎉 Ваш реферал выполнил все условия!\n' +
                '✅ Подписался на спонсорские каналы\n' +
                '✅ Выполнил 2 задания\n\n' +
                '💰 Вы получили 2 звезды\n' +
                '🏆 Вы получили 1 очко'
            );
        } catch (e) {
            console.log(`Не удалось отправить уведомление рефереру ${user.referrer_id}`);
        }

    } catch (error) {
        console.error('Ошибка проверки реферальных условий:', error);
    }
}

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

        // Установка команд бота
        await bot.setMyCommands([
            { command: 'start', description: 'Запустить бота' },
            { command: 'menu', description: 'Главное меню' },
            { command: 'admin', description: 'Админ панель' }
        ]);
        
    } catch (error) {
        console.error('Ошибка запуска бота:', error);
        process.exit(1);
    }
}

// Создание клавиатур
function createMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 Про��иль', callback_data: 'profile' }],
            [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
            [{ text: '🖱 Кликер', callback_data: 'clicker' }],
            [{ text: '💰 Вывод звёзд', callback_data: 'withdraw' }],
            [{ text: '📋 Задания', callback_data: 'tasks' }],
            [{ text: '�� Инструкция', callback_data: 'instructions' }],
            [{ text: '🏆 Рейтинг��', callback_data: 'ratings' }],
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

// Проверка подписки пользователя для заданий (НЕ блокирует доступ, а возвращает доступные задания SubGram для заработка)
// ВАЖНО: Это отдельная функция для получения ЗАДАНИЙ, а не спонсорских каналов для доступа к боту!
async function checkUserSubscriptionForTasks(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
    try {
        console.log(`📋 Получение заданий SubGram для пользователя ${userId}`);

        // Получаем задания через getTaskChannels с action='newtask' и MaxOP=10 (больше заданий)
        console.log(`🌐 ВЫЗЫВАЕМ SubGram.getTaskChannels для заданий`);
        const taskChannels = await SubGram.getTaskChannels(userId, chatId, firstName, languageCode, isPremium);
        console.log(`📥 SubGram ОТВЕТ для заданий (getTaskChannels):`, JSON.stringify(taskChannels, null, 2));

        return {
            status: taskChannels.status || 'ok',
            availableChannels: taskChannels.links || [],
            additional: taskChannels.additional || {},
            error: taskChannels.status === 'error' ? taskChannels.message : null
        };

    } catch (error) {
        console.error(`❌ Ошибка получения заданий для пользователя ${userId}:`, error);
        return {
            status: 'error',
            availableChannels: [],
            additional: {},
            error: error.message
        };
    }
}

// Проверка подписки пользователя на СПОНСОРСКИЕ каналы (для блокировки доступа к функциям бота)
// ВАЖНО: Это функция для проверки СПОНСОРСКИХ каналов (action='subscribe', MaxOP=3), а НЕ для заданий!
async function checkUserSubscription(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
    try {
        // Сначала проверяем кеш вебхуков (свежие данные - не старше 5 минут)
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);

        if (cachedStatus.lastUpdate && (Date.now() - cachedStatus.lastUpdate) < 5 * 60 * 1000) {
            console.log(`🗄️ Используем кешированные данные подписки для ��ользователя ${userId}`);
            console.log(`📊 Кеш:`, cachedStatus);

            if (cachedStatus.isSubscribed === false && cachedStatus.unsubscribedLinks.length > 0) {
                // Пользователь точно не подписан - есть неподписанные канал��
                return {
                    isSubscribed: false,
                    subscriptionData: {
                        links: cachedStatus.unsubscribedLinks,
                        status: 'webhook_cache'
                    }
                };
            }

            if (cachedStatus.isSubscribed === true) {
                // Пользовател�� точно подписан
                return {
                    isSubscribed: true,
                    subscriptionData: { status: 'webhook_cache' }
                };
            }
        }

        // Если нет кешированных данных, делаем запрос к SubGram для СПОНСОРСКИХ каналов
        console.log(`🌐 Запрос к SubGram API для проверки СПОНСОРСКИХ каналов пользователя ${userId}`);
        const taskChannels = await SubGram.checkSubscription(
            userId,
            chatId,
            firstName,
            languageCode,
            isPremium
        );

        console.log(`📥 SubGram ответ:`, JSON.stringify(taskChannels, null, 2));

        // Проверяем ответ SubGram
        if (taskChannels.status === 'error') {
            console.log(`❌ Ошибка SubGram, проверяем кеш как fallback`);

            // В случае ошибки API используем кеш если есть
            if (cachedStatus.lastUpdate) {
                return {
                    isSubscribed: cachedStatus.isSubscribed === true, // СТРОГО: только если точно подписан
                    subscriptionData: {
                        status: 'fallback_cache',
                        links: cachedStatus.unsubscribedLinks || []
                    }
                };
            }

            // СТРОГИЙ FALLBACK: если нет кеша - НЕ подписан (безопасность)
            return {
                isSubscribed: false,
                subscriptionData: {
                    status: 'error_fallback',
                    links: [],
                    message: 'Ошибка проверки подписки - доступ заб��окирован'
                }
            };
        }

        // ВАЖНО: статус "warning" означает что пользователь НЕ подписан!
        if (taskChannels.status === 'warning') {
            console.log(`⚠️ Пользователь ${userId} НЕ подписан (статус warning): ${taskChannels.message}`);

            // Для статуса warning SubGram может не ��озвращать ссылки, попробуем разные способы получения
            if (!taskChannels.links || taskChannels.links.length === 0) {
                console.log(`🔄 Запрашиваем ссылки каналов для пользователя ${userId} (warning без с��ылок)`);

                // Попробуем несколько способов получения ссылок
                const attempts = [
                    // 1. Попытка с MaxOP=1 (как задания)
                    () => SubGram.getTaskChannels(userId, chatId, firstName, languageCode, isPremium),
                    // 2. Попытка с обычными параметрами но MaxOP=1
                    () => SubGram.getChannelLinks(userId, chatId, firstName, languageCode, isPremium)
                ];

                for (let i = 0; i < attempts.length; i++) {
                    try {
                        console.log(`🔄 Попытка ${i + 1}/2 получения ссыл��к`);
                        const linksCheck = await attempts[i]();

                        if (linksCheck.links && linksCheck.links.length > 0) {
                            taskChannels.links = linksCheck.links;
                            taskChannels.additional = linksCheck.additional;
                            console.log(`✅ Получены ссылки (попытка ${i + 1}): ${linksCheck.links.length} каналов`);
                            break;
                        } else {
                            console.log(`⚠️ Попытка ${i + 1} не дала ссылок`);
                        }
                    } catch (e) {
                        console.error(`❌ Ошибка попытки ${i + 1}:`, e.message);
                    }
                }

                if (!taskChannels.links || taskChannels.links.length === 0) {
                    console.log(`⚠️ Все попытки получения ссылок не удались для пользователя ${userId}`);
                }
            }

            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Если есть ссылки для подписки - значит пользователь не подписан
        if (taskChannels.links && taskChannels.links.length > 0) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан, есть ${taskChannels.links.length} каналов`);
            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Статус "ok" и нет ссылок - пользователь подписан
        if (taskChannels.status === 'ok') {
            console.log(`✅ Пользователь ${userId} подписан на все каналы (статус ok)`);
            return {
                isSubscribed: true,
                subscriptionData: taskChannels
            };
        }

        // Для всех остальных случаев используем СТРОГИЙ подход - НЕ подписан!
        console.log(`⚠️ Неизвестный статус для пользователя ${userId}: ${taskChannels.status}, считаем НЕ подписанным (СТРОГО)`);
        return {
            isSubscribed: false,
            subscriptionData: taskChannels
        };

    } catch (error) {
        console.error(`⚠️ Ошибка проверки подпис��и для пользователя ${userId}:`, error);

        // В случае ��шибки проверяем кеш как fallback
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);
        if (cachedStatus.lastUpdate) {
            console.log(`🗄️ Используем кеш как fallback после ошибки API`);
            return {
                isSubscribed: cachedStatus.isSubscribed === true, // СТРОГО: только если точно подписан
                subscriptionData: {
                    status: 'fallback_cache',
                    links: cachedStatus.unsubscribedLinks || []
                }
            };
        }

        // СТРОГИЙ FALLBACK: если нет данных - НЕ подписан (безопасность превыше всего)
        console.log(`🔒 СТРОГИЙ FALLBACK: нет данных о подписке, считаем НЕ подпис��нным (безопасность)`);
        return {
            isSubscribed: false,
            subscriptionData: {
                status: 'strict_fallback',
                links: [],
                message: 'Нет данных о подписке - доступ заблокирован'
            }
        };
    }
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
            
            // Реферальная награда будет начислена позже после выполнения условий
            if (referrerId) {
                console.log(`👥 Новый пользователь ${userId} пришел по реферальной ссылке от ${referrerId}`);
                // Награда будет начислена в функции checkReferralConditions()
            }
        }
        
        // СНАЧАЛА проверяем подписку - это самое важн��е!
        console.log(`🔍 Проверка подписки для пользова��еля ${userId}`);
        const subscriptionStatus = await checkUserSubscription(
            userId, 
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );
        
        console.log(`📊 Статус подписки:`, subscriptionStatus);

        // Если пользователь НЕ подписан - показываем спонсорские каналы (даж�� если ссылки пустые)
        if (!subscriptionStatus.isSubscribed) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан, блокируем доступ`);

            // Если есть ссылки - показываем их
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(`📢 Показыв��ем ${subscriptionStatus.subscriptionData.links.length} спонсорских каналов`);
                const message = SubGram.formatSubscriptionMessage(
                    subscriptionStatus.subscriptionData.links,
                    subscriptionStatus.subscriptionData.additional?.sponsors
                );
                const keyboard = SubGram.createSubscriptionKeyboard(subscriptionStatus.subscriptionData.links);
                await bot.sendMessage(chatId, message, { reply_markup: keyboard });
            } else {
                // Если нет ссылок, но пользователь не подписан - показываем общее сообщение
                console.log(`⚠️ Нет ссылок каналов, показываем общее сообщение о подписке`);
                await bot.sendMessage(chatId,
                    '🔒 Для доступа к боту необходимо подписаться на спонсорские каналы.\n\n' +
                    '⏳ Пожалуйста, подождите немного или обратитесь к администратору.'
                );
            }
            return; // ВАЖНО: выходим, НЕ показываем главное меню
        }

        // Только ес��и пользователь точно подписан - показываем главное меню
        console.log(`✅ Пользователь ${userId} подписан, показываем главное меню`);
        await showMainMenu(chatId, userId);
        
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Показать главное меню
async function showMainMenu(chatId, userId = null) {
    const message = '🌟 Добро пожаловать в бота для заработка звёзд!\n\n' +
                   '⭐ З��рабатывайте звёзды различными способами:\n' +
                   '• Приглашайте друзей\n' +
                   '• Выполняйте задания\n' +
                   '• Используйте кликер\n' +
                   '• Участвуйте в лотереях\n\n' +
                   'Выберите действие:';

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
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: '❌ Пользователь не найден. Нажмите /start',
                show_alert: true
            });
            return;
        }

        // КРИТИЧНО: ЖЁСТКА�� проверка подписки для ВСЕХ действий в самом начале (кроме специальных команд)
        const allowedWithoutSubscription = [
            'check_subscription',
            'admin_',
            'approve_',
            'reject_',
            'disabled',  // для заблокированных кнопок
            'tasks',     // ВАЖНО: разрешаем доступ к заданиям для их выполнения
            'check_task', // проверка выполнения задания
            'skip_task',  // про��уск задания
            'check_custom_task_', // проверка кастомного задания
            'broadcast_', // рассылки (админские)
            'admin_back'  // возвр��т в админ панель
        ];

        // Проверяем разрешённые команды (с учётом точн��го соответствия для некоторых)
        const isAllowedCommand = allowedWithoutSubscription.some(cmd => {
            if (cmd.endsWith('_')) {
                return data.startsWith(cmd); // для команд с префиксом (admin_, check_custom_task_, и т.д.)
            } else {
                return data === cmd; // для точ��ых команд (tasks, check_task, skip_task, admin_back)
            }
        });

        // ЖЁСТКАЯ БЛОКИРОВКА: сначала проверяем подписку для ВСЕХ команд кроме разрешённых
        if (!isAllowedCommand) {
            console.log(`🔍 ЖЁСТКАЯ проверка подписки для команды: ${data} пользователя ${userId}`);
            const subscriptionStatus = await checkUserSubscription(
                userId,
                chatId,
                callbackQuery.from.first_name || '',
                callbackQuery.from.language_code || 'ru',
                callbackQuery.from.is_premium || false
            );

            // СТРОГАЯ ПРОВЕРК��: если НЕ подписан - ЖЁСТКО блокируем
            if (!subscriptionStatus.isSubscribed) {
                console.log(`🔒 ЖЁСТКАЯ БЛОКИРОВКА действ��я "${data}" для неподписанного пользователя ${userId}`);

                // Показываем алерт с жёсткой блокировко��
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '🔒 Доступ заблокирован! Сначала подпишитесь на все ��понсорские каналы!',
                    show_alert: true
                });

                // Если есть ссылки на каналы - показываем их
                if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                    const subscriptionData = subscriptionStatus.subscriptionData;
                    const subscriptionMessage = SubGram.formatSubscriptionMessage(subscriptionData.links, subscriptionData.additional?.sponsors);
                    const keyboard = SubGram.createSubscriptionKeyboard(subscriptionData.links);

                    try {
                        // Пытаемся отредактировать сообщение для замены старого меню
                        await bot.editMessageText(subscriptionMessage, {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            reply_markup: keyboard
                        });
                    } catch (e) {
                        console.log('Не удалось отредактировать сообщ��ние, удаляем старое и отправляем новое');
                        // Пытаемся удалить старое сообщение с меню
                        try {
                            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                        } catch (deleteError) {
                            console.log('Не удалось удалить старое сообщение:', deleteError.message);
                        }
                        // Отправляем новое сообщение с каналами
                        await bot.sendMessage(chatId, subscriptionMessage, { reply_markup: keyboard });
                    }
                } else {
                    // Если нет ссылок, показы��аем общее сообщение о блокировке
                    const blockMessage = '🔒 Доступ к боту заблокирова��!\n\n' +
                                       '📢 Необходимо подписаться на спонсорские каналы.\n' +
                                       '⏳ Попробуйте нажать /start для получения каналов.';

                    try {
                        await bot.editMessageText(blockMessage, {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '🔄 Проверить подписки', callback_data: 'check_subscription' }
                                ]]
                            }
                        });
                    } catch (e) {
                        console.log('Не удалось отредактировать сообщение, удаляем старое и отправляем новое');
                        // Пытаемся удалить старое сообщение с меню
                        try {
                            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                        } catch (deleteError) {
                            console.log('Не удалось удалить старое сообщение:', deleteError.message);
                        }
                        // Отправляем новое сообщ��ние с блокировкой
                        await bot.sendMessage(chatId, blockMessage, {
                            reply_markup: {
                                inline_keyboard: [[
                                    { text: '🔄 Проверить подписки', callback_data: 'check_subscription' }
                                ]]
                            }
                        });
                    }
                }

                return; // КРИТИЧНО: немедленно завершаем обработку
            }
        }

        // Отвечаем на callback_query только для команд, которые н�� отвечают сами
        const commandsThatAnswerThemselves = [
            'check_subscription',
            'click',
            'open_case',
            'check_task',
            'check_custom_task',
            'admin_back'
        ];

        const shouldAnswerCallbackQuery = !commandsThatAnswerThemselves.some(cmd =>
            data === cmd || data.startsWith(cmd + '_')
        ) && !data.startsWith('admin_') && !data.startsWith('withdraw_') && !data.startsWith('rating_') && !data.startsWith('approve_') && !data.startsWith('reject_') && !data.startsWith('broadcast_');

        if (shouldAnswerCallbackQuery) {
            await bot.answerCallbackQuery(callbackQuery.id);
        }

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

            case 'referral_details':
                await showReferralDetails(chatId, userId, message.message_id);
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
                
            case 'disabled':
                // Ничего не делаем для заблокированных кнопок
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
                    await showAdminPanel(chatId, message.message_id);
                    await bot.answerCallbackQuery(callbackQuery.id);
                } else if (data === 'open_case') {
                    await handleOpenCase(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data === 'check_task') {
                    await handleTaskCheck(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data === 'skip_task') {
                    await showTasks(chatId, userId, message.message_id);
                } else if (data.startsWith('check_custom_task_')) {
                    const taskId = parseInt(data.split('_')[3]);
                    await handleCustomTaskCheck(chatId, userId, taskId, message.message_id, callbackQuery.id);
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
    console.log(`🔄 Проверка подписки по запрос�� пользователя ${userId}`);
    
    const subscriptionStatus = await checkUserSubscription(
        userId,
        chatId,
        '', // имя не важно для проверки
        'ru',
        false
    );

    console.log('📊 Результат проверки подписки:', subscriptionStatus);

    // Если нет ссылок для подписки - значит пользователь подписан
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        // Показываем сообщение об успешной проверке
        const successMessage = '✅ Отлично! Вы успешно подписались на все спонсорские каналы!\n\n' +
                              '🎉 Добро пожаловать в бота для заработка звёзд!\n\n' +
                              '🌟 Теперь вам доступны все функции бота:\n' +
                              '• 👥 Приглашайте друзей\n' +
                              '• 📋 Выполняйте задания\n' +
                              '• 🖱 Используйте кликер\n' +
                              '• 🎁 Открывайте кейсы\n' +
                              '• 💰 Выводите звёзды\n\n' +
                              'Выберите действие:';

        const keyboard = createMainMenuKeyboard();

        await bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Поздравляем! Вы успешно подписались на все каналы!');
        }

        // Проверяем условия для засчитывания реферала
        await checkReferralConditions(userId);
    } else {
        // Все еще есть каналы для подписки
        const message = SubGram.formatSubscriptionMessage(
            subscriptionStatus.subscriptionData.links, 
            subscriptionStatus.subscriptionData.additional?.sponsors
        );
        const keyboard = SubGram.createSubscriptionKeyboard(subscriptionStatus.subscriptionData.links);

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
    const message = '🏠 Главное меню\n\nВыберите действие:';
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
    const referralStats = await Database.getReferralStats(userId);

    const message = `👤 Ваш профиль\n\n` +
                   `🆔 ID: ${user.user_id}\n` +
                   `👤 Имя: ${user.first_name}\n` +
                   `🌟 Баланс: ${user.balance} звёзд\n` +
                   `💰 Зар��ботано за рефералов: ${user.referral_earned}\n` +
                   `💎 Всего заработано: ${user.total_earned}\n` +
                   `✅ Выполнено заданий: ${completedTasks}\n` +
                   `🏆 Очки: ${user.points}\n\n` +
                   `👥 Ваши рефералы:\n` +
                   `• ✅ Активированные: ${referralStats.activated_referrals}\n` +
                   `• ⏳ Неактивированные: ${referralStats.non_activated_referrals}\n` +
                   `• 📈 За сегодня: ${user.daily_referrals}\n\n` +
                   `ℹ️ Активированные рефералы - те, кто подписался н�� спонсоров и выполнил 2 задания`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '👥 Подробно о рефералах', callback_data: 'referral_details' }],
            [{ text: '🎫 Ввести промокод', callback_data: 'promocode' }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать подробную ��нформацию о рефералах
async function showReferralDetails(chatId, userId, messageId) {
    try {
        const activatedReferrals = await Database.getActivatedReferrals(userId);
        const nonActivatedReferrals = await Database.getNonActivatedReferrals(userId);

        let message = `👥 Детальная информация о рефералах\n\n`;

        // Активированные рефералы
        message += `✅ Активированные рефералы (${activatedReferrals.length}):\n`;
        if (activatedReferrals.length === 0) {
            message += `• Пока нет активированных рефералов\n`;
        } else {
            activatedReferrals.slice(0, 10).forEach((referral, index) => { // показываем только первые 10
                const name = referral.first_name || 'Пользователь';
                const username = referral.username ? `@${referral.username}` : '';
                const date = new Date(referral.created_at).toLocaleDateString('ru-RU');
                message += `• ${name} ${username} (${date})\n`;
            });
            if (activatedReferrals.length > 10) {
                message += `... и ещё ${activatedReferrals.length - 10}\n`;
            }
        }

        message += `\n`;

        // Неактивированные рефералы
        message += `⏳ Неактивированные рефералы (${nonActivatedReferrals.length}):\n`;
        if (nonActivatedReferrals.length === 0) {
            message += `• Все рефералы активированы! 🎉\n`;
        } else {
            nonActivatedReferrals.slice(0, 10).forEach((referral, index) => { // показываем только первые 10
                const name = referral.first_name || 'Пользователь';
                const username = referral.username ? `@${referral.username}` : '';
                const date = new Date(referral.created_at).toLocaleDateString('ru-RU');
                message += `• ${name} ${username} (${date})\n`;
            });
            if (nonActivatedReferrals.length > 10) {
                message += `... и ещё ${nonActivatedReferrals.length - 10}\n`;
            }
        }

        message += `\n📝 Для активации реферал должен:\n`;
        message += `1. Подписаться на все спонсорские каналы\n`;
        message += `2. Выполнить 2 задания\n\n`;
        message += `💰 За каждого ��ктивированного реферала вы получаете 2 звезды`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '👤 Назад к профилю', callback_data: 'profile' }],
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

    } catch (error) {
        console.error('Ошибка показа рефералов:', error);
        await bot.editMessageText('❌ Ошибка загрузки данных о рефералах', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });
    }
}

// Показать информацию о п��иглашениях
async function showInviteInfo(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const botUsername = (await bot.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;
    
    const message = `👥 Пригласить друзей\n\n` +
                   `🎯 Приглашайте друзей и зарабатывайте звёзды!\n\n` +
                   `💰 За каждого реферала: 2 звезды\n` +
                   `📝 Реферал засчитывается когда:\n` +
                   `• Подписался на спонсорские каналы\n` +
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
                   `📊 Кликов сег��дня: ${clicksToday}/10\n` +
                   `⏳ Осталось кл��ков: ${remainingClicks}\n\n` +
                   `${canClick ? '✅ Можете кликать!' : `⏰ Ждите ${timeToWait} мин.`}\n\n` +
                   `ℹ️ После каждого клика время ожидани��\nувеличивается на 5 минут`;
    
    const keyboard = {
        inline_keyboard: [
            [{ 
                text: canClick && remainingClicks > 0 ? '🖱 КЛИК!' : '��� Недоступно', 
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
        console.error('Ошибка клика:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка клика');
    }
}

// Показать варианты вывода
async function showWithdrawOptions(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    
    const message = `💰 Вывод звёзд\n\n` +
                   `💎 В��ш баланс: ${user.balance} звёзд\n\n` +
                   `📋 Выберите сумму для вывода:`;
    
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
        
        // Со��даем заявку
        const request = await Database.createWithdrawalRequest(userId, amount);
        
        // Отправляем в админ чат
        const adminMessage = `💰 Новая заявка на вывод #${request.id}\n\n` +
                            `👤 Пользователь: ${user.first_name}\n` +
                            `🆔 ID: ${user.user_id}\n` +
                            `📱 Username: @${user.username || 'отсутствует'}\n` +
                            `💰 Сумма: ${amount} звёзд\n` +
                            `💎 Остаток: ${user.balance - amount} звёзд\n` +
                            `🔗 Профиль: tg://user?id=${user.user_id}`;

        const adminKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Выполнено', callback_data: `approve_${request.id}` },
                    { text: '❌ Отклонить', callback_data: `reject_${request.id}` }
                ]
            ]
        };

        await bot.sendMessage(config.ADMIN_CHAT_ID, adminMessage, {
            reply_markup: adminKeyboard
        });
        
        // Уведомляем пользователя
        const userMessage = `✅ З��явка на вывод ${amount} звёзд отправлена!\n\n` +
                           `📋 Номер заявки: #${request.id}\n` +
                           `�� Ожидайте обработки администратором`;
        
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
    try {
        console.log(`📋 ФУНКЦИЯ showTasks ВЫЗВАНА для пользователя ${userId}`);

        // 1. Получаем каналы для заданий через специальную функцию (НЕ блокирующую)
        const taskData = await checkUserSubscriptionForTasks(userId, chatId);
        console.log(`📋 РЕЗУЛЬТАТ checkUserSubscriptionForTasks:`, JSON.stringify(taskData, null, 2));

        // 2. Получаем уже выполненные SubGram задания пользователем
        const completedSubgramTasks = await Database.getCompletedSubgramTasks(userId);
        console.log(`📋 Пользователь ${userId} уже выполнил ${completedSubgramTasks.length} SubGram заданий:`, completedSubgramTasks);

        // 3. Фильтруем каналы - исключаем уже выполненные как задания
        let availableChannels = [];
        if (taskData.availableChannels && taskData.availableChannels.length > 0) {
            availableChannels = taskData.availableChannels.filter(link =>
                !completedSubgramTasks.includes(link)
            );
        }

        console.log(`📊 ДОСТУПНО НОВЫХ SubGram ЗАДАНИЙ: ${availableChannels.length}`);
        console.log(`📊 СПИСОК ДОСТУПНЫХ ЗАДАНИЙ:`, availableChannels);

        if (taskData.status === 'error') {
            console.log(`❌ ПОКАЗЫВАЕМ ОШИБКУ ЗАДАНИЙ`);
            // Ошибка SubGram - показываем сообщение об ошибке
            // Ошибка SubGram - показываем сообщение об ошибке
            const message = `📋 Задания\n\n` +
                           `⚠️ Временные проблемы с получением заданий.\n` +
                           `🔄 Попробуйте позже или обратитесь к админис��ратору.`;

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createBackToMenuKeyboard()
            });
        } else if (availableChannels.length > 0) {
            console.log(`✅ ПОКАЗЫВАЕМ SUBGRAM ЗАДАНИЕ`);
            // Показываем ПЕРВОЕ доступное задание SubGram в правильном формате
            const taskLink = availableChannels[0];
            const sponsorIndex = taskData.availableChannels.indexOf(taskLink);
            const sponsor = taskData.additional?.sponsors?.[sponsorIndex];
            const channelName = sponsor?.resource_name || 'Канал Кирби';

            const message = `📋 Доступное задание\n\n` +
                           `📢 ${channelName}\n` +
                           `❓❓❓ Подписка\n` +
                           `💰 Награда: 0.25 звёзд\n` +
                           `🏆 Бонус: +1 очко\n\n` +
                           `ℹ️ После выполнения нажмите\n"Проверить выполнение"`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: '📢 Перейти к заданию', url: taskLink }],
                    [{ text: '✅ Проверить выполнение', callback_data: 'check_task' }],
                    [{ text: '🏠 В главно�� меню', callback_data: 'main_menu' }]
                ]
            };

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });
        } else {
            console.log(`🔍 НЕТ SUBGRAM ЗАДАНИЙ, ПРОВЕРЯЕМ КАСТОМНЫЕ`);
            // Нет доступных SubGram заданий, проверяем кастомные задания
            const customTasks = await Database.getTasks(false); // false = не SubGram задания
            console.log(`🔍 НАЙДЕНО КАСТОМНЫХ ЗАДАНИЙ: ${customTasks.length}`);
            
            // Ищем первое невыполненное кастомное задание
            let availableCustomTask = null;
            for (const task of customTasks) {
                const isCompleted = await Database.isTaskCompleted(userId, task.id);
                if (!isCompleted) {
                    availableCustomTask = task;
                    break;
                }
            }
            
            if (availableCustomTask) {
                console.log(`✅ ПОКАЗЫВАЕМ КАСТОМНОЕ ЗАДАНИЕ:`, availableCustomTask);
                // Показываем кастомное задание
                const message = `📋 Доступное задание\n\n` +
                               `📢 ${availableCustomTask.title}\n` +
                               `��� ${availableCustomTask.description || 'Выполните задание'}\n` +
                               `💰 Награда: ${availableCustomTask.reward} звёзд\n` +
                               `🏆 Бонус: +1 очко\n\n` +
                               `ℹ️ После выполнения нажмите "Проверить выполнен��е"`;
                
                const keyboard = {
                    inline_keyboard: [
                        availableCustomTask.link ? [{ text: '📢 Перейти к заданию', url: availableCustomTask.link }] : [],
                        [{ text: '✅ Проверить выполнение', callback_data: `check_custom_task_${availableCustomTask.id}` }],
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ].filter(row => row.length > 0) // Убираем пустые строки
                };
                
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard
                });
            } else {
                console.log(`❌ НЕТ ДОСТУПНЫХ ЗАДАНИЙ ВООБЩЕ`);
                // Нет доступных заданий вообще
                const message = `📋 Задания\n\n` +
                               `✅ Все зад��ния выполнены!\n` +
                               `�� Проверьте позже, возможно появятся новые.`;
                
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: createBackToMenuKeyboard()
                });
            }
        }
    } catch (error) {
        console.error('Ошибка показа заданий:', error);
        const message = `📋 Задания\n\n` +
                       `❌ Произошла ошибка при загрузке заданий.\n` +
                       `🔄 Попробуйте позже.`;
        
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
                   `🌟 Как зарабатывать звёзды:\n\n` +
                   `👥 Рефералы:\n` +
                   `• Приглашайте друзей по своей ссылке\n` +
                   `• За каждого реферала: 2 звезды\n` +
                   `• Реферал засчитывается после подписки на спонсоров и выполнения 2 заданий\n\n` +
                   `🖱 Кликер:\n` +
                   `• Кликайте до 10 раз в день\n` +
                   `• За клик: 0.1 звезды\n` +
                   `• Время ожидания увеличивается\n\n` +
                   `📋 Задания:\n` +
                   `• Подписывайтесь на кана��ы\n` +
                   `• За задание: 0.25 звёзд\n\n` +
                   `🏆 Рейтинги:\n` +
                   `• Зарабатывайте очки\n` +
                   `• Топ 5 недели получают бонусы\n\n` +
                   `���� Кейсы:\n` +
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
            [{ text: '🌟 Общий ��ейтинг', callback_data: 'rating_overall' }],
            [{ text: '📅 Недельный рейтинг', callback_data: 'rating_weekly' }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
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
        title = '🌟 Общий рейтинг';
    } else {
        leaderboard = await Database.getWeeklyLeaderboard();
        title = '📅 Недельный рейтинг';
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
            message += `🥇 1 место: 100 звёзд\n`;
            message += `🥈 2 место: 75 звёзд\n`;
            message += `🥉 3 место: 50 звёзд\n`;
            message += `4 место: 25 з��ёзд\n`;
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
                   `🎁 Кейс ${lastCaseDate === today ? 'уже открыт' : 'доступен'}\n\n` +
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

// обработка ввода промокода
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
                `✅ Промок��д активирован!\n💰 Вы получили ${promocode.reward} звёзд`
            );
        } catch (error) {
            await bot.sendMessage(chatId, `❌ ${error.message}`);
        }
    }
});

// Команд�� /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Проверка админских прав (добавьте ��вой ID в config.ADMIN_IDS)
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '❌ У вас нет прав администратора');
        return;
    }

    await showAdminPanel(chatId);
});

// Показать админ-панель
async function showAdminPanel(chatId, messageId = null) {
    const message = '👨‍💼 Админ-панель\n\nВыберите действие:';

    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Статистика бота', callback_data: 'admin_stats' }],
            [{ text: '📋 Управление заданиями', callback_data: 'admin_tasks' }],
            [{ text: '🎲 Управление лотереями', callback_data: 'admin_lottery' }],
            [{ text: '🎫 Управление промокодами', callback_data: 'admin_promocodes' }],
            [{ text: '📢 Рассылка сообщений', callback_data: 'admin_broadcast' }],
            [{ text: '🏆 Недельные награды', callback_data: 'admin_rewards' }],
            [{ text: '💰 Заявки на вывод', callback_data: 'admin_withdrawals' }]
        ]
    };

    if (messageId) {
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } else {
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    }
}

// Обработчик админских действий
async function handleAdminCallback(chatId, userId, data, messageId, callbackQueryId) {
    // Проверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    try {
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
            case 'admin_create_task':
                await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Функция создания заданий будет добавлена позже');
                return; // выходим, чтобы не было двойного ответа
            case 'admin_list_tasks':
                await showAdminTasksList(chatId, messageId);
                break;
            case 'admin_create_lottery':
                await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Функция создания лотерей будет добавлена позже');
                return; // выходим, чтобы не было двойного ответа
            case 'admin_list_lotteries':
                await showAdminLotteriesList(chatId, messageId);
                break;
            case 'admin_create_promocode':
                await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Функция создания промокодов будет добавлена позже');
                return; // выходим, чтобы не было двойного ответа
            case 'admin_list_promocodes':
                await showAdminPromocodesList(chatId, messageId);
                break;
            case 'admin_give_rewards':
                await handleGiveWeeklyRewards(chatId, userId, callbackQueryId);
                break;
            case 'admin_reset_weekly':
                await handleResetWeeklyPoints(chatId, userId, callbackQueryId);
                break;
            default:
                await bot.answerCallbackQuery(callbackQueryId, '❌ Неизвестная команда');
                break;
        }

        // Отвечаем на callback query для о��ычных команд (ко��анды создания уже ответили через return)
        if (!['admin_give_rewards', 'admin_reset_weekly'].includes(data)) {
            await bot.answerCallbackQuery(callbackQueryId);
        }

    } catch (error) {
        console.error('Ошибка админской команды:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Произошла ошибка');
    }
}

// Проверка выполнения задания SubGram
async function handleTaskCheck(chatId, userId, messageId, callbackQueryId) {
    try {
        console.log(`✅ Проверка выполнения SubGram задания для пользователя ${userId}`);

        // 1. Получаем текущие задания пользователя
        const taskData = await checkUserSubscriptionForTasks(userId, chatId);
        
        if (taskData.status === 'error') {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки задания');
            return;
        }

        // 2. Получаем уже выполненные SubGram задания
        const completedSubgramTasks = await Database.getCompletedSubgramTasks(userId);
        
        // 3. Найдем первое доступное задание (которое показыв��ем пользователю)
        let availableChannels = [];
        if (taskData.availableChannels && taskData.availableChannels.length > 0) {
            availableChannels = taskData.availableChannels.filter(link => 
                !completedSubgramTasks.includes(link)
            );
        }

        if (availableChannels.length === 0) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Нет доступных заданий');
            await showTasks(chatId, userId, messageId);
            return;
        }

        // 4. Проверяем выполнение первого задания (текущее)
        const currentTaskLink = availableChannels[0];
        
        // Для проверки SubGram задания нужно проверить подписку пользователя
        const subscriptionCheck = await checkUserSubscription(userId, chatId);
        
        // Если пользователь подписан на все каналы (включая текущий канал задания)
        if (subscriptionCheck.isSubscribed) {
            // Задание выполнено! Сохраняем и награждаем
            const sponsorIndex = taskData.availableChannels.indexOf(currentTaskLink);
            const sponsor = taskData.additional?.sponsors?.[sponsorIndex];
            const channelName = sponsor?.resource_name || 'Канал';
            
            await Database.completeSubgramTask(userId, currentTaskLink, channelName);
            await Database.updateUserBalance(userId, 0.25);
            await Database.updateUserPoints(userId, 1);

            await bot.answerCallbackQuery(callbackQueryId, '🎉 Задан��е выполнено! +0.25 звёзд, +1 очко!');
            
            // Проверяем условия для засчитывания реферала
            await checkReferralConditions(userId);
            
            // Показываем следующее задание или завершаем
            await showTasks(chatId, userId, messageId);
        } else {
            // Пользователь еще не по��писался
            await bot.answerCallbackQuery(callbackQueryId, '❌ Вы еще не подписались на канал!');
        }

    } catch (error) {
        console.error('Ошибка проверки SubGram задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки задания');
    }
}

// Проверка выполнения кастомного задания
async function handleCustomTaskCheck(chatId, userId, taskId, messageId, callbackQueryId) {
    try {
        console.log(`✅ Проверка выполнения кастомного задания ${taskId} для пользователя ${userId}`);

        // Проверяем не выполнено ли уже задание
        const isCompleted = await Database.isTaskCompleted(userId, taskId);
        if (isCompleted) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Задание уже выполнено!');
            await showTasks(chatId, userId, messageId);
            return;
        }

        // Получаем информацию о задании
        const tasks = await Database.getTasks(false); // не SubGram задания
        const task = tasks.find(t => t.id === taskId);
        
        if (!task) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Задание не найдено');
            return;
        }

        // Для кастомных заданий автоматически засчитываем выполнение
        // (в реальном проекте здесь может быть дополнительная логика проверки)
        await Database.completeTask(userId, taskId);
        await Database.updateUserBalance(userId, task.reward);
        await Database.updateUserPoints(userId, 1);

        await bot.answerCallbackQuery(callbackQueryId, `🎉 Зада��ие выполнено! +${task.reward} звёзд, +1 очко!`);
        
        // Проверяем условия для засчитывания реферала
        await checkReferralConditions(userId);
        
        // Показываем следующе�� задание
        await showTasks(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка проверки кастомного задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки задания');
    }
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
            await bot.answerCallbackQuery(callbackQueryId, '❌ Кейс уже открыт сегодня!');
            return;
        }
        
        // Генерируем случайный выигрыш (1-10 звёзд)
        const winAmount = Math.floor(Math.random() * 10) + 1;
        
        await Database.updateUserBalance(userId, winAmount);
        await Database.pool.query('UPDATE users SET last_case_open = CURRENT_DATE WHERE user_id = $1', [userId]);
        
        await bot.answerCallbackQuery(callbackQueryId, `🎉 Вы выиграли ${winAmount} звёзд!`);
        await showCases(chatId, userId, messageId);
        
    } catch (error) {
        console.error('Ошибка открытия кей��а:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка открытия кейса');
    }
}

// Обработка действий с зая��ками на вывод
async function handleWithdrawalAction(chatId, userId, data, callbackQueryId) {
    try {
        const [action, requestId] = data.split('_');
        const request = await Database.processWithdrawal(
            parseInt(requestId), 
            action === 'approve' ? 'approved' : 'rejected',
            action === 'reject' ? 'Отклонено администратором' : null
        );
        
        if (action === 'reject') {
            // Возвращаем средства пользователю
            await Database.updateUserBalance(request.user_id, request.amount);
        }
        
        await bot.answerCallbackQuery(callbackQueryId, 
            action === 'approve' ? '✅ Заявка одобрена' : '❌ Заявка отклонена');
        
        // Уведомляем пользователя
        const message = action === 'approve' 
            ? `✅ Ваша заявка на вывод ${request.amount} звёзд одобрена!`
            : `❌ Ваша заявка на вывод ${request.amount} звёзд отклонена. Средства возвращены на баланс.`;
            
        try {
            await bot.sendMessage(request.user_id, message);
        } catch (e) {
            console.log(`Не удалось уведомить пользователя ${request.user_id}`);
        }
        
    } catch (error) {
        console.error('Ошибка обработки заявки:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка обработки');
    }
}

// Показать статистику ��ота
async function showBotStats(chatId, messageId) {
    try {
        const totalUsers = await Database.pool.query('SELECT COUNT(*) as count FROM users');
        const totalStarsEarned = await Database.pool.query('SELECT SUM(total_earned) as sum FROM users');
        const totalWithdrawals = await Database.pool.query('SELECT SUM(amount) as sum FROM withdrawal_requests WHERE status = \'approved\'');
        const pendingWithdrawals = await Database.pool.query('SELECT COUNT(*) as count, SUM(amount) as sum FROM withdrawal_requests WHERE status = \'pending\'');

        const message = `📊 Статистика бота\n\n` +
                       `👥 Всего пользователей: ${totalUsers.rows[0].count}\n` +
                       `⭐ Всего заработано звёзд: ${totalStarsEarned.rows[0].sum || 0}\n` +
                       `💰 Всего выведено: ${totalWithdrawals.rows[0].sum || 0}\n` +
                       `⏳ Заявок в ожидании: ${pendingWithdrawals.rows[0].count}\n` +
                       `💎 Сумма в ожидании: ${pendingWithdrawals.rows[0].sum || 0}`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Обновить', callback_data: 'admin_stats' }],
                [{ text: '🔙 Назад к ад��ин-панели', callback_data: 'admin_back' }]
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

async function showAdminTasks(chatId, messageId) {
    const message = `📋 Упра��ление заданиями\n\n` +
                   `Здесь вы можете создавать собственные задания\n` +
                   `помимо заданий от SubGram`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать задание', callback_data: 'admin_create_task' }],
            [{ text: '📋 Список заданий', callback_data: 'admin_list_tasks' }],
            [{ text: '🔄 Обновить', callback_data: 'admin_tasks' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

async function showAdminLottery(chatId, messageId) {
    const message = `🎲 Управление лотереями\n\n` +
                   `Создавайте и управляйте лотереями`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать лотерею', callback_data: 'admin_create_lottery' }],
            [{ text: '📋 Список лотерей', callback_data: 'admin_list_lotteries' }],
            [{ text: '🔄 Обновить', callback_data: 'admin_lottery' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

async function showAdminPromocodes(chatId, messageId) {
    const message = `🎫 Управление промокодами\n\n` +
                   `Со��давайте и управляйте п��омокодами`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать промокод', callback_data: 'admin_create_promocode' }],
            [{ text: '📋 Список промокодов', callback_data: 'admin_list_promocodes' }],
            [{ text: '🔄 Обновить', callback_data: 'admin_promocodes' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

async function showAdminBroadcast(chatId, messageId) {
    const message = `📢 Рассылка сообщений\n\n` +
                   `Выберите готовое сообщение для рассылки:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Сообщение о рейтинге', callback_data: 'broadcast_rating' }],
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

async function handleBroadcast(type) {
    try {
        const users = await Database.pool.query('SELECT user_id FROM users');
        let message, keyboard;

        if (type === 'rating') {
            message = `🏆 Быстрее попади в топ 5 по очкам в недельном рейтинге и получи доп��лнительные звёзды в конце недели!\n\n` +
                     `🥇 1 место: 100 звёзд\n` +
                     `🥈 2 место: 75 звёзд\n` +
                     `🥉 3 место: 50 звёзд\n` +
                     `4 место: 25 звёзд\n` +
                     `5 место: 15 звёзд`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '👥 Приг��асить друзей', callback_data: 'invite' }],
                    [{ text: '📋 Задания', callback_data: 'tasks' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        } else {
            message = `📋 Новые задания уже ждут тебя!\n\n` +
                     `💰 Зарабатывай звёзды выполняя простые задания!`;

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
                await new Promise(resolve => setTimeout(resolve, 50)); // Задержка между отправками
            } catch (error) {
                console.log(`Не удалось отправить сообщение пользователю ${user.user_id}`);
            }
        }

        console.log(`Рассылк�� ${type} завершена`);
    } catch (error) {
        console.error('Ошибка рассылки:', error);
    }
}

async function showAdminRewards(chatId, messageId) {
    try {
        const leaderboard = await Database.getWeeklyLeaderboard(5);
        
        let message = `🏆 Недельные награды\n\n`;
        
        if (leaderboard.length === 0) {
            message += `ℹ️ Нет участников в недельном рей��инге`;
        } else {
            message += `👑 Топ 5 пользователей:\n\n`;
            const rewards = [100, 75, 50, 25, 15];
            
            leaderboard.forEach((user, index) => {
                const position = index + 1;
                const emoji = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][index];
                const reward = rewards[index];
                const name = user.first_name || 'Пользователь';
                
                message += `${emoji} ${name} - ${user.weekly_points} очков (${reward} звёзд)\n`;
            });
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🎁 Выдать награды', callback_data: 'admin_give_rewards' }],
                [{ text: '🔄 Сбросить недельные очки', callback_data: 'admin_reset_weekly' }],
                [{ text: '🔙 На��ад к админ-панели', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа наград:', error);
    }
}

async function showAdminWithdrawals(chatId, messageId) {
    try {
        const pendingWithdrawals = await Database.getPendingWithdrawals();
        
        let message = `💰 Заявки на вывод\n\n`;
        
        if (pendingWithdrawals.length === 0) {
            message += `ℹ️ Нет заявок в ожидании`;
        } else {
            message += `📋 Заявки в ожидании:\n\n`;
            
            pendingWithdrawals.slice(0, 5).forEach(withdrawal => {
                const name = withdrawal.first_name || 'Пользователь';
                const username = withdrawal.username ? `@${withdrawal.username}` : '';
                message += `#${withdrawal.id} - ${name} ${username}\n`;
                message += `💰 ${withdrawal.amount} звёзд\n`;
                message += `📅 ${new Date(withdrawal.created_at).toLocaleDateString('ru-RU')}\n\n`;
            });
            
            if (pendingWithdrawals.length > 5) {
                message += `... и ещё ${pendingWithdrawals.length - 5} заявок`;
            }
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Обновить', callback_data: 'admin_withdrawals' }],
                [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
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

// Показать список заданий
async function showAdminTasksList(chatId, messageId) {
    try {
        const customTasks = await Database.getTasks(false); // не SubGram задания
        
        let message = `📋 Список зад��ний\n\n`;
        
        if (customTasks.length === 0) {
            message += `ℹ️ Нет созданных заданий`;
        } else {
            message += `📝 Кастомные задания (${customTasks.length}):\n\n`;
            
            customTasks.slice(0, 10).forEach((task, index) => {
                const status = task.is_active ? '✅' : '❌';
                message += `${status} ${task.title}\n`;
                message += `💰 Награда: ${task.reward} звёзд\n`;
                message += `📅 ${new Date(task.created_at).toLocaleDateString('ru-RU')}\n\n`;
            });
            
            if (customTasks.length > 10) {
                message += `... и ещё ${customTasks.length - 10} заданий`;
            }
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '➕ Создать задание', callback_data: 'admin_create_task' }],
                [{ text: '🔄 Обновить', callback_data: 'admin_list_tasks' }],
                [{ text: '🔙 Назад', callback_data: 'admin_tasks' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа списка заданий:', error);
    }
}

// Показать список лотерей
async function showAdminLotteriesList(chatId, messageId) {
    try {
        const lotteries = await Database.getActiveLotteries();
        
        let message = `🎲 Список лотерей\n\n`;
        
        if (lotteries.length === 0) {
            message += `ℹ️ Нет активных лотерей`;
        } else {
            message += `🎫 Активные лотереи:\n\n`;
            
            lotteries.forEach((lottery, index) => {
                const progress = (lottery.sold_tickets / lottery.total_tickets * 100).toFixed(1);
                message += `🎟 ${lottery.name}\n`;
                message += `💰 Цена: ${lottery.ticket_price} звёзд\n`;
                message += `📊 Прогресс: ${lottery.sold_tickets}/${lottery.total_tickets} (${progress}%)\n`;
                message += `🏆 Победителей: ${lottery.winners_count}\n\n`;
            });
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '➕ Создать лотерею', callback_data: 'admin_create_lottery' }],
                [{ text: '🔄 Обновить', callback_data: 'admin_list_lotteries' }],
                [{ text: '🔙 Назад', callback_data: 'admin_lottery' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа списка лот��рей:', error);
    }
}

// Показать список промокодов
async function showAdminPromocodesList(chatId, messageId) {
    try {
        const result = await Database.pool.query(`
            SELECT * FROM promocodes 
            WHERE is_active = true 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        const promocodes = result.rows;
        
        let message = `🎫 Список промокодов\n\n`;
        
        if (promocodes.length === 0) {
            message += `ℹ️ Нет активных промокодов`;
        } else {
            message += `🎟 Активные промокоды:\n\n`;
            
            promocodes.forEach((promo, index) => {
                message += `🎫 ${promo.code}\n`;
                message += `💰 Награда: ${promo.reward} звёзд\n`;
                message += `📊 Использовано: ${promo.current_uses}/${promo.uses_limit}\n`;
                message += `📅 ${new Date(promo.created_at).toLocaleDateString('ru-RU')}\n\n`;
            });
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '➕ Создать промок��д', callback_data: 'admin_create_promocode' }],
                [{ text: '🔄 Обновить', callback_data: 'admin_list_promocodes' }],
                [{ text: '🔙 Назад', callback_data: 'admin_promocodes' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа списка промокодов:', error);
    }
}

// Выдача недельных наград
async function handleGiveWeeklyRewards(chatId, userId, callbackQueryId) {
    try {
        const leaderboard = await Database.getWeeklyLeaderboard(5);
        const rewards = [100, 75, 50, 25, 15];
        
        let rewardedCount = 0;
        
        for (let i = 0; i < leaderboard.length; i++) {
            const user = leaderboard[i];
            const reward = rewards[i];
            
            if (user.weekly_points > 0) {
                await Database.updateUserBalance(user.user_id, reward);
                rewardedCount++;
                
                // Уведомляем пользователя
                try {
                    await bot.sendMessage(user.user_id, 
                        `🏆 Поздравляем! Вы заняли ${i + 1} место в недельном рейти��ге!\n` +
                        `💰 Ваша награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалось уведомить пользователя ${user.user_id}`);
                }
            }
        }
        
        await bot.answerCallbackQuery(callbackQueryId, 
            `✅ Награды выданы ${rewardedCount} ��о��ьзователям!`);
        
    } catch (error) {
        console.error('Ошибка выдачи наград:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка выдачи наград');
    }
}

// Сброс недельных очков
async function handleResetWeeklyPoints(chatId, userId, callbackQueryId) {
    try {
        await Database.resetWeeklyPoints();
        await bot.answerCallbackQuery(callbackQueryId, '✅ Недельные очки сброшены!');
    } catch (error) {
        console.error('Ошибка сброса очков:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка сброса очков');
    }
}

// Еженедельное начисление наград (воскресенье в 20:00 МСК)
cron.schedule('0 20 * * 0', async () => {
    console.log('Начисление еже��едельных наград...');
    
    try {
        const leaderboard = await Database.getWeeklyLeaderboard(5);
        const rewards = [100, 75, 50, 25, 15];
        
        for (let i = 0; i < leaderboard.length; i++) {
            const user = leaderboard[i];
            const reward = rewards[i];
            
            if (reward && user.weekly_points > 0) {
                await Database.updateUserBalance(user.user_id, reward);
                
                // Уведомляем пользователя
                try {
                    await bot.sendMessage(user.user_id, 
                        `🏆 Поздравляем! Вы заняли ${i + 1} место в недельном рейтинге!\n` +
                        `💰 Ваша награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалось уведомить пользователя ${user.user_id}`);
                }
            }
        }
        
        // Сбрасываем недельные очки
        await Database.resetWeeklyPoints();
        console.log('Еженедельные награды начислены и очки сброшены');
        
    } catch (error) {
        console.error('Ошибка еженедельн��го начисления наград:', error);
    }
});

// Ежедневный сброс счетчиков в 00:00 МСК
cron.schedule('0 0 * * *', async () => {
    console.log('Сброс ежедневных счетчиков...');
    
    try {
        await Database.pool.query(`
            UPDATE users 
            SET daily_referrals = 0, 
                last_daily_reset = CURRENT_DATE 
            WHERE last_daily_reset < CURRENT_DATE
        `);
        
        console.log('Ежедневные счетчики сброшены');
    } catch (error) {
        console.error('Ошибка сброса ежедневных счетчиков:', error);
    }
});

// Инициализируем бота
initBot().catch(console.error);

module.exports = bot;
