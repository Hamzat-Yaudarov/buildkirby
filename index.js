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

// ��ащита от спама - храним последний вызов для каждого пользователя
const lastSubscriptionCheck = new Map();

// Защита от дублирования спонсорски�� сообщений
const lastSponsorMessage = new Map();

// Удаляем предсказуемый счетчик рулетки
// let rouletteBetCounter = 0; // УЯЗВИМОСТЬ ИСПРАВЛЕНА

// Проверка подписки на ли��ные спонсорские каналы
async function checkPersonalChannelsSubscription(userId, skipOnError = false) {
    try {
        const personalChannels = config.PERSONAL_SPONSOR_CHANNELS;
        if (!personalChannels || personalChannels.length === 0) {
            return { isSubscribed: true }; // Если личных каналов нет, считаем подписанным
        }

        const unsubscribedChannels = [];

        for (const channel of personalChannels) {
            try {
                const member = await bot.getChatMember(channel, userId);
                if (member.status === 'left' || member.status === 'kicked') {
                    unsubscribedChannels.push({
                        username: channel,
                        title: channel.replace('@', ''),
                        url: `https://t.me/${channel.replace('@', '')}`
                    });
                }
            } catch (error) {
                console.error(`Ошибка проверка подписки на канал ${channel}:`, error.message);

                if (skipOnError) {
                    // При нажатии кнопки "Проверить подписки" - пропускаем канал при ошибке
                    console.log(`⏭️ Пропускаем канал ${channel} при проверке по запросу пользователя`);
                } else {
                    // В остальных случаях считаем что пользователь не подписан
                    unsubscribedChannels.push({
                        username: channel,
                        title: channel.replace('@', ''),
                        url: `https://t.me/${channel.replace('@', '')}`
                    });
                }
            }
        }

        return {
            isSubscribed: unsubscribedChannels.length === 0,
            unsubscribedChannels: unsubscribedChannels
        };

    } catch (error) {
        console.error('Ошибка проверки личных каналов:', error);
        return { isSubscribed: false, unsubscribedChannels: [] };
    }
}

// Централизованная функция для отправки спонсорских сообщений (БЕЗ ДУБЛИРОВАНИЯ)
async function sendSponsorMessage(chatId, userId, subscriptionData, messageId = null, method = 'send') {
    const now = Date.now();
    const lastMessage = lastSponsorMessage.get(userId);
    const uniqueKey = `${userId}_${chatId}`; // Уникальный ключ для защиты

    // УСИЛЕННАЯ ЗАЩИТА: если недавно отправляли спонсорское сообщение - не отправляем повторно
    if (lastMessage && (now - lastMessage) < 30000) { // 30 секунд усиленная защита
        console.log(`🛡️ БЛОКИРОВКА: недавно уже отправили спонсорское сообщение пользователю ${userId} (${(now - lastMessage)/1000}с назад)`);
        return false;
    }

    // Проверяем есть ли ссылки для отправки
    if (!subscriptionData.links || subscriptionData.links.length === 0) {
        console.log(`⚠️ Нет ссылок для отправки спонсорского сообщения пользователю ${userId}`);
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
            // Пытаемся от��едактировать существующее сообщение
            try {
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: keyboard
                });
                console.log(`✅ Отредактировали спонсорское сообщение для пользователя ${userId}`);
                return true;
            } catch (editError) {
                console.log(`⚠️ Редактирование не удалось для пользователя ${userId}: ${editError.message}`);
                // При ошибке редактирования удаляем блокиров��у и НЕ отправляем н��вое сообщение
                lastSponsorMessage.delete(userId);
                return false;
            }
        } else {
            // Отправляем новое сообщение ТОЛЬКО если метод не edit
            await bot.sendMessage(chatId, message, { reply_markup: keyboard });
            console.log(`✅ Отправили спонсорское cообщение пользователю ${userId}`);
            return true;
        }

    } catch (error) {
        console.error(`❌ Ошибка отправки спонсорского сообщения пользователю ${userId}:`, error.message);
        // При ошибке удаляем блокировку, чтобы можно было попробовать позже
        lastSponsorMessage.delete(userId);
        return false;
    }
}

