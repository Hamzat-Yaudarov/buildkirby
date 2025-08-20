/**
 * Менеджер поэтапных подписок (ТОЛЬКО SubGram)
 * УДАЛЕНА логика обязательных каналов - работаем только с SubGram спонсорами
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Этапы подписки (упрощенные)
 */
const SUBSCRIPTION_STAGES = {
    SPONSORS: 'sponsors',      // Спонсорские каналы от SubGram
    COMPLETED: 'completed'     // Все подписки выполнены
};

/**
 * Получить каналы для проверки (ТОЛЬКО SubGram)
 * @param {number} userId - ID пользователя
 * @returns {Object} Объект с каналами
 */
async function getCurrentSubscriptionStage(userId) {
    try {
        console.log(`[FLOW] Getting SubGram channels for user ${userId}`);

        // Получаем ТОЛЬКО спонсорские каналы от SubGram
        const sponsorChannels = await getSponsorChannels(userId);

        console.log(`[FLOW] Found ${sponsorChannels.length} SubGram sponsor channels`);

        return {
            sponsorChannels: sponsorChannels,
            stage: null,
            sponsorStatus: null,
            allCompleted: false,
            nextAction: null,
            channelsToShow: []
        };

    } catch (error) {
        console.error('[FLOW] Error getting channels:', error);
        return {
            sponsorChannels: [],
            stage: SUBSCRIPTION_STAGES.SPONSORS,
            nextAction: 'subscribe_sponsors',
            allCompleted: false,
            channelsToShow: [],
            error: error.message
        };
    }
}

/**
 * Получить спонсорские каналы от SubGram с улучшенной fallback логикой
 * @param {number} userId - ID пользователя
 * @returns {Array} Список спонсорских каналов
 */
