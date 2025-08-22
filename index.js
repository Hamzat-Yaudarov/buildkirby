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

// Защита от спама - храним последний вызов для каждого пол��зователя
const lastSubscriptionCheck = new Map();

// Защита от дублирования спонсорских сообщений
const lastSponsorMessage = new Map();

// Централизованная функция для отправки спонсорских сообщений (БЕЗ ДУБЛИРОВАНИЯ)
async function sendSponsorMessage(chatId, userId, subscriptionData, messageId = null, method = 'send') {
    const now = Date.now();
    const lastMessage = lastSponsorMessage.get(userId);

    // СТРОГАЯ ЗАЩИТА: если недавно отправляли спонсо��ское сообщение - не отправляем повторно
    if (lastMessage && (now - lastMessage) < 8000) { // 8 секунд строгая защита
        console.log(`🛡️ БЛОКИРОВКА: недавно уже отправили спонсорское сообщение пользователю ${userId}`);
        return false;
    }

    // Устанавливаем блокировку ПЕРЕД отправкой, а не после
    lastSponsorMessage.set(userId, now);

    try {
        const message = SubGram.formatSubscriptionMessage(
            subscriptionData.links,
            subscriptionData.additional?.sponsors
        );
        const keyboard = SubGram.createSubscriptionKeyboard(subscriptionData.links);

        if (method === 'edit' && messageId) {
            // Пытаемся отредактировать существующее сообщение
            try {
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard
                });
                console.log(`✅ Отредактировали спонсорское сообщение для пользователя ${userId}`);
                return true;
            } catch (editError) {
                console.log(`⚠️ Редактирование не удалось для пользователя ${userId}, НО НЕ ОТПРАВЛЯЕМ НОВОЕ (защита от дублирования)`);
                return false; // НЕ отправляем новое сообщение при ошибке редактирования
            }
        } else {
            // Отпр��вляем новое сообщение ТОЛЬКО если метод не edit
            await bot.sendMessage(chatId, message, { reply_markup: keyboard });
            console.log(`✅ Отправили спонсорское сообщение пользователю ${userId}`);
            return true;
        }

    } catch (error) {
        console.error(`❌ Ошибка отправки спонсорского сообщения пользователю ${userId}:`, error);
        // При ошибке удаляем блокировку, чтобы можно было попробовать позже
        lastSponsorMessage.delete(userId);
        return false;
    }
}

