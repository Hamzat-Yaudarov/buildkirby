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

// Храним пройденные капчи пользователей
const passedCaptcha = new Map();

// Защ��та от спама - храним пос��едний вызов для каждого по��ьзователя
const lastSubscriptionCheck = new Map();

// Защита от дублирования спонсорс��ие сообщений
const lastSponsorMessage = new Map();

// Состояния пользователей для кастомной рассылки
const broadcastStates = new Map();

// Временное хранение сообщений для рассылки (решает пр��блему BUTTON_DATA_INVALID)
const pendingBroadcastMessages = new Map();

// Состояние ожидания причины отклонения заявки на вывод (по администратору)
const pendingRejectionReasons = new Map();

// Удаля��м предсказуемый счетчик ру��етки
// let rouletteBetCounter = 0; // УЯЗВИМОСТЬ ИСПРАВЛЕНА

// Функция для преобразования канала в формат, подходящий для Telegram Bot API
function normalizeChannelIdentifier(channelInput) {
    // Если это прямая ссылка https://t.me/channel
    if (channelInput.startsWith('https://t.me/')) {
        const username = channelInput.replace('https://t.me/', '');
        return {
            identifier: `@${username}`, // Для getChatMember нужен формат @username
            title: username,
            url: channelInput // Оставляем тригинальную ссыл��у
        };
    }
    // Если это уже формат @username
    else if (channelInput.startsWith('@')) {
        return {
            identifier: channelInput,
            title: channelInput.replace('@', ''),
            url: `https://t.me/${channelInput.replace('@', '')}`
        };
    }
    // Если ��то просто username без @
    else {
        return {
            identifier: `@${channelInput}`,
            title: channelInput,
            url: `https://t.me/${channelInput}`
        };
    }
}

