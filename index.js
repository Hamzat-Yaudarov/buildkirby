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

// Проверка выполнения у��ловий для засчитывания реферала
async function checkReferralConditions(userId) {
    try {
        const user = await Database.getUser(userId);
        if (!user || !user.referrer_id) {
            return; // Нет реферера
        }

        // Проверяем подписку на спонсорские каналы
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
            console.log(`👥 Реферальная награда за пользователя ${userId} уже был�� начислена`);
            return;
        }

        // Все условия выпол��ены - начисляем награду
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
                '🏆 Вы получил�� 1 очко'
            );
        } catch (e) {
            console.log(`Не удалось отправить уведомление ��ефереру ${user.referrer_id}`);
        }

    } catch (error) {
        console.error('О��ибка проверки реферальн��х услов��й:', error);
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
        console.log('🔧 Переменн��е окружения:');
        console.log('- PORT:', process.env.PORT);
        console.log('- WEBHOOK_PORT:', process.env.WEBHOOK_PORT);
        console.log('- Используемый порт:', webhookPort);
        await webhookHandler.start(webhookPort);

        // Установка команд бота
        await bot.setMyCommands([
            { command: 'start', description: 'Запустить бота' },
            { command: 'menu', description: 'Главн��е меню' },
            { command: 'admin', description: 'Админ панель' }
        ]);
        
    } catch (error) {
        console.error('Ошибка запуска бота:', error);
        process.exit(1);
    }
}

// Создание клави��тур
function createMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 Профиль', callback_data: 'profile' }],
            [{ text: '👥 Пригласить друзей', callback_data: 'invite' }],
            [{ text: '🖱 Кликер', callback_data: 'clicker' }],
            [{ text: '💰 Вывод звёзд', callback_data: 'withdraw' }],
            [{ text: '📋 Задания', callback_data: 'tasks' }],
            [{ text: '📖 Инструкция', callback_data: 'instructions' }],
            [{ text: '🏆 Рей��инги', callback_data: 'ratings' }],
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
            [{ text: '���� Промокод', callback_data: 'promocode' }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };
}