// Проверка выполнения условий для засчитывания реферала
async function checkReferralConditions(userId) {
    try {
        const user = await Database.getUser(userId);
        if (!user || !user.referrer_id) {
            return; // Нет реферера
        }

        // Проверяем подписку на спонсорские каналы
        const subscriptionStatus = await checkUserSubscription(userId, userId);
        if (!subscriptionStatus.isSubscribed) {
            console.log(`👥 Реферал ${userId} еще не подписан на спонсорские к��налы`);
            return;
        }

        // Проверяем количество выполненных кастомных з��даний (больше не SubGram)
        const completedTasks = await Database.getUserCompletedTasks(userId);
        if (completedTasks < 2) {
            console.log(`👥 Реферал ${userId} выполнил только ${completedTasks}/2 заданий`);
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
                '🏆 Вы ��олучили 1 очко'
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

// Инициализаци�� бота
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

// Проверка подписки пользователя на СПОНСОРСКИЕ каналы (для блокировки доступа к функциям бота)
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

        // Если нет кешированных данных, делаем запрос к SubGram для СПОНСОР��КИХ каналов
        console.log(`🌐 Запрос к SubGram API для проверки СПОНСОРСКИ�� каналов пользователя ${userId}`);
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
                    isSubscribed: cachedStatus.isSubscribed === true, // С��РОГО: только если точно подписан
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
                    message: 'Ошибка проверки подписки - доступ заблокирован'
                }
            };
        }

        // ВАЖНО: статус "warning" означает что пользо��атель НЕ подписан!
        if (taskChannels.status === 'warning') {
            console.log(`⚠️ Пользователь ${userId} НЕ подписан (статус warning): ${taskChannels.message}`);

            // Для статуса warning SubGram может не возвращать ссылки, попробуем разные способы получения
            if (!taskChannels.links || taskChannels.links.length === 0) {
                console.log(`�� Запрашиваем ссылки ка��алов для пользователя ${userId} (warning без ссылок)`);

                // Попробуем несколько способов получения ссылок
                const attempts = [
                    // 1. Попытка с обычными параметрами но MaxOP=3
                    () => SubGram.getChannelLinks(userId, chatId, firstName, languageCode, isPremium)
                ];

                for (let i = 0; i < attempts.length; i++) {
                    try {
                        console.log(`🔄 Попытка ${i + 1}/1 получения ссылок`);
                        const linksCheck = await attempts[i]();

                        if (linksCheck.links && linksCheck.links.length > 0) {
                            taskChannels.links = linksCheck.links;
                            taskChannels.additional = linksCheck.additional;
                            console.log(`✅ Получены ссылки (попытка ${i + 1}): ${linksCheck.links.length} каналов`);
                            break;
                        } else {
                            console.log(`⚠�� Попытка ${i + 1} не дала ссылок`);
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

        // Если есть ссылки для подписки - значит пользовател�� не подписан
        if (taskChannels.links && taskChannels.links.length > 0) {
            console.log(`��� Пользователь ${userId} НЕ подписан, есть ${taskChannels.links.length} каналов`);
            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Статус "ok" и нет ссылок - пользователь подписан
        if (taskChannels.status === 'ok') {
            console.log(`✅ Пользователь ${userId} по��писан на все каналы (статус ok)`);
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

        // СТРОГИЙ FALLBACK: если не�� данных - НЕ подписан (безопасность превыше всего)
        console.log(`🔒 СТРОГИЙ FALLBACK: нет данных о подписке, считаем НЕ подписанным (безопасность)`);
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
        // ЗАЩИТА ОТ СПАМА: проверяем не вызывали ли мы недавно проверку подписки
        const now = Date.now();
        const lastCheck = lastSubscriptionCheck.get(userId);
        if (lastCheck && (now - lastCheck) < 3000) { // 3 секунды защита
            console.log(`⚠️ Защита от спама: пропускаем повторный /start для поль��ователя ${userId}`);
            return;
        }
        lastSubscriptionCheck.set(userId, now);

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
        
        // СНАЧАЛА проверяем подписку - это самое важное!
        console.log(`🔍 Проверка подписки для пользователя ${userId}`);
        const subscriptionStatus = await checkUserSubscription(
            userId, 
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );
        
        console.log(`📊 Статус подписки:`, subscriptionStatus);

        // Если пользователь НЕ подписан - показываем спонсорские каналы (даже если ссылки пустые)
        if (!subscriptionStatus.isSubscribed) {
            console.log(`🔒 По��ьзователь ${userId} НЕ ��одписан, блокируем доступ`);

            // Если есть ссылки - показываем их ЧЕРЕЗ ЦЕНТРАЛИЗОВАННУЮ ФУНКЦИЮ
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(`📢 Показываем ${subscriptionStatus.subscriptionData.links.length} спонсорских каналов`);
                await sendSponsorMessage(chatId, userId, subscriptionStatus.subscriptionData);
            } else {
                // Если нет ссылок, но пользователь не подписан - показываем общее сообщение
                console.log(`⚠️ Н��т ссылок каналов, показываем общее сообщение о подписке`);
                await bot.sendMessage(chatId,
                    '🔒 Для доступа к боту необходимо подписаться на спонсорские каналы.\n\n' +
                    '⏳ Пожалуйста, подождите немного или обратитесь к администрат��ру.\n\n' +
                    '���� Нажмите кнопку ниже для повторной проверки.',
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 Проверить подписки', callback_data: 'check_subscription' }
                            ]]
                        }
                    }
                );
            }
            return; // ВАЖНО: выходим, НЕ показываем главное меню
        }

        // Только если пользователь точно подписан - показываем главное меню
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
                   '⭐ Зарабатывайте звёзды различными способа��и:\n' +
                   '• Приглашайте друзей\n' +
                   '• Выполняйте задания\n' +
                   '• Используйте кликер\n' +
                   '• Участвуйте в лотереях\n\n' +
                   'В��бер��те действие:';

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

    console.log(`🔔 ПОЛУЧЕН CALLBACK: "${data}" от пользователя ${userId}`);

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
            'check_custom_task_', // проверка кастомного задания
            'broadcast_', // рассылки (админские)
            'admin_back'  // возврат в админ панель
        ];

        // Проверяем разрешённые команды (с учётом точного соответствия для некоторых)
        const isAllowedCommand = allowedWithoutSubscription.some(cmd => {
            if (cmd.endsWith('_')) {
                return data.startsWith(cmd); // для команд с префиксом (admin_, check_custom_task_, и т.д.)
            } else {
                return data === cmd; // для то��ных команд (tasks, admin_back)
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

            // СТРОГАЯ ПРОВЕРКА: если НЕ подписан - ЖЁСТКО блокируем
            if (!subscriptionStatus.isSubscribed) {
                console.log(`🔒 ЖЁСТКАЯ БЛОКИРОВКА д��йстви�� "${data}" для неподписанного пользователя ${userId}`);

                // Показываем алерт с жёсткой блокировкой
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '🔒 Доступ заблокирован! Сначала подпи��итесь на все спонсорские каналы!',
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
                        // Пытаемся удалить старое сообщение с ��еню
                        try {
                            await bot.deleteMessage(chatId, callbackQuery.message.message_id);
                        } catch (deleteError) {
                            console.log('Не удалось удалить старое сообщение:', deleteError.message);
                        }
                        // Отправляем новое сообщение с каналами
                        // БЛОКИРОВАНО: используем централизованную функцию вместо прямой отправки
                        console.log('❌ БЛОКИРОВКА: предотвращено дублирование спонсорского сообщения');
                    }
                } else {
                    // Если нет ссылок, показываем общее сообщение о блокировке
                    const blockMessage = '🔒 Дост��п к боту заблокирован!\n\n' +
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

                return; // КР��ТИЧНО: немедленно завершаем обработку
            }
        }

        // Отвечаем на callback_query только для команд, которые не отвечают сами
        const commandsThatAnswerThemselves = [
            'check_subscription',
            'click',
            'open_case',
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
                console.log(`📋 ВЫЗЫВАЮ showTasks для пользователя ${userId}`);
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

// Проверк�� подписки
async function handleSubscriptionCheck(chatId, userId, messageId, callbackQueryId = null) {
    console.log(`🔄 Проверка подписки по запр��су пользователя ${userId}`);

    // ЗАЩИТА ОТ СПАМА: проверяем не выз��вали ли мы ��едавно проверку подписки
    const now = Date.now();
    const lastCheck = lastSubscriptionCheck.get(userId);
    if (lastCheck && (now - lastCheck) < 2000) { // 2 секунды защита для callback
        console.log(`⚠️ Защита от спама: пропускаем повторную проверку подписки для пользователя ${userId}`);
        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '⏳ Пожалуйста, подождите...');
        }
        return;
    }
    lastSubscriptionCheck.set(userId, now);

    const subscriptionStatus = await checkUserSubscription(
        userId,
        chatId,
        '', // имя не важно для проверки
        'ru',
        false
    );

    console.log('📊 Результат проверки подписки:', subscriptionStatus);

    // Если ��ет ссылок д��я подписки - значит пользователь подписан
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        // Показываем сообщение об успешной пров��рке с приветствием
        const successMessage = '✅ Отлично! Вы успешно подписали��ь на все спонсорские каналы!\n\n' +
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
        // Все еще есть каналы для подписки - используем ЦЕНТРАЛИЗОВАННУЮ ФУНКЦИЮ
        await sendSponsorMessage(
            chatId,
            userId,
            subscriptionStatus.subscriptionData,
            messageId,
            'edit'
        );

        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Вы ещё не подписались на все каналы!');
        }
    }
}