// Проверка подписки на личные спонс��рские каналы (ОБНОВЛЕНО: с базой данных и стат��стикой)
// Теперь п��ддерживает как @username, так и https://t.me/username форматы
async function checkPersonalChannelsSubscription(userId, skipOnError = false) {
    try {
        // Получаем активные каналы из базы данных
        const personalChannels = await Database.getActiveSponsorChannels();

        if (!personalChannels || personalChannels.length === 0) {
            console.log(`ℹ️ Нет активных личных спонсорских каналов в базе данных`);
            return { isSubscribed: true }; // Если ��ичных каналов н��т, считаем подписанным
        }

        console.log(`📊 Проверяем подписку на ${personalChannels.length} активных личных каналов`);
        const unsubscribedChannels = [];

        for (const channelData of personalChannels) {
            try {
                console.log(`🔍 Проверяем подписку на ${channelData.channel_identifier} (${channelData.channel_title})`);

                const member = await bot.getChatMember(channelData.channel_identifier, userId);
                const isSubscribed = member.status !== 'left' && member.status !== 'kicked';

                if (isSubscribed) {
                    // Пользователь п��дписан - запи��ываем статистику
                    try {
                        await Database.recordSponsorChannelCheck(channelData.channel_identifier, userId);
                        console.log(`✅ Пользователь ${userId} подписан на ${channelData.channel_identifier} - статистика обновлена`);
                    } catch (statsError) {
                        console.error(`❌ Ошибка записи статистики для канала ${channelData.channel_identifier}:`, statsError.message);
                    }
                } else {
                    // Пользователь ��е п��дп��сан
                    unsubscribedChannels.push({
                        username: channelData.channel_identifier,
                        title: channelData.channel_title,
                        url: channelData.channel_url,
                        originalInput: channelData.channel_identifier
                    });
                }
            } catch (error) {
                console.error(`Ошибка проверки подписки на канал ${channelData.channel_identifier}:`, error.message);

                if (skipOnError) {
                    // При нажатии кнопки "Проверить подписки" - пропу��каем канал при ошибке
                    console.log(`⏭️ Пропускаем канал ${channelData.channel_identifier} при проверке по запросу пользователя`);
                } else {
                    // В остальных случ��ях считаем что пользователь не подписан
                    unsubscribedChannels.push({
                        username: channelData.channel_identifier,
                        title: channelData.channel_title,
                        url: channelData.channel_url,
                        originalInput: channelData.channel_identifier
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

        // FALLBACK: если база данных недоступна, используем config
        try {
            console.log(`🔄 Fallback: используем каналы из конфигурации`);
            const configChannels = config.PERSONAL_SPONSOR_CHANNELS;
            if (!configChannels || configChannels.length === 0) {
                return { isSubscribed: true };
            }

            const unsubscribedChannels = [];
            for (const channelInput of configChannels) {
                try {
                    const channelData = normalizeChannelIdentifier(channelInput);
                    const member = await bot.getChatMember(channelData.identifier, userId);
                    if (member.status === 'left' || member.status === 'kicked') {
                        unsubscribedChannels.push({
                            username: channelData.identifier,
                            title: channelData.title,
                            url: channelData.url,
                            originalInput: channelInput
                        });
                    }
                } catch (err) {
                    if (!skipOnError) {
                        const channelData = normalizeChannelIdentifier(channelInput);
                        unsubscribedChannels.push({
                            username: channelData.identifier,
                            title: channelData.title,
                            url: channelData.url,
                            originalInput: channelInput
                        });
                    }
                }
            }

            return {
                isSubscribed: unsubscribedChannels.length === 0,
                unsubscribedChannels: unsubscribedChannels
            };
        } catch (fallbackError) {
            console.error('Ошибка fallback проверки каналов:', fallbackError);
            return { isSubscribed: false, unsubscribedChannels: [] };
        }
    }
}

// Централизованная функция для отправки спонсорских сообщений (БЕЗ ДУБЛИРОВАНИЯ)
async function sendSponsorMessage(chatId, userId, subscriptionData, messageId = null, method = 'send') {
    const now = Date.now();
    const lastMessage = lastSponsorMessage.get(userId);
    const uniqueKey = `${userId}_${chatId}`; // Уникальный ключ для защиты

    // УСИЛЕННАЯ ЗАЩИТА: если неда��но отправляли спонсорское сообщени�� - не отправляем повторно
    if (lastMessage && (now - lastMessage) < 30000) { // 30 секунд усиле��ная защита
        console.log(`🛡️ БЛОКИРОВКА: недавно уже отправили спонсорское сообщение пользователю ${userId} (${(now - lastMessage)/1000}с назад)`);
        return false;
    }

    // Проверяем есть ли ссылки для отправки
    if (!subscriptionData.links || subscriptionData.links.length === 0) {
        console.log(`⚠️ Нет ссылок для отправки спонсорского сообщения пользователю ${userId}`);
        return false;
    }

    // Устанавливаем бло��ировку ПЕРЕД отправкой, а не после
    lastSponsorMessage.set(userId, now);

    try {
        const message = SubGram.formatSubscriptionMessage(
            subscriptionData.links,
            subscriptionData.additional?.sponsors
        );
        const keyboard = SubGram.createSubscriptionKeyboard(subscriptionData.links);

        if (method === 'edit' && messageId) {
            // Пыта��мся отредактировать существующее сооб��ение
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
                // При ошибке редактирования удаляем блокировку и НЕ отправляем новое сообщение
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
        console.error(`❌ Ошибка отправка спонсорского сообщения пользователю ${userId}:`, error.message);
        // Пр�� ошибке удаляем блокировку, чтобы можно было попробовать позже
        lastSponsorMessage.delete(userId);
        return false;
    }
}

// Проверка выполнения условий для зас��итывания реферала
async function checkReferralConditions(userId) {
    try {
        const user = await Database.getUser(userId);
        if (!user || !user.referrer_id) {
            return; // Нет реферера
        }

        // Проверяем подписку на SubGram спонсорские каналы
        const subscriptionStatus = await checkUserSubscription(userId, userId);
        if (!subscriptionStatus.isSubscribed) {
            console.log(`👥 Реферал ${userId} еще не подписан на SubGram спонсорские каналы`);
            return;
        }

        // НОВОЕ: Проверяем подписку на личные спонсорские каналы
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId);
        if (!personalChannelsStatus.isSubscribed) {
            console.log(`👥 Реферал ${userId} еще не подписан на личные спонсорские каналы`);
            return;
        }

        // Прове��яем кол��чество выполне��ных кастомных заданий (больше не SubGram)
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

        // НОВОЕ: Проверяем является ли пользователь из страны СНГ
        const cisCodes = ['ru', 'uk', 'be', 'kk', 'ky', 'uz', 'tg', 'tk', 'hy', 'az', 'ka', 'mo'];
        const userLanguage = user.language_code ? user.language_code.toLowerCase() : 'unknown';

        if (!cisCodes.includes(userLanguage)) {
            console.log(`🚫 Реферал ${userId} из страны не СНГ (language_code: ${userLanguage}), награду не начисляем`);

            // Помечаем реферала как завершенного, но БЕЗ начисления награды
            try {
                await Database.pool.query(
                    'UPDATE users SET referral_completed = TRUE WHERE user_id = $1 AND referral_completed = FALSE',
                    [userId]
                );
                console.log(`✅ Реферал ${userId} помечен как завершенный без награды (не СНГ)`);
            } catch (error) {
                console.error(`❌ Ошибка пометки реферала ${userId} как завершенного:`, error);
            }
            return;
        }

        console.log(`✅ Реферал ${userId} из страны СНГ (language_code: ${userLanguage}), начисляем награду`);

        // Все условия выполнен�� - начисляем награду
        console.log(`🎉 Реферал ${userId} выполнил все условия! Начисляем награду реферору ${user.referrer_id}`);

        // ИСПРАВЛ����НО: Используем атомарную транзакцию для предотвращения race condition
        const client = await Database.pool.connect();
        try {
            await client.query('BEGIN');

            // Атомарно помечаем реферала как завершенного ТОЛЬКО если ещ�� не завершен
            const updateResult = await client.query(
                'UPDATE users SET referral_completed = TRUE WHERE user_id = $1 AND referral_completed = FALSE RETURNING referrer_id',
                [userId]
            );

            // Если об��овление не произошло (уже было referral_completed = TRUE), вы��одим
            if (updateResult.rowCount === 0) {
                console.log(`⚠️ Реферальная награда за пользователя ${userId} уже была начислена (race condition предотвращена)`);
                await client.query('COMMIT');
                return;
            }

            const referrerId = updateResult.rows[0].referrer_id;
            console.log(`✅ Атомарно помечен реферал ${userId}, начисляем награду рефереру ${referrerId}`);

            // Начи��ляем баланс и очк���� рефереру в той же транзакции
            await client.query(
                'UPDATE users SET balance = balance + 3, total_earned = total_earned + 3, points = points + 1, weekly_points = weekly_points + 1 WHERE user_id = $1',
                [referrerId]
            );

            // Увеличиваем сче��чики рефералов в той же транзакции
            await client.query(
                'UPDATE users SET total_referrals = total_referrals + 1, daily_referrals = daily_referrals + 1, referral_earned = referral_earned + 3 WHERE user_id = $1',
                [referrerId]
            );

            await client.query('COMMIT');
            console.log(`✅ Реферальная награда успешно начислена атомарно: +3 звезды, +1 очко для ${referrerId}`);

            // Уведомляем реферера после успешного COMMIT
            try {
                await bot.sendMessage(referrerId,
                    '🎉 Ваш реферал выполнил все условия!\n' +
                    '✅ Подписался на все спонсорские каналы\n' +
                    '✅ Подписался на наши основное каналы\n' +
                    '✅ Выполнил 2 задания\n\n' +
                    '💰 Вы получили 3 ⭐️\n' +
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
        console.error('Ошибка запуска бота:', error);
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

function createBlockedMainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '👤 Профиль', callback_data: 'disabled' }],
            [{ text: '⭐️ Заработать звезды', callback_data: 'disabled' }],
            [{ text: '🖱 Кликер', callback_data: 'disabled' }, { text: '🎰 Лотерея', callback_data: 'disabled' }],
            [{ text: '📋 Задания', callback_data: 'disabled' }, { text: '🎰 Рулетка', callback_data: 'disabled' }],
            [{ text: '🏆 Рейтинги', callback_data: 'disabled' }, { text: '🎁 Кейсы', callback_data: 'disabled' }],
            [{ text: '💰 Вывод звёзд', callback_data: 'disabled' }]
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
            [{ text: '🎁 Промокод', callback_data: 'promocode' }],
            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
        ]
    };
}

// Капча с 8 кнопками (животные и фрук��ы)
function showCaptcha(chatId, userId) {
    const message = '🤖 Для продолжения работы с ботом пройдите проверку:\n\n' +
                   '🍓 Найдите и нажмите на ЗЕМЛЯНИ4КУ среди представленных вариантов:';

    const keyboard = {
        inline_keyboard: [
            [
                { text: '🐱 Кот', callback_data: 'captcha_1' },
                { text: '🐕 Собака', callback_data: 'captcha_2' }
            ],
            [
                { text: '🐘 Слон', callback_data: 'captcha_3' },
                { text: '🐰 Кролик', callback_data: 'captcha_4' }
            ],
            [
                { text: '🍎 Яблоко', callback_data: 'captcha_5' },
                { text: '🍓 Земляника', callback_data: 'captcha_6' }
            ],
            [
                { text: '🍊 Апельсин', callback_data: 'captcha_7' },
                { text: '🍌 Банан', callback_data: 'captcha_8' }
            ]
        ]
    };

    return bot.sendMessage(chatId, message, { reply_markup: keyboard });
}

// Обработчик капчи
async function handleCaptcha(chatId, userId, data, messageId, callbackQueryId) {
    const choice = parseInt(data.split('_')[1]);

    if (choice === 6) { // Правильный отве�� - ��емляника (6-я кнопка)
        // Капча п��ойдена успешно
        passedCaptcha.set(userId, true);

        await bot.answerCallbackQuery(callbackQueryId, '✅ Капча пройдена успешно!');

        // ��еперь переходим к проверке подписки
        await bot.editMessageText('✅ Капча пройдена успешно!\n\n🔍 Теперь проверяем ваши подписки...', {
            chat_id: chatId,
            message_id: messageId
        });

        // ЗАЩИТА ОТ СПАМА: проверяем не вызывали ли мы недавно проверку подписки
        const now = Date.now();
        const lastCheck = lastSubscriptionCheck.get(userId);
        if (lastCheck && (now - lastCheck) < 3000) { // 3 секунды защита
            console.log(`⚠️ Защита от спама: пропускаем повторные проверки для пользователя ${userId}`);
            return;
        }
        lastSubscriptionCheck.set(userId, now);

        let user = await Database.getUser(userId);

        // Получаем с��хранённые данные пользователя
        const userStateData = userStates.get(userId);
        let userData = null;

        if (userStateData && userStateData.startsWith('{')) {
            try {
                userData = JSON.parse(userStateData);
            } catch (e) {
                console.log(`⚠️ Ошибка парсинга данных пользователя ${userId}:`, e.message);
            }
        }

        if (!user) {
            // Создаем нового пользователя с сохранёнными данными
            const referrerId = userData?.referralCode ? parseInt(userData.referralCode) : null;
            user = await Database.createUser({
                userId: userId,
                username: userData?.username || '',
                firstName: userData?.firstName || '',
                languageCode: userData?.languageCode || 'ru',
                isPremium: userData?.isPremium || false,
                referrerId: referrerId
            });

            // Реферальная награда будет на��ислена позже после выполнения условий
            if (referrerId) {
                console.log(`👥 Новый пользователь ${userId} пришел по реферальной ссылке от ${referrerId} (после капчи)`);
            }
        }

        // Оч��щаем состояние пользователя
        userStates.delete(userId);

        // Сохраняем статус прохождения капчи в б��зу данных
        try {
            await Database.setCaptchaPassed(userId, true);
            console.log(`✅ Статус прохождения капчи сохранен в БД для пользователя ${userId}`);
        } catch (error) {
            console.error(`❌ Ошибка сохранения статуса капчи для пользователя ${userId}:`, error);
        }

        // Проверяе�� подписку на SubGram каналы
        console.log(`🔍 Проверка подписки для пользователя ${userId} после капчи`);
        const subscriptionStatus = await checkUserSubscription(
            userId,
            chatId,
            userData?.firstName || '',
            userData?.languageCode || 'ru',
            userData?.isPremium || false
        );

        console.log(`📊 Статус подписки послЕ капчи:`, subscriptionStatus);

        // Если пользователь НЕ подписан - показываем спонсорские кан��лы
        if (!subscriptionStatus.isSubscribed) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан на SubGram каналы после капчи`);

            // Если есть ссылки - показываем их
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(` Показываем ${subscriptionStatus.subscriptionData.links.length} спонсорских каналов после капчи`);
                const messageSent = await sendSponsorMessage(chatId, userId, subscriptionStatus.subscriptionData, messageId, 'edit');
                if (!messageSent) {
                    console.log(`⚠️ Не удалось отправить спонсорское сообщение пользователю ${userId} после капчи`);
                }
            } else {
                // Если нет ссылок - показываем общее сообщение
                await bot.editMessageText(
                    '🔒 Для доступа к боту необходимо подписаться на спонсорские каналы.\n\n' +
                    '⏳ Временно нет доступных каналов для подписки. Попробуйте позже или обратитесь к администратору.\n\n' +
                    '👇 Нажмите кнопку ниже для повторной проверки.',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '🔄 Проверить подписки', callback_data: 'check_subscription' }
                            ]]
                        }
                    }
                );
            }
            return;
        }

        // Проверяем подписку на личные спонсорские каналы
        console.log(`🔍 Дополнительная проверка личных спонсорских каналов для пользователя ${userId} после капчи`);
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId, false);

        if (!personalChannelsStatus.isSubscribed && personalChannelsStatus.unsubscribedChannels.length > 0) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан на личные каналы после капчи`);

            // Формируем сообщение с личными каналами
            let personalMessage = '🔐 Для полного доступа к боту подпишитесь на наши основные каналы:\n\n';

            personalChannelsStatus.unsubscribedChannels.forEach((channel, index) => {
                personalMessage += `${index + 1}. ${channel.title}\n`;
            });

            personalMessage += '\n⚠️ После подписки нажмите "Проверить подписки"';

            // Создаем кл��виатуру с каналами
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

            // Добавляем кнопку проверки
            personalKeyboard.inline_keyboard.push([{
                text: '✅ Проверить подписку',
                callback_data: 'check_subscription_personal'
            }]);

            await bot.editMessageText(personalMessage, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: personalKeyboard
            });
            return;
        }

        // Если подписан на ВСЕ каналы - показываем главное меню
        console.log(`✅ Пользователь ${userId} подписан на ВСЕ каналы после капчи, показываем главное меню`);

        const blocked = (config.BLOCKED_LANGUAGE_CODES || []).map(c => c.toLowerCase());
        const userLang = (user?.language_code || userData?.languageCode || 'ru').toLowerCase();
        const isBlocked = blocked.includes(userLang);

        const successMessageDefault = '✅ Отлично! Вы прошли капчу и подписались на все каналы!\n\n' +
                              '🎉 Добро пожаловать в бота для заработка звёзд!\n\n' +
                              '🌟 Теперь вам доступны все функции бота:\n' +
                              '• ⭐️ Зарабатывать звезды\n' +
                              '• 🎰 Играть в рулетку\n' +
                              '• 🖱 Использовать кликер\n' +
                              '• 🎁 Открывать кейсы\n' +
                              '• 💰 Выводить звёзды\n\n' +
                              'Выберите действие:';

        const successMessage = isBlocked
            ? '🚫 Доступ к основным функциям бота ограничен в вашем регионе.\n\n🔻 Главное меню'
            : successMessageDefault;

        const keyboard = isBlocked ? createBlockedMainMenuKeyboard() : createMainMenuKeyboard();

        await bot.editMessageText(successMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });

        // Проверяем условия для засчитывания реферала
        await checkReferralConditions(userId);

    } else {
        // Неправильный ответ
        await bot.answerCallbackQuery(callbackQueryId, {
            text: '❌ Неправильно! Найдите землянику среди вариантов.',
            show_alert: true
        });

        // Показываем капчу заново
        await bot.editMessageText('❌ Неправильный ответ! Попробуйте еще раз.\n\n' +
                                '🍓 Найдите и нажмите на ЗЕМЛЯНИ4КУ среди представленных вариантов:', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🐱 Кот', callback_data: 'captcha_1' },
                        { text: '🐕 Собака', callback_data: 'captcha_2' }
                    ],
                    [
                        { text: '🐘 Слон', callback_data: 'captcha_3' },
                        { text: '🐰 Кролик', callback_data: 'captcha_4' }
                    ],
                    [
                        { text: '🍎 Яблоко', callback_data: 'captcha_5' },
                        { text: '🍓 Земляника', callback_data: 'captcha_6' }
                    ],
                    [
                        { text: '🍊 Апельсин', callback_data: 'captcha_7' },
                        { text: '🍌 Банан', callback_data: 'captcha_8' }
                    ]
                ]
            }
        });
    }
}