// Проверка подписки пользователя для заданий (не блоки��ует, а возвращает доступные задания)
async function checkUserSubscriptionForTasks(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
    try {
        console.log(`��� Проверка подписки для заданий пользователя ${userId}`);

        // Получаем задания через getTaskChannels (больше каналов)
        const taskChannels = await SubGram.getTaskChannels(userId, chatId, firstName, languageCode, isPremium);
        console.log(`📥 SubGram задания:`, JSON.stringify(taskChannels, null, 2));

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

// Проверка подписки пользователя (для блокировки функций)
async function checkUserSubscription(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
    try {
        // Сначала проверяем кеш вебхуков (свежие данные - не старше 5 минут)
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);

        if (cachedStatus.lastUpdate && (Date.now() - cachedStatus.lastUpdate) < 5 * 60 * 1000) {
            console.log(`🗄️ Используем кешированные данные подписки для пользователя ${userId}`);
            console.log(`📊 Кеш:`, cachedStatus);

            if (cachedStatus.isSubscribed === false && cachedStatus.unsubscribedLinks.length > 0) {
                // Пользователь точно не подписан - есть неподписанные каналы
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

        // Есл�� ��ет кешированных данных, делаем запрос к SubGram
        console.log(`🌐 Запр��с к SubGram API для пользователя ${userId}`);
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

            // СТРОГИЙ FALLBACK: если нет кеша - НЕ подписан (бе����пасность)
            return {
                isSubscribed: false,
                subscriptionData: {
                    status: 'error_fallback',
                    links: [],
                    message: 'Ошибка проверки подписки - доступ заблокирован'
                }
            };
        }

        // ВАЖНО: статус "warning" означает что пользователь НЕ подписан!
        if (taskChannels.status === 'warning') {
            console.log(`⚠️ Пользователь ${userId} НЕ подписан (статус warning): ${taskChannels.message}`);

            // Для статуса warning SubGram может не возвращать ссылки, попробуем разные способы получения
            if (!taskChannels.links || taskChannels.links.length === 0) {
                console.log(`🔄 Запрашиваем ссылки каналов для пользователя ${userId} (warning без ссылок)`);

                // Попробуем несколько способов получения ссылок
                const attempts = [
                    // 1. Попытка с MaxOP=1 (как задания)
                    () => SubGram.getTaskChannels(userId, chatId, firstName, languageCode, isPremium),
                    // 2. Попытка �� обычными параметрами но MaxOP=1
                    () => SubGram.getChannelLinks(userId, chatId, firstName, languageCode, isPremium)
                ];

                for (let i = 0; i < attempts.length; i++) {
                    try {
                        console.log(`🔄 Попытка ${i + 1}/2 получения ссылок`);
                        const linksCheck = await attempts[i]();

                        if (linksCheck.links && linksCheck.links.length > 0) {
                            taskChannels.links = linksCheck.links;
                            taskChannels.additional = linksCheck.additional;
                            console.log(`✅ Получены ссылки (попытка ${i + 1}): ${linksCheck.links.length} каналов`);
                            break;
                        } else {
                            console.log(`⚠️ Попытка ${i + 1} ��е дала ссылок`);
                        }
                    } catch (e) {
                        console.error(`❌ Ошибка попытки ${i + 1}:`, e.message);
                    }
                }

                if (!taskChannels.links || taskChannels.links.length === 0) {
                    console.log(`⚠️ Все попытки получения ссылок не уда��ись для пользователя ${userId}`);
                }
            }

            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Если есть ссылки для подписки - з��ачит пользователь не подпис��н
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

        // Дл�� всех оста��ьных случаев используем СТРОГИЙ подход - НЕ подписан!
        console.log(`⚠️ Неизвестный ста��ус для пользователя ${userId}: ${taskChannels.status}, считаем НЕ подписанным (СТРОГО)`);
        return {
            isSubscribed: false,
            subscriptionData: taskChannels
        };

    } catch (error) {
        console.error(`⚠️ Ошибка проверки подписки для пользователя ${userId}:`, error);

        // В случае ошибки проверяем кеш как fallback
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

        // СТРОГИЙ FALLBACK: если нет данных - НЕ подписан (безопасность превы��е в��его)
        console.log(`🔒 СТ��ОГИЙ FALLBACK: нет данных о подписке, считаем НЕ подписанным (безопасность)`);
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
            
            // Реферальная н��града б��дет начислена позже после выполнения усл��вий
            if (referrerId) {
                console.log(`👥 Новый поль��ователь ${userId} приш��л п�� реферальной ссылке от ${referrerId}`);
                // Награда будет нач��слена в функц��и checkReferralConditions()
            }
        }
        
        // СНАЧАЛА проверяем подписку - это самое важное!
        console.log(`🔍 Про��ерка подпи��ки для пользователя ${userId}`);
        const subscriptionStatus = await checkUserSubscription(
            userId, 
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );
        
        console.log(`📊 Статус подписки:`, subscriptionStatus);

        // Если пользов��тель НЕ подписан - показываем ��понсорские каналы (даже если ссылки пустые)
        if (!subscriptionStatus.isSubscribed) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан, блокируем доступ`);

            // Если есть ссылки - показываем их
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(`📢 Показываем ${subscriptionStatus.subscriptionData.links.length} ����понсорских каналов`);
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
                    '⏳ Пожалуйста, подождите немного или обратитесь к админ��стратору.'
                );
            }
            return; // ВАЖНО: выходим, НЕ показываем главное меню
        }

        // Только если пользователь т��чно подписа�� - показываем главное меню
        console.log(`✅ Пользователь ${userId} подписан, показываем главно�� меню`);
        await showMainMenu(chatId, userId);
        
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        await bot.sendMessage(chatId, '❌ Пр��изошла ошибка. П��пробуйте позже.');
    }
});

// Показать главное меню
async function showMainMenu(chatId, userId = null) {
    const message = '🌟 Добро пожаловать в бота для заработка звёзд!\n\n' +
                   '⭐ Зарабатывайте звёзды различными способами:\n' +
                   '• Приглашайте друзей\n' +
                   '• Выполняйте задания\n' +
                   '• Используйте кликер\n' +
                   '• Участвуйте в лотереях\n\n' +
                   'Выберите действие:';

    const keyboard = createMainMenuKeyboard();

    try {
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    } catch (error) {
        console.error('Ошибка отправки главно��о меню:', error);
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

        // КРИТИЧНО: ЖЁСТКАЯ проверка подписки для ВСЕХ действий в самом начале (кроме специальных команд)
        const allowedWithoutSubscription = [
            'check_subscription',
            'admin_',
            'approve_',
            'reject_',
            'disabled',  // для заблокированных кнопок
            'tasks',     // ВАЖНО: разрешаем доступ к заданиям для их выполнения
            'check_task', // проверка выполнения задания
            'skip_task',  // пропуск задания
            'check_custom_task_', // проверка кастомного задания
            'broadcast_', // рассылки (админские)
            'admin_back'  // возврат в админ панель
        ];

        // Проверяем разрешённые команды (с учётом точного соответствия для некоторых)
        const isAllowedCommand = allowedWithoutSubscription.some(cmd => {
            if (cmd.endsWith('_')) {
                return data.startsWith(cmd); // для команд с префиксом (admin_, check_custom_task_, и т.д.)
            } else {
                return data === cmd; // для точных команд (tasks, check_task, skip_task, admin_back)
            }
        });

        // ЖЁСТКАЯ БЛОКИРО��КА: сначала проверяем подписку для ВСЕХ команд кроме разрешённых
        if (!isAllowedCommand) {
            console.log(`🔍 ЖЁСТКАЯ проверка подписки для команды: ${data} пользователя ${userId}`);
            const subscriptionStatus = await checkUserSubscription(
                userId,
                chatId,
                callbackQuery.from.first_name || '',
                callbackQuery.from.language_code || 'ru',
                callbackQuery.from.is_premium || false
            );

            // СТРОГА�� ПРОВЕРКА: если НЕ подписан - ЖЁСТКО блокируем
            if (!subscriptionStatus.isSubscribed) {
                console.log(`🔒 ЖЁСТКАЯ БЛОКИРОВКА действия "${data}" для неподписанного пользователя ${userId}`);

                // Показываем алерт с жёсткой блокировкой
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '🔒 Доступ заблокирован! Сначала подпишитесь на все спонсорские каналы!',
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
                        console.log('Не удалось отредактировать сообщение, удаляем старое и отправляем новое');
                        // Пытаемся удалить старое сообщение с меню
                        try {
                            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                        } catch (deleteError) {
                            console.log('Не удалось удалить старое сообще��ие:', deleteError.message);
                        }
                        // Отправляем новое сообщение с каналами
                        await bot.sendMessage(chatId, subscriptionMessage, { reply_markup: keyboard });
                    }
                } else {
                    // Если нет ссылок, показываем общее сообщение о блокировке
                    const blockMessage = '🔒 Доступ к боту заблокирован!\n\n' +
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
                        console.log('Не удалось отредактировать сообщение, удаляем старо�� и отправляем новое');
                        // Пытаемся удалить старое со��бщение с меню
                        try {
                            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                        } catch (deleteError) {
                            console.log('Н�� удалось удалить старое сообщение:', deleteError.message);
                        }
                        // Отправляем новое сообщение с блокировкой
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

        // Отвечаем на callback_query только есл�� прошли проверку
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
                    await bot.answerCallbackQuery(callbackQuery.id, '📢 ��ассылка запущена!');
                } else if (data === 'admin_back') {
                    await showAdminPanel(chatId, message.message_id);
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
        console.error('��ши���ка обработки callback:', error);
        try {
            await bot.answerCallbackQuery(callbackQuery.id, '❌ Произошла ошибка');
        } catch (e) {}
    }
});

// Проверка подписки
async function handleSubscriptionCheck(chatId, userId, messageId, callbackQueryId = null) {
    console.log(`🔄 Проверка подписки по запросу пользователя ${userId}`);
    
    const subscriptionStatus = await checkUserSubscription(
        userId,
        chatId,
        '', // имя не важно для проверки
        'ru',
        false
    );

    console.log('📊 Результат проверки подписки:', subscriptionStatus);

    // Если нет ссылок для подписки - значит поль��ователь подписан
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        await editMainMenu(chatId, messageId);
        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Проверка пройдена!');
        }

        // Проверяем ��словия для засчитывания реферала
        await checkReferralConditions(userId);
    } else {
        // Все еще есть каналы дл�� подписки
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
    const message = '🏠 Гла��ное меню\n\nВыберите действие:';
    const keyboard = createMainMenuKeyboard();
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Остальные функции остаются такими же как в оригинальном файле...
// Показать профиль
async function showProfile(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const completedTasks = await Database.getUserCompletedTasks(userId);
    const referralStats = await Database.getReferralStats(userId);

    const message = `👤 Ваш профиль\n\n` +
                   `🆔 ID: ${user.user_id}\n` +
                   `👤 Имя: ${user.first_name}\n` +
                   `🌟 Баланс: ${user.balance} звёзд\n` +
                   `💰 Заработа��о за рефералов: ${user.referral_earned}\n` +
                   `💎 Всего заработано: ${user.total_earned}\n` +
                   `✅ Выполнено заданий: ${completedTasks}\n` +
                   `🏆 Очки: ${user.points}\n\n` +
                   `👥 Ваши рефералы:\n` +
                   `• ✅ Активированные: ${referralStats.activated_referrals}\n` +
                   `• ⏳ Неактивированные: ${referralStats.non_activated_referrals}\n` +
                   `• 📈 За сегодня: ${user.daily_referrals}\n\n` +
                   `ℹ️ Активированные рефералы - те, кто подписался на спонсоров и выполнил 2 задания`;

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

// Показать подробную информа��ию о рефералах
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
                const name = referral.first_name || 'Пользов��тель';
                const username = referral.username ? `@${referral.username}` : '';
                const date = new Date(referral.created_at).toLocaleDateString('ru-RU');
                message += `• ${name} ${username} (${date})\n`;
            });
            if (activatedReferrals.length > 10) {
                message += `... и ещё ${activatedReferrals.length - 10}\n`;
            }
        }

        message += `\n`;

        // ��еактивированные рефералы
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
        message += `💰 За каждого активированного реферала вы получаете 2 звезды`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '👤 Назад к профилю', callback_data: 'profile' }],
                [{ text: '���� В главное меню', callback_data: 'main_menu' }]
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

// Показать информацию о приглашениях
async function showInviteInfo(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const botUsername = (await bot.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;
    
    const message = `👥 Пригласить друзей\n\n` +
                   `🎯 Пригл��шайте друзей и зарабатывайте звёзды!\n\n` +
                   `💰 За каждого реферала: 2 звезды\n` +
                   `����� Реферал засчитывается когда:\n` +
                   `• Подписался на спонсорские кан��лы\n` +
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
                   `📊 Кликов сегодня: ${clicksToday}/10\n` +
                   `⏳ Осталось кликов: ${remainingClicks}\n\n` +
                   `${canClick ? '✅ Можете кликать!' : `⏰ Ждите ${timeToWait} мин.`}\n\n` +
                   `ℹ️ После каждого клика время ожидания\nувеличивается н�� 5 минут`;
    
    const keyboard = {
        inline_keyboard: [
            [{ 
                text: canClick && remainingClicks > 0 ? '🖱 КЛИК!' : '❌ Н��доступно', 
                callback_data: canClick && remainingClicks > 0 ? 'click' : 'disabled'
            }],
            [{ text: '��� В главное меню', callback_data: 'main_menu' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Обр��ботка клика
async function handleClick(chatId, userId, messageId, callbackQueryId) {
    try {
        const clicksToday = await Database.updateUserClicks(userId);
        await Database.updateUserBalance(userId, 0.1);
        await Database.updateUserPoints(userId, 1);

        await bot.answerCallbackQuery(callbackQueryId, '���� +0.1 звезды! +1 очко!');
        await showClicker(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка клика:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка клика');
    }
}

// Показать варианты вы��ода
async function showWithdrawOptions(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    
    const message = `💰 Вывод звёзд\n\n` +
                   `💎 Ваш баланс: ${user.balance} звёзд\n\n` +
                   `📋 Выбер��те сумму для вывода:`;
    
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
        text: '🏠 В главно�� меню',
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
        // Списываем ��ре��ства
        await Database.updateUserBalance(userId, amount, 'subtract');
        
        // Создаем ��аявку
        const request = await Database.createWithdrawalRequest(userId, amount);
        
        // Отправляем в админ чат
        const adminMessage = `💰 Нова���� заявка на вывод #${request.id}\n\n` +
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
        
        // Уведомляем пользоват��ля
        const userMessage = `✅ Заявка на вывод ${amount} звёзд отправлена!\n\n` +
                           `📋 Номер заявки: #${request.id}\n` +
                           `⏳ Ожидайте обработки администратором`;
        
        await bot.editMessageText(userMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });
        
    } catch (error) {
        console.error('Ошибка вывода:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка соз��ания заявки');
    }
}

// Показать задания
async function showTasks(chatId, userId, messageId) {
    try {
        console.log(`📋 Загрузка заданий для пользователя ${userId}`);

        // 1. Получаем каналы для заданий через специальную фун��цию (НЕ блокирующую)
        const taskData = await checkUserSubscriptionForTasks(userId, chatId);

        // 2. Получаем уже выполненные SubGram задания пользователем
        const completedSubgramTasks = await Database.getCompletedSubgramTasks(userId);
        console.log(`Пользователь ${userId} уже выполнил ${completedSubgramTasks.length} SubGram заданий`);

        // 3. Фильтруем каналы - исключаем уже выполненные как задания
        let availableChannels = [];
        if (taskData.availableChannels && taskData.availableChannels.length > 0) {
            availableChannels = taskData.availableChannels.filter(link =>
                !completedSubgramTasks.includes(link)
            );
        }

        console.log(`📊 Доступно новых SubGram заданий: ${availableChannels.length}`);

        if (taskData.status === 'error') {
            // Ошибка SubGram - показываем сообщение об ошибке
            const message = `📋 Задания\n\n` +
                           `⚠️ Временные проблемы с получением заданий.\n` +
                           `🔄 Попробуйте позже или обратит��сь к администратору.`;

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createBackToMenuKeyboard()
            });
        } else if (availableChannels.length > 0) {
            // Пока��ываем ПЕРВОЕ доступное задание
            const taskLink = availableChannels[0];
            const sponsorIndex = taskData.availableChannels.indexOf(taskLink);
            const sponsor = taskData.additional?.sponsors?.[sponsorIndex];
            const channelName = sponsor?.resource_name || 'Канал';
            
            const message = `📋 Доступное задание\n\n` +
                           `📢 Подпишитесь на канал: ${channelName}\n` +
                           `💰 Награда: 0.3 звезды\n` +
                           `🏆 Бонус: +1 очко\n\n` +
                           `ℹ️ После подписки нажмите "Проверить выполнение"`;
            
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📢 Перейти на канал', url: taskLink }],
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
            // ��ет доступных SubGram заданий, проверяем кастомные задания
            const customTasks = await Database.getTasks(false); // false = не SubGram задания
            
            // Ищем первое невыполненное кастомное з��дание
            let availableCustomTask = null;
            for (const task of customTasks) {
                const isCompleted = await Database.isTaskCompleted(userId, task.id);
                if (!isCompleted) {
                    availableCustomTask = task;
                    break;
                }
            }
            
            if (availableCustomTask) {
                // Показываем кастомное задание
                const message = `📋 Доступное задание\n\n` +
                               `📢 ${availableCustomTask.title}\n` +
                               `📝 ${availableCustomTask.description || 'Выполните задание'}\n` +
                               `💰 Награда: ${availableCustomTask.reward} звёзд\n` +
                               `🏆 Бонус: +1 очко\n\n` +
                               `ℹ️ После выполнения нажмите "Проверить выполнение"`;
                
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
                // Нет доступных заданий вообще
                const message = `��� Задания\n\n` +
                               `✅ Все задания выполнены!\n` +
                               `⏰ Проверьте позж��, возможно появятся новые.`;
                
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: createBackToMenuKeyboard()
                });
            }
        }
    } catch (error) {
        console.error('Ошибка показа заданий:', error);
        const message = `�� Задания\n\n` +
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
                   `🌟 Как за��абатывать звёзды:\n\n` +
                   `👥 Рефералы:\n` +
                   `• Приглашайте друзей по своей ссылке\n` +
                   `• За каждого ��еферала: 2 звезды\n` +
                   `• Реф��рал засчит��вается после подписки на спонсоров и выполнения 2 задани��\n\n` +
                   `🖱 К��икер:\n` +
                   `• ��ликайте до 10 раз в ��ень\n` +
                   `• За клик: 0.1 звезды\n` +
                   `• Время ожидания увеличивается\n\n` +
                   `📋 Задания:\n` +
                   `• Подписывайтесь на каналы\n` +
                   `• За зад��ние: 0.3 звезды\n\n` +
                   `🏆 Рейтинги:\n` +
                   `• Зараб��тывайте очки\n` +
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

// По��азать ��ейтинг��
async function showRatings(chatId, messageId) {
    const message = `🏆 Рейтинги\n\n` +
                   `📊 Выберите тип рейтинга:`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🌟 Общий р��йтинг', callback_data: 'rating_overall' }],
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
                   `📊 Ваша с��атистика:\n` +
                   `👥 Рефералов сегодня: ${user.daily_referrals}\n` +
                   `🎁 Кейс ${lastCaseDate === today ? 'уже отк��ыт' : 'доступен'}\n\n` +
                   `💰 Возм��жный выигрыш: 1-10 звё��д`;
    
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

// Показать лотере��
async function showLottery(chatId, messageId) {
    const lotteries = await Database.getActiveLotteries();
    
    let message = `🎲 Лотереи\n\n`;
    
    if (lotteries.length === 0) {
        message += 'ℹ️ Активных лотер��й не��';
    } else {
        lotteries.forEach(lottery => {
            const progress = (lottery.sold_tickets / lottery.total_tickets * 100).toFixed(1);
            message += `🎟 ${lottery.name}\n`;
            message += `💰 Цена билета: ${lottery.ticket_price} звёзд\n`;
            message += `🎫 Билетов: ${lottery.sold_tickets}/${lottery.total_tickets} (${progress}%)\n`;
            message += `🏆 Поб��дителей: ${lottery.winners_count}\n\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: createBackToMenuKeyboard()
    });
}

// обработка ввода пром��к��да
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
    // Пров��рка админских прав
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
        case 'admin_create_task':
            await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Функция в разработке');
            break;
        case 'admin_list_tasks':
            await showAdminTasksList(chatId, messageId);
            break;
        case 'admin_create_lottery':
            await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Функция в разработке');
            break;
        case 'admin_list_lotteries':
            await showAdminLotteriesList(chatId, messageId);
            break;
        case 'admin_create_promocode':
            await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Функция в разработке');
            break;
        case 'admin_list_promocodes':
            await showAdminPromocodesList(chatId, messageId);
            break;
        case 'admin_give_rewards':
            await handleGiveWeeklyRewards(chatId, userId, callbackQueryId);
            break;
        case 'admin_reset_weekly':
            await handleResetWeeklyPoints(chatId, userId, callbackQueryId);
            break;
    }

    await bot.answerCallbackQuery(callbackQueryId);
}

// Показать статистику бота
async function showBotStats(chatId, messageId) {
    try {
        const totalUsers = await Database.pool.query('SELECT COUNT(*) as count FROM users');
        const totalStarsEarned = await Database.pool.query('SELECT SUM(total_earned) as sum FROM users');
        const totalWithdrawals = await Database.pool.query('SELECT SUM(amount) as sum FROM withdrawal_requests WHERE status = \'approved\'');
        const pendingWithdrawals = await Database.pool.query('SELECT COUNT(*) as count, SUM(amount) as sum FROM withdrawal_requests WHERE status = \'pending\'');

        const message = `📊 Статистика бота\n\n` +
                       `👥 Всего п��льзователей: ${totalUsers.rows[0].count}\n` +
                       `⭐ Все��о заработано звёзд: ${totalStarsEarned.rows[0].sum || 0}\n` +
                       `💰 Всего выведено: ${totalWithdrawals.rows[0].sum || 0}\n` +
                       `⏳ Заявок в ожидании: ${pendingWithdrawals.rows[0].count}\n` +
                       `💎 Сумма в ожидании: ${pendingWithdrawals.rows[0].sum || 0}`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 ��азад к админ-панели', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Оши��ка статистики:', error);
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

        // 3. Найдем первое доступное задание (которое показываем пользователю)
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
            const channelName = sponsor?.resource_name || 'Ка��ал';

            await Database.completeSubgramTask(userId, currentTaskLink, channelName);
            await Database.updateUserBalance(userId, 0.3);
            await Database.updateUserPoints(userId, 1);

            await bot.answerCallbackQuery(callbackQueryId, '🎉 Задание выполнено! +0.3 звезды, +1 очко!');

            // Проверяем условия для засчитывания реферала
            await checkReferralConditions(userId);

            // Показываем следующее задание или завершаем
            await showTasks(chatId, userId, messageId);
        } else {
            // Пользователь еще не подписался
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

        await bot.answerCallbackQuery(callbackQueryId, `🎉 Задание выполнено! +${task.reward} звёзд, +1 очко!`);

        // Проверяем условия для засчитывания реферала
        await checkReferralConditions(userId);

        // Показываем следующее задание
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
        console.error('Ошибка открытия кейса:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка открытия кейса');
    }
}

// Обработка действий с заявками на вывод
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

// Остальные функции для админ панели...
async function showAdminTasks(chatId, messageId) {
    const message = `📋 Управление заданиями\n\n` +
                   `Здесь вы можете создавать собственные задания\n` +
                   `помимо заданий от SubGram`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '��� Создать задание', callback_data: 'admin_create_task' }],
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
                   `Создавайте и управляйте промокодами`;

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

async function showAdminRewards(chatId, messageId) {
    try {
        const leaderboard = await Database.getWeeklyLeaderboard(5);

        let message = `🏆 Недельные награды\n\n`;

        if (leaderboard.length === 0) {
            message += `ℹ️ Нет участников �� недельном рейтинге`;
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
                [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
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
            message += `ℹ️ Нет заявок в ��жидании`;
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

async function showAdminBroadcast(chatId, messageId) {
    const message = `📢 Рассылка сообщений\n\n` +
                   `Выберите готовое сообщение для рассылки:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Сообщение о рейтинге', callback_data: 'broadcast_rating' }],
            [{ text: '📋 Сообщение о задан��ях', callback_data: 'broadcast_tasks' }],
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
            message = `🏆 Бы��трее попади �� топ 5 по очкам в недельном рейтинге и получи дополнительные звёзды в конце ��едели!\n\n` +
                     `🥇 1 место: 100 звёзд\n` +
                     `🥈 2 мес��о: 75 звёзд\n` +
                     `🥉 3 место: 50 звёзд\n` +
                     `4 место: 25 звёзд\n` +
                     `5 место: 15 звёзд`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '👥 Пригласить друзе��', callback_data: 'invite' }],
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
                    [{ text: '📋 За��ания', callback_data: 'tasks' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        }

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.user_id, message, { reply_markup: keyboard });
                await new Promise(resolve => setTimeout(resolve, 50)); // Задержка между отправками
            } catch (error) {
                console.log(`Не удалось отправить сообщение п��льзователю ${user.user_id}`);
            }
        }

        console.log(`Рассылка ${type} завершена`);
    } catch (error) {
        console.error('Ошибка рассылки:', error);
    }
}

