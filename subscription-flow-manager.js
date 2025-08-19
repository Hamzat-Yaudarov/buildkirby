/**
 * Менеджер поэтапных подписок
 * Обеспечивает правильный flow: Спонс��ры → Обязательные каналы → Главное меню
 * Блокирует функции до полной подписки на ВСЕ каналы
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Этапы подписки
 */
const SUBSCRIPTION_STAGES = {
    SPONSORS: 'sponsors',      // Спонсорские каналы от SubGram
    REQUIRED: 'required',      // Обязательные каналы
    COMPLETED: 'completed'     // Все подписки выполнены
};

/**
 * Получить каналы для проверки (без определения этапа)
 * @param {number} userId - ID пользователя
 * @returns {Object} Объект с каналами
 */
async function getCurrentSubscriptionStage(userId) {
    try {
        console.log(`[FLOW] Getting channels for user ${userId}`);

        // 1. Получаем спонсорские каналы от SubGram
        const sponsorChannels = await getSponsorChannels(userId);

        // 2. Получаем обязательные каналы
        const requiredChannels = await getRequiredChannels();

        console.log(`[FLOW] Found ${sponsorChannels.length} sponsor channels, ${requiredChannels.length} required channels`);

        return {
            sponsorChannels: sponsorChannels,
            requiredChannels: requiredChannels,
            // Эти поля будут заполнены в updateSubscriptionStage
            stage: null,
            sponsorStatus: null,
            requiredStatus: null,
            allCompleted: false,
            nextAction: null,
            channelsToShow: []
        };

    } catch (error) {
        console.error('[FLOW] Error getting channels:', error);
        return {
            sponsorChannels: [],
            requiredChannels: [],
            stage: SUBSCRIPTION_STAGES.SPONSORS,
            nextAction: 'subscribe_sponsors',
            allCompleted: false,
            channelsToShow: [],
            error: error.message
        };
    }
}

/**
 * Получить спонсорские каналы от SubGram
 * @param {number} userId - ID пользователя
 * @returns {Array} Список спонсорских каналов
 */
async function getSponsorChannels(userId) {
    try {
        // Проверяем настройки SubGram
        const subgramSettings = await db.getSubGramSettings();
        if (!subgramSettings || !subgramSettings.enabled) {
            console.log('[FLOW] SubGram disabled, no sponsor channels');
            return [];
        }

        // Проверяем сохраненные каналы (не старше 1 часа)
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '1 hour'
            ORDER BY created_at DESC
        `, [userId]);

        if (savedChannels.rows && savedChannels.rows.length > 0) {
            console.log(`[FLOW] Found ${savedChannels.rows.length} saved sponsor channels`);
            
            // Убираем дубликаты по ссылке
            const uniqueChannels = new Map();
            savedChannels.rows.forEach(ch => {
                if (!uniqueChannels.has(ch.channel_link)) {
                    uniqueChannels.set(ch.channel_link, ch);
                }
            });

            return Array.from(uniqueChannels.values()).map(ch => ({
                id: ch.channel_link,
                name: ch.channel_name || 'Спонсорский канал',
                link: ch.channel_link,
                type: 'subgram', // Правильный тип для SubGram каналов
                subscribed: false // Будет проверено отдельно
            }));
        }

        // Запрашиваем новые каналы у SubGram
        console.log('[FLOW] Requesting fresh sponsor channels from SubGram...');
        const subgramResponse = await subgramAPI.requestSponsors({
            userId: userId.toString(),
            chatId: userId.toString(),
            maxOP: subgramSettings.max_sponsors || 3,
            action: subgramSettings.default_action || 'subscribe',
            excludeChannelIds: [],
            withToken: true
        });

        if (subgramResponse.success && subgramResponse.data) {
            const processedData = subgramAPI.processAPIResponse(subgramResponse.data);

            if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                console.log(`[FLOW] Got ${processedData.channelsToSubscribe.length} fresh sponsor channels`);

                // Убираем дубликаты
                const uniqueChannels = new Map();
                processedData.channelsToSubscribe.forEach(ch => {
                    if (!uniqueChannels.has(ch.link)) {
                        uniqueChannels.set(ch.link, ch);
                    }
                });

                const channels = Array.from(uniqueChannels.values()).map(ch => ({
                    id: ch.link,
                    name: ch.name || 'Спонсорский канал',
                    link: ch.link,
                    type: 'subgram', // Правильный тип для SubGram каналов
                    subscribed: false
                }));

                // Сохраняем новые каналы
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                await db.saveSubGramChannels(userId, Array.from(uniqueChannels.values()));

                return channels;
            }
        }

        console.log('[FLOW] No sponsor channels available');
        return [];

    } catch (error) {
        console.error('[FLOW] Error getting sponsor channels:', error);
        return [];
    }
}

/**
 * Получить обязательны�� каналы
 * @returns {Array} Список обязательных каналов
 */
async function getRequiredChannels() {
    try {
        const result = await db.executeQuery(
            'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE'
        );

        return result.rows.map(ch => ({
            id: ch.channel_id,
            name: ch.channel_name || ch.channel_id,
            link: ch.channel_id.startsWith('@') ? 
                `https://t.me/${ch.channel_id.substring(1)}` : ch.channel_id,
            type: 'required',
            subscribed: false // Будет проверено отдельно
        }));

    } catch (error) {
        console.error('[FLOW] Error getting required channels:', error);
        return [];
    }
}