// Проверка подписки пользователя на СПОНСОРСКИЕ каналы (для блокировка доступа к функциям бота)
async function checkUserSubscription(userId, chatId, firstName = '', languageCode = 'ru', isPremium = false) {
    try {
        // Сначала проверяем кеш вебхуков (свежи�� данные - не старше 5 минут)
        const cachedStatus = webhookHandler.getUserSubscriptionStatus(userId);

        if (cachedStatus.lastUpdate && (Date.now() - cachedStatus.lastUpdate) < 5 * 60 * 1000) {
            console.log(` Используем кешированные данные подписки для пользователя ${userId}`);
            console.log(`📊 Кеш:`, cachedStatus);

            if (cachedStatus.isSubscribed === false && cachedStatus.unsubscribedLinks.length > 0) {
                // Пользователь точно не подписан - есть непод��исанные каналы
                return {
                    isSubscribed: false,
                    subscriptionData: {
                        links: cachedStatus.unsubscribedLinks,
                        status: 'webhook_cache'
                    }
                };
            }

            if (cachedStatus.isSubscribed === true) {
                // Пол��зователь точно подписан
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
            console.log(`❌ Ошибка SubGram, пытаемся получить ссылки альтернативным способом`);

            // Пытаемся получить ссылки через getChannelLinks
            console.log(` Запрашиваем ссылки каналов через getChannelLinks для пользователя ${userId}`);
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

            // СТРОГ��Й FALLBACK: если нет кеша - НЕ подписан (безопасность)
            return {
                isSubscribed: false,
                subscriptionData: {
                    status: 'error_fallback',
                    links: [],
                    message: 'Ошибка проверки подписки - доступ заблокирован'
                }
            };
        }

        // ВАЖНО: статус "warning" означает ��то пользовате��ь НЕ подписа��!
        if (taskChannels.status === 'warning') {
            console.log(` Пользователь ${userId} НЕ подписан (статус warning): ${taskChannels.message}`);

            // Для статуса warning SubGram может не возвращать ссылки, попробуем разные способы получе��ия
            if (!taskChannels.links || taskChannels.links.length === 0) {
                console.log(` Запрашиваем ссылки каналов для пользователя ${userId} (warning без ссылок)`);

                // Попробуем получить ссылки через getChannelLinks
                const attempts = [
                    // 1. Попытка с getChannelLinks
                    () => SubGram.getChannelLinks(userId, chatId, firstName, languageCode, isPremium)
                ];

                for (let i = 0; i < attempts.length; i++) {
                    try {
                        console.log(` Попытка ${i + 1}/${attempts.length} получения ссылок`);
                        const linksCheck = await attempts[i]();

                        if (linksCheck.links && linksCheck.links.length > 0) {
                            taskChannels.links = linksCheck.links;
                            taskChannels.additional = linksCheck.additional;
                            console.log(`✅ Получены ссылки (попытка ${i + 1}): ${linksCheck.links.length} каналов`);
                            break;
                        } else if (linksCheck.status === 'ok') {
                            console.log(`⚠ Попытка ${i + 1}: status='ok' но нет ссылок (пользователь уже подписан?)`);
                        } else {
                            console.log(`⚠ Попытка ${i + 1} не кала ссылок: status=${linksCheck.status}`);
                        }
                    } catch (e) {
                        console.error(`❌ Ошибка попытки ${i + 1}:`, e.message);
                    }
                }

                if (!taskChannels.links || taskChannels.links.length === 0) {
                    console.log(`⚠️ Все попытки получения ссылок не удались для пользователя ${userId}`);

                    // Если не смогли получить ссылки, ��роверяем кеш
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

        // Если ест�� ссылки для подпи��ки - ��начит пользователь ��е подписан
        if (taskChannels.links && taskChannels.links.length > 0) {
            console.log(` Пользователь ${userId} НЕ подписан, есть ${taskChannels.links.length} каналов`);
            return {
                isSubscribed: false,
                subscriptionData: taskChannels
            };
        }

        // Статус "ok" и нет ссылок - пользователь подписан
        if (taskChannels.status === 'ok') {
            // Дополн��тельно проверим, действительно ли нет ссылок
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

        // Для всех остальных случаев ис��ользуем СТРОГИЙ подход - НЕ подписан!
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
            console.log(` Используем кеш как fallback после ошибки API`);
            return {
                isSubscribed: cachedStatus.isSubscribed === true, // СТРОГО: только если точно подписан
                subscriptionData: {
                    status: 'fallback_cache',
                    links: cachedStatus.unsubscribedLinks || []
                }
            };
        }

        // СТРОГИЙ FALLBACK: если нет данных - НЕ подписан (безопасность превыше всего)
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

// Обраб��тчик команды /cancel ��ля о��мены рассылки
bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    console.log(`🚫 Команда /cancel от пользователя ${userId}`);
    console.log(` Состояние рассылки: ${broadcastStates.has(userId) ? 'есть' : 'нет'}`);
    console.log(`📊 Всего активных состояний: ${broadcastStates.size}`);

    if (broadcastStates.has(userId)) {
        broadcastStates.delete(userId);
        console.log(`✅ Удалили состояние рассылки для пользователя ${userId}`);
        await bot.sendMessage(chatId, '❌ Рассылка отменена.');
    } else {
        await bot.sendMessage(chatId, 'ℹ️ Нет активных операций для отмены.');
    }
});

// Обработчик текстовых сообщений для кастомной рассылки
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const messageText = msg.text;

    // Обработка ожидания причины отклонения заявки (админ)
    if (pendingRejectionReasons.has(userId) && config.ADMIN_IDS.includes(userId)) {
        const state = pendingRejectionReasons.get(userId);
        if (!messageText || messageText.startsWith('/')) {
            await bot.sendMessage(chatId, '⚠️ Пожалуйста, пришлите текст причины одним сообщением.');
            return;
        }
        try {
            const req = await Database.pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [state.requestId]);
            if (req.rows.length === 0) {
                pendingRejectionReasons.delete(userId);
                await bot.sendMessage(chatId, '❌ Заявка не найдена.');
                return;
            }
            const r = req.rows[0];
            await Database.processWithdrawal(state.requestId, 'rejected', messageText);
            if (state.refund) {
                await Database.updateUserBalance(r.user_id, r.amount, 'add');
            }
            try {
                await bot.editMessageReplyMarkup(null, { chat_id: state.chatId, message_id: state.messageId });
            } catch (e) {}
            const statusLine = state.refund ? '❌ ЗАЯВКА ОТКЛОНЕНА • Средства возвращены' : '❌ ЗАЯВКА ОТКЛОНЕНА • Без возврата';
            try {
                await bot.editMessageText(`💰 Заявка на вывод #${state.requestId}\n\n${statusLine}\n📝 Причина: ${messageText}`, {
                    chat_id: state.chatId,
                    message_id: state.messageId
                });
            } catch (e) {}

            const paymentMsg = (state.refund ? '❌ Заявка #' : '❌ Заявка #') + state.requestId + ' отклонена\n\n' +
                `👤 Пользователь: ${r.user_id}\n` +
                `💰 Сумма: ${r.amount} звёзд\n` +
                `📝 Причина: ${messageText}\n` +
                (state.refund ? '💰 Средства возвращены пользователю' : '🚫 Средства НЕ возвращены');
            try {
                await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMsg);
            } catch (e) {}

            try {
                const reasonText = messageText.length > 0 ? `\n📝 Причина: ${messageText}` : '';
                const userNotice = state.refund
                    ? `❌ Ваша заявка на вывод ${r.amount} звёзд отклонена.\n💰 Средства возвращены на баланс.${reasonText}`
                    : `❌ Ваша заявка на вывод ${r.amount} звёзд отклонена.${reasonText}`;
                await bot.sendMessage(r.user_id, userNotice);
            } catch (e) {}

            pendingRejectionReasons.delete(userId);
            return;
        } catch (e) {
            pendingRejectionReasons.delete(userId);
            await bot.sendMessage(chatId, '❌ Ошибка обработки отклонения.');
            return;
        }
    }

    // Проверяем, если адми�� ожидаем ввода сообщен���я для рассылки
    console.log(`📨 Получено сообщение от пользователя ${userId}: "${messageText}"`);
    console.log(`🔍 Состояние рассылки: ${broadcastStates.has(userId) ? 'есть' : 'нет'}`);

    if (broadcastStates.has(userId) && broadcastStates.get(userId).waiting) {
        console.log(` Пользователь ${userId} ожидает рассылку, обрабатываем сообщение`);
        // Проверяем админские права
        if (!config.ADMIN_IDS.includes(userId)) {
            broadcastStates.delete(userId);
            await bot.sendMessage(chatId, '❌ У вас нет прав администратора');
            return;
        }

        // Пропускае�� команды
        if (messageText && (messageText.startsWith('/') || messageText.startsWith('Участник:'))) {
            return;
        }

        if (!messageText || messageText.trim().length === 0) {
            await bot.sendMessage(chatId, '⚠️ Пожалуйста, отправьте текстовое сообщение.');
            return;
        }

        // Очищаем с��стояние
        broadcastStates.delete(userId);

        // Генер��руем уникальный ID дл��� сообщения (исправлено для BUTTON_DATA_INVALID)
        const messageId = `${userId}_${Date.now()}`;

        // Сохраняем сообщение во временном хранилище
        pendingBroadcastMessages.set(messageId, messageText);
        console.log(`💾 Сохранено сообщение рассылки: ${messageId}`);

        // Автоочистка через 10 минут
        setTimeout(() => {
            if (pendingBroadcastMessages.has(messageId)) {
                pendingBroadcastMessages.delete(messageId);
                console.log(`🗑️ Удалено устаревшее сообщение рассылки: ${messageId}`);
            }
        }, 10 * 60 * 1000);

        // Подтверждаем отправку (��гранич���ваем отобр��жение длинных сообщений)
        const displayMessage = messageText.length > 200 ? messageText.substring(0, 200) + '...' : messageText;
        const confirmationMessage = `ℹ️ Подтвердите отправку сообщения:\n\n` +
                               `“${messageText}”\n\n` +
                               `⚠️ Сообщение будет отправлено всем пользователям бота!`;

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Подтвердить отправку', callback_data: `confirm_broadcast_${messageId}` },
                    { text: '❌ Отменить', callback_data: 'cancel_broadcast' }
                ]
            ]
        };

        await bot.sendMessage(chatId, confirmationMessage, { reply_markup: keyboard });
        return;
    }

    // Пров��ряем промокоды только если это не команда
    if (messageText && !messageText.startsWith('/') && !messageText.startsWith('Участник:')) {
        const userState = userStates.get(userId);

        if (userState === 'waiting_promocode') {
            userStates.delete(userId);

            try {
                const promocode = await Database.usePromocode(userId, messageText);
                await Database.updateUserBalance(userId, promocode.reward);

                await bot.sendMessage(chatId,
                    `✅ Промокод активирован!\n💰 Вы получили ${promocode.reward} ⭐`
                );
            } catch (error) {
                await bot.sendMessage(chatId, `❌ ${error.message}`);
            }
            return;
        }
    }
});