// Показать список заданий
async function showAdminTasksList(chatId, messageId) {
    try {
        const customTasks = await Database.getTasks(false); // не SubGram задания

        let message = `📋 Список заданий\n\n`;

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
        console.error('Ошибка показа списка лотерей:', error);
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
                [{ text: '➕ Создать промокод', callback_data: 'admin_create_promocode' }],
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
        console.error('Ошибк�� показа списка промокодов:', error);
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
                        `🏆 Поздравляем! Вы заняли ${i + 1} место в недельном рейтинге!\n` +
                        `💰 Ваша награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалось уведомить пользователя ${user.user_id}`);
                }
            }
        }

        await bot.answerCallbackQuery(callbackQueryId,
            `✅ Награды выданы ${rewardedCount} пользователя��!`);

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
                message += `👤 ${request.first_name} (@${request.username || 'н��т'})\n`;
                message += `💰 Сумма: ${request.amount} звёзд\n`;
                message += `💎 Ос��аток: ${request.balance} звёзд\n\n`;
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
        console.error('Ошибка показа за����ок:', error);
    }
}

async function handleWithdrawalAction(chatId, userId, data, callbackQueryId) {
    try {
        const [action, requestId] = data.split('_');
        const request = await Database.pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [requestId]);

        if (request.rows.length === 0) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка ��е найдена');
            return;
        }

        const requestData = request.rows[0];

        if (action === 'approve') {
            // Одобряем заявку
            await Database.processWithdrawal(requestId, 'approved');

            // Отправляем в чат платежей
            const paymentMessage = `✅ Выплата #${requestId} выполнена\n\n` +
                                 `👤 Пользователь: ${requestData.first_name}\n` +
                                 `💰 Сумма: ${requestData.amount} звёзд`;

            await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage);

            // Уведомляем пользователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `✅ Ваша заявка #${requestId} на вывод ${requestData.amount} звёзд одобрена и выполнена!`
                );
            } catch (e) {}

            await bot.answerCallbackQuery(callbackQueryId, '✅ ��аявка одобрена');

        } else if (action === 'reject') {
            // Отклоняем заявку и возвращаем средства
            await Database.processWithdrawal(requestId, 'rejected', 'Отклонено администрат��ром');
            await Database.updateUserBalance(requestData.user_id, requestData.amount, 'add');

            // У��едомляем пользователя
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
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка о��работки');
    }
}

