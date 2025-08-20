/**
 * Упрощенная система проверки подписок
 * Проверяет ТОЛЬКО спонсорские каналы от SubGram
 * УДАЛЕНА логика обязательных каналов
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Получить все каналы для проверки (ТОЛЬКО SubGram)
 * @param {number} userId - ID пользователя
 * @returns {Object} Каналы от SubGram
 */
async function getAllChannelsForUser(userId) {
    const result = {
        subgramChannels: [],
        allChannels: [],
        hasSubgramChannels: false
    };

    try {
        console.log(`[UNIFIED] Getting SubGram channels for user ${userId}`);

        // Пытаемся получить каналы от SubGram
        try {
            // Проверяем настройки SubGram - возможно он ��тключен
            const subgramSettings = await db.getSubGramSettings();
            if (!subgramSettings || !subgramSettings.enabled) {
                console.log('[UNIFIED] SubGram disabled in settings, skipping');
                result.hasSubgramChannels = false;
            } else {
                // Сначала проверяем, есть ли сохраненные каналы (не старше 1 часа)
                const savedSubgramChannels = await db.executeQuery(`
                    SELECT * FROM subgram_channels
                    WHERE user_id = $1
                    AND created_at > NOW() - INTERVAL '1 hour'
                    ORDER BY created_at DESC
                `, [userId]);

                if (savedSubgramChannels.rows && savedSubgramChannels.rows.length > 0) {
                    console.log(`[UNIFIED] Found ${savedSubgramChannels.rows.length} recent saved SubGram channels`);

                    // Убираем дубликаты
                    const uniqueChannels = new Map();
                    savedSubgramChannels.rows.forEach(ch => {
                        if (!uniqueChannels.has(ch.channel_link)) {
                            uniqueChannels.set(ch.channel_link, ch);
                        }
                    });

                    result.subgramChannels = Array.from(uniqueChannels.values()).map(ch => ({
                        id: ch.channel_link,
                        name: ch.channel_name || 'Спонсорский канал',
                        type: 'subgram',
                        source: 'saved',
                        link: ch.channel_link
                    }));

                    result.hasSubgramChannels = result.subgramChannels.length > 0;
                } else {
                    // Если нет свежих сохраненных каналов, запрашиваем у SubGram
                    console.log('[UNIFIED] No recent saved SubGram channels, requesting from API...');

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
                            console.log(`[UNIFIED] Got ${processedData.channelsToSubscribe.length} fresh SubGram channels`);

                            // Убираем дубликаты
                            const uniqueChannels = new Map();
                            processedData.channelsToSubscribe.forEach(ch => {
                                if (!uniqueChannels.has(ch.link)) {
                                    uniqueChannels.set(ch.link, ch);
                                }
                            });

                            result.subgramChannels = Array.from(uniqueChannels.values()).map(ch => ({
                                id: ch.link,
                                name: ch.name || 'Спонсорский канал',
                                type: 'subgram',
                                source: 'api',
                                link: ch.link
                            }));

                            result.hasSubgramChannels = true;

                            // Очищаем старые каналы и сохраняем новые
                            await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                            await db.saveSubGramChannels(userId, Array.from(uniqueChannels.values()));
                        }

                        // Логируем запрос
                        await db.logSubGramAPIRequest(
                            userId,
                            'unified_check',
                            { action: 'subscribe', unified: true },
                            subgramResponse.data,
                            true
                        );
                    } else {
                        console.log('[UNIFIED] Failed to get SubGram channels or no channels available');

                        // Логируем неудачу
                        await db.logSubGramAPIRequest(
                            userId,
                            'unified_check_failed',
                            { action: 'subscribe', unified: true },
                            subgramResponse.data || {},
                            false,
                            subgramResponse.error || 'No channels available'
                        );
                    }
                }
            }
        } catch (subgramError) {
            console.error('[UNIFIED] Error getting SubGram channels:', subgramError);
            
            // Логируем ошибку
            await db.logSubGramAPIRequest(
                userId,
                'unified_check_error',
                { action: 'subscribe', unified: true },
                {},
                false,
                subgramError.message
            );
        }

        // Формируем общий список (теперь только SubGram)
        result.allChannels = [...result.subgramChannels];
        
        console.log(`[UNIFIED] Total channels to check: ${result.allChannels.length} (all SubGram)`);
        
        return result;

    } catch (error) {
        console.error('[UNIFIED] Error getting channels for user:', error);
        return {
            subgramChannels: [],
            allChannels: [],
            hasSubgramChannels: false,
            error: error.message
        };
    }
}