// Проверка выполнения условий для за��читывания реферала
async function checkReferralConditions(userId) {
    try {
        const user = await Database.getUser(userId);
        if (!user || !user.referrer_id) {
            return; // Нет реферера
        }

        // Пр����веряем подписку на SubGram спонсорские каналы
        const subscriptionStatus = await checkUserSubscription(userId, userId);
        if (!subscriptionStatus.isSubscribed) {
            console.log(`👥 Реферал ${userId} еще не подписан на SubGram спонсорские каналы`);
            return;
        }

        // НОВОЕ: Проверяем подпи��ку на личные спонсорские каналы
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId);
        if (!personalChannelsStatus.isSubscribed) {
            console.log(`👥 Реферал ${userId} еще не подписан на личные спонсорские каналы`);
            return;
        }

        // Проверяем количество выполненных кастомных заданий (больше не SubGram)
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

        // Все ��словия выполнены - начисляем награду
        console.log(`🎉 Реферал ${userId} выполнил все условия! Начисляем награду реферору ${user.referrer_id}`);

        // ИСПРА��ЛЕНО: Используем атомарную транзакцию для предотвращения race condition
        const client = await Database.pool.connect();
        try {
            await client.query('BEGIN');

            // Атом��рно помечае�� реферала как завер��енного ТОЛЬКО если ещё не завершен
            const updateResult = await client.query(
                'UPDATE users SET referral_completed = TRUE WHERE user_id = $1 AND referral_completed = FALSE RETURNING referrer_id',
                [userId]
            );

            // Если обновление не произошло (уже было referral_completed = TRUE), выходим
            if (updateResult.rowCount === 0) {
                console.log(`⚠️ Реферальная награда за пользователя ${userId} уже была начислена (race condition предотвращена)`);
                await client.query('COMMIT');
                return;
            }

            const referrerId = updateResult.rows[0].referrer_id;
            console.log(`✅ Атомарно помечен реферал ${userId}, начисляем награду рефереру ${referrerId}`);

            // Начисляем баланс и очки рефереру в той же транзакции
            await client.query(
                'UPDATE users SET balance = balance + 2, total_earned = total_earned + 2, points = points + 1, weekly_points = weekly_points + 1 WHERE user_id = $1',
                [referrerId]
            );

            // Увеличи��аем счетчики рефералов в той же транзакции
            await client.query(
                'UPDATE users SET total_referrals = total_referrals + 1, daily_referrals = daily_referrals + 1, referral_earned = referral_earned + 2 WHERE user_id = $1',
                [referrerId]
            );

            await client.query('COMMIT');
            console.log(`✅ Реферальная награда успешно начислена атомарно: +2 звезды, +1 очко для ${referrerId}`);

            // Уве����омляем реферера после успешного COMMIT
            try {
                await bot.sendMessage(referrerId,
                    '🎉 Ваш реферал вы��олнил все условия!\n' +
                    '✅ Подписался на все спонсорские каналы\n' +
                    '✅ Подписался на наши основные каналы\n' +
                    '✅ Выполнил 2 задания\n\n' +
                    '💰 Вы получили 2 ⭐️\n' +
                    '🏆 Вы получили 1 очко'
                );
            } catch (e) {
                console.log(`Не удалось отправить уведомление рефереру ${referrerId}`);
            }

        } catch (error) {
            await client.query('ROLLBACK');
            console.error(`❌ Ошибка атомарного начисления реферальной награды:`, error);
            throw error;
        } finally {
            client.release();
        }

        // Уведомляем реферер��
        try {
            await bot.sendMessage(user.referrer_id,
                '🎉 Ваш реферал выполнил все условия!\n' +
                '✅ Подписался на все спонсорские каналы\n' +
                '✅ Подписался на наши основные каналы\n' +
                '✅ Выполнил 2 задания\n\n' +
                '💰 Вы получили 2 ⭐️\n' +
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
        console.log('🔧 Переменные окружении:');
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
        console.error('Ошибка за��уска бота:', error);
        process.exit(1);
    }
}

// Создание клавиатур
function createMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 Профиль', callback_data: 'profile' }],
            [{ text: '⭐️ Заработать звезды', callback_data: 'invite' }],
            [{ text: '🖱 Кликер', callback_data: 'clicker' }, { text: '🎲 Лотерея', callback_data: 'lottery' }],
            [{ text: '📋 Задания', callback_data: 'tasks' }, { text: '🎰 Рулетка', callback_data: 'roulette' }],
            [{ text: '🏆 Рейтинги', callback_data: 'ratings' }, { text: '🎁 Кейсы', callback_data: 'cases' }],
            [{ text: '💰 Вывод звёзд', callback_data: 'withdraw' }]
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

// Проверка подписки пользователя на СПОНСОРСКИЕ каналы (для блокировка доступа к функциям бота)
async function checkUserSubscription(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
    try {
        // Сна��ала проверяем кеш вебхуков (свежие данные - не старше 5 минут)
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);

        if (cachedStatus.lastUpdate && (Date.now() - cachedStatus.lastUpdate) < 5 * 60 * 1000) {
            console.log(` Используем кешированные данные подписки для пользователя ${userId}`);
            console.log(` Кеш:`, cachedStatus);

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

        // Если нет кешированных да��ных, делаем запрос к SubGram для СПОНСОРСКИХ каналов
        console.log(`🌐 Запрос к SubGram API для проверки СПОНСОРСКИХ каналов пользователя ${userId}`);
        const taskChannels = await SubGram.checkSubscription(
            userId,
            chatId,
            firstName,
            languageCode,
            isPremium
        );

        console.log(` SubGram ответ:`, JSON.stringify(taskChannels, null, 2));

        // Провер��ем ответ SubGram
        if (taskChannels.status === 'error') {
            console.log(`❌ Ошибка SubGram, пытаемся получить ссылки альтернативным способом`);

            // Пытаемся получить ссылки через getChannelLinks
            console.log(`🔄 Запрашиваем ссылки каналов через getChannelLinks для пользователя ${userId}`);
            try {
                const channelLinks = await SubGram.getChannelLinks(
                    userId,
                    chatId,
                    firstName,
                    languageCode,
                    isPremium
                );

                if (channelLinks.status === 'ok' && channelLinks.links && channelLinks.links.length > 0) {
                    console.log(`✅ Получены ссылки через альтернативный метод: ${channelLinks.links.length} каналов`);
                    return {
                        isSubscribed: false,
                        subscriptionData: channelLinks
                    };
                }
            } catch (fallbackError) {
                console.error(`❌ Альтернативный метод также не сработал:`, fallbackError.message);
            }

            // �� случае ошибки API используем кеш если есть
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
                    message: 'Ошибка проверки подписки - доступ заблокирован'
                }
            };
        }

        // ВАЖНО: статус "warning" означает что пользователь НЕ подписан!
        if (taskChannels.status === 'warning') {
            console.log(`⚠️ Пользователь ${userId} НЕ подписан (статус warning): ${taskChannels.message}`);

            // Для статуса warning SubGram может не возв��ащать ссылки, попробуем разные способы получения
            if (!taskChannels.links || taskChannels.links.length === 0) {
                console.log(` Запрашиваем ссылки каналов для пользователя ${userId} (warning без ссылок)`);

                // Попробуем получить ссылки через getChannelLinks
                const attempts = [
                    // 1. Попытк�� с getChannelLinks
                    () => SubGram.getChannelLinks(userId, chatId, firstName, languageCode, isPremium)
                ];

                for (let i = 0; i < attempts.length; i++) {
                    try {
                        console.log(`🔄 Попытка ${i + 1}/${attempts.length} получения ссылок`);
                        const linksCheck = await attempts[i]();

                        if (linksCheck.links && linksCheck.links.length > 0) {
                            taskChannels.links = linksCheck.links;
                            taskChannels.additional = linksCheck.additional;
                            console.log(`✅ Получены ссылки (попытка ${i + 1}): ${linksCheck.links.length} каналов`);
                            break;
                        } else if (linksCheck.status === 'ok') {
                            console.log(`⚠ Попытка ${i + 1}: status='ok' но нет ссылок (пользователь уже подписан?)`);
                        } else {
                            console.log(`⚠ Попытка ${i + 1} не дала ссылок: status=${linksCheck.status}`);
                        }
                    } catch (e) {
                        console.error(`❌ Ошибка попытки ${i + 1}:`, e.message);
                    }
                }

                if (!taskChannels.links || taskChannels.links.length === 0) {
                    console.log(`⚠️ Все попытки получения ссылок не удались для пользователя ${userId}`);

                    // Если не смогли получить ссылки, проверяем кеш
                    if (cachedStatus.lastUpdate && cachedStatus.unsubscribedLinks.length > 0) {
                        console.log(`💾 Используем кешированные неподписанные ссылки: ${cachedStatus.unsubscribedLinks.length}`);
                        taskChannels.links = cachedStatus.unsubscribedLinks;
                    }
                }
            }

            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Если есть ссылки для подписки - значит пользователь не подписан
        if (taskChannels.links && taskChannels.links.length > 0) {
            console.log(` Пользователь ${userId} НЕ подписан, есть ${taskChannels.links.length} каналов`);
            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Стат��с "ok" �� нет ссылок - пользователь подписан
        if (taskChannels.status === 'ok') {
            // Дополнительн�� проверим, действительно ли нет ссылок
            if (!taskChannels.links || taskChannels.links.length === 0) {
                console.log(`✅ Пользователь ${userId} подписан на все каналы (статус ok, нет ссылок)`);
                return {
                    isSubscribed: true,
                    subscriptionData: taskChannels
                };
            } else {
                console.log(`⚠️ Пользователь ${userId} НЕ подписан (статус ok, но есть ${taskChannels.links.length} ссылок)`);
                return {
                    isSubscribed: false,
                    subscriptionData: taskChannels
                };
            }
        }

        // Для всех остальных случаев ��спользуем СТРОГИЙ подход - НЕ подписан!
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
            console.log(`🗄 Используем кеш как fallback после ошибки API`);
            return {
                isSubscribed: cachedStatus.isSubscribed === true, // СТРОГО: только если точно подписан
                subscriptionData: {
                    status: 'fallback_cache',
                    links: cachedStatus.unsubscribedLinks || []
                }
            };
        }

        // СТРОГИЙ FALLBACK: если нет данных - НЕ ��одписан (безопасность превыше вс��го)
        console.log(`🔒 СТРОГОЙ FALLBACK: нет данных о подписке, считаем НЕ подписанным (безопасность)`);
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
        // ЗАЩИТА ОТ СПАМА: проверя��м не вызывали ли мы недавно проверку подписки
        const now = Date.now();
        const lastCheck = lastSubscriptionCheck.get(userId);
        if (lastCheck && (now - lastCheck) < 3000) { // 3 секунды защита
            console.log(`⚠️ Защита от спама: пропускаем повторный /start для пользователя ${userId}`);
            return;
        }
        lastSubscriptionCheck.set(userId, now);

        let user = await Database.getUser(userId);
        
        if (!user) {
            // Создаем нового пользова��еля
            const referrerId = referralCode ? parseInt(referralCode) : null;
            user = await Database.createUser({
                userId: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                languageCode: msg.from.language_code || 'ru',
                isPremium: msg.from.is_premium || false,
                referrerId: referrerId
            });
            
            // Реферальная награда будет начислена позже после выполнения ��словий
            if (referrerId) {
                console.log(`👥 Новый пользователь ${userId} пришел по реферальной ссылке от ${referrerId}`);
                // Награда будет начислена в функции checkReferralConditions()
            }
        }
        
        // СНАЧАЛА проверяем подпис��у - это самое важное!
        console.log(`🔍 Проверка подписки для пользователя ${userId}`);
        const subscriptionStatus = await checkUserSubscription(
            userId, 
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );
        
        console.log(` Статус подписки:`, subscriptionStatus);

        // Если пользователь НЕ подписан - показываем спонсорские каналы (да��е если ссылки пустые)
        if (!subscriptionStatus.isSubscribed) {
            console.log(` Пользователь ${userId} НЕ подписан, блокируем доступ`);

            // Если есть ссылки - показываем их ЧЕРЕЗ ЦЕНТРАЛИЗОВАННУЮ Ф��НКЦИЮ
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(`📢 Показываем ${subscriptionStatus.subscriptionData.links.length} спонсорских каналов`);
                const messageSent = await sendSponsorMessage(chatId, userId, subscriptionStatus.subscriptionData);
                if (!messageSent) {
                    console.log(`⚠ Не удалось отправить спонсорское сообщение пользователю ${userId}`);
                }
            } else {
                // Если нет ссылок - ��оказываем общее сообщение
                console.log(`⚠️ Нет ссылок каналов, показываем общее сообщение`);
                await bot.sendMessage(chatId,
                    '🔒 Для доступа к боту необходимо подписаться на спонсорские каналы.\n\n' +
                    '⏳ Временно нет доступных каналов для подписки. Попробуйте позже или обратитесь к администратору.\n\n' +
                    '👇 Нажмите кнопку ниже для повторной проверки.',
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

        // Только есл�� п��льзователь точно подписан - показыва��м главное меню
        console.log(`✅ Пользователь ${userId} подписан, показываем главное меню`);
        await showMainMenu(chatId, userId);
        
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Показать главное меню
async function showMainMenu(chatId, userId = null) {
    const message = '1️⃣ Получи свою личную ссылку жми «⭐️ Заработать звезды»\n\n' +
                   '2️⃣ Приглашай друзей — 2⭐️ за каждого!\n\n' +
                   '✅ Дополнительно:\n' +
                   '> — Ежедневные награды и промокоды (Профиль)\n' +
                   '> — Выполняй задания\n' +
                   '> — Участвуй в лотереях и выигрывай!\n' +
                   '> — Участвуй в конкурсе на топ\n\n' +
                   '🔻 Главное меню';

    const keyboard = createMainMenuKeyboard();

    try {
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    } catch (error) {
        console.error('Ошибка отправки г��авного меню:', error);
    }
}

// Обработчик callback запросов
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    console.log(`🔔 ПОЛУЧЕН CALLBACK: "${data}" от п��льзователя ${userId}`);

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

        // КР��ТИЧНО: ЖЁСТКАЯ проверка подписки для ВСЕХ действий в самом начале (кроме специальных команд)
        const allowedWithoutSubscription = [
            'check_subscription',
            'check_subscription_personal',
            'admin_',
            'approve_',
            'reject_',
            'disabled',  // для забло��ированных кно��ок
            'tasks',     // ВАЖНО: разрешаем доступ к за��ания�� для их выполнения
            'check_custom_task_', // проверка кастомного задания
            'broadcast_', // рассылки (админские)
            'admin_back'  // возврат в админ панель
        ];

        // Проверяем раз��ешённые команды (с учётом точного ��оответствия для некоторых)
        const isAllowedCommand = allowedWithoutSubscription.some(cmd => {
            if (cmd.endsWith('_')) {
                return data.startsWith(cmd); // для команд с префиксом (admin_, check_custom_task_, и т.д.)
            } else {
                return data === cmd; // для точных команд (tasks, admin_back)
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
                console.log(`🔒 ЖЁСТКАЯ БЛОКИРОВКА действий "${data}" для непод��исанного пользователя ${userId}`);

                // Показываем алерт с жёсткой блокировкой
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '🔒 Доступ заблокирован! Сначала подпишитесь на все спонсорские каналы!',
                    show_alert: true
                });

                // Если есть ссылки на каналы - показываем их через централизованную функцию
                if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                    await sendSponsorMessage(
                        chatId,
                        userId,
                        subscriptionStatus.subscriptionData,
                        callbackQuery.message.message_id,
                        'edit'
                    );
                } else {
                    // Если нет ссылок, показываем обще�� сообщение о блокировке
                    const blockMessage = '🔒 Доступ к боту заблокирован!\n\n' +
                                       '📢 Необходимо подписаться на спонсорские каналы.\n' +
                                       '⏳ Временно нет доступных каналов. Попробуйте позже или обратитесь к администратору.';

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
                        console.log(`⚠ Не удалось отредактировать сообщение блокировки: ${e.message}`);
                        // НЕ отпра��ляем новое ��ообщение для избежания дублирования
                    }
                }

                return; // КРИТИЧНО: немедленно завершаем обработку
            }
        }

        // Отвечаем на callback_query толь��о для коман��, которые не отвечают сами
        const commandsThatAnswerThemselves = [
            'check_subscription',
            'check_subscription_personal',
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

            case 'check_subscription_personal':
                await handleSubscriptionCheckPersonal(chatId, userId, message.message_id, callbackQuery.id);
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

            case 'roulette':
                await showRoulette(chatId, userId, message.message_id);
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
                    console.log(`🔧 АДМИНСКАЯ КОМАНДА: data="${data}", userId=${userId}, adminIDs=${JSON.stringify(config.ADMIN_IDS)}`);
                    await handleAdminCallback(chatId, userId, data, message.message_id, callbackQuery.id);
                } else if (data.startsWith('approve_') || data.startsWith('reject_')) {
                    await handleWithdrawalAction(chatId, userId, data, callbackQuery.id, message.message_id);
                } else if (data.startsWith('broadcast_')) {
                    const type = data.split('_')[1];
                    console.log(`📢 ЗАПУСК РАССЫЛКИ: type="${type}", data="${data}"`);
                    try {
                        await handleBroadcastNew(type);
                        await bot.answerCallbackQuery(callbackQuery.id, '📢 Рассылка запущена!');
                        console.log(`✅ РАССЫЛКА ЗАПУЩЕНА: type="${type}"`);
                    } catch (error) {
                        console.error(`❌ ОШИБКА РАССЫЛКИ: type="${type}"`, error);
                        await bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка рассылки');
                    }
                } else if (data === 'admin_back') {
                    console.log(`🔙 ВОЗВРАТ К АДМИН ПАНЕЛИ от пользователя ${userId}, adminIDs=${JSON.stringify(config.ADMIN_IDS)}`);

                    // Проверяем админские права для admin_back
                    if (!config.ADMIN_IDS.includes(userId)) {
                        console.log(`❌ ОТКАЗ В ��РАВАХ ДЛЯ admin_back: пользователь ${userId} не является админом`);
                        await bot.answerCallbackQuery(callbackQuery.id, '❌ Нет прав администратора');
                        return;
                    }

                    try {
                        await showAdminPanel(chatId, message.message_id);
                        await bot.answerCallbackQuery(callbackQuery.id);
                        console.log(`✅ АДМИН ПАНЕЛЬ ПОКАЗАНА пользователю ${userId}`);
                    } catch (error) {
                        console.error(`❌ ОШИБКА ПОКАЗА АДМИН ПАНЕЛИ пользователю ${userId}:`, error);
                        await bot.answerCallbackQuery(callbackQuery.id, '❌ Ошибка');
                    }
                } else if (data === 'open_case') {
                    await handleOpenCase(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data.startsWith('check_custom_task_')) {
                    const taskId = parseInt(data.split('_')[3]);
                    await handleCustomTaskCheck(chatId, userId, taskId, message.message_id, callbackQuery.id);
                } else if (data.startsWith('roulette_bet_')) {
                    const amount = parseFloat(data.split('_')[2]);
                    await handleRouletteBet(chatId, userId, amount, message.message_id, callbackQuery.id);
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

// Проверка подписки в контексте личных каналов (с пропуском ошибок)
async function handleSubscriptionCheckPersonal(chatId, userId, messageId, callbackQueryId = null) {
    console.log(`🔄 Проверка подписки (личные каналы) по запросу пользователя ${userId}`);

    // ЗАЩИТА ОТ СПАМА: проверяем не вызывали ли мы недавно проверку подписки
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

    console.log('📊 Результат проверки подписки (личные каналы):', subscriptionStatus);

    // Если нет ссылок для подписки - значит пользователь подписан на SubGram каналы
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        // Проверяем личные сп��нсорские каналы (ВСЕГДА с пропуском ошибок в этом контексте)
        console.log(`🔍 Проверка личных спонсорских каналов для пользователя ${userId} (с пропуском ошибок)`);
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId, true);

        if (!personalChannelsStatus.isSubscribed && personalChannelsStatus.unsubscribedChannels.length > 0) {
            // Пользователь не подписан на личные ��аналы
            console.log(`🔒 Пользователь ${userId} не подписан на личные каналы`);

            // Формируем сообще��ие с личными каналами
            let personalMessage = '🔐 Для полного доступа к боту подпишитесь на наши основные каналы:\n\n';

            personalChannelsStatus.unsubscribedChannels.forEach((channel, index) => {
                personalMessage += `${index + 1}. ${channel.title}\n`;
            });

            personalMessage += '\n⚠️ После подписки нажмите "Проверить подписки"';

            // Создаем клавиатуру с каналами
            const personalKeyboard = {
                inline_keyboard: []
            };

            // Добавляем кнопки каналов
            personalChannelsStatus.unsubscribedChannels.forEach(channel => {
                personalKeyboard.inline_keyboard.push([{
                    text: `📢 ${channel.title}`,
                    url: channel.url
                }]);
            });

            // Добавляем ��нопку проверки (для личных каналов - пропускать ошибки)
            personalKeyboard.inline_keyboard.push([{
                text: '✅ Проверить подписки',
                callback_data: 'check_subscription_personal'
            }]);

            await bot.editMessageText(personalMessage, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: personalKeyboard
            });

            if (callbackQueryId) {
                await bot.answerCallbackQuery(callbackQueryId, ' Подпишитесь на наши основные каналы!');
            }

            return; // Блокируем доступ
        }

        // Если подписан на все каналы (и SubGram и личные)
        const successMessage = '✅ Отлично! вы подписались на все каналы!\n\n' +
                              '🎉 Добро пожаловать в бота для заработка звёзд!\n\n' +
                              '🌟 Теперь вам доступны все функции бота:\n' +
                              '• ⭐️ Зарабатывать звезды\n' +
                              '• 🎰 Играть в рулетку\n' +
                              '• 🖱 Использовать кликер\n' +
                              '• 🎁 Открывать кейсы\n' +
                              '• 💰 Выводить звёзды\n\n' +
                              'Выберите действие:';

        const keyboard = createMainMenuKeyboard();

        await bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Поздравляем! Вы подписались на все каналы!');
        }

        // Проверяем условия для засчитывания реферала
        await checkReferralConditions(userId);
    } else {
        // Все еще есть ��ана��ы для подписки - используем ЦЕНТРАЛИЗОВАННУЮ ФУНКЦИЮ
        const messageSent = await sendSponsorMessage(
            chatId,
            userId,
            subscriptionStatus.subscriptionData,
            messageId,
            'edit'
        );

        if (callbackQueryId) {
            const alertText = messageSent ? '❌ Вы ещё не подписались на все каналы!' : '⏳ Пожалуйста, подождите...';
            await bot.answerCallbackQuery(callbackQueryId, alertText);
        }
    }
}