async function showAdminLottery(chatId, messageId) {
    const message = `🎲 Управление л��тере��ми\n\n` +
                   `Здесь вы можете создавать и управлять лотереями`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать лотерею', callback_data: 'create_lottery' }],
            [{ text: '📋 Активные лотереи', callback_data: 'list_lotteries' }],
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
                   `Здесь вы можете создавать и управлять промокодами`;

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

async function showAdminRewards(chatId, messageId) {
    const message = `🏆 Недел��ные награды\n\n` +
                   `Текущие награды за топ 5:\n` +
                   `🥇 1 место: ${config.WEEKLY_REWARDS[1]} звёзд\n` +
                   `��� 2 место: ${config.WEEKLY_REWARDS[2]} звёзд\n` +
                   `🥉 3 место: ${config.WEEKLY_REWARDS[3]} звёзд\n` +
                   `4 место: ${config.WEEKLY_REWARDS[4]} звёзд\n` +
                   `5 место: ${config.WEEKLY_REWARDS[5]} звёзд\n\n` +
                   `⚙️ Автоматическое начисление: ВКЛ`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Выдать награды сейчас', callback_data: 'give_rewards_now' }],
            [{ text: '🔙 Назад к а��мин-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

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
        const reward = Math.floor(Math.random() * 10) + 1;

        // Обновляе�� баланс и дату открытия кейса
        await Database.updateUserBalance(userId, reward);
        await Database.pool.query('UPDATE users SET last_case_open = CURRENT_DATE WHERE user_id = $1', [userId]);

        const message = `🎁 Кейс открыт!\n\n` +
                       `🎉 Поздравляем! Вы выиграли ${reward} звёзд!\n` +
                       `💰 Зв��зды добав��ены на ваш б��ланс`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });

        await bot.answerCallbackQuery(callbackQueryId, `🎉 Выигра��и ${reward} звёзд!`);

    } catch (error) {
        console.error('Ошибка открытия кейса:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка открытия кейса');
    }
}

