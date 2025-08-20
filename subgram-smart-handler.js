/**
 * Умная система обработки SubGram каналов
 * Решает проблему блокировки бота когда нет спонсорских каналов
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Состояния SubGram для пользователя
 */
const SUBGRAM_STATES = {
    NO_CHANNELS: 'no_channels',           // SubGram не вернул каналы (норма)
    HAS_CHANNELS: 'has_channels',         // Есть каналы для подписки
    ALL_SUBSCRIBED: 'all_subscribed',     // Подписан на все каналы
    API_ERROR: 'api_error',               // Ошибка API
    DISABLED: 'disabled'                  // SubGram отключен
};

/**
 * Получить текущее состояние SubGram для пользователя
 * @param {number} userId - ID пользователя
 * @returns {Object} Состояние SubGram
 */
async function getSubGramState(userId) {
    try {
        console.log(`[SMART-SUBGRAM] Checking SubGram state for user ${userId}`);

        // 1. Проверяем настройки SubGram
        const settings = await db.getSubGramSettings();
        if (!settings || !settings.enabled) {
            console.log('[SMART-SUBGRAM] SubGram disabled in settings');
            return {
                state: SUBGRAM_STATES.DISABLED,
                shouldBlock: false,
                channels: [],
                message: 'SubGram отключен в настройках'
            };
        }

        // 2. Делаем запрос к SubGram API
        const apiResponse = await subgramAPI.requestSponsors({
            userId: userId.toString(),
            chatId: userId.toString(),
            maxOP: settings.max_sponsors || 3,
            action: settings.default_action || 'subscribe',
            excludeChannelIds: [],
            withToken: true
        });

        // Логируем запрос
        await db.logSubGramAPIRequest(
            userId,
            'smart_state_check',
            { action: 'subscribe', smart: true },
            apiResponse.data || {},
            apiResponse.success,
            apiResponse.error
        );

        // 3. Анализируем ответ
        if (!apiResponse.success) {
            console.log(`[SMART-SUBGRAM] API error: ${apiResponse.error}`);
            return {
                state: SUBGRAM_STATES.API_ERROR,
                shouldBlock: false, // НЕ блокируем при ошибке API
                channels: [],
                message: 'Ошибка SubGram API - доступ разрешен',
                error: apiResponse.error
            };
        }

        const processedData = subgramAPI.processAPIResponse(apiResponse.data);
        console.log(`[SMART-SUBGRAM] API response: status=${processedData.status}, code=${processedData.code}, channels=${processedData.channels.length}, toSubscribe=${processedData.channelsToSubscribe?.length || 0}`);
        console.log(`[SMART-SUBGRAM] Processed data:`, JSON.stringify({
            status: processedData.status,
            code: processedData.code,
            needsSubscription: processedData.needsSubscription,
            allSubscribed: processedData.allSubscribed,
            channelsCount: processedData.channels.length,
            toSubscribeCount: processedData.channelsToSubscribe?.length || 0
        }, null, 2));

        // 4. Определяем состояние на основе ответа

        // УЛУЧШЕННАЯ ЛОГИКА: проверяем needsSubscription вместо status
        if (processedData.needsSubscription && (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0)) {
            // Есть каналы для подписки - БЛОКИРУЕМ доступ
            console.log(`[SMART-SUBGRAM] Found ${processedData.channelsToSubscribe.length} channels requiring subscription (needsSubscription: true)`);

            // Сохраняем каналы в БД
            await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
            await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);

            return {
                state: SUBGRAM_STATES.HAS_CHANNELS,
                shouldBlock: true, // БЛОКИРУЕМ - есть каналы для подписки
                channels: processedData.channelsToSubscribe,
                message: 'Необходимо подписаться на спонсорские каналы'
            };
        }

        // Если есть каналы, но статус неизвестен - проверяем по статусу
        if (processedData.channels && processedData.channels.length > 0) {
            const unsubscribedChannels = processedData.channels.filter(ch => ch.needsSubscription);

            if (unsubscribedChannels.length > 0) {
                console.log(`[SMART-SUBGRAM] Found ${unsubscribedChannels.length} unsubscribed channels`);

                // Сохраняем каналы в БД
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                await db.saveSubGramChannels(userId, unsubscribedChannels);

                return {
                    state: SUBGRAM_STATES.HAS_CHANNELS,
                    shouldBlock: true, // БЛОКИРУЕМ - есть каналы для подписки
                    channels: unsubscribedChannels,
                    message: 'Необходимо подписаться на спонсорские каналы'
                };
            }
        }

        if (processedData.status === 'ok' && processedData.code === 200) {
            // Пользователь подписан на все каналы ИЛИ каналов нет
            console.log('[SMART-SUBGRAM] Status OK - user is subscribed or no channels available');
            return {
                state: SUBGRAM_STATES.ALL_SUBSCRIBED,
                shouldBlock: false,
                channels: [],
                message: 'Подписан на все спонсорские каналы'
            };
        }

        // 5. Нет каналов - это нормально, НЕ блокируем
        console.log('[SMART-SUBGRAM] No channels available - this is normal');
        return {
            state: SUBGRAM_STATES.NO_CHANNELS,
            shouldBlock: false, // Н�� блокируем - просто нет спонсоров
            channels: [],
            message: 'Спонсорские каналы недоступны - доступ разрешен'
        };

    } catch (error) {
        console.error('[SMART-SUBGRAM] Critical error checking state:', error);
        return {
            state: SUBGRAM_STATES.API_ERROR,
            shouldBlock: false, // НЕ блокируем при ошибке
            channels: [],
            message: 'Ошибка проверки спонсоров - доступ разрешен',
            error: error.message
        };
    }
}

