/**
 * Умная система обработки SubGram каналов
 * Решает проблему блокировки бота ��огда нет спонсорских каналов
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Состояния SubGram для пользователя
 */
const SUBGRAM_STATES = {
    NO_CHANNELS: 'no_channels',           // SubGram не вернул кана��ы (норма)
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

        // 2. Делаем запрос к SubGram API (с retry логикой)
        console.log(`[SMART-SUBGRAM] Making SubGram API request for user ${userId}`);
        let apiResponse = await subgramAPI.requestSponsors({
            userId: userId.toString(),
            chatId: userId.toString(),
            maxOP: settings.max_sponsors || 3,
            action: settings.default_action || 'subscribe',
            excludeChannelIds: [],
            withToken: true
        });

        // RETRY логика: если API успешен, но каналов нет и needsSubscription=true - пробуем еще раз
        if (apiResponse.success && apiResponse.data) {
            const initialProcessed = subgramAPI.processAPIResponse(apiResponse.data);
            if (initialProcessed.needsSubscription && (!initialProcessed.channelsToSubscribe || initialProcessed.channelsToSubscribe.length === 0)) {
                console.log(`[SMART-SUBGRAM] First request: needsSubscription=true but no channels, trying retry after 2 seconds...`);

                // Ждем 2 секунды и пробуем еще раз
                await new Promise(resolve => setTimeout(resolve, 2000));

                const retryResponse = await subgramAPI.requestSponsors({
                    userId: userId.toString(),
                    chatId: userId.toString(),
                    maxOP: settings.max_sponsors || 3,
                    action: settings.default_action || 'subscribe',
                    excludeChannelIds: [],
                    withToken: true
                });

                if (retryResponse.success && retryResponse.data) {
                    const retryProcessed = subgramAPI.processAPIResponse(retryResponse.data);
                    if (retryProcessed.channelsToSubscribe && retryProcessed.channelsToSubscribe.length > 0) {
                        console.log(`[SMART-SUBGRAM] Retry successful - got ${retryProcessed.channelsToSubscribe.length} channels`);
                        apiResponse = retryResponse; // Используем результат retry
                    } else {
                        console.log(`[SMART-SUBGRAM] Retry also returned no channels - using original response`);
                    }
                } else {
                    console.log(`[SMART-SUBGRAM] Retry failed - using original response`);
                }
            }
        }

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

        // ИСПРАВЛЕННАЯ ЛОГИКА: блокируем только если needsSubscription=true И есть реальные каналы
        if (processedData.needsSubscription) {
            console.log(`[SMART-SUBGRAM] needsSubscription=true - checking for actual channels`);
            console.log(`[SMART-SUBGRAM] Channels available: ${processedData.channels.length}, toSubscribe: ${processedData.channelsToSubscribe?.length || 0}`);

            // Если есть каналы для подписки - сохраняем их и блокируем
            if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);

                return {
                    state: SUBGRAM_STATES.HAS_CHANNELS,
                    shouldBlock: true, // БЛОКИРУЕМ - есть каналы для подписки
                    channels: processedData.channelsToSubscribe,
                    message: 'Необходимо подписаться на спонсорские каналы'
                };
            } else {
                // ИСПРАВЛЕНИЕ: Если каналов нет, но needsSubscription=true - НЕ блокируем!
                console.log(`[SMART-SUBGRAM] No channels returned despite needsSubscription=true - ALLOWING ACCESS (no actual channels to show)`);
                return {
                    state: SUBGRAM_STATES.NO_CHANNELS,
                    shouldBlock: false, // НЕ БЛОКИРУЕМ - нет каналов для показа
                    channels: [],
                    message: 'SubGram требует подписку, но каналы недоступны - доступ разрешен'
                };
            }
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

        // 5. Fallback - это должно выполняться только если needsSubscription=false
        console.log('[SMART-SUBGRAM] Fallback: No channels and no subscription required - allowing access');
        return {
            state: SUBGRAM_STATES.NO_CHANNELS,
            shouldBlock: false, // НЕ блокируем - действительно нет требований
            channels: [],
            message: 'Спонсорские каналы недоступны для вас - доступ разрешен'
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
        
        let message = '🎯 **Спонсорские каналы**\n\n';
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
 * Проверить подписки пол��зовател�� на спонсорские каналы
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
            console.log('[SMART-SUBGRAM] No saved channels to check - refreshing state from SubGram API');
            // Обновляем состояние из API
            const newState = await getSubGramState(userId);
            console.log(`[SMART-SUBGRAM] Refreshed state: shouldBlock=${newState.shouldBlock}, channels=${newState.channels.length}`);
            return {
                allSubscribed: !newState.shouldBlock,
                channels: newState.channels,
                refreshed: true
            };
        }

        // Проверяем подписки на сохраненные каналы
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
                // ИСПРАВЛЕНИЕ: При ошибке проверки НЕ считаем автоматически подписанным
                // Вместо этого помечаем как "не удалось проверить" и блокируем доступ для безопасности
                isSubscribed = false; // Консервативный подход - требуем ручной проверки
                canCheck = false;
                console.log(`[SMART-SUBGRAM] Channel ${channelData.channel_link} marked as unsubscribed due to check error - conservative approach`);
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

        // ИСПРАВЛЕНИЕ: Если все подписки выполнены, принудительно обновляем состояние
        if (allSubscribed && checkedChannels.length > 0) {
            console.log(`[SMART-SUBGRAM] All subscriptions completed - force refreshing state to clear channels`);
            try {
                await forceRefreshSubGramState(userId);
            } catch (refreshError) {
                console.error(`[SMART-SUBGRAM] Error force refreshing after subscription completion:`, refreshError);
            }
        }

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
 * Принудительно обновить состояние SubGram для пользователя
 * Очищает сохраненные каналы и делает новый запрос к API
 * @param {number} userId - ID пользователя
 * @returns {Object} Новое состояние
 */