// Редактирование сообщения с г��авным меню
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
                   `💰 Заработано за рефералов: ${user.referral_earned}\n` +
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
            [{ text: '👥 Подробн�� о рефералах', callback_data: 'referral_details' }],
            [{ text: '🎫 Ввест�� промокод', callback_data: 'promocode' }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать подробную информацию о рефералах
async function showReferralDetails(chatId, userId, messageId) {
    try {
        const activatedReferrals = await Database.getActivatedReferrals(userId);
        const nonActivatedReferrals = await Database.getNonActivatedReferrals(userId);

        let message = `👥 Детальная инфор��ация о рефералах\n\n`;

        // Активированные рефералы
        message += `✅ Активированные рефералы (${activatedReferrals.length}):\n`;
        if (activatedReferrals.length === 0) {
            message += `• Пока н��т активированных рефералов\n`;
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
            nonActivatedReferrals.slice(0, 10).forEach((referral, index) => { // показываем толь��о первые 10
                const name = referral.first_name || 'Пользователь';
                const username = referral.username ? `@${referral.username}` : '';
                const date = new Date(referral.created_at).toLocaleDateString('ru-RU');
                message += `• ${name} ${username} (${date})\n`;
            });
            if (nonActivatedReferrals.length > 10) {
                message += `... и ещё ${nonActivatedReferrals.length - 10}\n`;
            }
        }

        message += `\n📝 Для актива��ии реферал должен:\n`;
        message += `1. Подписаться на все спонсорские каналы\n`;
        message += `2. Выполнить 2 задания\n\n`;
        message += `💰 За каждого а��тивированного реферала вы получаете 2 звезды`;

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

// Показать ин��ормацию о приглашениях
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
                   `�� Клико�� сегодня: ${clicksToday}/10\n` +
                   `�� Осталось кликов: ${remainingClicks}\n\n` +
                   `${canClick ? '✅ Можете кликать!' : `⏰ Ждит�� ${timeToWait} мин.`}\n\n` +
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
        console.error('Ошибка клика:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка клика');
    }
}

// Показать варианты вывода
async function showWithdrawOptions(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    
    const message = `💰 Выво�� звёзд\n\n` +
                   `💎 Ваш баланс: ${user.balance} звёзд\n\n` +
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
        // Списываем ср��дства
        await Database.updateUserBalance(userId, amount, 'subtract');
        
        // Создаем заявку
        const request = await Database.createWithdrawalRequest(userId, amount);
        
        // Получаем расширенную информацию
        const userInfo = await Database.getUserWithdrawalInfo(userId) || user;

        // Отправляем в админ чат расширенную информацию
        const adminMessage = `💰 Новая заявка на вывод\n\n` +
                            `👤 Пользователь: ${user.first_name}\n` +
                            `🆔 ID: ${user.user_id}\n` +
                            `📱 Username: @${user.username || 'отсутствует'}\n` +
                            `💰 Сумма: ${amount} звёзд\n` +
                            `💎 Остаток: ${user.balance - amount} звёзд\n` +
                            `💎 Всего заработано: ${user.total_earned} звёзд\n\n` +
                            `📊 Подписки на спонсорские каналы:\n` +
                            `👤 П��льзователь: ~${userInfo.sponsor_subscriptions || 0} подписок\n` +
                            `👥 Его рефералы: ~${userInfo.referrals_subscriptions || 0} подписок\n\n` +
                            `👥 Рефералы:\n` +
                            `✅ Активированные: ${userInfo.referral_stats?.activated_referrals || 0}\n` +
                            `⏳ Неактивированные: ${userInfo.referral_stats?.non_activated_referrals || 0}\n` +
                            `📈 За сегодня: ${user.daily_referrals}\n\n` +
                            `🔗 Профиль: tg://user?id=${user.user_id}`;

        const adminKeyboard = {
            inline_keyboard: [
                [
                    { text: '✅ ��ыполнено', callback_data: `approve_${request.id}` },
                    { text: '❌ Отклонить', callback_data: `reject_${request.id}` }
                ]
            ]
        };

        await bot.sendMessage(config.ADMIN_CHAT_ID, adminMessage, {
            reply_markup: adminKeyboard
        });
        
        // Уведомляем польз��вателя
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
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка создания заявки');
    }
}