// Обработчик команды /start
bot.onText(/\/start(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const referralCode = match[1] ? match[1].trim() : null;

    try {
        // ПЕРВЫЙ ЭТАП: Проверяем, прошел ли пользователь капчу
        // Проверяем сначала в памяти (быстро), затем в базе данны�� (если нет в памяти)
        let captchaPassed = passedCaptcha.get(userId);

        if (!captchaPassed) {
            // Проверяем в базе данных
            const user = await Database.getUser(userId);
            captchaPassed = user?.captcha_passed || false;

            // Если в базе отмечено что капча пройдена, сохраняем в памяти для быстрого доступа
            if (captchaPassed) {
                passedCaptcha.set(userId, true);
                console.log(`✅ Пользователь ${userId} уже проходил капчу (восстановлено из БД)`);
            }
        }

        if (!captchaPassed) {
            console.log(`🤖 Пользователь ${userId} не прошел капчу, показываем капчу`);
            await showCaptcha(chatId, userId);

            // Сохраняем реферальный код и данн��е пользователя для создания после прохождения капчи
            if (referralCode || msg.from.username || msg.from.first_name) {
                userStates.set(userId, JSON.stringify({
                    state: 'waiting_after_captcha',
                    referralCode: referralCode,
                    username: msg.from.username,
                    firstName: msg.from.first_name,
                    languageCode: msg.from.language_code || 'ru',
                    isPremium: msg.from.is_premium || false
                }));
            } else {
                userStates.set(userId, 'waiting_after_captcha');
            }
            return;
        }

        // ЗАЩИТА ОТ СПАМА: проверяем не вызывали ли мы недавно проверку подписки
        const now = Date.now();
        const lastCheck = lastSubscriptionCheck.get(userId);
        if (lastCheck && (now - lastCheck) < 3000) { // 3 секунды защита
            console.log(`⚠️ Защита от спама: пропускаем повторные /start для пользователя ${userId}`);
            return;
        }
        lastSubscriptionCheck.set(userId, now);

        let user = await Database.getUser(userId);
        
        if (!user) {
            // Создаем но���ого пользователя
            const referrerId = referralCode ? parseInt(referralCode) : null;
            user = await Database.createUser({
                userId: userId,
                username: msg.from.username,
                firstName: msg.from.first_name,
                languageCode: msg.from.language_code || 'ru',
                isPremium: msg.from.is_premium || false,
                referrerId: referrerId
            });
            
            // Реферальная награда буд��т начислена позже после выполнения условий
            if (referrerId) {
                console.log(`👥 Новый пользователь ${userId} пришел по реферальной ссылке от ${referrerId}`);
                // Награда будет начислена в функции checkReferralConditions()
            }
        }
        
        // С��АЧАЛА проверяем подписку - это самое важное!
        console.log(`🔍 Проверка подписки для пользователя ${userId}`);
        const subscriptionStatus = await checkUserSubscription(
            userId, 
            chatId,
            msg.from.first_name || '',
            msg.from.language_code || 'ru',
            msg.from.is_premium || false
        );
        
        console.log(` Статус подписки:`, subscriptionStatus);

        // Если пользователь Н�� п��дписан - показываем спонсорские каналы (даже если ссы��ки пустые)
        if (!subscriptionStatus.isSubscribed) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан на SubGram каналы, блокируем доступ`);

            // Если есть ссылки - показываем их ЧЕРЕЗ ЦЕНТРАЛИЗОВАННУЮ ФУНКЦИЮ
            if (subscriptionStatus.subscriptionData?.links?.length > 0) {
                console.log(`📢 Показываем ${subscriptionStatus.subscriptionData.links.length} спонсорских каналов`);
                const messageSent = await sendSponsorMessage(chatId, userId, subscriptionStatus.subscriptionData);
                if (!messageSent) {
                    console.log(`⚠ Не удалось отправить спонсорское сообщение пользователю ${userId}`);
                }
            } else {
                // Если нет ссылок - показываем общее сообщение
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
            return; // ВАЖНО: в��ходим, НЕ показываем главное меню
        }

        // 2. НОВОЕ: Проверяе�� подписку на личные спонсорские каналы
        console.log(`🔍 Дополнительная проверка личных спонсорских каналов для пользователя ${userId}`);
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId, false);

        if (!personalChannelsStatus.isSubscribed && personalChannelsStatus.unsubscribedChannels.length > 0) {
            console.log(`🔒 Пользователь ${userId} НЕ подписан на личные каналы, блокируем доступ`);

            // Формируем сообщение с личными к��нал��ми
            let personalMessage = '🔐 Для полного доступа к боту подпишитесь на наши основные каналы:\n\n';

            personalChannelsStatus.unsubscribedChannels.forEach((channel, index) => {
                personalMessage += `${index + 1}. ${channel.title}\n`;
            });

            personalMessage += '\n⚠ После подписки нажмите "Проверить подписки"';

            // Созд��ем клавиатуру с каналами
            const personalKeyboard = {
                inline_keyboard: []
            };

            // Добавл��ем кнопки каналов
            personalChannelsStatus.unsubscribedChannels.forEach(channel => {
                personalKeyboard.inline_keyboard.push([{
                    text: `📢 ${channel.title}`,
                    url: channel.url
                }]);
            });

            // Добавляем кнопку проверки
            personalKeyboard.inline_keyboard.push([{
                text: '✅ Проверить подписки',
                callback_data: 'check_subscription_personal'
            }]);

            await bot.sendMessage(chatId, personalMessage, { reply_markup: personalKeyboard });
            return; // ВАЖНО: выходим, НЕ показываем главное меню
        }

        // 3. Т��лько если пользователь подписан на ВСЕ каналы - показываем главное меню
        console.log(`✅ Пользователь ${userId} подписан на ВСЕ каналы (SubGram И личные), показываем главное меню`);
        await showMainMenu(chatId, userId);
        
    } catch (error) {
        console.error('Ошибка в команде /start:', error);
        await bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
});

// Показать главное меню
async function showMainMenu(chatId, userId = null) {
    let isBlocked = false;
    try {
        if (userId) {
            const u = await Database.getUser(userId);
            const lang = (u?.language_code || '').toLowerCase();
            const blocked = (config.BLOCKED_LANGUAGE_CODES || []).map(c => c.toLowerCase());
            isBlocked = lang && blocked.includes(lang);
        }
    } catch (e) {}

    const defaultMessage = '1️⃣ Получи свою личную ссылку жми «⭐️ Заработать звезды»\n\n' +
                   '2️⃣ Приглашай друзей — 3 ⭐ за каждого!\n\n' +
                   '✅ Дополнительно:\n' +
                   '> — Ежедневные награды и промокоды (Профиль)\n' +
                   '> — Выполняй задания\n' +
                   '> — Участвуй в лотереях и выигрывай!\n' +
                   '> — Участвуй в конкурсе на топ\n\n' +
                   '🔻 Главное меню';

    const message = isBlocked
        ? '🚫 Доступ к основным функциям бота ограничен в вашим регионе.\n\n🔻 Главное меню'
        : defaultMessage;

    const keyboard = isBlocked ? createBlockedMainMenuKeyboard() : createMainMenuKeyboard();

    try {
        await bot.sendMessage(chatId, message, { reply_markup: keyboard });
    } catch (error) {
        console.error('Ошибка отправки главного меню:', error);
    }
}

// Обраб��тчик callback запросов
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    console.log(`🔔 ПОЛУЧЕН CALLBACK: "${data}" от пользователя ${userId}`);

    try {
        // Получаем пользователя
        let user = await Database.getUser(userId);

        // Для ��оманд капчи разрешаем обработк�� даже если пользователя нет в базе
        const isCaptchaCommand = data.startsWith('captcha_');

        if (!user && !isCaptchaCommand) {
            await bot.answerCallbackQuery(callbackQuery.id, {
                text: ' Пользователь не найден. Нажмите /start',
                show_alert: true
            });
            return;
        }

        // КРИТИЧНО: ЖЁСТКАЯ проверка подписки для ВСЕХ действий в самом на��але (кроме специал��ных команд)
        const allowedWithoutSubscription = [
            'check_subscription',
            'check_subscription_personal',
            'admin_',
            'approve_',
            'reject_',
            'rj_',
            'disabled',  // для заблокир��ванных кнопок
            'tasks',     // ВАЖНО: разрешаем ��оступ к задани��м для их выполнения
            'check_custom_task_', // Проверка кастомного задания
            'broadcast_', // рассылки (админские)
            'confirm_broadcast_', // подтверждение рассылки
            'cancel_broadcast', // отмена рассылки
            'admin_back',  // возврат в админ панель
            'captcha_'    // капча для новых пользователей
        ];

        // Проверяем разрешённые команды (с учётом точного соответствия для некоторых)
        const isAllowedCommand = allowedWithoutSubscription.some(cmd => {
            if (cmd.endsWith('_')) {
                return data.startsWith(cmd); // для команд с префиксом (admin_, check_custom_task_, и т.д.)
            } else {
                return data === cmd; // для точных команд (tasks, admin_back)
            }
        });

        // ЖЁСТ��АЯ БЛОКИРОВКА: сначала п��оверяем ��одписку для ВСЕХ команд кроме разрешённых
        if (!isAllowedCommand) {
            console.log(`🔍 ЖЁСТКАЯ проверка подписки для команды: ${data} пользователя ${userId}`);

            // 1. Проверяем подписку на SubGram каналы
            const subscriptionStatus = await checkUserSubscription(
                userId,
                chatId,
                callbackQuery.from.first_name || '',
                callbackQuery.from.language_code || 'ru',
                callbackQuery.from.is_premium || false
            );

            // СТРОГАЯ ПРОВЕРКА: если НЕ подписан на SubGram - ЖЁСТКО блокируем
            if (!subscriptionStatus.isSubscribed) {
                console.log(`🔒 ЖЁСТКАЯ БЛОКИРОВКА действий "${data}" - пользователь ${userId} НЕ подписан на SubGram каналы`);

                // Показываем алерт с жёсткой блокировкой
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: ' Доступ заблокирован! Сначала подпишитесь на все спонсорские каналы!',
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
                    // Если нет ссылок, показываем общее сообщение о блокировке
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
                        // НЕ отправляем новое сообщение для избежания дублиро��ания
                    }
                }

                return; // КРИТИЧНО: немедленно завершаем обработку
            }

            // 2. НОВОЕ: Проверяем подписку на личные спонсорские каналы
            console.log(`🔍 Дополнительная проверка личных спонсорских каналов для пользователя ${userId}`);
            const personalChannelsStatus = await checkPersonalChannelsSubscription(userId, false);

            if (!personalChannelsStatus.isSubscribed && personalChannelsStatus.unsubscribedChannels.length > 0) {
                console.log(`🔒 ЖЁСТКАЯ БЛОКИРОВКА действий "${data}" - пользователь ${userId} НЕ подписан на личные каналы`);

                // По��азываем алерт о нео��ходимости подписки на личные к��налы
                await bot.answerCallbackQuery(callbackQuery.id, {
                    text: '🔒 Доступ заблокирован! Подпишитесь на наши основные каналы!',
                    show_alert: true
                });

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

                // Добавляем кнопку проверки
                personalKeyboard.inline_keyboard.push([{
                    text: '✅ Проверить подписки',
                    callback_data: 'check_subscription_personal'
                }]);

                try {
                    await bot.editMessageText(personalMessage, {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        reply_markup: personalKeyboard
                    });
                } catch (e) {
                    console.log(`⚠ Не удалось отредактировать сообщение с личными каналами: ${e.message}`);
                }

                return; // КРИТИЧНО: немедленно завершаем обработку
            }

            // Ес��и подписан на все каналы (SubGram И личные) - разре��аем дос��уп
            console.log(`✅ Пользователь ${userId} подписан на ВСЕ каналы, разрешаем доступ к команде "${data}"`);
        }

        // Блокировка доступа по яз��ковому коду (регион)
        try {
            const blocked = (config.BLOCKED_LANGUAGE_CODES || []).map(c => c.toLowerCase());
            const lang = (user?.language_code || callbackQuery.from.language_code || '').toLowerCase();
            const isBlocked = lang && blocked.includes(lang);
            const allowedWithBlock = [
                'main_menu',
                'check_subscription',
                'check_subscription_personal',
                'disabled',
                'admin_',
                'captcha_'
            ];
            const isAllowedBlockCmd = allowedWithBlock.some(cmd => cmd.endsWith('_') ? data.startsWith(cmd) : data === cmd);
            if (isBlocked && !isAllowedBlockCmd) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: '🚫 Доступ к боту ограничен в вашем регионе', show_alert: true });
                const blockedKeyboard = createBlockedMainMenuKeyboard();
                try {
                    await bot.editMessageText('🚫 Доступ к основным функциям бота ограничен в вашем регионе.\n\n🔻 Главное меню', {
                        chat_id: chatId,
                        message_id: message.message_id,
                        reply_markup: blockedKeyboard
                    });
                } catch (e) {}
                return;
            }
        } catch (e) {}

        // Отвечаем на callback_query только для команд, которые не отвечают сами
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
        ) && !data.startsWith('admin_') && !data.startsWith('withdraw_') && !data.startsWith('rating_') && !data.startsWith('approve_') && !data.startsWith('reject_') && !data.startsWith('broadcast_') && !data.startsWith('confirm_broadcast_') && data !== 'cancel_broadcast';

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
                // Ничего ��е делаем для заблокированных кнопок
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
                } else if (data.startsWith('rj_refund_') || data.startsWith('rj_norefund_')) {
                    const parts = data.split('_');
                    const refund = parts[1] === 'refund';
                    const reqId = parseInt(parts[2]);
                    pendingRejectionReasons.set(userId, { requestId: reqId, refund, chatId, messageId: message.message_id });
                    try { await bot.answerCallbackQuery(callbackQuery.id, '📝 Пришлите причину отклонения одним сообщением'); } catch (e) {}
                    await bot.sendMessage(chatId, '📝 Пришлите причину отклонения для заявки #' + reqId + ' одним сообщением.');
                } else if (data.startsWith('approve_') || data.startsWith('reject_')) {
                    await handleWithdrawalAction(chatId, userId, data, callbackQuery.id, message.message_id);
                } else if (data.startsWith('broadcast_')) {
                    const type = data.split('_')[1];
                    await handleBroadcastNew(type);
                    await bot.answerCallbackQuery(callbackQuery.id, '📢 Рассылка запущена!');
                } else if (data === 'admin_back') {
                    await showAdminPanel(chatId, message.message_id);
                    await bot.answerCallbackQuery(callbackQuery.id);
                } else if (data === 'open_case') {
                    await handleOpenCase(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data.startsWith('check_custom_task_')) {
                    const taskId = parseInt(data.split('_')[3]);
                    await handleCustomTaskCheck(chatId, userId, taskId, message.message_id, callbackQuery.id);
                } else if (data.startsWith('roulette_bet_')) {
                    const amount = parseFloat(data.split('_')[2]);
                    await handleRouletteBet(chatId, userId, amount, message.message_id, callbackQuery.id);
                } else if (data.startsWith('confirm_broadcast_')) {
                    const messageId = data.replace('confirm_broadcast_', '');
                    const messageText = pendingBroadcastMessages.get(messageId);

                    if (!messageText) {
                        await bot.answerCallbackQuery(callbackQuery.id, '❌ Сообщение истекло. Повторите попытку.');
                        return;
                    }

                    // Удаляем сообщение из вр��менного хранилища
                    pendingBroadcastMessages.delete(messageId);
                    console.log(`🗑️ Удалено обработанное сообщение рассылки: ${messageId}`);

                    await handleConfirmBroadcast(chatId, userId, messageText, message.message_id, callbackQuery.id);
                } else if (data === 'cancel_broadcast') {
                    await handleCancelBroadcast(chatId, userId, message.message_id, callbackQuery.id);
                } else if (data.startsWith('captcha_')) {
                    await handleCaptcha(chatId, userId, data, message.message_id, callbackQuery.id);
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

// Проверка ��о��писки в контексты личных каналов (с пропуском оши��ок)
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

    // Если нет ссылок для подписки - значит пользователь подписан н�� SubGram каналы
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        // Проверяем личные спонсорские канал�� (ВСЕГДА с пропуском о��ибо�� в ��том контексте)
        console.log(`🔍 Проверка личных спонсорских каналов для пользователя ${userId} (с пропуском ошибок)`);
        const personalChannelsStatus = await checkPersonalChannelsSubscription(userId, true);

        if (!personalChannelsStatus.isSubscribed && personalChannelsStatus.unsubscribedChannels.length > 0) {
            // Пользователь не подписан на личные каналы
            console.log(`🔒 Пользователь ${userId} не подписан на личные каналы`);

            // Формируем сообщение с личными каналами
            let personalMessage = '🔐 Для полного доступа к боту подпишитесь на наши основные каналы:\n\n';

            personalChannelsStatus.unsubscribedChannels.forEach((channel, index) => {
                personalMessage += `${index + 1}. ${channel.title}\n`;
            });

            personalMessage += '\n⚠ После подписки нажмите "Проверить подписки"';

            // Создаем клавиатуру с каналами
            const personalKeyboard = {
                inline_keyboard: []
            };

            // ��обавляем кнопки каналов
            personalChannelsStatus.unsubscribedChannels.forEach(channel => {
                personalKeyboard.inline_keyboard.push([{
                    text: `📢 ${channel.title}`,
                    url: channel.url
                }]);
            });

            // Добавляем кнопку проверки (для личных к��налов - пропускат�� ошибки)
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
                              ' Добро пожаловать в бота для заработка звёзд!\n\n' +
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

        // Проверяем условия дл�� засчит����вания реферала
        await checkReferralConditions(userId);
    } else {
        // Все еще есть каналы для подписки - используем ЦЕНТРАЛИЗОВАННУЮ Ф��НКЦИЮ
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

    // Если нет ссылок для подписки - значит п��льзователь подпи��ан на SubGram каналы
    if (subscriptionStatus.isSubscribed || !subscriptionStatus.subscriptionData?.links?.length) {
        // Проверяем личные спонсорские каналы (с пропускем ошибок при нажатии кнопки)
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

            // Добавляем кнопки к��нал��в
            personalChannelsStatus.unsubscribedChannels.forEach(channel => {
                personalKeyboard.inline_keyboard.push([{
                    text: `📢 ${channel.title}`,
                    url: channel.url
                }]);
            });

            // Добавляем кнопку проверки (для ��ичных каналов - пропускать ошибки)
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

        // Проверяем условия для засчиты��ания реферала
        await checkReferralConditions(userId);
    } else {
        // Все еще есть каналы для подписки - используем ЦЕНТРАЛИЗОВАННУЮ ФУНКЦИЮ
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

// Редактирование сообщения с главным меню
async function editMainMenu(chatId, messageId) {
    let isBlocked = false;
    try {
        const u = await Database.getUser(chatId);
        const lang = (u?.language_code || '').toLowerCase();
        const blocked = (config.BLOCKED_LANGUAGE_CODES || []).map(c => c.toLowerCase());
        isBlocked = lang && blocked.includes(lang);
    } catch (e) {}

    const defaultMessage = '1️⃣ Получи свою личную ссылку жми на⭐ Заработать звезды»\n\n' +
                   '2️⃣ Приглашай друзей — 3⭐️ за каждого!\n\n' +
                   '✅ Дополнительно:\n' +
                   '> — Ежедневные награды и промокоды (Профиль)\n' +
                   '> — Выполняй задания\n' +
                   '> — Участвуй в лотереях и выигрывай!\n' +
                   '> — Участвуй в конкурсе на топ\n\n' +
                   '🔻 Главное меню';

    const message = isBlocked ? '🚫 Доступ к основным функциям бота ограничен в вашем регионе.\n\n🔻 Главное меню' : defaultMessage;
    const keyboard = isBlocked ? createBlockedMainMenuKeyboard() : createMainMenuKeyboard();

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

// Показать профиль
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

// Показать подробную информацию о рефералах
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
            activatedReferrals.slice(0, 10).forEach((referral, index) => { // показывает только первые 10
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
            message += `• Все рефералы активированы! \n`;
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
        message += `💰 За каждого активированного реферала вы получаете 3 ⭐`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '◀️ Назад к профилю', callback_data: 'profile' }],
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

// Показать информацию о приглашениях
async function showInviteInfo(chatId, userId, messageId) {
    const user = await Database.getUser(userId);
    const botUsername = (await bot.getMe()).username;
    const referralLink = `https://t.me/${botUsername}?start=${userId}`;
    
    const message = `💫 Зарабатывай с друзьями!\n\n` +
                   `🚀 Приглашай друзей и получай крутые награды!\n\n` +
                   `💸 За каждого активного друга: 3⭐️!\n\n` +
                   `🎆 Как получить награду:\n` +
                   `• 📱 Друг подписывается на спонсоров\n` +
                   `• ✅ Выполняет 2 простых задания\n\n` +
                   `🔗 Твоя магическая ссылка:\n➡️ ${referralLink}\n\n` +
                   `📈 Твои достижения:\n` +
                   `👥 Общие рефералы: ${user.total_referrals}\n` +
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

// ��оказать клике��
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
        const requiredWait = nextClickDelay * 60 * 1000; // в ми��лисекундах
        
        if (timeSinceLastClick < requiredWait) {
            canClick = false;
            timeToWait = Math.ceil((requiredWait - timeSinceLastClick) / 1000 / 60);
        }
    }
    
    const message = `🖱 Кликер\n\n` +
                   ` За клик: 0.1 звезды\n` +
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
            [{ text: '◀️ В главное меню', callback_data: 'main_menu' }]
        ]
    };
    
    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Получить расширенную ин��ормацию о пользователе для заявки на вывод (с реальными данным�� о подписках)