/**
 * Проверить подписки на спонсорские каналы
 * @param {number} userId - ID пользователя
 * @param {Array} channels - Список каналов для проверки
 * @returns {Object} Статус подписок
 */
async function checkSponsorSubscriptions(userId, channels) {
    if (channels.length === 0) {
        return { allSubscribed: true, subscribedCount: 0, totalCount: 0 };
    }

    let subscribedCount = 0;
    for (const channel of channels) {
        try {
            // Извлекаем username из ссылки
            let channelToCheck = channel.id;
            if (channel.id.includes('t.me/')) {
                const match = channel.id.match(/t\.me\/([^\/\?]+)/);
                if (match) {
                    channelToCheck = '@' + match[1];
                }
            }

            // Получаем bot из глобального контекста (будет передан позже)
            // Пока просто отмечаем как не подписанный для безопасности
            channel.subscribed = false;
            
        } catch (error) {
            console.log(`[FLOW] Cannot check sponsor channel ${channel.id}: ${error.message}`);
            // В случае ошибки считаем канал подписанным
            channel.subscribed = true;
            subscribedCount++;
        }
    }

    return {
        allSubscribed: subscribedCount === channels.length,
        subscribedCount: subscribedCount,
        totalCount: channels.length
    };
}

/**
 * Проверить подписки на обязательные каналы
 * @param {number} userId - ID пользователя
 * @param {Array} channels - Список каналов для проверки
 * @returns {Object} Статус по��писок
 */
async function checkRequiredSubscriptions(userId, channels) {
    if (channels.length === 0) {
        return { allSubscribed: true, subscribedCount: 0, totalCount: 0 };
    }

    let subscribedCount = 0;
    for (const channel of channels) {
        try {
            // Аналогично спонсорским каналам, пока отм��чаем как не подписанный
            channel.subscribed = false;
            
        } catch (error) {
            console.log(`[FLOW] Cannot check required channel ${channel.id}: ${error.message}`);
            // В случае ошибки считаем канал подписанным
            channel.subscribed = true;
            subscribedCount++;
        }
    }

    return {
        allSubscribed: subscribedCount === channels.length,
        subscribedCount: subscribedCount,
        totalCount: channels.length
    };
}

/**
 * Проверить подписки с помощью бота
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @param {Array} channels - Список каналов
 */