// Показать задания (только кас��омные, без SubGram)
async function showTasks(chatId, userId, messageId) {
    try {
        console.log(`📋 ФУНКЦИЯ showTasks ВЫЗВАНА для пользователя ${userId}`);

        // Получаем только кастомные задания (не SubGram)
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
                           `📄 ${availableCustomTask.description || 'Выполните задание'}\n` +
                           `💰 Нагр��да: ${availableCustomTask.reward} звёзд\n` +
                           `🏆 Бонус: +1 очко\n\n` +
                           `ℹ️ По��ле выполнения нажмите "Проверить выполнение"`;
            
            const keyboard = {
                inline_keyboard: [
                    availableCustomTask.link ? [{ text: '📢 Перейти к за��анию', url: availableCustomTask.link }] : [],
                    [{ text: '✅ Проверить выполне��ие', callback_data: `check_custom_task_${availableCustomTask.id}` }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ].filter(row => row.length > 0) // Убираем пусты�� строки
            };
            
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });
        } else {
            console.log(`❌ НЕТ ДОСТУПНЫХ ЗАДАНИЙ`);
            // Нет доступных заданий
            const message = `📋 Задания\n\n` +
                           `✅ Все задания выполнены!\n` +
                           `⏳ Проверьте позже, возможно появятся новые задания.`;
            
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createBackToMenuKeyboard()
            });
        }
    } catch (error) {
        console.error('Ошибка показа заданий:', error);
        const message = `📋 Задания\n\n` +
                       `❌ Произошла ошибка при загрузке зада��ий.\n` +
                       `🔄 Попробу��те позже.`;
        
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
                   `• За каждого реф��рала: 2 звезды\n` +
                   `• Реферал засчитывается после подписки на спонсоров и выполнения 2 заданий\n\n` +
                   `🖱 Кликер:\n` +
                   `• Кликайте до 10 раз в день\n` +
                   `• За клик: 0.1 звезды\n` +
                   `• Время ожидания у��еличивается\n\n` +
                   `📋 Задания:\n` +
                   `• Выполняйте кастомные задания\n` +
                   `• Награда указана в каждом задании\n\n` +
                   `🏆 Рейтинги:\n` +
                   `• Зарабатывайте очки\n` +
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

// П��казать рейтинги
async function showRatings(chatId, messageId) {
    const message = `🏆 Рейтинги\n\n` +
                   `📊 Выберите тип рейтинга:`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🌟 Общий рейтинг', callback_data: 'rating_overall' }],
            [{ text: '���� Недельный рейтинг', callback_data: 'rating_weekly' }],
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
        title = '��� Общий рейтинг';
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
                   `📊 Ваша статистика:\n` +
                   `👥 Рефералов сегодня: ${user.daily_referrals}\n` +
                   `🎁 Кейс ${lastCaseDate === today ? 'уже открыт' : 'доступен'}\n\n` +
                   `💰 Во��можный выигрыш: 1-10 звёзд`;
    
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
    await bot.sendMessage(chatId, '���� Введите промокод:');
}

// Обработчик кастомного задания
async function handleCustomTaskCheck(chatId, userId, taskId, messageId, callbackQueryId) {
    try {
        console.log(`✅ Проверка выполнения кастомного задания ${taskId} для пользователя ${userId}`);

        // Проверяем есть ли задание
        const tasks = await Database.getTasks(false);
        const task = tasks.find(t => t.id === taskId);
        
        if (!task) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Задание не найдено');
            return;
        }

        // ��роверяем не выполнено ли уже
        const isCompleted = await Database.isTaskCompleted(userId, taskId);
        if (isCompleted) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Задание уже выполнено!');
            await showTasks(chatId, userId, messageId);
            return;
        }

        // Отмечаем как выполненное
        await Database.completeTask(userId, taskId);
        
        // Начисляем награду
        await Database.updateUserBalance(userId, task.reward);
        await Database.updateUserPoints(userId, 1);

        await bot.answerCallbackQuery(callbackQueryId, `🎉 +${task.reward} звёзд! +1 очко!`);

        // Проверяем условия для реферала
        await checkReferralConditions(userId);

        // Показываем сл��дующее задание или сообщение о завершении
        await showTasks(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка проверки кастомного задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки задания');
    }
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
            await bot.sendMessage(chatId, `�� ${error.message}`);
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

// Обработчик админских действий (упрощенная версия - нужно добавить полную реали��ацию)
async function handleAdminCallback(chatId, userId, data, messageId, callbackQueryId) {
    // Про��ерка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    try {
        switch (data) {
            case 'admin_stats':
                await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Статистика будет добавлена позже');
                break;
            case 'admin_tasks':
                await bot.answerCallbackQuery(callbackQueryId, 'ℹ️ Управление заданиями будет добавлено позже');
                break;
            default:
                await bot.answerCallbackQuery(callbackQueryId, '❌ Неизвестная команда');
                break;
        }
    } catch (error) {
        console.error('Ошибка адми��ской команды:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Произошла оши��ка');
    }
}