async function forceRefreshSubGramState(userId) {
    try {
        console.log(`[SMART-SUBGRAM] Force refreshing SubGram state for user ${userId}`);

        // Очищаем старые каналы
        await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
        console.log(`[SMART-SUBGRAM] Cleared old channels for user ${userId}`);

        // Получаем новое состояние (это сделает новый API запрос)
        const newState = await getSubGramState(userId);
        console.log(`[SMART-SUBGRAM] New state: ${newState.state}, shouldBlock: ${newState.shouldBlock}, channels: ${newState.channels.length}`);

        return newState;

    } catch (error) {
        console.error(`[SMART-SUBGRAM] Error force refreshing state for user ${userId}:`, error);
        return {
            state: SUBGRAM_STATES.API_ERROR,
            shouldBlock: false,
            channels: [],
            message: 'Ош��бка обновления состояния - доступ разрешен',
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

/**
 * Диагностическая функция для быстрой проверки состояния пользователя
 * @param {number} userId - ID пользователя
 * @returns {Object} Детальная информация о состоянии
 */
async function getDiagnosticInfo(userId) {
    try {
        console.log(`[SMART-SUBGRAM] Getting diagnostic info for user ${userId}`);

        // Проверяем настройки SubGram
        const settings = await db.getSubGramSettings();

        // Получаем сохраненные каналы
        const savedChannels = await db.executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 10
        `, [userId]);

        // Получаем последние API запросы
        const recentRequests = await db.executeQuery(`
            SELECT * FROM subgram_api_requests
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 5
        `, [userId]);

        // Получаем текущее состояние
        const currentState = await getSubGramState(userId);
        const accessCheck = await shouldBlockBotAccess(userId);

        return {
            userId: userId,
            timestamp: new Date().toISOString(),
            settings: {
                enabled: settings?.enabled || false,
                maxSponsors: settings?.max_sponsors || 0,
                hasApiKey: !!settings?.api_key
            },
            savedChannels: {
                count: savedChannels.rows.length,
                channels: savedChannels.rows.map(ch => ({
                    link: ch.channel_link,
                    name: ch.channel_name,
                    created: ch.created_at
                }))
            },
            recentRequests: {
                count: recentRequests.rows.length,
                requests: recentRequests.rows.map(req => ({
                    type: req.request_type,
                    success: req.success,
                    error: req.error_message,
                    created: req.created_at
                }))
            },
            currentState: {
                state: currentState.state,
                shouldBlock: currentState.shouldBlock,
                channelsCount: currentState.channels.length,
                message: currentState.message
            },
            accessDecision: {
                shouldBlock: accessCheck.shouldBlock,
                reason: accessCheck.reason
            }
        };

    } catch (error) {
        console.error('[SMART-SUBGRAM] Error getting diagnostic info:', error);
        return {
            userId: userId,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = {
    SUBGRAM_STATES,
    getSubGramState,
    shouldBlockBotAccess,
    getSubscriptionMessage,
    checkUserSubscriptions,
    forceRefreshSubGramState,
    getSubGramStats,
    getDiagnosticInfo
};