async function handleTaskCheck(chatId, userId, messageId, callbackQueryId) {
    try {
        console.log(`✅ Проверка выполнения задания пользоват��лем ${userId}`);

        // 1. Получаем текущее задание - использ��ем специальную функцию для заданий
        const taskData = await checkUserSubscriptionForTasks(userId, chatId);
        const completedSubgramTasks = await Database.getCompletedSubgramTasks(userId);

        let availableChannels = [];
        if (taskData.availableChannels && taskData.availableChannels.length > 0) {
            availableChannels = taskData.availableChannels.filter(link =>
                !completedSubgramTasks.includes(link)
            );
        }

        // 2. Если есть доступные задания, проверяем первое
        if (availableChannels.length > 0) {
            const taskLink = availableChannels[0];
            console.log(`🔍 Проверяем выполнение задания: ${taskLink}`);

            // 3. Делаем новую проверку заданий после возможной подписки пользователя
            const newCheck = await checkUserSubscriptionForTasks(userId, chatId);

            // 4. Если канал больше не в списке заданий - значит подписался
            if (!newCheck.availableChannels || !newCheck.availableChannels.includes(taskLink)) {
                // Задание выполнено - подписался на канал!
                console.log(`🎉 Задание выполнено! Пользователь ${userId} подписался на ${taskLink}`);

                // 5. Записываем выполненное задание в БД
                const sponsorIndex = taskData.availableChannels.indexOf(taskLink);
                const sponsor = taskData.additional?.sponsors?.[sponsorIndex];
                const channelName = sponsor?.resource_name || 'Канал';
                
                await Database.completeSubgramTask(userId, taskLink, channelName);
                
                // 6. Начисляем награду
                await Database.updateUserBalance(userId, 0.3);
                await Database.updateUserPoints(userId, 1);
                
                console.log(`✅ Пользователь ${userId} выполнил SubGram задание: ${taskLink}`);

                const message = `✅ Задание выполнено!\n\n` +
                               `💰 Вы получили 0.3 звезды\n` +
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

                // 7. Проверяем условия для засчитывания реферала
                await checkReferralConditions(userId);

            } else {
                // Все еще есть задание для выполнени��
                await bot.answerCallbackQuery(callbackQueryId, '❌ Подпишитесь на канал сн��чала!');
            }
        } else {
            // Нет доступных заданий
            await bot.answerCallbackQuery(callbackQueryId, '❌ Нет доступных заданий');
            await showTasks(chatId, userId, messageId); // Показать обновленное состояние
        }

    } catch (error) {
        console.error('Ошибка проверки задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки');
    }
}