async function checkChannelSubscriptionsWithBot(bot, userId, channels) {
    for (const channel of channels) {
        try {
            let channelToCheck = channel.id;
            
            // Правильная обработка ссылок SubGram (тип subgram или sponsor)
            if ((channel.type === 'sponsor' || channel.type === 'subgram') && channel.id.includes('t.me/')) {
                const match = channel.id.match(/t\.me\/([^\/\?]+)/);
                if (match) {
                    channelToCheck = '@' + match[1];
                }
            }
            // Обработка приватных ссылок (+код)
            else if (channel.id.includes('t.me/+')) {
                // Приватные ссылки нельзя проверить через getChatMember
                console.log(`[FLOW] Cannot check private link ${channel.id} - marking as subscribed`);
                channel.subscribed = true;
                return;
            }

            const member = await bot.getChatMember(channelToCheck, userId);
            channel.subscribed = !(member.status === 'left' || member.status === 'kicked');
            
        } catch (error) {
            console.log(`[FLOW] Cannot check channel ${channel.id}: ${error.message}`);
            // Для спонсорских каналов при ошибке считаем подписанным
            // Для обязательных - неподписанным
            if (channel.type === 'sponsor' || channel.type === 'subgram') {
                channel.subscribed = true; // Ошибка проверки = подписан
            } else {
                channel.subscribed = false; // Обязательные каналы строже
            }
        }
    }
}

/**
 * Вычислить статус подписок для массива каналов
 * @param {Array} channels - Массив каналов с проверенными подписками
 * @returns {Object} Статус подписок
 */
function calculateSubscriptionStatus(channels) {
    if (channels.length === 0) {
        return { allSubscribed: true, subscribedCount: 0, totalCount: 0 };
    }

    const subscribedCount = channels.filter(ch => ch.subscribed).length;
    const totalCount = channels.length;

    return {
        allSubscribed: subscribedCount === totalCount,
        subscribedCount: subscribedCount,
        totalCount: totalCount
    };
}

/**
 * Сформировать сообщение для текущего этапа подписки
 * @param {Object} stageInfo - Информация об этапе
 * @returns {Object} Сообщение и кнопки
 */