// Проверка подписки
async function handleSubscriptionCheck(chatId, userId, messageId, callbackQueryId = null) {
    console.log(`🔄 Проверка подписки по запросу пользователя ${userId}`);

    // ЗАЩИТА ОТ СПАМА: проверяем не вызывали ли мы недавно проверку подписки
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

    // Если нет ссылок для подписки - значит пользователь подписан на SubGram ка��алы
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        // Проверяем личные спонсорские каналы (с пропуск��м ошибок при нажатии кнопки)
        console.log(` Проверка личных спонсорских каналов для пользователя ${userId}`);
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId, false);

        if (!personalChannelsStatus.isSubscribed && personalChannelsStatus.unsubscribedChannels.length > 0) {
            // Пользователь не подписан на личные каналы
            console.log(`🔒 Пользователь ${userId} не подписан на личные каналы`);

            // Формируем сообщение с личными каналами
            let personalMessage = '🔐 Для полного доступа к боту подпишитесь на наши основные каналы:\n\n';

            personalChannelsStatus.unsubscribedChannels.forEach((channel, index) => {
                personalMessage += `${index + 1}. ${channel.title}\n`;
            });

            personalMessage += '\n⚠️ После подписки нажмите "Проверить подписки"';

            // Создаем клавиатуру с каналами
            const personalKeyboard = {
                inline_keyboard: []
            };

            // Добавляем кнопки каналов
            personalChannelsStatus.unsubscribedChannels.forEach(channel => {
                personalKeyboard.inline_keyboard.push([{
                    text: `📢 ${channel.title}`,
                    url: channel.url
                }]);
            });

            // Добавляем кнопку проверки (для личных каналов - пропускать оши��ки)
            personalKeyboard.inline_keyboard.push([{
                text: '✅ Проверить подписки',
                callback_data: 'check_subscription_personal'
            }]);

            await bot.editMessageText(personalMessage, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: personalKeyboard
            });

            if (callbackQueryId) {
                await bot.answerCallbackQuery(callbackQueryId, '⚠️ Подпишитесь на наши основные каналы!');
            }

            return; // Блокируем доступ
        }

        // Если подписан на все каналы (и SubGram и личные)
        const successMessage = '✅ Отлично! вы подписались на все каналы!\n\n' +
                              '🎉 Добро пожаловать в бота для заработка звёзд!\n\n' +
                              '🌟 Теперь вам доступны все функции бота:\n' +
                              '• ⭐️ Зарабатывать звезды\n' +
                              '• 🎰 Играть в рулетку\n' +
                              '• 🖱 Использовать кликер\n' +
                              '• 🎁 Открывать кейсы\n' +
                              '• 💰 Выводить звёзды\n\n' +
                              'Выберите действие:';

        const keyboard = createMainMenuKeyboard();

        await bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

        if (callbackQueryId) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Поздравляем! Вы подписались на все каналы!');
        }

        // Проверяем условия для засчитывания реферала
        await checkReferralConditions(userId);
    } else {
        // Все еще есть каналы для подписки - ис��ользуем ЦЕНТРАЛ��ЗОВАННУЮ ФУНКЦИЮ
        const messageSent = await sendSponsorMessage(
            chatId,
            userId,
            subscriptionStatus.subscriptionData,
            messageId,
            'edit'
        );

        if (callbackQueryId) {
            const alertText = messageSent ? '❌ Вы ещё не подписались на все каналы!' : '⏳ Пожалуйста, подождите...';
            await bot.answerCallbackQuery(callbackQueryId, alertText);
        }
    }
}