async function getUserWithdrawalInfo(userId) {
    try {
        // Основн��е данные поль��ователя
        const user = await Database.getUser(userId);
        if (!user) return { sponsor_subscriptions: 0, referrals_subscriptions: 0, referral_stats: { activated_referrals: 0, non_activated_referrals: 0 } };

        // Статистика рефералов
        const referralStats = await Database.getReferralStats(userId);

        // Реальные данные о п��дписках пользователя из webhook кеша
        const userSubscriptionStatus = webhookHandler.getUserSubscriptionStatus(userId);
        let userSubscriptions = 0;

        if (userSubscriptionStatus.lastUpdate && userSubscriptionStatus.isSubscribed !== null) {
            // Если есть свежие данные о подписках
            const subscribedCount = userSubscriptionStatus.subscribedCount || 0;
            const totalChannels = userSubscriptionStatus.totalLinks || 0;
            userSubscriptions = subscribedCount; // реальное количество подписок
            console.log(`📈 Пользователь ${userId}: реальные подписки ${subscribedCount}/${totalChannels}`);
        } else {
            // Оценка ��а основе статуса активации
            userSubscriptions = user.referral_completed ? 4 : 0; // если активирован, то подписан на спонсоров
            console.log(`📈 Пользователь ${userId}: оценка подписок ${userSubscriptions} (нет свежих данных)`);
        }

        // Подсчитываем подписки активирова��ных рефералов
        let referralsSubscriptions = 0;
        const activatedReferrals = await Database.getActivatedReferrals(userId);

        // Проверяем реальные да��ные �� подписках каждого акти��ного реферала
        for (const referral of activatedReferrals) {
            const referralSubscriptionStatus = webhookHandler.getUserSubscriptionStatus(referral.user_id);
            if (referralSubscriptionStatus.lastUpdate && referralSubscriptionStatus.subscribedCount) {
                referralsSubscriptions += referralSubscriptionStatus.subscribedCount;
            } else {
                // Оценка: активные рефералы подписаны на ~4 канала
                referralsSubscriptions += 4;
            }
        }

        console.log(`📈 Пользователь ${userId}: подписки рефералов ${referralsSubscriptions} (за ${activatedReferrals.length} активных рефералов)`);

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

// Обраб��тка клика
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
        text: '🏠 В Главное меню',
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

    // НОВОЕ ОГРАНИЧЕНИЕ: минимум 5 активированных рефералов для вывода
    const referralStats = await Database.getReferralStats(userId);
    if (referralStats.activated_referrals < 5) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ для вывода нужно минимум 5 активированных рефералов!');

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
        
        // Создаем з��явку
        const request = await Database.createWithdrawalRequest(userId, amount);
        
        // Получаем расширенную информацию с реальными данными о подписках
        const userInfo = await getUserWithdrawalInfo(userId);

        // Получаем последних 5 рефералов
        const recentReferrals = await Database.getRecentReferrals(userId, 5);

        let referralsInfo = '';
        if (recentReferrals.length > 0) {
            referralsInfo = `\n\n📋 Последние 5 рефералов:\n`;
            recentReferrals.forEach((referral, index) => {
                const name = referral.first_name || 'Неизвестен';
                const username = referral.username ? `@${referral.username}` : '';
                const date = new Date(referral.created_at).toLocaleDateString('ru-RU');
                const status = referral.referral_completed ? '✅' : '⏳';
                referralsInfo += `${index + 1}. ${status} ${name} ${username} (${date})\n`;
            });
        } else {
            referralsInfo = `\n\n📋 Рефералов пока нет`;
        }

        // Отправляем в админ чат расширенную информацию
        const adminMessage = `💰 Новая заявка на вывод\n\n` +
                            `👤 Пользователь: ${user.first_name}\n` +
                            `🆔 ID: ${user.user_id}\n` +
                            `📱 Username: @${user.username || 'отсутствует'}\n` +
                            `💰 Сумма: ${amount} звёзд\n` +
                            `💎 Остаток: ${user.balance - amount} звёзд\n` +
                            `💎 Всего заработано: ${user.total_earned} звёзд\n\n` +
                            `📊 Подписки на спонсорские каналы (реальные данные):\n` +
                            `👤 Пользователь: ${userInfo.sponsor_subscriptions} подписок\n` +
                            `👥 Его рефералы: ${userInfo.referrals_subscriptions} подписок\n\n` +
                            `👥 Рефералы:\n` +
                            `✅ Активированные: ${userInfo.referral_stats?.activated_referrals || 0}\n` +
                            `⏳ Неактивированные: ${userInfo.referral_stats?.non_activated_referrals || 0}\n` +
                            `📈 За сегодня: ${user.daily_referrals}${referralsInfo}\n\n` +
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

// Показать задания (только кастомные, ��ез SubGram)
async function showTasks(chatId, userId, messageId) {
    try {
        console.log(`📋 ФУНКЦИЯ showTasks ВЫЗВАНА для пользователя ${userId}`);

        // Получаем только кастомные задания (не SubGram)
        const customTasks = await Database.getTasks(false); // false = не SubGram задания
        console.log(`🔍 НАЙДЕНО КАСТОМНЫХ ЗАДАНИЙ: ${customTasks.length}`);
        
        // Ищем первое невыполненное кастомные задание
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
            // Показываем ����астомное задание
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
                ].filter(row => row.length > 0) // Убиваем пу����тые строки
            };
            
            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: keyboard
            });
        } else {
            console.log(`НЕТ ДОСТУПНЫХ ЗАДАНИЙ`);
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
                   `• Приглашайте друзей по твоей ссылке\n` +
                   `• За каждого реферала: 3 звезды\n` +
                   `• Реферал засчитывается после подписки на спонсоров и выполнения 2 заданий\n\n` +
                   `🖱 Кликер:\n` +
                   `• Кликайте до 10 раз в день\n` +
                   `• За клик: 0.1 звезды\n` +
                   `• Время ожидания увеличивается\n\n` +
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

// Показать рейтинги
async function showRatings(chatId, messageId) {
    const message = `🏆 Рейтинги\n\n` +
                   `📊 Выберите тип рейтинга:`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: '🌟 Общий рейтинг', callback_data: 'rating_overall' }],
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