/**
 * Проверить нужно ли блокировать доступ к боту
 * @param {number} userId - ID пользователя
 * @returns {Object} Решение о блокировке
 */
async function shouldBlockBotAccess(userId) {
    try {
        const subgramState = await getSubGramState(userId);
        
        console.log(`[SMART-SUBGRAM] Access decision for user ${userId}: state=${subgramState.state}, shouldBlock=${subgramState.shouldBlock}`);

        return {
            shouldBlock: subgramState.shouldBlock,
            reason: subgramState.state,
            channels: subgramState.channels,
            message: subgramState.message,
            state: subgramState
        };

    } catch (error) {
        console.error('[SMART-SUBGRAM] Error checking bot access:', error);
        // При ошибке НЕ блокируем доступ
        return {
            shouldBlock: false,
            reason: 'error_allow_access',
            channels: [],
            message: 'Ошибка проверки - доступ разрешен',
            error: error.message
        };
    }
}

/**
 * Получить сообщение о спонсорских каналах для показа пользователю
 * @param {number} userId - ID пользователя
 * @returns {Object} Сообщение и кнопки
 */
async function getSubscriptionMessage(userId) {
    try {
        const accessCheck = await shouldBlockBotAccess(userId);

        // Если доступ не блокируется
        if (!accessCheck.shouldBlock) {
            console.log(`[SMART-SUBGRAM] Access allowed for user ${userId}: ${accessCheck.reason}`);
            return {
                accessAllowed: true,
                reason: accessCheck.reason,
                message: accessCheck.message
            };
        }

        // Если есть каналы для подписки - формируем сообщение
        const channels = accessCheck.channels;
        
        let message = '🎯 **Спонсорские кана��ы**\n\n';
        message += 'Для продолжения работы подпишитесь на спонсорские каналы:\n\n';

        let buttons = [];

        channels.forEach((channel, index) => {
            message += `${index + 1}. ${channel.name}\n`;
            buttons.push([{
                text: `💎 ${channel.name}`,
                url: channel.link
            }]);
        });

        message += '\n📌 После подписки нажмите кнопку проверки';
        buttons.push([{ text: '✅ Проверить подписки', callback_data: 'check_subgram_subscriptions' }]);

        return {
            accessAllowed: false,
            message: message,
            buttons: buttons,
            channelsCount: channels.length
        };

    } catch (error) {
        console.error('[SMART-SUBGRAM] Error getting subscription message:', error);
        return {
            accessAllowed: true, // При ошибке разрешаем доступ
            reason: 'error_allow_access',
            message: 'Ошибка получения спонсорских каналов - доступ разрешен'
        };
    }
}