// Реда��тир��вание сообщения с главным меню
async function editMainMenu(chatId, messageId) {
    const message = '1️⃣ Получи свою личную ссылку жми «⭐ Заработать звезды»\n\n' +
                   '2️⃣ Приглашай друзей — 2⭐️ за каждого!\n\n' +
                   '✅ Дополнительно:\n' +
                   '> — Ежедневные награды и промокоды (Профиль)\n' +
                   '> — Выполняй задания\n' +
                   '> — Участвуй в лотереях и выигрывай!\n' +
                   '> — Участвуй в конкурсе на топ\n\n' +
                   '🔻 Главное меню';

    const keyboard = createMainMenuKeyboard();

    try {
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка редактирования главного меню:', error);
        // Fallback: отправляем новое сообщение если редактирование не удалось
        try {
            await bot.sendMessage(chatId, message, { reply_markup: keyboard });
        } catch (fallbackError) {
            console.error('Ошибка fallback отправки главного меню:', fallbackError);
        }
    }
}

// Пок��зать профиль
async function showProfile(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const completedTasks = await Database.getUserCompletedTasks(userId);
    const referralStats = await Database.getReferralStats(userId);

    const message = `👑 Твой профиль звёздного магната!\n\n` +
                   `🆔 ID: ${user.user_id}\n` +
                   `👤 Имя: ${user.first_name}\n` +
                   `🌟 Баланс: ${user.balance} ⭐\n` +
                   `💰 Заработано за рефералов: ${user.referral_earned} ⭐\n` +
                   `💎 Всего заработано: ${user.total_earned} ⭐\n` +
                   `✅ Выполнено заданий: ${completedTasks}\n` +
                   `🏆 Очки: ${user.points}\n\n` +
                   `👥 Ваши рефералы:\n` +
                   `• ✅ Активированные: ${referralStats.activated_referrals}\n` +
                   `• ⏳ Неактивированные: ${referralStats.non_activated_referrals}\n` +
                   `• ���� За сегодня: ${user.daily_referrals}\n\n` +
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

// Показать ��одробную информацию о рефе��алах
async function showReferralDetails(chatId, userId, messageId) {
    try {
        const activatedReferrals = await Database.getActivatedReferrals(userId);
        const nonActivatedReferrals = await Database.getNonActivatedReferrals(userId);

        let message = `👥 Детальная информация о рефералах\n\n`;

        // Активированные рефералы
        message += `✅ ��ктивированные рефералы (${activatedReferrals.length}):\n`;
        if (activatedReferrals.length === 0) {
            message += `• Пока нет активированных рефералов\n`;
        } else {
            activatedReferrals.slice(0, 10).forEach((referral, index) => { // показываем тольк�� первые 10
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

        // Неактив��рованны�� рефералы
        message += `⏳ Неактивированные рефералы (${nonActivatedReferrals.length}):\n`;
        if (nonActivatedReferrals.length === 0) {
            message += `• Все рефералы активированы! \n`;
        } else {
            nonActivatedReferrals.slice(0, 10).forEach((referral, index) => { // показываем только перв��е 10
                const name = referral.first_name || 'Пользователь';
                const username = referral.username ? `@${referral.username}` : '';
                const date = new Date(referral.created_at).toLocaleDateString('ru-RU');
                message += `• ${name} ${username} (${date})\n`;
            });
            if (nonActivatedReferrals.length > 10) {
                message += `...  ещё ${nonActivatedReferrals.length - 10}\n`;
            }
        }

        message += `\n📝 Для активации реферал должен:\n`;
        message += `1. Подписаться на все спонсорские каналы\n`;
        message += `2. Выполнить 2 задания\n\n`;
        message += `💰 За каждого активированного реферала вы получаете 2 ⭐`;

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

// Показать и��формацию о ��риглашениях
async function showInviteInfo(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const botUsername = (await bot.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;
    
    const message = `⭐️ Зарабатывай с друзьями!\n\n` +
                   `🚀 Приглашай друзей и получай крутые награды!\n\n` +
                   `💸 За каждого активного друга: 2⭐️!\n\n` +
                   `🎆 Как получить награду:\n` +
                   `• 📱 Друг подписывается на спонсоров\n` +
                   `• ✅ Выполняет 2 простых задания\n\n` +
                   `🔗 Твоя магическая ссылка:\n➡️ ${referralLink}\n\n` +
                   `📈 Твои достижения:\n` +
                   `👥 Об��ие рефералы: ${user.total_referrals}\n` +
                   `🔥 Приведено сегодня: ${user.daily_referrals}\n` +
                   `💰 Заработано с друзей: ${user.referral_earned}⭐️`;
    
    const keyboard = {
        inline_keyboard: [
            [{
                text: '📤 Поделиться',
                switch_inline_query: `🌟 Присоединяйся к боту для заработка звёзд! Используй мою реферальную ссылку: ${referralLink}`
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
                   ` Кликов сегодня: ${clicksToday}/10\n` +
                   ` Остались кликов: ${remainingClicks}\n\n` +
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

// Пол��чить расширенную информацию о пользователе для заявки на вывод (с реаль��ыми ��анными о подписках)
async function getUserWithdrawalInfo(userId) {
    try {
        // Основные данные пользователя
        const user = await Database.getUser(userId);
        if (!user) return { sponsor_subscriptions: 0, referrals_subscriptions: 0, referral_stats: { activated_referrals: 0, non_activated_referrals: 0 } };

        // Статистика рефералов
        const referralStats = await Database.getReferralStats(userId);

        // Реальные данные о подписк��х пользователя из webhook кеша
        const userSubscriptionStatus = webhookHandler.getUserSubscriptionStatus(userId);
        let userSubscriptions = 0;

        if (userSubscriptionStatus.lastUpdate && userSubscriptionStatus.isSubscribed !== null) {
            // Если есть свежие данные о подписках
            const subscribedCount = userSubscriptionStatus.subscribedCount || 0;
            const totalChannels = userSubscriptionStatus.totalLinks || 0;
            userSubscriptions = subscribedCount; // реальное количество подписок
            console.log(`📈 Пользователь ${userId}: реальные подписки ${subscribedCount}/${totalChannels}`);
        } else {
            // Оц��нка на основе статуса ��ктиваци��
            userSubscriptions = user.referral_completed ? 4 : 0; // если активирован, то подписан на спонсоров
            console.log(`📈 Пользователь ${userId}: оценка подписок ${userSubscriptions} (нет свежих данных)`);
        }

        // Под��читываем подпис��и активированных рефералов
        let referralsSubscriptions = 0;
        const activatedReferrals = await Database.getActivatedReferrals(userId);

        // Проверяем реальные дан��ые о подписках каждого активного реферала
        for (const referral of activatedReferrals) {
            const referralSubscriptionStatus = webhookHandler.getUserSubscriptionStatus(referral.user_id);
            if (referralSubscriptionStatus.lastUpdate && referralSubscriptionStatus.subscribedCount) {
                referralsSubscriptions += referralSubscriptionStatus.subscribedCount;
            } else {
                // Оценка: активные рефералы подписаны на ~4 канала
                referralsSubscriptions += 4;
            }
        }

        console.log(`📈 Пользователь ${userId}: подписки рефера��ов ${referralsSubscriptions} (за ${activatedReferrals.length} активных рефералов)`);

        return {
            ...user,
            referral_stats: referralStats,
            sponsor_subscriptions: userSubscriptions,
            referrals_subscriptions: referralsSubscriptions
        };
    } catch (error) {
        console.error('Ошибка получения информации о пользователе для вывода:', error);
        return {
            sponsor_subscriptions: 0,
            referrals_subscriptions: 0,
            referral_stats: { activated_referrals: 0, non_activated_referrals: 0 }
        };
    }
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

// Обработка зая������и на вывод
async function handleWithdraw(chatId, userId, amount, messageId, callbackQueryId) {
    const user = await Database.getUser(userId);

    if (user.balance < amount) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Недостаточно средств!');
        return;
    }

    // НОВОЕ ОГРАНИЧЕНИЕ: минимум 5 активированных реф��ралов для вы��ода
    const referralStats = await Database.getReferralStats(userId);
    if (referralStats.activated_referrals < 5) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Для вывода нужно минимум 5 активированных рефералов!');

        const message = `💰 Вывод заблокирован\n\n` +
                       `❌ Для вывода звёзд необходимо:\n` +
                       `👥 Минимум 5 активированных рефералов\n\n` +
                       `📊 У вас сейчас:\n` +
                       `✅ Активированных: ${referralStats.activated_referrals}\n` +
                       `⏳ Неактивированных: ${referralStats.non_activated_referrals}\n\n` +
                       `ℹ️ Активированный реферал = подписался на каналы + выполнил 2 задания`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: createBackToMenuKeyboard()
        });
        return;
    }
    
    try {
        // Списываем средства
        await Database.updateUserBalance(userId, amount, 'subtract');
        
        // Создаем заявку
        const request = await Database.createWithdrawalRequest(userId, amount);
        
        // Получаем ра��ширенную информацию с реальными данными о подписках
        const userInfo = await getUserWithdrawalInfo(userId);

        // Отправляем в админ чат расширенную информацию
        const adminMessage = `💰 Новая заявка на вывод\n\n` +
                            `👤 Пользователь: ${user.first_name}\n` +
                            `🆔 ID: ${user.user_id}\n` +
                            `📱 Username: @${user.username || 'отсутствует'}\n` +
                            `💰 Сумма: ${amount} звёзд\n` +
                            `💎 Остаток: ${user.balance - amount} звёзд\n` +
                            `💎 В��его заработано: ${user.total_earned} звёзд\n\n` +
                            `📊 Подписки на спонсорские каналы (реальные данные):\n` +
                            `👤 Пользователь: ${userInfo.sponsor_subscriptions} подписок\n` +
                            `👥 Его рефералы: ${userInfo.referrals_subscriptions} подписок\n\n` +
                            `👥 Рефералы:\n` +
                            `✅ Активированные: ${userInfo.referral_stats?.activated_referrals || 0}\n` +
                            `⏳ Неактивированные: ${userInfo.referral_stats?.non_activated_referrals || 0}\n` +
                            `📈 За сегодня: ${user.daily_referrals}\n\n` +
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

// Показать задания (только кастомные, без SubGram)
async function showTasks(chatId, userId, messageId) {
    try {
        console.log(`📋 ФУНКЦИЯ showTasks ВЫЗВАНА для пользователя ${userId}`);

        // Получаем только кастомные задания (не SubGram)
        const customTasks = await Database.getTasks(false); // false = ��е SubGram задания
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
            // ��оказываем кастомное задание
            const message = `📋 Доступное задание\n\n` +
                           ` ${availableCustomTask.title}\n` +
                           `📄 ${availableCustomTask.description || 'Выполните задания'}\n` +
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
                   `🌟 Как зарабатывать ⭐:\n\n` +
                   `👥 Рефералы:\n` +
                   `• Приглашайте друзей по своей ссылке\n` +
                   `• За каждого реферала: 2 звезды\n` +
                   `• Реферал засчитывается после подписки на спонсоров и выполнения 2 заданий\n\n` +
                   `🖱 Кликер:\n` +
                   `• Кликайте до 10 раз в день\n` +
                   `• За клик: 0.1 звезды\n` +
                   `• Время ожидания увеличив��ется\n\n` +
                   `📋 Задания:\n` +
                   `• Выполняйте кастомные задания\n` +
                   `• Награда указана в каждом задании\n\n` +
                   `🏆 Рейтинги:\n` +
                   `• Зарабатывайте очки\n` +
                   `• Топ 5 н��дели получают бонусы\n\n` +
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
            [{ text: '🌟 Общий рейтинг', callback_data: 'rating_overall' }],
            [{ text: '📅 Нед��льный рейтинг', callback_data: 'rating_weekly' }],
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
        title = '🏆 Общий рейтинг';
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
            message += `🥇 1 место: 100 ⭐\n`;
            message += `🥈 2 место: 75 ⭐\n`;
            message += `🥉 3 место: 50 ⭐\n`;
            message += `4 место: 25 ⭐\n`;
            message += `5 место: 15 ⭐`;
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
                   `👥 5 рефералов за день\n` +
                   `• 1 кейс в день\n\n` +
                   `📊 Ваша статистика:\n` +
                   `👥 Рефералов сегодня: ${user.daily_referrals}\n` +
                   `🎁 Кейс ${lastCaseDate === today ? 'уже открыт' : 'доступен'}\n\n` +
                   `💰 Возможный выигрыш: 1-10 ⭐`;
    
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
            message += `🏆 Победите��ей: ${lottery.winners_count}\n\n`;
        });
    }
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: createBackToMenuKeyboard()
    });
}

// Показать рулетку
async function showRoulette(chatId, userId, messageId) {
    const user = await Database.getUser(userId);

    const message = `🎰 Р��летка\n\n` +
                   `💰 Ваш баланс: ${user.balance} звёзд\n\n` +
                   `🎯 Правила:\n` +
                   `• Выберите сумму ставки\n` +
                   `• При выигрыше ставка удваивается\n` +
                   `• При проигрыше теряете ставку\n` +
                   `• Шанс выигрыша: 15% (честная игра)\n\n` +
                   `💫 Выберите ставку:`;

    const betAmounts = [0.5, 1, 2, 3, 5, 10, 25, 50, 100];
    const keyboard = {
        inline_keyboard: []
    };

    // Добавляем кнопки ставок (по 3 в ряд)
    for (let i = 0; i < betAmounts.length; i += 3) {
        const row = [];
        for (let j = 0; j < 3 && i + j < betAmounts.length; j++) {
            const amount = betAmounts[i + j];
            const canAfford = user.balance >= amount;
            row.push({
                text: canAfford ? `💰 ${amount} звёзд` : `❌ ${amount} звёзд`,
                callback_data: canAfford ? `roulette_bet_${amount}` : 'disabled'
            });
        }
        keyboard.inline_keyboard.push(row);
    }

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

// Обработка ставки в рулетке
async function handleRouletteBet(chatId, userId, amount, messageId, callbackQueryId) {
    try {
        const user = await Database.getUser(userId);

        if (user.balance < amount) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Недостаточно средств!');
            return;
        }

        // ИСПРАВЛЕНО: используем честную случайность вместо предсказуемого счетчика
        // Шанс выигрыша 15% (справедливая рулетка)
        const isWin = Math.random() < 0.15;

        if (isWin) {
            // Выигрыш - удваиваем ставку
            const winAmount = amount * 2;
            await Database.updateUserBalance(userId, winAmount - amount); // +amount (возврат ставки) + amount (вы��грыш)
            await Database.updateUserPoints(userId, 2);

            const message = `🎉 ВЫИГРЫШ!\n\n` +
                           `💰 Ставка: ${amount} звёзд\n` +
                           `🏆 Выигрыш: ${winAmount} звёзд\n` +
                           `💎 Ваш баланс: ${user.balance + winAmount - amount} звёзд\n` +
                           `🏆 +2 очки!\n\n` +
                           `🎊 Поздравляем с победой!`;

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎰 Играть снова', callback_data: 'roulette' }],
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });

            await bot.answerCallbackQuery(callbackQueryId, `🎉 Выигрыш ${winAmount} звёзд!`);
        } else {
            // Проигрыш - теряем ставку
            await Database.updateUserBalance(userId, -amount);

            const message = `😔 Проигрыш\n\n` +
                           `💸 Ставка: ${amount} звёзд\n` +
                           `💔 Потеряно: ${amount} звёзд\n` +
                           `💎 Ваш баланс: ${user.balance - amount} звёзд\n\n` +
                           `🍀 Не расстраивайтесь, попробуйте ещё раз!`;

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎰 Играть снова', callback_data: 'roulette' }],
                        [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });

            await bot.answerCallbackQuery(callbackQueryId, `😔 Проигрыш ${amount} звёзд`);
        }

    } catch (error) {
        console.error('Ошибка ставки в рулетке:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка игры');
    }
}

// обработка ввода промокода
async function handlePromocodeInput(chatId, userId) {
    userStates.set(userId, 'waiting_promocode');
    await bot.sendMessage(chatId, '🎁 Введите промокод:');
}

// Обработчик кастомного задания
async function handleCustomTaskCheck(chatId, userId, taskId, messageId, callbackQueryId) {
    try {
        console.log(`✅ Проверка выпо��нения кастомного задания ${taskId} для пользователя ${userId}`);

        // Проверяем есть ли задание
        const tasks = await Database.getTasks(false);
        const task = tasks.find(t => t.id === taskId);
        
        if (!task) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Задание не найдено');
            return;
        }

        // Проверяем не выполнено ли уже
        const isCompleted = await Database.isTaskCompleted(userId, taskId);
        if (isCompleted) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Задание уже выполнено!');
            await showTasks(chatId, userId, messageId);
            return;
        }

        // Отмечаем как выполненное
        await Database.completeTask(userId, taskId);
        
        // Начис��яем награду
        await Database.updateUserBalance(userId, task.reward);
        await Database.updateUserPoints(userId, 1);

        await bot.answerCallbackQuery(callbackQueryId, `🎉 +${task.reward} звёзд! +1 очко!`);

        // Проверяем условия для реферала
        await checkReferralConditions(userId);

        // Показываем следу��щее ����дание или сообщение о завершении
        await showTasks(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка проверки кастомного задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки задания');
    }
}

// Обработчик текстовых сообщение
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
                `✅ Промокод активирован!\n💰 Вы получили ${promocode.reward} ⭐`
            );
        } catch (error) {
            await bot.sendMessage(chatId, ` ${error.message}`);
        }
    }
});