// Показ��ть кейсы
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
            message += `🏆 Победителей: ${lottery.winners_count}\n\n`;
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

    const message = `🎰 Рулетка\n\n` +
                   `💰 Ваш баланс: ${user.balance} звёзд\n\n` +
                   `🎯 Правила:\n` +
                   `• Выберите сумму ставки\n` +
                   `• При выигрыше ставка удваивается\n` +
                   `• При проигрыше теряете ставку\n` +
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
        text: '◀️ В главное меню',
        callback_data: 'main_menu'
    }]);

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// Обработка ста��ки в рулетке
async function handleRouletteBet(chatId, userId, amount, messageId, callbackQueryId) {
    try {
        const user = await Database.getUser(userId);

        if (user.balance < amount) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Недостаточно средств!');
            return;
        }

        // ИСПРАВЛЕНЫ: используем честную случайн��сть вместо предсказуемого счетчика
        // Шанс выигрыша 15% (справедливая рул��тка)
        const isWin = Math.random() < 0.15;

        if (isWin) {
            // Выигрыш - удваиваем ставку
            const winAmount = amount * 2;
            await Database.updateUserBalance(userId, winAmount - amount); // +amount (возврат ставки) + amount (выигрыш)
            await Database.updateUserPoints(userId, 2);

            const message = `🎉 ВЫИГРЫШ!\n\n` +
                           `💰 Ставка: ${amount} звёзд\n` +
                           `🏆 Выигрыш: ${winAmount} звёзд\n` +
                           `💎 Ваш баланс: ${user.balance + winAmount - amount} звёзд\n` +
                           `🎊 +2 очки!\n\n` +
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
                           `💰 Ваш баланс: ${user.balance - amount} звёзд\n\n` +
                           `🍀 Не расстраивайтесь, попробуйте ещё раз!`;

            await bot.editMessageText(message, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎰 Играть снова', callback_data: 'roulette' }],
                        [{ text: '◀️ В главное меню', callback_data: 'main_menu' }]
                    ]
                }
            });

            await bot.answerCallbackQuery(callbackQueryId, ` Проигрыш ${amount} звёзд`);
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
        console.log(`✅ Проверка выполнения кастомного задания ${taskId} для пользователя ${userId}`);

        // Проверяем есть ли задание
        const tasks = await Database.getTasks(false);
        const task = tasks.find(t => t.id === taskId);
        
        if (!task) {
            await bot.answerCallbackQuery(callbackQueryId, '❌ Задание не найдено');
            return;
        }

        // Проверяем ��е выполнено л�� уже
        const isCompleted = await Database.isTaskCompleted(userId, taskId);
        if (isCompleted) {
            await bot.answerCallbackQuery(callbackQueryId, '✅ Задание уже выполнено!');
            await showTasks(chatId, userId, messageId);
            return;
        }

        // Проверяем, если это задание на подписку канала
        if (task.link && (task.link.includes('t.me/') || task.link.startsWith('@'))) {
            console.log(`🔍 Проверяем подписку на канал для задания: ${task.link}`);

            try {
                // Нормализуем ссылку канала
                const channelData = normalizeChannelIdentifier(task.link);

                // Проверя����м подписку
                const member = await bot.getChatMember(channelData.identifier, userId);

                if (member.status === 'left' || member.status === 'kicked') {
                    await bot.answerCallbackQuery(callbackQueryId, '❌ Сначала подпишитесь на канал!');

                    // Показываем сообщение о необходимости подписки
                    const subscriptionMessage = `❌ Не выполнено!\n\n` +
                                               `📝 Задание: ${task.title}\n\n` +
                                               `⚠️ Для выполнения задания необходимо подписаться на канал.\n\n` +
                                               `🔗 Подпишитесь на канал и нажмите "Проверить выполнение" снова.`;

                    const subscriptionKeyboard = {
                        inline_keyboard: [
                            [{ text: '📢 Перейти к каналу', url: channelData.url }],
                            [{ text: '✅ Проверить выыолнение', callback_data: `check_custom_task_${taskId}` }],
                            [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
                        ]
                    };

                    await bot.editMessageText(subscriptionMessage, {
                        chat_id: chatId,
                        message_id: messageId,
                        reply_markup: subscriptionKeyboard
                    });

                    return;
                }

                console.log(`✅ Пользователь ${userId} подписан на канал ${channelData.identifier}`);

            } catch (subscriptionError) {
                console.error(`Ошибка проверки подписки для задания:`, subscriptionError.message);

                // Если не удалось проверить подписку (например, канал не найден), продолжаем выполнение задания
                console.log('⚠️ Не удалось проверить подписку, продолжаем выполнение задания');
            }
        }

        // Отмечаем как выполненное
        await Database.completeTask(userId, taskId);
        
        // Начисляем награду
        await Database.updateUserBalance(userId, task.reward);
        await Database.updateUserPoints(userId, 1);

        await bot.answerCallbackQuery(callbackQueryId, `🎉 +${task.reward} звёзд! +1 очко!`);

        // Пр��веряем условия для реферала
        await checkReferralConditions(userId);

        // Показываем слебующее задание или сообщение о завершении
        await showTasks(chatId, userId, messageId);

    } catch (error) {
        console.error('Ошибка проверки частомного задания:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка проверки задания');
    }
}


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
    const message = '‍Админ-панель\n\nВыберите действие:';

    const keyboard = {
        inline_keyboard: [
            [{ text: '📊 Статистика бота', callback_data: 'admin_stats' }],
            [{ text: '   Управление заданиями', callback_data: 'admin_tasks' }],
            [{ text: '🎲 Управление лотереями', callback_data: 'admin_lottery' }],
            [{ text: '🎫 Управление промокодами', callback_data: 'admin_promocodes' }],
            [{ text: '📢 Рассылка сообщений', callback_data: 'admin_broadcast' }],
            [{ text: '🏆 Недельные награды', callback_data: 'admin_rewards' }],
            [{ text: '💰 Заявки на вывод', callback_data: 'admin_withdrawals' }],
            [{ text: '🔢 Нумерация заявок', callback_data: 'admin_withdrawal_numbering' }],
            [{ text: '📺 Спонсорские каналы', callback_data: 'admin_sponsor_channels' }]
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

// Обр��ботчик админс��их действий
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
        case 'admin_withdrawal_numbering':
            await showWithdrawalNumbering(chatId, messageId);
            break;
        case 'admin_broadcast_all':
            await startBroadcastMessage(chatId, userId);
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
        case 'admin_sponsor_channels':
            await showSponsorChannelsAdmin(chatId, messageId);
            break;
        case 'admin_sponsor_top':
            await showSponsorChannelsTop(chatId, messageId);
            break;
        case 'admin_sponsor_sync':
            await syncSponsorChannelsFromConfig(chatId, messageId, callbackQueryId);
            return; // Не отве��аем на callback здесь, так как функция сама отвечает
    }

    await bot.answerCallbackQuery(callbackQueryId);
}