/**
 * Проверить подписку на один канал
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @param {Object} channel - Информация о канале
 * @returns {Object} Результат проверки
 */
async function checkSingleChannelSubscription(bot, userId, channel) {
    try {
        // Извлекаем username канала из ссылки для SubGram каналов
        let channelToCheck = channel.id;
        
        if (channel.type === 'subgram' && channel.id.includes('t.me/')) {
            // Извлекаем username из ссылки типа https://t.me/channelname
            const match = channel.id.match(/t\.me\/([^\/\?]+)/);
            if (match) {
                channelToCheck = '@' + match[1];
            }
        }

        // Проверяем подписку
        const member = await bot.getChatMember(channelToCheck, userId);
        const isSubscribed = !(member.status === 'left' || member.status === 'kicked');

        return {
            subscribed: isSubscribed,
            canCheck: true,
            status: member.status
        };

    } catch (error) {
        console.log(`[UNIFIED] Cannot check channel ${channel.id}: ${error.message}`);
        
        // Для SubGram каналов при ошибке считаем подписанным
        return {
            subscribed: true,
            canCheck: false,
            error: error.message
        };
    }
}

/**
 * Проверить подписки на все каналы (ТОЛЬКО SubGram)
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @param {boolean} recordStats - Записывать статистику
 * @returns {Object} Результат проверки
 */
async function checkUnifiedSubscriptions(bot, userId, recordStats = false) {
    try {
        console.log(`[UNIFIED] Starting subscription check for user ${userId}`);

        // 1. Получаем каналы
        const channelsData = await getAllChannelsForUser(userId);

        if (channelsData.error) {
            return {
                allSubscribed: false,
                channels: [],
                hasErrors: true,
                subgramChannels: [],
                error: channelsData.error
            };
        }

        if (channelsData.allChannels.length === 0) {
            console.log(`[UNIFIED] No channels found for user ${userId} - allowing access`);
            return {
                allSubscribed: true,
                channels: [],
                hasErrors: false,
                subgramChannels: []
            };
        }

        // 2. Создаем результат
        const result = {
            allSubscribed: true,
            channels: [],
            hasErrors: false,
            subgramChannels: [],
            hasSubgramChannels: channelsData.hasSubgramChannels
        };

        // 3. Проверяем подписки на все каналы
        for (const channel of channelsData.allChannels) {
            const subscriptionCheck = await checkSingleChannelSubscription(bot, userId, channel);

            const channelInfo = {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                subscribed: subscriptionCheck.subscribed,
                canCheck: subscriptionCheck.canCheck,
                link: channel.link || channel.id
            };

            if (!subscriptionCheck.subscribed) {
                result.allSubscribed = false;
            }

            if (!subscriptionCheck.canCheck) {
                result.hasErrors = true;
            }

            result.channels.push(channelInfo);
            result.subgramChannels.push(channelInfo);
        }

        console.log(`[UNIFIED] Check completed: ${result.channels.length} channels, allSubscribed: ${result.allSubscribed}`);

        // 4. Записываем статистику если требуется
        if (recordStats) {
            try {
                await db.recordSubscriptionCheck(userId, result.allSubscribed);
            } catch (statsError) {
                console.error('[UNIFIED] Error recording subscription stats:', statsError);
            }
        }

        return result;

    } catch (error) {
        console.error('[UNIFIED] Error in unified subscription check:', error);
        
        if (recordStats) {
            try {
                await db.recordSubscriptionCheck(userId, false);
            } catch (statError) {
                console.error('Error recording failed subscription check:', statError);
            }
        }

        return {
            allSubscribed: false,
            channels: [],
            hasErrors: true,
            subgramChannels: []
        };
    }
}

module.exports = {
    getAllChannelsForUser,
    checkSingleChannelSubscription,
    checkUnifiedSubscriptions
};