// Проверка выполнения кастомного задания
async function handleCustomTaskCheck(chatId, userId, taskId, messageId, callbackQueryId) {
    try {
        // Получаем задание
        const task = await Database.pool.query('SELECT * FROM tasks WHERE id = $1 AND is_active = true', [taskId]);
        
        if (task.rows.length === 0) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Задание не найдено');
            return;
        }
        
        const taskData = task.rows[0];
        
        // Проверяем не было ли уже выполнено
        const isCompleted = await Database.isTaskCompleted(userId, taskId);
        if (isCompleted) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Задание уже в��полнено');
            await showTasks(chatId, userId, messageId);
            return;
        }
        
        // Записываем выполнение задания
        await Database.completeTask(userId, taskId);
        
        // Начисляем награду
        await Database.updateUserBalance(userId, taskData.reward);
        await Database.updateUserPoints(userId, 1);
        
        console.log(`✅ Пользователь ${userId} выполнил кастомное задание ${taskId}: ${taskData.title}`);

        const message = `✅ Задание выполнено!\n\n` +
                       `💰 Вы получили ${taskData.reward} звёзд\n` +
                       `🏆 Вы получили 1 очко\n\n` +
                       `Хотите выполнить ещё одно задание?`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '📋 Следующее задание', callback_data: 'tasks' }],
                [{ text: '���� В главное меню', callback_data: 'main_menu' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

        await bot.answerCallbackQuery(callbackQueryId, `✅ +${taskData.reward} звёзд!`);

        // Проверяем условия для засчитывания реферала (но кастомные задания не считаются для рефералов)
        // await checkReferralConditions(userId); // Не вызываем, только SubGram задания считаются

    } catch (error) {
        console.error('Ошибка проверки кастомного задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки');
    }
}

// Еженедельное начисление наград (воскресенье в 20:00 М��К)
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
                        `🏆 Поздравляем! Вы заняли ${position} ме��то в недельном рейтинге!\n` +
                        `💰 Ваша награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалос�� отправить награду пользователю ${user.user_id}`);
                }
            }
        }
        
        // Сброс н��дельных очков
        await Database.resetWeeklyPoints();
        console.log('Еженедельные награды начисле��ы');
        
    } catch (error) {
        console.error('Ошибка начислени�� е��енедельных на��рад:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// Обработка ошибок polling
bot.on('polling_error', (error) => {
    console.log('Polling error:', error.message);
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
        console.log('К��нфликт polling - д��угой эк��емпляр бота уже запущен');
        // Не пытаемся переподключ��ться, так как это усугубляет проблему
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