// Пок��зать статистику бота
async function showBotStats(chatId, messageId) {
    try {
        const totalUsers = await Database.pool.query('SELECT COUNT(*) as count FROM users');
        const totalStarsEarned = await Database.pool.query('SELECT SUM(total_earned) as sum FROM users');
        const totalWithdrawals = await Database.pool.query('SELECT SUM(amount) as sum FROM withdrawal_requests WHERE status = \'approved\'');
        const pendingWithdrawals = await Database.pool.query('SELECT COUNT(*) as count, SUM(amount) as sum FROM withdrawal_requests WHERE status = \'pending\'');
        const activatedReferrals = await Database.pool.query('SELECT COUNT(*) as count FROM users WHERE referral_completed = TRUE');
        const todayUsers = await Database.pool.query('SELECT COUNT(*) as count FROM users WHERE DATE(created_at) = CURRENT_DATE');

        // Дополнительная статистика по подписка��
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

// Управление задан��ями
async function showAdminTasks(chatId, messageId) {
    const message = ` Управление заданиями\n\n` +
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

// Показать адм��нскую рассылку
async function showAdminBroadcast(chatId, messageId) {
    const message = ` Рассылка сообщений\n\n` +
                   `Выберите готовое сообщение для рассылки всем пользователям:`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🏆 Напоминание о рейтинге', callback_data: 'broadcast_rating' }],
            [{ text: '📋 Уведомление о заданиях', callback_data: 'broadcast_tasks' }],
            [{ text: '📝 Отправить сообщение всем', callback_data: 'admin_broadcast_all' }],
            [{ text: '🔙 Назад к админ-панели', callback_data: 'admin_back' }]
        ]
    };

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard
    });
}

// По��азать управление наградами
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
                // Получаем расширенную информацию о пользователе
                const userInfo = await getUserWithdrawalInfo(request.user_id);

                message += `📄 Заявка #${request.id}\n`;
                message += `👤 ${request.first_name} (@${request.username || 'нет'})\n`;
                message += `🆔 ID: ${request.user_id}\n`;
                message += `💰 Сумма: ${request.amount} звёзд\n`;
                message += `💎 Остаток: ${request.balance} звёзд\n`;
                message += `📊 Подписки: ${userInfo.sponsor_subscriptions} личных + ${userInfo.referrals_subscriptions} рефералов\n`;
                message += `👥 Рефералы: ${userInfo.referral_stats?.activated_referrals || 0} активных\n`;
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

// Показать управ��ение промок��дами
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

// Показат�� управление нумерац��ей заявок
async function showWithdrawalNumbering(chatId, messageId) {
    try {
        // Полу��аем текущее зна��ение последовательности создания заявок
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
                       `• Следующая заявка: #${nextRequestId}\n\n` +
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
        console.error('Ошибка показа нумерации заявок:', error);

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

// Обработчик установки номера закрытых заявок (для платежного ча��а)
async function handleSetClosureNumber(chatId, userId, startNumber, messageId, callbackQueryId) {
    try {
        console.log(`🔢 Установка начального номера закрытых заявок: ${startNumber} (админ: ${userId})`);

        const result = await Database.setWithdrawalClosureStartNumber(startNumber);

        if (result.success) {
            const successMessage = `✅ Номер закрытых заявок успешно установлен!\n\n` +
                                 `📊 Изменения:\n` +
                                 `• Последовательность установлена на: ${result.newValue}\n` +
                                 `• Следующая закрытая заявка получит номер: ${result.nextClosureNumber}\n\n` +
                                 `ℹ️ Это влияет только на нумерацию в платежном чате`;

            await bot.answerCallbackQuery(callbackQueryId, `✅ Установлен номер ${startNumber}!`);

            // Обновляем интерфейс
            await showWithdrawalNumbering(chatId, messageId);

            // Уведомляе�� админа в чат
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
            const successMessage = ` Номер заявок успешно установлен!\n\n` +
                                 `📊 Изменения:\n` +
                                 `• Предыдущий номер: ${result.previousValue}\n` +
                                 `• Новый номер: ${result.newValue}\n` +
                                 `• Следующая заявка получит номер: ${result.nextWithdrawalId}`;

            await bot.answerCallbackQuery(callbackQueryId, `✅ Установлен номер ${startNumber}!`);

            // Обновляем интерфейс
            await showWithdrawalNumbering(chatId, messageId);

            // Уведомляе�� админа в чат
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
        console.error('Ошибка установки номера заявок:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Произошла ошибка');
    }
}

// Обработчик открытия кей��а (упрощенная версия)
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
        
        // Об��овляем дату открытия ке��са
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

// Обр��б��тчик заявок на вывод с упиранием кнопок и отправкой в платежный чат
async function handleWithdrawalAction(chatId, userId, data, callbackQueryId, messageId) {
    // Проверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    try {
        console.log(`🔍 НАЧАЛО ОБРАБОТКИ ЗАЯВКИ: data=${data}, userId=${userId}, chatId=${chatId}`);

        const [action, requestId] = data.split('_');
        const id = parseInt(requestId);
        console.log(`📋 Парсинг данных: action=${action}, requestId=${requestId}, id=${id}`);

        // Получаем информацию о заявке перед обработкой
        console.log(`🔍 Получаем заявку из БД: id=${id}`);
        const request = await Database.pool.query('SELECT * FROM withdrawal_requests WHERE id = $1', [id]);
        if (request.rows.length === 0) {
            console.log(`❌ Заявка не найдена в БД: id=${id}`);
            await bot.answerCallbackQuery(callbackQueryId, '❌ Заявка не найдена');
            return;
        }

        const requestData = request.rows[0];
        console.log(` Заявка найдена:`, requestData);

        console.log(`🔍 Получаем данные пользователя: userId=${requestData.user_id}`);
        const user = await Database.getUser(requestData.user_id);
        console.log(`✅ Данные пользователя:`, user ? 'найдены' : 'НЕ найдены');

        if (action === 'approve') {
            console.log(`✅ ОБРАБОТКА ОДОБРЕНИЯ заявки: id=${id}`);
            // Одо��ряем заявку
            console.log(`🔄 Вызываем Database.processWithdrawal для одобрения...`);
            await Database.processWithdrawal(id, 'approved');
            console.log(`✅ Database.processWithdrawal выполнен успешно`);

            // УБИРАЕМ КНОПКИ из ад��инского сообщения
            try {
                await bot.editMessageReplyMarkup(null, {
                    chat_id: chatId,
                    message_id: messageId
                });

                // Добавля��м статус к тексту ��ообщения
                const originalText = await bot.getChat(chatId).then(() => "Заявка обработана");
                await bot.editMessageText(`${originalText}\n\n✅ ЗАЯВКА ОДОБРЕНА`, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (e) {
                console.log('Не удалось отредактировать админское сообщение');
            }

            // Отправляем в чат пла��ежей С НОМЕРОМ ЗАЯВКИ И КНОПКАМИ
            console.log(`💰 ОТПРАВКА В ПЛАТЕЖНЫЙ ЧАТ (APPROVE): ${config.PAYMENTS_CHAT_ID}`);
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

            console.log(`📤 Отправляем сообщение о выполнении в платежный чат...`);
            try {
                await bot.sendMessage(config.PAYMENTS_CHAT_ID, paymentMessage, {
                    reply_markup: paymentKeyboard
                });
                console.log(`✅ Сообщение о выполнении отправлено успешно`);
            } catch (paymentError) {
                console.error(`❌ Ошика отправки в платежный чат (APPROVE):`, paymentError.message);
                // Уведомляем админа об ошибке
                try {
                    await bot.sendMessage(chatId, `⚠️ Заявка одобрена в базе, но не удалось отправить в чат платежей:\n${paymentError.message}`);
                } catch (e) {}
            }

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
            console.log(`❌ НАЧАЛО ПРОЦЕССА ОТКЛОНЕНИЯ заявки: id=${id}`);

            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '❌ Отклонить с возвратом звёзд', callback_data: `rj_refund_${id}` }
                    ],
                    [
                        { text: '🚫 Отклонить без возврата', callback_data: `rj_norefund_${id}` }
                    ],
                    [
                        { text: '🔙 Назад', callback_data: 'admin_withdrawals' }
                    ]
                ]
            };

            try {
                await bot.answerCallbackQuery(callbackQueryId, 'Выберите вариант отклонения');
            } catch (e) {}

            try {
                await bot.editMessageReplyMarkup(keyboard, {
                    chat_id: chatId,
                    message_id: messageId
                });
            } catch (e) {
                console.log('Не удалось обновить клавиатуру для выбора отклонения:', e.message);
            }

            return;
        }

    } catch (error) {
        console.error('❌ ДЕТАЛИ ОШИБКИ ОБРАБОТКИ ЗАЯВКИ:', {
            error: error.message,
            stack: error.stack,
            data: data,
            chatId: chatId,
            userId: userId,
            messageId: messageId
        });

        // Более подробное сообщение для админов
        let errorMessage = '❌ Ошибка обработки';
        if (error.message.includes('chat not found')) {
            errorMessage = '❌ Чат для платежей не найден';
        } else if (error.message.includes('bot is not')) {
            errorMessage = '❌ Бот не добавлен в чат';
        } else if (error.message.includes('insufficient rights')) {
            errorMessage = '❌ Недостаточно прав в чате';
        }

        await bot.answerCallbackQuery(callbackQueryId, errorMessage);
    }
}


