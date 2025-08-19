/**
 * Менеджер поэтапных подписок
 * Обеспечивает правильный flow: Спонсоры → Обязательные каналы → Главное меню
 * Блок��рует функции до полной подписки на ВСЕ каналы
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Этап�� подписки
 */
const SUBSCRIPTION_STAGES = {
    SPONSORS: 'sponsors',      // Спонсорские каналы от SubGram
    REQUIRED: 'required',      // Обязательные каналы
    COMPLETED: 'completed'     // Все подписки выполнены
};

/**
 * Пересчитать статус подписок на основе проверенных каналов
 * @param {Array} channels - Массив каналов с обновленными статусами
 * @returns {Object} Статус подписок
 */
function recalculateSubscriptionStatus(channels) {
    if (channels.length === 0) {
        return { allSubscribed: true, subscribedCount: 0, totalCount: 0 };
    }

    const subscribedCount = channels.filter(ch => ch.subscribed).length;
    return {
        allSubscribed: subscribedCount === channels.length,
        subscribedCount: subscribedCount,
        totalCount: channels.length
    };
}

/**
 * Определить текущий этап подписки для пользователя
 * @param {number} userId - ID пользователя
 * @returns {Object} Информация о текущем этапе
 */
async function getCurrentSubscriptionStage(userId) {
    try {
        console.log(`[FLOW] Checking subscription stage for user ${userId}`);

        // 1. Получаем спонсорские каналы от SubGram
        const sponsorChannels = await getSponsorChannels(userId);
        
        // 2. Получаем обязательные каналы
        const requiredChannels = await getRequiredChannels();

        // 3. Изначально считаем что пользователь НЕ подписан (проверим с ботом позже)
        const sponsorStatus = {
            allSubscribed: false, // Всегда false до проверки с ботом
            subscribedCount: 0,
            totalCount: sponsorChannels.length
        };

        // 4. Аналогично для обязательных каналов
        const requiredStatus = {
            allSubscribed: false, // Всегда false до проверки с ботом
            subscribedCount: 0,
            totalCount: requiredChannels.length
        };

        const result = {
            stage: SUBSCRIPTION_STAGES.SPONSORS,
            sponsorChannels: sponsorChannels,
            requiredChannels: requiredChannels,
            sponsorStatus: sponsorStatus,
            requiredStatus: requiredStatus,
            allCompleted: false,
            nextAction: 'subscribe_sponsors'
        };

        // Определяем текущий этап - строго последовательно
        if (sponsorChannels.length > 0 && !sponsorStatus.allSubscribed) {
            // Этап 1: Есть спонсоры и не все подписаны - показываем ТОЛЬКО спонсоров
            result.stage = SUBSCRIPTION_STAGES.SPONSORS;
            result.nextAction = 'subscribe_sponsors';
            result.channelsToShow = sponsorChannels; // Показываем все спонсорские каналы
            console.log(`[FLOW] Stage: SPONSORS - showing ${sponsorChannels.length} sponsor channels`);
        } else if (requiredChannels.length > 0 && !requiredStatus.allSubscribed) {
            // Этап 2: Спонсоры выполнены (или нет), но есть обязательные - показываем ТОЛЬКО обязательные
            result.stage = SUBSCRIPTION_STAGES.REQUIRED;
            result.nextAction = 'subscribe_required';
            result.channelsToShow = requiredChannels; // Показываем все обязательные каналы
            console.log(`[FLOW] Stage: REQUIRED - showing ${requiredChannels.length} required channels`);
        } else {
            // Этап 3: Все подписки выполнены или нет каналов вообще
            result.stage = SUBSCRIPTION_STAGES.COMPLETED;
            result.nextAction = 'show_main_menu';
            result.allCompleted = true;
            result.channelsToShow = [];
            console.log(`[FLOW] Stage: COMPLETED - all subscriptions done`);
        }

        console.log(`[FLOW] User ${userId} stage: ${result.stage}, channels to show: ${result.channelsToShow.length}`);
        return result;

    } catch (error) {
        console.error('[FLOW] Error determining subscription stage:', error);
        return {
            stage: SUBSCRIPTION_STAGES.COMPLETED,
            nextAction: 'show_main_menu',
            allCompleted: true,
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
            
            // Убираем дубликаты по ссы��ке
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
                type: 'sponsor',
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
                    type: 'sponsor',
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
 * Получить обязательные ��аналы
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
            // Из��лекаем username из ссылки
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
 * @returns {Object} Статус подписок
 */
async function checkRequiredSubscriptions(userId, channels) {
    if (channels.length === 0) {
        return { allSubscribed: true, subscribedCount: 0, totalCount: 0 };
    }

    let subscribedCount = 0;
    for (const channel of channels) {
        try {
            // Аналогично спонсорским каналам, пока отмечаем как не подписанный
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
 * @param {Array} channels - Список канал��в
 */
async function checkChannelSubscriptionsWithBot(bot, userId, channels) {
    for (const channel of channels) {
        try {
            let channelToCheck = channel.id;
            
            if (channel.type === 'sponsor' && channel.id.includes('t.me/')) {
                const match = channel.id.match(/t\.me\/([^\/\?]+)/);
                if (match) {
                    channelToCheck = '@' + match[1];
                }
            }

            const member = await bot.getChatMember(channelToCheck, userId);
            channel.subscribed = !(member.status === 'left' || member.status === 'kicked');
            
        } catch (error) {
            console.log(`[FLOW] Cannot check channel ${channel.id}: ${error.message}`);
            // В случае ошибки проверки НЕ меняем статус - ост��вляем как есть
            // channel.subscribed останется false (по умолчанию)
        }
    }
}

/**
 * Сформировать сообщение для текущего этапа подписки
 * @param {Object} stageInfo - Информация об этапе
 * @returns {Object} Сообщение и кнопки
 */
function formatStageMessage(stageInfo) {
    const { stage, channelsToShow, allCompleted } = stageInfo;

    if (allCompleted) {
        return {
            message: '✅ **Отлично!**\n\nВ�� подписаны на в��е необходимые каналы!\n\n🎉 Можете пользоваться ботом.',
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
            buttons.push([{ text: '✅ Проверить спонсоров', callback_data: 'check_sponsors' }]);
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
 * @param {number} userId - ID польз��вателя
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
        // Получаем текущий этап без проверки подписок
        let stageInfo = await getCurrentSubscriptionStage(userId);

        console.log(`[FLOW] Initial stage for user ${userId}: ${stageInfo.stage}`);

        // Проверяем подписки ТОЛЬКО для текущего этапа
        if (stageInfo.stage === SUBSCRIPTION_STAGES.SPONSORS && stageInfo.sponsorChannels.length > 0) {
            console.log(`[FLOW] Checking sponsor subscriptions for user ${userId}`);
            await checkChannelSubscriptionsWithBot(bot, userId, stageInfo.sponsorChannels);

            // Обновляем статус спонсоров
            const subscribedSponsors = stageInfo.sponsorChannels.filter(ch => ch.subscribed).length;
            const allSponsorsSubscribed = subscribedSponsors === stageInfo.sponsorChannels.length;

            if (allSponsorsSubscribed) {
                console.log(`[FLOW] User ${userId} completed all sponsor subscriptions`);
                stageInfo.sponsorStatus.allSubscribed = true;
                stageInfo.sponsorStatus.subscribedCount = subscribedSponsors;
            }

        } else if (stageInfo.stage === SUBSCRIPTION_STAGES.REQUIRED && stageInfo.requiredChannels.length > 0) {
            console.log(`[FLOW] Checking required subscriptions for user ${userId}`);
            await checkChannelSubscriptionsWithBot(bot, userId, stageInfo.requiredChannels);

            // Обновляем статус обязательных
            const subscribedRequired = stageInfo.requiredChannels.filter(ch => ch.subscribed).length;
            const allRequiredSubscribed = subscribedRequired === stageInfo.requiredChannels.length;

            if (allRequiredSubscribed) {
                console.log(`[FLOW] User ${userId} completed all required subscriptions`);
                stageInfo.requiredStatus.allSubscribed = true;
                stageInfo.requiredStatus.subscribedCount = subscribedRequired;
            }
        }

        // Пересчитываем этап после проверки подписок
        const updatedStageInfo = await getCurrentSubscriptionStage(userId);

        // Обновляем статусы подписок в новом результате
        if (stageInfo.sponsorStatus.allSubscribed) {
            updatedStageInfo.sponsorStatus.allSubscribed = true;
        }
        if (stageInfo.requiredStatus.allSubscribed) {
            updatedStageInfo.requiredStatus.allSubscribed = true;
        }

        console.log(`[FLOW] Final stage for user ${userId}: ${updatedStageInfo.stage}`);
        return updatedStageInfo;

    } catch (error) {
        console.error('[FLOW] Error updating subscription stage:', error);
        return {
            stage: SUBSCRIPTION_STAGES.SPONSORS,
            nextAction: 'subscribe_sponsors',
            allCompleted: false,
            channelsToShow: [],
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
    formatStageMessage,
    canUserAccessBot,
    updateSubscriptionStage
};