async function getSponsorChannels(userId) {
    try {
        // Используем новую fallback систему
        const { getSponsorsWithFallback } = require('./subgram-fallback-handler');
        const sponsorResult = await getSponsorsWithFallback(userId);

        console.log(`[FLOW] Sponsor fallback result: success=${sponsorResult.success}, channels=${sponsorResult.channels.length}, source=${sponsorResult.source}, shouldSkip=${sponsorResult.shouldSkipSponsors}`);

        if (sponsorResult.shouldSkipSponsors) {
            console.log(`[FLOW] Skipping sponsors: ${sponsorResult.source}`);
            return [];
        }

        if (sponsorResult.success && sponsorResult.channels.length > 0) {
            console.log(`[FLOW] Got ${sponsorResult.channels.length} sponsor channels from ${sponsorResult.source}`);

            return sponsorResult.channels.map(ch => ({
                id: ch.link,
                name: ch.name || 'Спонсорский канал',
                link: ch.link,
                type: 'subgram',
                subscribed: false
            }));
        }

        console.log('[FLOW] Sponsor channels unavailable');
        return [];

    } catch (error) {
        console.error('[FLOW] Error getting sponsor channels:', error);
        return [];
    }
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

            console.log(`[FLOW] Checking subscription for channel: ${channel.id} (type: ${channel.type})`);

            // Правильная обработка ссылок SubGram
            if (channel.type === 'subgram' && channel.id.includes('t.me/')) {
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
                continue;
            }

            console.log(`[FLOW] Checking membership: user ${userId} in channel ${channelToCheck}`);
            const member = await bot.getChatMember(channelToCheck, userId);
            channel.subscribed = !(member.status === 'left' || member.status === 'kicked');
            console.log(`[FLOW] Membership result: ${member.status} -> subscribed: ${channel.subscribed}`);
            
        } catch (error) {
            console.log(`[FLOW] Cannot check channel ${channel.id}: ${error.message}`);
            // Для спонсорских каналов при ошибке считаем подписанным
            channel.subscribed = true;
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
 * @returns {Object} Сообщение и ��нопки
 */
function formatStageMessage(stageInfo) {
    const { stage, channelsToShow, allCompleted } = stageInfo;

    console.log(`[FLOW] Formatting stage message: stage=${stage}, channelsToShow=${channelsToShow?.length || 0}, allCompleted=${allCompleted}`);

    if (allCompleted) {
        return {
            message: '✅ **Отлично!**\n\nВы подписаны на все спонсорские каналы!\n\n🎉 Можете пользоваться ботом.',
            buttons: [
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };
    }

    // Проверяем что есть каналы для показа
    if (!channelsToShow || channelsToShow.length === 0) {
        console.log(`[FLOW] No channels to show for stage ${stage}`);
        return {
            message: '🎯 **Спонсорские каналы недоступны**\n\nВ данный момент нет спонсорских каналов для подписки.\n\n✅ Можете пользоваться ботом!',
            buttons: [
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };
    }

    let message = '🎯 **Спонсорские каналы**\n\n';
    message += 'Дл�� начала работы с ботом подпишитесь на спонсорские каналы:\n\n';
    
    let buttons = [];
    
    channelsToShow.forEach((channel, index) => {
        message += `${index + 1}. ${channel.name}\n`;
        buttons.push([{
            text: `💎 ${channel.name}`,
            url: channel.link
        }]);
    });

    message += '\n📌 После подписки нажмите кнопку проверки';
    buttons.push([{ text: '✅ Проверить подписки', callback_data: 'check_sponsors' }]);

    return { message, buttons };
}

/**
 * Проверить, может ли пользователь использовать функции бота
 * @param {number} userId - ID пользователя
 * @returns {boolean} Может ли пользователь использовать бот
 */
async function canUserAccessBot(bot, userId) {
    try {
        console.log(`[FLOW] Checking bot access for user ${userId}`);
        const stageInfo = await updateSubscriptionStage(bot, userId);
        console.log(`[FLOW] Bot access check result: allCompleted=${stageInfo.allCompleted}, stage=${stageInfo.stage}`);
        return stageInfo.allCompleted;
    } catch (error) {
        console.error('[FLOW] Error checking bot access:', error);
        return false;
    }
}

/**
 * Обновить этап подписки после проверки (УПРОЩЕНО - ТОЛЬКО SubGram)
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @returns {Object} Обновленная информация об этапе
 */
async function updateSubscriptionStage(bot, userId) {
    try {
        console.log(`[FLOW] Updating subscription stage for user ${userId}`);

        // 1. Получаем ТОЛЬКО спонсорские каналы
        const stageInfo = await getCurrentSubscriptionStage(userId);

        // 2. Проверяем подписки с помощью бота
        if (stageInfo.sponsorChannels.length > 0) {
            await checkChannelSubscriptionsWithBot(bot, userId, stageInfo.sponsorChannels);
        }

        // 3. Пересчитываем статусы ПОСЛЕ реальной проверки
        const sponsorStatus = calculateSubscriptionStatus(stageInfo.sponsorChannels);

        console.log(`[FLOW] Subscription status - Sponsors: ${sponsorStatus.subscribedCount}/${sponsorStatus.totalCount}`);

        // 4. Обновляем результат
        stageInfo.sponsorStatus = sponsorStatus;

        // 5. Определяем этап (УПРОЩЕНО):
        if (!sponsorStatus.allSubscribed && stageInfo.sponsorChannels.length > 0) {
            // ЭТАП 1: Нужны спонсорские каналы
            stageInfo.stage = SUBSCRIPTION_STAGES.SPONSORS;
            stageInfo.nextAction = 'subscribe_sponsors';
            stageInfo.channelsToShow = stageInfo.sponsorChannels.filter(ch => !ch.subscribed);
            stageInfo.allCompleted = false;
        } else {
            // ЭТАП 2: Все подписки выполнены ИЛИ нет каналов
            stageInfo.stage = SUBSCRIPTION_STAGES.COMPLETED;
            stageInfo.nextAction = 'show_main_menu';
            stageInfo.allCompleted = true;
            stageInfo.channelsToShow = [];

            console.log(`[FLOW] User ${userId} completed all subscriptions`);
        }

        console.log(`[FLOW] Final stage for user ${userId}: ${stageInfo.stage}, unsubscribed channels: ${stageInfo.channelsToShow.length}`);
        return stageInfo;

    } catch (error) {
        console.error('[FLOW] Error updating subscription stage:', error);
        return {
            stage: SUBSCRIPTION_STAGES.SPONSORS,
            nextAction: 'subscribe_sponsors',
            allCompleted: false,
            channelsToShow: [],
            sponsorChannels: [],
            sponsorStatus: { allSubscribed: false, subscribedCount: 0, totalCount: 0 },
            error: error.message
        };
    }
}

module.exports = {
    SUBSCRIPTION_STAGES,
    getCurrentSubscriptionStage,
    getSponsorChannels,
    checkChannelSubscriptionsWithBot,
    calculateSubscriptionStatus,
    formatStageMessage,
    canUserAccessBot,
    updateSubscriptionStage
};