// Функция для ��ачала создания кастомной рассылки
async function startBroadcastMessage(chatId, userId) {
    const message = '📝 Отправка сообщения всем пользователям\n\n' +
                   'Напишите сообщение, которое будет отправлено всем пользователям бота.\n\n' +
                   '⚠️ Будьте осторожны! Сообщение будет отправлено ВСЕМ активным пользователям.\n\n' +
                   'Отправьте /cancel для отмены.';

    broadcastStates.set(userId, { waiting: true, chatId: chatId });
    console.log(`🎯 Установили состояние рассылки для пользователя ${userId}`);
    console.log(`📊 Всего активных состояний рассылки: ${broadcastStates.size}`);

    await bot.sendMessage(chatId, message);
}

// Функция для отправки кастомного сообщения всем пользователям
async function sendCustomBroadcast(messageText, adminUserId) {
    try {
        const users = await Database.pool.query('SELECT user_id FROM users WHERE user_id != $1', [adminUserId]);
        let successCount = 0;
        let failCount = 0;

        console.log(`📢 Начинаем рассылку кастомного сообщения ${users.rows.length} пользователям`);

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.user_id, messageText);
                successCount++;

                // Небольшая задержка ��е��ду отпр��вками для избежания лимитов
                if (successCount % 20 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                failCount++;
                console.log(`❌ Не удалось отправить сообщение пользователю ${user.user_id}: ${error.message}`);
            }
        }

        // Отправля��м отчет админу
        const reportMessage = ` Отчет о кастомной рассылке:\n\n` +
                             `✅ Успешно отправлено: ${successCount}\n` +
                             `❌ Не удалось отправить: ${failCount}\n` +
                             `📈 Общий охват: ${successCount}/${users.rows.length} пользователей`;

        await bot.sendMessage(adminUserId, reportMessage);
        console.log(`✅ Кастомная рассылка завершена: ${successCount} успешно, ${failCount} ошибок`);

    } catch (error) {
        console.error('❌ Ошибка при кастомной рассылке:', error);
        await bot.sendMessage(adminUserId, '❌ Произошла ошибка при отправке рассылки.');
    }
}

// О��работчик подтверждения рассылки
async function handleConfirmBroadcast(chatId, userId, messageText, messageId, callbackQueryId) {
    // Проверка админских прав
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    await bot.answerCallbackQuery(callbackQueryId, '📢 Рассылка запущена!');

    // Обновляем сообщение
    await bot.editMessageText('⚙️ Рассылка запущена... Ожидайте отчет.', {
        chat_id: chatId,
        message_id: messageId
    });

    // Запускаем рассылку
    await sendCustomBroadcast(messageText, userId);
}

// Обработчик отмены рассылки
async function handleCancelBroadcast(chatId, userId, messageId, callbackQueryId) {
    await bot.answerCallbackQuery(callbackQueryId, '❌ Рассылка отменена');

    await bot.editMessageText('❌ Рассылка отменена.', {
        chat_id: chatId,
        message_id: messageId
    });
}

// Обработчик рассылки (упрощенная версия)
async function handleBroadcast(type) {
    console.log(` Рассылка типа ${type} (функция будет добавлена позже)`);
}

// Улу��шенный обработчик рассылки с готовы��и сообщениями
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
            message = `📋 Новых задания уже ждут тебя!\n\n` +
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
            console.log('Не удалось отправить отчет о рассылке админа');
        }

    } catch (error) {
        console.error('Ошибка рассылки:', error);
    }
}

// Cron зада��и

// ��жедневный сброс счетчиков в 00:00 МСК
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

// Еженедельный сброс подписок в п��недельник в 03:03 МСК
cron.schedule('3 3 * * 1', async () => {
    console.log('🕛 Еженедельный сброс подписок...');
    try {
        // Очииаем кеш подписок webhook handler
        webhookHandler.userSubscriptionCache.clear();
        console.log('✅ Кеш подписок очищен');

        // Сбр��сываем weekly_points для неде��ьного рейтинга
        await Database.pool.query('UPDATE users SET weekly_points = 0');
        console.log('✅ Недельные очки сброшены');
    } catch (error) {
        console.error('❌ Ошибка еженедельного сброса:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// Еженедельное начислен��е наград (Воскресенье в 20:00 МСК)
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
                        `🏆 Поздравляем!\n\n` +
                        `Вы заняли ${position} место в недельном рейтинге!\n` +
                        `💰 Награда: ${reward} звёзд`
                    );
                } catch (e) {
                    console.log(`Не удалось отправить награду пользователю ${user.user_id}`);
                }
            }
        }

        console.log('✅ Еженедельные награды начислены');
    } catch (error) {
        console.error('❌ Ошибка начисления еженедельных наград:', error);
    }
}, {
    timezone: "Europe/Moscow"
});

// ==================== SPONSOR CHANNELS ADMIN INTERFACE ====================

// Показать админ интерфейс спо���сорских кана��ов
async function showSponsorChannelsAdmin(chatId, messageId) {
    try {
        const channels = await Database.getAllSponsorChannels();
        const totalChannels = channels.length;
        const activeChannels = channels.filter(c => c.is_enabled).length;
        const totalChecks = channels.reduce((sum, c) => sum + c.total_checks, 0);
        const totalUniqueUsers = channels.reduce((sum, c) => sum + c.unique_users_count, 0);

        let message = `📺 Управление спонсорскими каналами\n\n`;
        message += `📊 Общая статистика:\n`;
        message += `• Всего каналов: ${totalChannels}\n`;
        message += `• Активных: ${activeChannels}\n`;
        message += `• Всего проверок: ${totalChecks}\n`;
        message += `• Уникальных пользователей: ${totalUniqueUsers}\n\n`;

        if (channels.length === 0) {
            message += `ℹ️ Нет зарегистрированных каналов`;
        } else {
            message += `📋 Список каналов:\n`;
            channels.slice(0, 10).forEach((channel, index) => {
                const status = channel.is_enabled ? '✅' : '❌';
                const uniqueRate = channel.total_checks > 0 ?
                    Math.round((channel.unique_users_count / channel.total_checks) * 100) : 0;

                message += `${index + 1}. ${status} ${channel.channel_title}\n`;
                message += `   📊 ${channel.total_checks} проверок (${channel.unique_users_count} уник., ${uniqueRate}%)\n`;
            });

            if (channels.length > 10) {
                message += `\n... и ещё ${channels.length - 10} каналов`;
            }
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '📊 Топ каналов', callback_data: 'admin_sponsor_top' }],
                [{ text: '🔄 Синхронизировать с config', callback_data: 'admin_sponsor_sync' }],
                [{ text: '🔙 Назад в админ панель', callback_data: 'admin_back' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа спонсорских каналов:', error);
        await bot.editMessageText('❌ Ошибка загрузки данных о спонсорских каналах', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_back' }]]
            }
        });
    }
}

// Показать топ спонсорских каналов
async function showSponsorChannelsTop(chatId, messageId) {
    try {
        const topChannels = await Database.getTopSponsorChannels(15);

        let message = `🏆 Топ спонсорских каналов\n\n`;

        if (topChannels.length === 0) {
            message += `ℹ️ Нет данных о каналах`;
        } else {
            topChannels.forEach((channel, index) => {
                const position = index + 1;
                const emoji = position <= 3 ? ['🥇', '🥈', '🥉'][position - 1] : `${position}.`;
                const status = channel.is_enabled ? '✅' : '❌';
                const uniqueRate = channel.uniqueness_rate || 0;

                message += `${emoji} ${status} ${channel.channel_title}\n`;
                message += `   📊 ${channel.total_checks} проверок | ${channel.unique_users_count} уник. | ${uniqueRate}%\n\n`;
            });
        }

        const keyboard = {
            inline_keyboard: [
                [{ text: '🔙 Назад к каналам', callback_data: 'admin_sponsor_channels' }]
            ]
        };

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Ошибка показа типа каналов:', error);
        await bot.editMessageText('❌ Ошибка загрузки топа каналов', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_sponsor_channels' }]]
            }
        });
    }
}

// Синхронизировать каналы из конфига с баз��й данных
async function syncSponsorChannelsFromConfig(chatId, messageId, callbackQueryId) {
    try {
        await bot.answerCallbackQuery(callbackQueryId, '🔄 Синхронизируем...');

        const configChannels = config.PERSONAL_SPONSOR_CHANNELS || [];
        let addedCount = 0;
        let updatedCount = 0;
        let errorCount = 0;

        for (const channelInput of configChannels) {
            try {
                const channelData = normalizeChannelIdentifier(channelInput);
                const existingChannel = await Database.getSponsorChannelStats(channelData.identifier);

                if (existingChannel) {
                    // ����бновляем существующий канал
                    await Database.addOrUpdateSponsorChannel(
                        channelData.identifier,
                        channelData.title,
                        channelData.url,
                        true
                    );
                    updatedCount++;
                } else {
                    // Добавляем новый канал
                    await Database.addOrUpdateSponsorChannel(
                        channelData.identifier,
                        channelData.title,
                        channelData.url,
                        true
                    );
                    addedCount++;
                }
            } catch (error) {
                console.error(`Ошибка синхронизации канала ${channelInput}:`, error.message);
                errorCount++;
            }
        }

        const resultMessage = `✅ Синхронизация завершена!\n\n` +
                             `📊 Результаты:\n` +
                             `• Добавлено новых: ${addedCount}\n` +
                             `• Обновлено: ${updatedCount}\n` +
                             `• Ошибок: ${errorCount}\n\n` +
                             ` Всего в config: ${configChannels.length} каналов`;

        await bot.editMessageText(resultMessage, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к каналам', callback_data: 'admin_sponsor_channels' }]
                ]
            }
        });
    } catch (error) {
        console.error('Ошибка синхронизации каналов:', error);
        await bot.answerCallbackQuery(callbackQueryId, '❌ Ошибка синхронизации');
        await bot.editMessageText('❌ Произошла ошибка при синхронизации каналов', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Назад', callback_data: 'admin_sponsor_channels' }]]
            }
        });
    }
}

// Добавляем обработчики для новых команд сп��нсорских каналов
async function handleSponsorChannelsAdminCallback(chatId, userId, data, messageId, callbackQueryId) {
    if (!config.ADMIN_IDS.includes(userId)) {
        await bot.answerCallbackQuery(callbackQueryId, '❌ Нет прав');
        return;
    }

    switch (data) {
        case 'admin_sponsor_top':
            await showSponsorChannelsTop(chatId, messageId);
            await bot.answerCallbackQuery(callbackQueryId);
            break;
        case 'admin_sponsor_sync':
            await syncSponsorChannelsFromConfig(chatId, messageId, callbackQueryId);
            break;
        default:
            await bot.answerCallbackQuery(callbackQueryId);
    }
}

// Инициализация
initBot();

module.exports = { bot };