// Обработчик открытия кейса (упрощенная версия)
async function handleOpenCase(chatId, userId, messageId, callbackQueryId) {
    try {
        const user = await Database.getUser(userId);
        const today = new Date().toDateString();
        const lastCaseDate = user.last_case_open ? new Date(user.last_case_open).toDateString() : null;
        
        if (user.daily_referrals < 5 || lastCaseDate === today) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Условия не выполнены!');
            return;
        }

        // Случайная награда от 1 до 10 звёзд
        const reward = Math.floor(Math.random() * 10) + 1;
        
        // Начисляем награду
        await Database.updateUserBalance(userId, reward);
        
        // Обновляем дату открытия кейса
        await Database.pool.query(
            'UPDATE users SET last_case_open = CURRENT_DATE WHERE user_id = $1',
            [userId]
        );

        await bot.answerCallbackQuery(callbackQueryId, `🎉 Вы выиграли ${reward} звёзд!`);
        await showCases(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка открытия кейса:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка открытия кейса');
    }
}

// Обработчик заявок на вывод с отправкой номеров в платежный чат
async function handleWithdrawalAction(chatId, userId, data, callbackQueryId) {
    // Проверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    try {
        const [action, requestId] = data.split('_');
        const id = parseInt(requestId);

        // Получаем информацию о заявке перед обработкой
        const request = await Database.pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [id]);
        if (request.rows.length === 0) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка не найдена');
            return;
        }

        const requestData = request.rows[0];
        const user = await Database.getUser(requestData.user_id);

        if (action === 'approve') {
            // Одобряем заявку
            await Database.processWithdrawal(id, 'approved');

            // Отправляем в чат платежей С НОМЕРОМ ЗАЯВКИ
            const paymentMessage = `✅ Выплата #${id} выполнена\n\n` +
                                 `👤 Пользователь: ${user?.first_name || 'Неизвестен'}\n` +
                                 `🆔 ID: ${requestData.user_id}\n` +
                                 `💰 Сумма: ${requestData.amount} звёзд\n` +
                                 `📅 Дата: ${new Date().toLocaleDateString('ru-RU')}`;

            await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage);

            // Уведомляем пользователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `✅ Ваша заявка на вывод ${requestData.amount} звёзд одобрена и выполнена!`
                );
            } catch (e) {
                console.log(`Не удалось уведомить пользователя ${requestData.user_id}`);
            }

            await bot.answerCallbackQuery(callbackQueryId, '✅ Заявка одобрена');

        } else if (action === 'reject') {
            // Отклоняем заявку и возвращаем средства
            await Database.processWithdrawal(id, 'rejected', 'Отклонено администратором');
            await Database.updateUserBalance(requestData.user_id, requestData.amount, 'add');

            // Отправляем в чат платежей С НОМЕРОМ ЗАЯВКИ
            const paymentMessage = `❌ Заявка #${id} отклонена\n\n` +
                                 `👤 Пользователь: ${user?.first_name || 'Неизвестен'}\n` +
                                 `🆔 ID: ${requestData.user_id}\n` +
                                 `💰 Сумма: ${requestData.amount} звёзд\n` +
                                 `📅 Дата: ${new Date().toLocaleDateString('ru-RU')}\n` +
                                 `💰 Средства возвращены пользователю`;

            await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage);

            // Уведомляем пользователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `❌ Ваша заявка на вывод ${requestData.amount} звёзд была отклонена.\n` +
                    `💰 Средства возвращены на баланс.`
                );
            } catch (e) {
                console.log(`Не удалось уведомить пользователя ${requestData.user_id}`);
            }

            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка отклонена');
        }

    } catch (error) {
        console.error('Ошибка обработки заявки:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка обработки');
    }
}

// Обработчик рассылки (упрощенная версия)
async function handleBroadcast(type) {
    console.log(`📢 Рассылка типа ${type} (функция б��дет добавлена позже)`);
}

// Инициализация
initBot();

module.exports = { bot };