// Команда /myid для получения своего Telegram ID
bot.onText(/\/myid/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    await bot.sendMessage(chatId,
        `🆔 Ваш Telegram ID: \`${userId}\`\n\n` +
        `📋 Админы: ${config.ADMIN_IDS.join(', ')}\n\n` +
        `${config.ADMIN_IDS.includes(userId) ? '✅ У вас есть права админа' : '❌ У вас нет прав админа'}`,
        { parse_mode: 'Markdown' }
    );
});

// Команда /admin
bot.onText(/\/admin/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    console.log(`🔑 ПОПЫТКА ДОСТУПА К АДМИН ПАНЕЛИ: userId=${userId}, adminIDs=${JSON.stringify(config.ADMIN_IDS)}`);

    // Проверка админских прав (добавьте свой ID в config.ADMIN_IDS)
    if (!config.ADMIN_IDS.includes(userId)) {
        console.log(`❌ ОТКАЗ В ДОСТУПЕ К АДМИН ПАНЕЛИ: пользователь ${userId} не в списке админов`);
        await bot.sendMessage(chatId, `❌ У вас нет прав администратора\n\n🆔 Ваш ID: ${userId}\n📋 Админы: ${config.ADMIN_IDS.join(', ')}`);
        return;
    }

    console.log(`✅ ДОСТУП К АДМИН ПАНЕЛИ РАЗРЕШЁН для пользователя ${userId}`);
    await showAdminPanel(chatId);
});

// Команда /broadcast для кастомной рассылки
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const broadcastText = match[1];

    // Проверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.sendMessage(chatId, '❌ У вас нет прав администратора');
        return;
    }

    try {
        const users = await Database.pool.query('SELECT user_id FROM users');
        let sentCount = 0;
        let errorCount = 0;

        const confirmMessage = await bot.sendMessage(chatId,
            `📢 Начинаю кастомную рассылку...\n\n` +
            `📝 Текст: "${broadcastText}"\n` +
            `👥 Пользователей: ${users.rows.length}\n\n` +
            `⏳ Обработка...`
        );

        console.log(`📢 Начинаем кастомную рассылку для ${users.rows.length} пользователей...`);
        console.log(`📝 Текст рассылки: "${broadcastText}"`);

        const keyboard = {
            inline_keyboard: [
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.user_id, broadcastText, { reply_markup: keyboard });
                sentCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                errorCount++;
                if (error.response?.description?.includes('blocked')) {
                    console.log(`Пользователь ${user.user_id} заблокировал бота`);
                } else {
                    console.log(`Не удалось отправить сообщение пользователю ${user.user_id}: ${error.message}`);
                }
            }
        }

        // Обновляем сообщение с результатами
        await bot.editMessageText(
            `✅ Кастомная рассылка завершена!\n\n` +
            `📝 Текст: "${broadcastText}"\n` +
            `✅ Отправлено: ${sentCount}\n` +
            `❌ Ошибок: ${errorCount}\n` +
            `📈 Успешность: ${Math.round((sentCount / (sentCount + errorCount)) * 100)}%`,
            {
                chat_id: chatId,
                message_id: confirmMessage.message_id
            }
        );

        console.log(`✅ Кастомная рассылка завершена: отправлено ${sentCount}, ошибок ${errorCount}`);

    } catch (error) {
        console.error('Ошибка кастомной рассылки:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при выполнении рассылки');
    }
});