function formatStageMessage(stageInfo) {
    const { stage, channelsToShow, allCompleted } = stageInfo;

    console.log(`[FLOW] Formatting stage message: stage=${stage}, channelsToShow=${channelsToShow?.length || 0}, allCompleted=${allCompleted}`);

    // Проверяем что есть каналы для показа
    if (!allCompleted && (!channelsToShow || channelsToShow.length === 0)) {
        console.log(`[FLOW] WARNING: No channels to show for stage ${stage}`);
        return {
            message: '🔄 **Проблема с каналами**\n\nОшибка получения каналов для подписки. Попробуйте еще раз.',
            buttons: [
                [{ text: '🔄 Обновить', callback_data: 'check_subscriptions' }]
            ]
        };
    }

    if (allCompleted) {
        return {
            message: '✅ **Отлично!**\n\nВ�� подписаны на все необходимые каналы!\n\n🎉 Можете пользоваться ботом.',
            buttons: [
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };
    }

    let message = '';
    let buttons = [];

    switch (stage) {
        case SUBSCRIPTION_STAGES.SPONSORS:
            message = '🎯 **Спонсорские каналы**\n\n';
            message += 'Для начала работы с ботом подпишитесь на спонсорские каналы:\n\n';
            
            channelsToShow.forEach((channel, index) => {
                message += `${index + 1}. ${channel.name}\n`;
                buttons.push([{
                    text: `💎 ${channel.name}`,
                    url: channel.link
                }]);
            });

            message += '\n📌 После подписки нажмите кнопку проверки';
            buttons.push([{ text: '✅ Провери��ь спонсоров', callback_data: 'check_sponsors' }]);
            break;

        case SUBSCRIPTION_STAGES.REQUIRED:
            message = '📋 **Обязательные каналы**\n\n';
            message += 'Теперь подпишитесь на обязательные каналы:\n\n';
            
            channelsToShow.forEach((channel, index) => {
                message += `${index + 1}. ${channel.name}\n`;
                buttons.push([{
                    text: `📺 ${channel.name}`,
                    url: channel.link
                }]);
            });

            message += '\n📌 После подписки нажмите кнопку проверки';
            buttons.push([{ text: '✅ Проверить обязательные', callback_data: 'check_required' }]);
            break;
    }

    return { message, buttons };
}

/**
 * Проверить, может ли пользователь использовать функции бота
 * @param {number} userId - ID пользователя
 * @returns {boolean} Может ли пользователь использовать бот
 */
async function canUserAccessBot(userId) {
    try {
        const stageInfo = await getCurrentSubscriptionStage(userId);
        return stageInfo.allCompleted;
    } catch (error) {
        console.error('[FLOW] Error checking bot access:', error);
        return false; // В случае ��шибки блокируем доступ
    }
}

/**
 * Обновить этап подписки после проверки
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @returns {Object} Обновленная информация об этапе
 */
async function updateSubscriptionStage(bot, userId) {
    try {
        console.log(`[FLOW] Updating subscription stage for user ${userId}`);

        // 1. Получаем каналы
        const stageInfo = await getCurrentSubscriptionStage(userId);

        // 2. Проверяем подписки с помощью бота
        if (stageInfo.sponsorChannels.length > 0) {
            await checkChannelSubscriptionsWithBot(bot, userId, stageInfo.sponsorChannels);
        }

        if (stageInfo.requiredChannels.length > 0) {
            await checkChannelSubscriptionsWithBot(bot, userId, stageInfo.requiredChannels);
        }

        // 3. Пересчитываем статусы ПОСЛЕ реальной проверки
        const sponsorStatus = calculateSubscriptionStatus(stageInfo.sponsorChannels);
        const requiredStatus = calculateSubscriptionStatus(stageInfo.requiredChannels);

        console.log(`[FLOW] Subscription status - Sponsors: ${sponsorStatus.subscribedCount}/${sponsorStatus.totalCount}, Required: ${requiredStatus.subscribedCount}/${requiredStatus.totalCount}`);

        // 4. Обновляем результат
        stageInfo.sponsorStatus = sponsorStatus;
        stageInfo.requiredStatus = requiredStatus;

        // 5. Определяем этап по ПРИОРИТЕТУ: Спонсоры -> Обязательные -> Завершено
        if (!sponsorStatus.allSubscribed && stageInfo.sponsorChannels.length > 0) {
            // ЭТАП 1: Нужны спонсорские каналы
            stageInfo.stage = SUBSCRIPTION_STAGES.SPONSORS;
            stageInfo.nextAction = 'subscribe_sponsors';
            stageInfo.channelsToShow = stageInfo.sponsorChannels.filter(ch => !ch.subscribed);
            stageInfo.allCompleted = false;
        } else if (!requiredStatus.allSubscribed && stageInfo.requiredChannels.length > 0) {
            // ЭТАП 2: Спонсоры ОК, нужны обязательные
            stageInfo.stage = SUBSCRIPTION_STAGES.REQUIRED;
            stageInfo.nextAction = 'subscribe_required';
            stageInfo.channelsToShow = stageInfo.requiredChannels.filter(ch => !ch.subscribed);
            stageInfo.allCompleted = false;
        } else {
            // ЭТАП 3: Все подписки выполнены
            stageInfo.stage = SUBSCRIPTION_STAGES.COMPLETED;
            stageInfo.nextAction = 'show_main_menu';
            stageInfo.allCompleted = true;
            stageInfo.channelsToShow = [];
        }

        console.log(`[FLOW] Final stage for user ${userId}: ${stageInfo.stage}, unsubscribed channels: ${stageInfo.channelsToShow.length}`);
        return stageInfo;

    } catch (error) {
        console.error('[FLOW] Error updating subscription stage:', error);
        // При ошибке НЕ считаем что все подписки выполнены!
        return {
            stage: SUBSCRIPTION_STAGES.SPONSORS,
            nextAction: 'subscribe_sponsors',
            allCompleted: false, // ← ВАЖНО: false при ошибке!
            channelsToShow: [],
            sponsorChannels: [],
            requiredChannels: [],
            sponsorStatus: { allSubscribed: false, subscribedCount: 0, totalCount: 0 },
            requiredStatus: { allSubscribed: false, subscribedCount: 0, totalCount: 0 },
            error: error.message
        };
    }
}

module.exports = {
    SUBSCRIPTION_STAGES,
    getCurrentSubscriptionStage,
    getSponsorChannels,
    getRequiredChannels,
    checkChannelSubscriptionsWithBot,
    calculateSubscriptionStatus,
    formatStageMessage,
    canUserAccessBot,
    updateSubscriptionStage
};