/**
 * Проверить подписки пользовател�� на спонсорские каналы
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @returns {Object} Результат проверки
 */
async function checkUserSubscriptions(bot, userId) {
    try {
        console.log(`[SMART-SUBGRAM] Checking subscriptions for user ${userId}`);

        // Получаем сохраненные каналы для проверки
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '2 hours'
            ORDER BY created_at DESC
        `, [userId]);

        if (!savedChannels.rows || savedChannels.rows.length === 0) {
            console.log('[SMART-SUBGRAM] No saved channels to check - refreshing state');
            // Обновляем состояние
            const newState = await getSubGramState(userId);
            return {
                allSubscribed: !newState.shouldBlock,
                channels: newState.channels,
                refreshed: true
            };
        }

        // Проверяем подписки на сохраненные к��налы
        let allSubscribed = true;
        const checkedChannels = [];

        for (const channelData of savedChannels.rows) {
            let isSubscribed = false;
            let canCheck = true;

            try {
                // Извлекаем username канала из ссылки
                let channelToCheck = channelData.channel_link;
                if (channelData.channel_link.includes('t.me/')) {
                    const match = channelData.channel_link.match(/t\.me\/([^\/\?]+)/);
                    if (match) {
                        channelToCheck = '@' + match[1];
                    }
                }

                const member = await bot.getChatMember(channelToCheck, userId);
                isSubscribed = !(member.status === 'left' || member.status === 'kicked');

            } catch (error) {
                console.log(`[SMART-SUBGRAM] Cannot check channel ${channelData.channel_link}: ${error.message}`);
                // При ошибке проверки считаем подписанным
                isSubscribed = true;
                canCheck = false;
            }

            if (!isSubscribed) {
                allSubscribed = false;
            }

            checkedChannels.push({
                link: channelData.channel_link,
                name: channelData.channel_name,
                subscribed: isSubscribed,
                canCheck: canCheck
            });
        }

        console.log(`[SMART-SUBGRAM] Subscription check result: ${checkedChannels.length} channels, allSubscribed: ${allSubscribed}`);

        return {
            allSubscribed: allSubscribed,
            channels: checkedChannels,
            checkedCount: checkedChannels.length
        };

    } catch (error) {
        console.error('[SMART-SUBGRAM] Error checking subscriptions:', error);
        return {
            allSubscribed: true, // При ошибке разрешаем доступ
            channels: [],
            error: error.message
        };
    }
}

/**
 * Получить статистику состояний SubGram для админа
 * @returns {Object} Статистика
 */
async function getSubGramStats() {
    try {
        // Статистика API запросов за 24 часа
        const apiStats = await db.executeQuery(`
            SELECT
                COUNT(*) as total_requests,
                COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
                COUNT(CASE WHEN success = false THEN 1 END) as failed_requests,
                COUNT(CASE WHEN api_status = 'ok' AND api_code = 200 THEN 1 END) as all_subscribed_responses,
                COUNT(CASE WHEN api_status = 'warning' THEN 1 END) as has_channels_responses,
                COUNT(DISTINCT user_id) as unique_users
            FROM subgram_api_requests
            WHERE created_at > NOW() - INTERVAL '24 hours'
            AND request_type LIKE '%smart%'
        `);

        // Статистика сохраненных каналов
        const channelStats = await db.executeQuery(`
            SELECT
                COUNT(DISTINCT user_id) as users_with_channels,
                COUNT(*) as total_saved_channels,
                COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent_channels
            FROM subgram_channels
        `);

        return {
            api: apiStats.rows[0] || {},
            channels: channelStats.rows[0] || {},
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('[SMART-SUBGRAM] Error getting stats:', error);
        return { error: error.message };
    }
}

module.exports = {
    SUBGRAM_STATES,
    getSubGramState,
    shouldBlockBotAccess,
    getSubscriptionMessage,
    checkUserSubscriptions,
    getSubGramStats
};