// Показать админ-панель
async function showAdminPanel(chatId, messageId = null) {
    const message = '‍💼 Админ-панель\n\nВыберите действие:';

    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Статистика бота', callback_data: 'admin_stats' }],
            [{ text: '📋 Управление заданиями', callback_data: 'admin_tasks' }],
            [{ text: '🎲 Управление лотереями', callback_data: 'admin_lottery' }],
            [{ text: '🎫 Управление промокодами', callback_data: 'admin_promocodes' }],
            [{ text: '📢 Рассылка сообщений', callback_data: 'admin_broadcast' }],
            [{ text: '🏆 Недельные награды', callback_data: 'admin_rewards' }],
            [{ text: '💰 Заявки на вывод', callback_data: 'admin_withdrawals' }],
            [{ text: '🔢 Нумерация заявок', callback_data: 'admin_withdrawal_numbering' }]
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
    console.log(`🔧 АДМИН CALLBACK: data="${data}", userId=${userId}`);

    // Проверка админских пр��в
    if (!config.ADMIN_IDS.includes(userId)) {
        console.log(`❌ ОТКАЗ В ПРАВАХ: пользователь ${userId} не является админом`);
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
        case 'admin_withdrawal_numbering':
            await showWithdrawalNumbering(chatId, messageId);
            break;
        case 'admin_custom_broadcast':
            console.log(`💎 ПОКАЗ КАСТОМНОЙ РАССЫЛКИ пользователю ${userId}`);
            await showCustomBroadcast(chatId, messageId);
            break;
        case 'create_custom_broadcast':
            console.log(`📝 СОЗДАНИЕ КАСТОМНОЙ РАССЫЛКИ от пользователя ${userId}`);
            await createCustomBroadcast(chatId, userId, messageId);
            break;
        case 'set_closure_435':
            await handleSetClosureNumber(chatId, userId, 435, messageId, callbackQueryId);
            break;
        case 'set_closure_500':
            await handleSetClosureNumber(chatId, userId, 500, messageId, callbackQueryId);
            break;
        case 'set_closure_1000':
            await handleSetClosureNumber(chatId, userId, 1000, messageId, callbackQueryId);
            break;
        // Старые callback_data для совместимости (перенаправляем на новые функции)
        case 'set_withdrawal_435':
            await handleSetClosureNumber(chatId, userId, 435, messageId, callbackQueryId);
            break;
        case 'set_withdrawal_500':
            await handleSetClosureNumber(chatId, userId, 500, messageId, callbackQueryId);
            break;
        case 'set_withdrawal_1000':
            await handleSetClosureNumber(chatId, userId, 1000, messageId, callbackQueryId);
            break;
        case 'give_rewards_now':
            await handleGiveRewardsNow(chatId, userId, messageId, callbackQueryId);
            break;
        case 'reset_weekly_points':
            await handleResetWeeklyPoints(chatId, userId, messageId, callbackQueryId);
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
        const activatedReferrals = await Database.pool.query('SELECT COUNT(*) as count FROM users WHERE referral_completed = TRUE');
        const todayUsers = await Database.pool.query('SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = CURRENT_DATE');

        // Дополнительная статистика по подпискам
        const subscriptionStats = await Database.pool.query(`
            SELECT
                COUNT(CASE WHEN referral_completed = TRUE THEN 1 END) as activated_users,
                COUNT(CASE WHEN referral_completed = FALSE THEN 1 END) as non_activated_users
            FROM users WHERE referrer_id IS NOT NULL
        `);

        const message = `📊 Полная статистика бота\n\n` +
                       `👥 Всего пользователей: ${totalUsers.rows[0].count}\n` +
                       `🆕 Новых сегодня: ${todayUsers.rows[0].count}\n` +
                       `⭐ Всего заработано звёзд: ${Math.round(totalStarsEarned.rows[0].sum || 0)}\n` +
                       `💰 Всего выведено: ${Math.round(totalWithdrawals.rows[0].sum || 0)}\n` +
                       `⏳ Заявок в ожидании: ${pendingWithdrawals.rows[0].count}\n` +
                       `💎 Сумма в ожидании: ${Math.round(pendingWithdrawals.rows[0].sum || 0)}\n\n` +
                       `👥 Реферальная статистика:\n` +
                       `✅ Активированных рефералов: ${activatedReferrals.rows[0].count}\n` +
                       `⏳ Неактивированных: ${subscriptionStats.rows[0].non_activated_users}\n\n` +
                       `📈 Соотношение: ${activatedReferrals.rows[0].count > 0 ? Math.round((activatedReferrals.rows[0].count / (activatedReferrals.rows[0].count + parseInt(subscriptionStats.rows[0].non_activated_users))) * 100) : 0}% активации`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔄 Обновить', callback_data: 'admin_stats' }],
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

// Управление заданиями
async function showAdminTasks(chatId, messageId) {
    const message = `📋 Управление заданиями\n\n` +
                   `Здесь вы можете создавать собственные задания\n` +
                   `помимо заданий от SubGram`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '➕ Создать задание', callback_data: 'create_task' }],
            [{ text: '📋 Список заданий', callback_data: 'list_tasks' }],
            [{ text: '🔙 Назад в админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать админскую рассылку
async function showAdminBroadcast(chatId, messageId) {
    const message = `📢 Рассылка сообщений\n\n` +
                   `Выберите готовое сообщение для рассылки всем пользователям:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Напоминание о рейтинге', callback_data: 'broadcast_rating' }],
            [{ text: '📋 Уведомление о заданиях', callback_data: 'broadcast_tasks' }],
            [{ text: '💎 Кастомная рассылка', callback_data: 'admin_custom_broadcast' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Показать кастомную рассылку
async function showCustomBroadcast(chatId, messageId) {
    const message = `💎 Кастомная рассылка\n\n` +
                   `Выберите тип кастомной рассылки или создайте новую:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '📝 Создать новую рассылку', callback_data: 'create_custom_broadcast' }],
            [{ text: '🏆 О рейтинге (готовая)', callback_data: 'broadcast_rating' }],
            [{ text: '📋 О заданиях (готовая)', callback_data: 'broadcast_tasks' }],
            [{ text: '💰 О заработке звёзд', callback_data: 'broadcast_stars' }],
            [{ text: '👥 О реферальной программе', callback_data: 'broadcast_referral' }],
            [{ text: '🔙 Назад к рассылкам', callback_data: 'admin_broadcast' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Создание кастомной рассылки
async function createCustomBroadcast(chatId, userId, messageId) {
    const message = `📝 Создание кастомной рассылки\n\n` +
                   `Для создания кастомной рассылки отправьте сообщение в следующем формате:\n\n` +
                   `<code>/broadcast Ваш текст сообщения</code>\n\n` +
                   `Например:\n` +
                   `<code>/broadcast  Новые возможнос��и в боте! Заходи и зарабатывай больше звёзд!</code>\n\n` +
                   `💡 Поддерживаются эмодзи и простое форматирование`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🔙 Назад к кастомным рассылкам', callback_data: 'admin_custom_broadcast' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
        parse_mode: 'HTML'
    });
}

// Показать управление наградами
async function showAdminRewards(chatId, messageId) {
    try {
        const weeklyLeaderboard = await Database.getWeeklyLeaderboard(5);

        let leaderboardText = '';
        if (weeklyLeaderboard.length > 0) {
            leaderboardText = '\n\n🏆 Текущий топ 5 недели:\n';
            weeklyLeaderboard.forEach((user, index) => {
                const position = index + 1;
                const emoji = position <= 3 ? ['🥇', '🥈', '🥉'][position - 1] : `${position}.`;
                const name = user.first_name || 'Пользователь';
                const reward = config.WEEKLY_REWARDS[position];
                leaderboardText += `${emoji} ${name} - ${user.weekly_points} очков (${reward} ⭐)\n`;
            });
        }

        const message = `🏆 Еженедельные награды\n\n` +
                       `Награды за топ 5 недельного рейтинга:\n` +
                       `🥇 1 место: ${config.WEEKLY_REWARDS[1]} звёзд\n` +
                       `🥈 2 место: ${config.WEEKLY_REWARDS[2]} звёзд\n` +
                       `🥉 3 место: ${config.WEEKLY_REWARDS[3]} звёзд\n` +
                       `4 место: ${config.WEEKLY_REWARDS[4]} звёзд\n` +
                       `5 место: ${config.WEEKLY_REWARDS[5]} звёзд\n\n` +
                       `⚙️ Автоматическое начисление: ВОСКРЕСЕНЬЕ 20:00` +
                       leaderboardText;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🏆 Выдать награды сейчас', callback_data: 'give_rewards_now' }],
                [{ text: '❌ Сбросить недельный рейтинг', callback_data: 'reset_weekly_points' }],
                [{ text: '🔄 Обновить топ', callback_data: 'admin_rewards' }],
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

// Принудительная выдача недельных наград
async function handleGiveRewardsNow(chatId, userId, messageId, callbackQueryId) {
    try {
        console.log(`🏆 ПРИНУДИТЕЛЬНАЯ ВЫДАЧА НАГРАД от админа ${userId}`);

        const leaderboard = await Database.getWeeklyLeaderboard(5);

        if (leaderboard.length === 0) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Нет пользователей в рейтинге!');
            return;
        }

        let rewardedCount = 0;
        let totalRewards = 0;

        for (let i = 0; i < leaderboard.length; i++) {
            const user = leaderboard[i];
            const position = i + 1;
            const reward = config.WEEKLY_REWARDS[position];

            if (reward) {
                await Database.updateUserBalance(user.user_id, reward);
                totalRewards += reward;
                rewardedCount++;

                try {
                    await bot.sendMessage(user.user_id,
                        `🏆 Поздравляем!\n\n` +
                        `Вы заняли ${position} место в недельном рейтинге!\n` +
                        `💰 Награда: ${reward} звёзд\n` +
                        `📅 Награда выдана досрочно администратором`
                    );
                } catch (e) {
                    console.log(`Не удалось отправить награду пользователю ${user.user_id}`);
                }
            }
        }

        // Сбрасываем очки после выдачи наград
        await Database.resetWeeklyPoints();

        console.log(`✅ Принудительно выданы награды: ${rewardedCount} получателей, ${totalRewards} звёзд`);

        await bot.answerCallbackQuery(callbackQueryId,
            `🎉 Награды выданы! ${rewardedCount} получателей, ${totalRewards} ⭐`
        );

        // Обновляем админскую панель
        await showAdminRewards(chatId, messageId);

    } catch (error) {
        console.error('Ошибка принудительной выдачи наград:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка выдачи наград');
    }
}

// Пр��нудительный сброс недельного рейтинга
async function handleResetWeeklyPoints(chatId, userId, messageId, callbackQueryId) {
    try {
        console.log(`🔥 ПРИНУДИТЕЛЬНЫЙ СБРОС НЕДЕЛЬНОГО РЕЙТИНГА от админа ${userId}`);

        // Получаем количество пользователей с очками перед сбросом
        const beforeReset = await Database.pool.query('SELECT COUNT(*) as count FROM users WHERE weekly_points > 0');
        const usersWithPoints = parseInt(beforeReset.rows[0].count);

        // Сбрасываем недельные очки
        await Database.resetWeeklyPoints();

        console.log(`✅ Сброшены недельные очки у ${usersWithPoints} пользователей`);

        await bot.answerCallbackQuery(callbackQueryId,
            `🔥 Рейтинг сброшен! Очки убраны у ${usersWithPoints} пользователей`
        );

        // Обновляем админскую панель
        await showAdminRewards(chatId, messageId);

    } catch (error) {
        console.error('Ошибка сброса недельного рейтинга:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка сброса рейт��нга');
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

            for (const request of pending.slice(0, 5)) { // Показываем п��рвые 5
                // Получаем расширенную информацию о пользователе
                const userInfo = await getUserWithdrawalInfo(request.user_id);

                message += `📄 Заявка #${request.id}\n`;
                message += `👤 ${request.first_name} (@${request.username || 'нет'})\n`;
                message += `🆔 ID: ${request.user_id}\n`;
                message += `💰 Сумма: ${request.amount} звёзд\n`;
                message += `💎 Остаток: ${request.balance} звёзд\n`;
                message += `📊 Подписки: ${userInfo.sponsor_subscriptions} личных + ${userInfo.referrals_subscriptions} рефералов\n`;
                message += `👥 Ре��ералы: ${userInfo.referral_stats?.activated_referrals || 0} активных\n`;
                message += `📅 ${new Date(request.created_at).toLocaleDateString('ru-RU')}\n\n`;
            }

            if (pending.length > 5) {
                message += `... и ещё ${pending.length - 5} заявок`;
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

// Показвть управление лотереями
async function showAdminLottery(chatId, messageId) {
    const message = `🎲 Управление лотереями\n\n` +
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

// Показать управление промокодами
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

// Показать управление нумерацией заявок
async function showWithdrawalNumbering(chatId, messageId) {
    try {
        // Получаем текущее значение последовательности создания заявок
        const requestSeq = await Database.pool.query(`
            SELECT last_value FROM withdrawal_requests_id_seq;
        `);

        // Получаем текущее значение последовательности закрытия заявок
        const closureSeqQuery = await Database.pool.query(`
            SELECT EXISTS (SELECT 1 FROM information_schema.sequences WHERE sequence_name = 'withdrawal_closure_seq');
        `);

        let closureInfo = "Не создана";
        if (closureSeqQuery.rows[0].exists) {
            const closureSeq = await Database.pool.query(`
                SELECT last_value FROM withdrawal_closure_seq;
            `);
            const closureValue = parseInt(closureSeq.rows[0]?.last_value) || 0;
            closureInfo = `${closureValue} (следующая закрытая: ${closureValue + 1})`;
        }

        const requestValue = parseInt(requestSeq.rows[0]?.last_value) || 0;
        const nextRequestId = requestValue + 1;

        const message = `🔢 Управление нумерацией заявок\n\n` +
                       `📊 Текущее состояние:\n` +
                       `📋 Создание заявок (админ-чат):\n` +
                       `• Последний ID: ${requestValue}\n` +
                       `• Следу��щая заявка: #${nextRequestId}\n\n` +
                       `💰 Закрытие заявок (платежный чат):\n` +
                       `• ${closureInfo}\n\n` +
                       `• Быстрые настройки:`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔢 Установить номер 435', callback_data: 'set_closure_435' }],
                [{ text: '🔢 Установить номер 500', callback_data: 'set_closure_500' }],
                [{ text: '🔢 Установить номер 1000', callback_data: 'set_closure_1000' }],
                [{ text: '🔄 Обновить информацию', callback_data: 'admin_withdrawal_numbering' }],
                [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

    } catch (error) {
        console.error('Ошибка показа нумерации зая��ок:', error);

        const errorMessage = `🔢 Управление нумерацией заявок\n\n` +
                            `❌ Ошибка получения информации о последовательности\n\n` +
                            `️ Быстрые настройки (для платежного чата):`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔢 Установить номер 435', callback_data: 'set_closure_435' }],
                [{ text: '🔢 Установить номер 500', callback_data: 'set_closure_500' }],
                [{ text: '🔢 Установить номер 1000', callback_data: 'set_closure_1000' }],
                [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(errorMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    }
}

// Обработчик установки номера закрытых заявок (для платежного чата)
async function handleSetClosureNumber(chatId, userId, startNumber, messageId, callbackQueryId) {
    try {
        console.log(`🔢 Установка начального номера закрытых заявок: ${startNumber} (админ: ${userId})`);

        const result = await Database.setWithdrawalClosureStartNumber(startNumber);

        if (result.success) {
            const successMessage = `✅ Номер закрытых заявок успешно установлен!\n\n` +
                                 `📊 Изменения:\n` +
                                 `• Последовательность установлена на: ${result.newValue}\n` +
                                 `• Следующая закрытая заявка получит номер: ${result.nextClosureNumber}\n\n` +
                                 ` Это влияет только на нумерацию в платежном чате`;

            await bot.answerCallbackQuery(callbackQueryId, `✅ Установлен номер ${startNumber}!`);

            // Обновляем интерфейс
            await showWithdrawalNumbering(chatId, messageId);

            // Уведомляем админа в чат
            try {
                await bot.sendMessage(chatId, successMessage);
            } catch (e) {
                console.log('Не удалось отправить уведомление админу:', e.message);
            }

        } else {
            await bot.answerCallbackQuery(callbackQueryId, `❌ Ошибка: ${result.error}`);

            const errorMessage = `❌ Ошибка установки номера закрытых заявок\n\n` +
                                `Детали: ${result.error}`;

            try {
                await bot.sendMessage(chatId, errorMessage);
            } catch (e) {
                console.log('Не удалось отправить сообщение об ошибке:', e.message);
            }
        }

    } catch (error) {
        console.error('Ошибка установки номера закрытых заявок:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Произошла ошибка');
    }
}

// Обработчик установки номера заявки
async function handleSetWithdrawalNumber(chatId, userId, startNumber, messageId, callbackQueryId) {
    try {
        console.log(`🔢 Установка начального номера заявок: ${startNumber} (админ: ${userId})`);

        const result = await Database.setWithdrawalStartNumber(startNumber);

        if (result.success) {
            const successMessage = `✅ Номер заявок успешно установлен!\n\n` +
                                 `📊 Изменения:\n` +
                                 `• Предыдущий номер: ${result.previousValue}\n` +
                                 `• Новый номер: ${result.newValue}\n` +
                                 `• Следующая заявка получит номер: ${result.nextWithdrawalId}`;

            await bot.answerCallbackQuery(callbackQueryId, `✅ Установлен номер ${startNumber}!`);

            // Обновляем интерфейс
            await showWithdrawalNumbering(chatId, messageId);

            // Уведомляем админа в чат
            try {
                await bot.sendMessage(chatId, successMessage);
            } catch (e) {
                console.log('Не удалось отправить уведомление админу:', e.message);
            }

        } else {
            await bot.answerCallbackQuery(callbackQueryId, `❌ Ошибка: ${result.error}`);

            const errorMessage = `❌ Ошибка установки номера заявок\n\n` +
                                `Детали: ${result.error}`;

            try {
                await bot.sendMessage(chatId, errorMessage);
            } catch (e) {
                console.log('Не удалось отправить сообщение об ошибке:', e.message);
            }
        }

    } catch (error) {
        console.error('Ошибка у��тановки номера заявок:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Произошла ошибка');
    }
}

// ��бработчик открытия кейса (упрощенная версия)
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

        await bot.answerCallbackQuery(callbackQueryId, `🎉 Вы выиграли ${reward} ⭐!`);
        await showCases(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка открытия кейса:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка открытия кейса');
    }
}

// Обработчик заявок на вывод с убиранием кнопок и отправкой в платежный чат
async function handleWithdrawalAction(chatId, userId, data, callbackQueryId, messageId) {
    // ��роверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    try {
        console.log(`🔍 ОБРАБОТКА ЗАЯВКИ: data="${data}", userId=${userId}`);

        const [action, requestId] = data.split('_');
        const id = parseInt(requestId);

        console.log(`🔍 ПАРСИНГ: action="${action}", requestId="${requestId}", id=${id}`);

        // Проверяе�� корректность парсинга ID
        if (isNaN(id) || !requestId) {
            console.error(`❌ ОШИБКА ПАРСИНГА: data="${data}" не содержит корректный ID`);
            await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка: неверный формат ID заявки');
            return;
        }

        // Получаем информацию о з��явке перед обработкой
        console.log(`🔍 ПОИСК ЗАЯВКИ: id=${id}`);
        const request = await Database.pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [id]);

        console.log(`🔍 РЕЗУЛЬТАТ ПОИСКА: найдено ${request.rows.length} заявок`);
        if (request.rows.length > 0) {
            console.log(`🔍 ДАННЫЕ ЗАЯВКИ:`, request.rows[0]);
        }

        if (request.rows.length === 0) {
            console.error(`❌ ЗАЯВКА НЕ НАЙДЕНА: id=${id}`);
            await bot.answerCallbackQuery(callbackQueryId, `❌ Заявка #${id} не найдена в базе данных`);
            return;
        }

        const requestData = request.rows[0];
        const user = await Database.getUser(requestData.user_id);

        if (action === 'approve') {
            // Одобряем заявку
            await Database.processWithdrawal(id, 'approved');

            // УБИРАЕМ КНОПКИ из админского сообщения
            try {
                await bot.editMessageReplyMarkup(null, {
                    chat_id: chatId,
                    message_id: messageId
                });

                // Добавляем статус к тексту сообщения
                const originalText = await bot.getChat(chatId).then(() => "Заявка обработана");
                await bot.editMessageText(`${originalText}\n\n✅ ЗАЯВКА ОДОБРЕНА`, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (e) {
                console.log('Не удалось отредактировать админское сообщение');
            }

            // Отправляем в чат платежей С НОМЕРОМ ЗАЯВКИ И КНОПКАМИ
            const paymentMessage = `✅ Выплата #${id} выполнена\n\n` +
                                 `👤 Пользователь: ${user?.first_name || 'Неизвестен'}\n` +
                                 `🆔 ID: ${requestData.user_id}\n` +
                                 `💰 Сумма: ${requestData.amount} звёзд\n` +
                                 `📅 Дата: ${new Date().toLocaleDateString('ru-RU')}`;

            const paymentKeyboard = {
                inline_keyboard: [
                    [
                        { text: '📢 Наш Канал', url: 'https://t.me/kirbystarschanel' },
                        { text: '💬 Наш чат', url: 'https://t.me/kirbistarschat' }
                    ],
                    [
                        { text: '🤖 Наш бот', url: 'https://t.me/kirbystarsfarmbot' }
                    ]
                ]
            };

            await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage, {
                reply_markup: paymentKeyboard
            });

            // Уведомляем пользователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `✅ Ваша заявка на вывод ${requestData.amount} звёзд одобрена и выполнена!`
                );
            } catch (e) {
                console.log(`Не удалось уведомить пользователя ${requestData.user_id}`);
            }

            await bot.answerCallbackQuery(callbackQueryId, '🎉 Заявка одобрена');

        } else if (action === 'reject') {
            // Отклоняем заявку и возвращаем средства
            await Database.processWithdrawal(id, 'rejected', 'Отклонено администратором');
            await Database.updateUserBalance(requestData.user_id, requestData.amount, 'add');

            // УБИРАЕМ КНОП��И из ад��инского сообщения
            try {
                await bot.editMessageReplyMarkup(null, {
                    chat_id: chatId,
                    message_id: messageId
                });

                // Добавляем статус к тексту сообщения
                await bot.editMessageText(`Заявка обработана\n\n❌ ЗАЯВКА ОТКЛОНЕНА`, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (e) {
                console.log('Не удалось отредактировать админское сообщение');
            }

            // Отправляем в чат платежей с НОМЕРОМ ЗАЯВКИ И КНОПКАМИ
            const paymentMessage = `❌ Заявка #${id} отклонена\n\n` +
                                 `👤 Пользователь: ${user?.first_name || 'Неизвестен'}\n` +
                                 `🆔 ID: ${requestData.user_id}\n` +
                                 `💰 Сумма: ${requestData.amount} звёзд\n` +
                                 `📅 Дата: ${new Date().toLocaleDateString('ru-RU')}\n` +
                                 `💰 Средства возвращены пользователю`;

            const paymentKeyboard = {
                inline_keyboard: [
                    [
                        { text: '📢 Наш Канал', url: 'https://t.me/kirbystarschanel' },
                        { text: '💬 Наш чат', url: 'https://t.me/kirbistarschat' }
                    ],
                    [
                        { text: '🤖 Наш бот', url: 'https://t.me/kirbystarsfarmbot' }
                    ]
                ]
            };

            await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage, {
                reply_markup: paymentKeyboard
            });

            // Уведомляем п��льзователя
            try {
                await bot.sendMessage(requestData.user_id,
                    `❌ Ваша заявка на вывод ${requestData.amount} звёзд была отклонена.\n` +
                    `💰 Средства возвращены на баланс.`
                );
            } catch (e) {
                console.log(`Не удалось уведомить пользователя ${requestData.user_id}`);
            }

            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка от��лонена');
        }

    } catch (error) {
        console.error('Ошибка обработк�� заявки:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка обработки');
    }
}

// Обработчик расс��лки (упрощенная версия)
async function handleBroadcast(type) {
    console.log(` Рассылка типа ${type} (функция будет добавлена позже)`);
}

// Улучшен��ый обработчик рассылки с готовыми сообщениями
async function handleBroadcastNew(type) {
    try {
        const users = await Database.pool.query('SELECT user_id FROM users');
        let message, keyboard;

        if (type === 'rating') {
            message = `🏆 Быстрее попади в топ 5 по очкам в недельном рейтинге и получи дополнительные звёзды в конце недели!\n\n` +
                     `💰 Награды за топ места:\n` +
                     `🥇 1 место: 100 ⭐\n` +
                     `🥈 2 место: 75 ⭐\n` +
                     `🥉 3 место: 50 ⭐\n` +
                     `4 место: 25 ⭐\n` +
                     `5 место: 15 ⭐\n\n` +
                     `⏰ Награды начисляются каждое воскресенье!\n` +
                     `🚀 Зарабатывай очки и поднимайся в рейтинге!`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '⭐️ Заработать звёзды', callback_data: 'invite' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        } else if (type === 'tasks') {
            message = `📋 Новые задания уже ждут тебя!\n\n` +
                     `💰 Зарабатывай звёзды выполняя простые задания!\n` +
                     `✅ Каждое выполненное задание приближает к активации рефералов\n` +
                     `🎯 Выполни минимум 2 задания для получения всех бонусов\n\n` +
                     `🚀 Не упусти возможность заработать!`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '📋 Задания', callback_data: 'tasks' }],
                    [{ text: '⭐️ Заработать звёзды', callback_data: 'invite' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        } else if (type === 'stars') {
            message = `⭐️ Зарабатывай звёзды каждый день!\n\n` +
                     `💰 Множество способов заработка:\n` +
                     `🖱 Кликер - до 1 звезды в день\n` +
                     `👥 Рефералы - по 2 звезды за каждого\n` +
                     `📋 Задания - от 0.3 звезды за задание\n` +
                     `🎰 Рулетка - попробуй удачу!\n` +
                     `🎁 Кейсы - открывай и выигрывай!\n\n` +
                     `🚀 Начни зарабатывать прямо сейчас!`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '🖱 Кликер', callback_data: 'clicker' }],
                    [{ text: '⭐️ Заработать звёзды', callback_data: 'invite' }],
                    [{ text: '📋 Задания', callback_data: 'tasks' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        } else if (type === 'referral') {
            message = `👥 Приглашай друзей и зарабатывай!\n\n` +
                     `💰 За каждого активного реферала: 2 ⭐\n` +
                     `💰 Активный реферал:\n` +
                     `• Подписался на все каналы\n` +
                     `• Выполнил минимум 2 задания\n\n` +
                     `🚀 Чем больше рефералов, тем больше заработок!\n` +
                     `💎 Приглашай друзей и строй пассивный доход!`;

            keyboard = {
                inline_keyboard: [
                    [{ text: '⭐️ Получить реферальную ссылку', callback_data: 'invite' }],
                    [{ text: '👤 Мой профиль', callback_data: 'profile' }],
                    [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                ]
            };
        } else {
            console.log(`❌ Неизвестный тип рассылки: ${type}`);
            return;
        }

        let sentCount = 0;
        let errorCount = 0;

        console.log(`📢 Начинаем рассылку "${type}" для ${users.rows.length} пользователей...`);

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.user_id, message, { reply_markup: keyboard });
                sentCount++;
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                errorCount++;
                if (error.response?.description?.includes('blocked')) {
                    console.log(`Пользователь ${user.user_id} заблокировал бота`);
                } else {
                    console.log(`Не удалось отправить сообщение пользователю ${user.user_id}: ${error.message}`);
                }
            }
        }

        console.log(`✅ Рассылка "${type}" завершена: отправлено ${sentCount}, ошибок ${errorCount}`);

        try {
            await bot.sendMessage(config.ADMIN_CHAT_ID,
                `📊 Отчет о рассылке "${type}":\n` +
                `✅ Отправлено: ${sentCount}\n` +
                `❌ Ошибок: ${errorCount}\n` +
                `📈 Успешность: ${Math.round((sentCount / (sentCount + errorCount)) * 100)}%`
            );
        } catch (e) {
            console.log('Не ��далось отправить отчет о рассылке админу');
        }

    } catch (error) {
        console.error('Ошибка рассылки:', error);
    }
}

// Cron задачи

// Ежедневный сброс счетчиков в 00:00 МСК
cron.schedule('0 0 * * *', async () => {
    console.log('🕛 Сброс ежедневных счетчиков...');
    try {
        // Сбрасываем daily_referrals для всех пользователей
        await Database.pool.query(`
            UPDATE users
            SET daily_referrals = 0,
                last_daily_reset = CURRENT_DATE,
                clicks_today = 0,
                last_click_time = NULL
            WHERE last_daily_reset < CURRENT_DATE OR last_daily_reset IS NULL
        `);

        console.log('✅ Ежедневные счетчики сброшены');
    } catch (error) {
        console.error('❌ Ошибка сброса ежедневных счетчиков:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// Еженедельный сброс подписок в понедельник в 03:03 МСК
cron.schedule('3 3 * * 1', async () => {
    console.log('🕛 ��женедельный сброс подписок...');
    try {
        // Очищаем ��еш подписок webhook handler
        webhookHandler.userSubscriptionCache.clear();
        console.log('✅ Кеш подписок очищен');

        // НЕ СБРАСЫВАЕМ ОЧКИ ЗДЕСЬ - они сбрасываются после начисления наград в воскресенье
        console.log('ℹ️ Недельные очки сбрасываются после начисления наград в воскресенье');
    } catch (error) {
        console.error('❌ Ошибка еженедельного сброса:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// Еженедельное начисление наград (воскресенье в 20:00 МСК)
cron.schedule('0 20 * * 0', async () => {
    console.log('🏆 Начисление еженедельных наград...');
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
                        `🏆 Поздрав��яем!\n\n` +
                        `Вы заняли ${position} место в недельном рейтинге!\n` +
                        `💰 Награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалось отправить награду пользователю ${user.user_id}`);
                }
            }
        }

        console.log('✅ еженедельные награды начислены');

        // СБРАСЫВАЕМ ОЧКИ СРАЗУ ПОСЛЕ НАЧИСЛЕНИЯ НАГРАД
        console.log('🔄 Сброс недельных очков после начисления наград...');
        await Database.resetWeeklyPoints();
        console.log('✅ Недельные очки сброшены после начисления наград');

    } catch (error) {
        console.error('❌ Ошибка начисления еженедельных наград:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// Инициализация
initBot();

module.exports = { bot };
