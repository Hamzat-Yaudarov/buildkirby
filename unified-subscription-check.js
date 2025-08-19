/**
 * Объединённая система проверки подписок
 * Проверяет И обязательные каналы И спонсорские каналы от SubGram
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

/**
 * Получить все каналы для проверки (обязательные + SubGram)
 * @param {number} userId - ID пользователя
 * @returns {Object} Объект с каналами для проверки
 */
async function getAllChannelsToCheck(userId) {
    const result = {
        requiredChannels: [],
        subgramChannels: [],
        allChannels: [],
        hasSubgramChannels: false
    };

    try {
        // 1. Получаем обязательные каналы из БД
        const requiredChannelsData = await db.executeQuery(
            'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE'
        );

        result.requiredChannels = requiredChannelsData.rows.map(ch => ({
            id: ch.channel_id,
            name: ch.channel_name || ch.channel_id,
            type: 'required',
            source: 'database'
        }));

        console.log(`[UNIFIED] Found ${result.requiredChannels.length} required channels`);

        // 2. Пытаемся получить каналы от SubGram
        try {
            // Сначала проверяем, есть ли сохраненные каналы
            const savedSubgramChannels = await db.getSubGramChannels(userId);
            
            if (savedSubgramChannels && savedSubgramChannels.length > 0) {
                console.log(`[UNIFIED] Found ${savedSubgramChannels.length} saved SubGram channels`);
                
                result.subgramChannels = savedSubgramChannels.map(ch => ({
                    id: ch.channel_link,
                    name: ch.channel_name || 'Спонсорский канал',
                    type: 'subgram',
                    source: 'saved',
                    link: ch.channel_link
                }));
                
                result.hasSubgramChannels = true;
            } else {
                // Если нет сохраненных каналов, запрашиваем у SubGram
                console.log('[UNIFIED] No saved SubGram channels, requesting from API...');
                
                const subgramResponse = await subgramAPI.requestSponsors({
                    userId: userId.toString(),
                    chatId: userId.toString(),
                    maxOP: 3,
                    action: 'subscribe',
                    excludeChannelIds: [],
                    withToken: true
                });

                if (subgramResponse.success && subgramResponse.data) {
                    const processedData = subgramAPI.processAPIResponse(subgramResponse.data);
                    
                    if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                        console.log(`[UNIFIED] Got ${processedData.channelsToSubscribe.length} fresh SubGram channels`);
                        
                        result.subgramChannels = processedData.channelsToSubscribe.map(ch => ({
                            id: ch.link,
                            name: ch.name || 'Спонсорский канал',
                            type: 'subgram',
                            source: 'api',
                            link: ch.link
                        }));
                        
                        result.hasSubgramChannels = true;
                        
                        // Сохраняем каналы в БД для следующих проверок
                        await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);
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
                        'unified_check',
                        { action: 'subscribe', unified: true },
                        subgramResponse.data || {},
                        false,
                        subgramResponse.error || 'No channels available'
                    );
                }
            }
        } catch (subgramError) {
            console.error('[UNIFIED] Error getting SubGram channels:', subgramError);
            
            // Логируем ошибку, но не блокируем работу с обязательными каналами
            await db.logSubGramAPIRequest(
                userId,
                'unified_check',
                { action: 'subscribe', unified: true },
                {},
                false,
                subgramError.message
            );
        }

        // 3. Объединяем все каналы
        result.allChannels = [...result.requiredChannels, ...result.subgramChannels];
        
        console.log(`[UNIFIED] Total channels to check: ${result.allChannels.length} (${result.requiredChannels.length} required + ${result.subgramChannels.length} subgram)`);
        
        return result;

    } catch (error) {
        console.error('[UNIFIED] Error getting channels to check:', error);
        return {
            requiredChannels: [],
            subgramChannels: [],
            allChannels: [],
            hasSubgramChannels: false,
            error: error.message
        };
    }
}

/**
 * Проверить подписку пользователя на конкретный канал
 * @param {Object} bot - Экземпляр Telegram бота
 * @param {number} userId - ID пользователя
 * @param {Object} channel - Информация о канале
 * @returns {Object} Результат проверки
 */
async function checkChannelSubscription(bot, userId, channel) {
    const channelInfo = {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        source: channel.source,
        subscribed: false,
        canCheck: true,
        error: null,
        link: channel.link || channel.id
    };

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

        console.log(`[UNIFIED] Checking subscription for ${channelToCheck} (${channel.type})`);
        
        const member = await bot.getChatMember(channelToCheck, userId);
        channelInfo.subscribed = !(member.status === 'left' || member.status === 'kicked');
        
        console.log(`[UNIFIED] User ${userId} subscription to ${channelToCheck}: ${channelInfo.subscribed}`);
        
    } catch (error) {
        console.log(`[UNIFIED] Cannot check subscription for ${channel.id}: ${error.message}`);
        channelInfo.canCheck = false;
        channelInfo.error = error.message;
        
        // Для каналов которые не можем проверить - считаем их подписанными
        // чтобы не блокировать пользователей из-за технических проблем
        channelInfo.subscribed = true;
    }

    return channelInfo;
}

/**
 * Проверить подписки на все каналы (обязательные + SubGram)
 * @param {Object} bot - Экземпляр Telegram бот��
 * @param {number} userId - ID пользователя
 * @param {boolean} recordStats - Записывать статистику
 * @returns {Object} Подробный результат проверки
 */
async function checkUnifiedSubscriptions(bot, userId, recordStats = false) {
    console.log(`[UNIFIED] Starting unified subscription check for user ${userId}`);
    
    try {
        // Получаем все каналы для проверки
        const channelsData = await getAllChannelsToCheck(userId);
        
        if (channelsData.error) {
            console.error('[UNIFIED] Error getting channels:', channelsData.error);
            return { 
                allSubscribed: false, 
                channels: [], 
                hasErrors: true,
                subgramChannels: [],
                requiredChannels: [],
                error: channelsData.error
            };
        }

        if (channelsData.allChannels.length === 0) {
            console.log('[UNIFIED] No channels to check');
            return { 
                allSubscribed: true, 
                channels: [], 
                hasErrors: false,
                subgramChannels: [],
                requiredChannels: []
            };
        }

        const result = {
            allSubscribed: true,
            channels: [],
            hasErrors: false,
            subgramChannels: [],
            requiredChannels: [],
            hasSubgramChannels: channelsData.hasSubgramChannels
        };

        // Проверяем подписки на все каналы
        for (const channel of channelsData.allChannels) {
            const channelInfo = await checkChannelSubscription(bot, userId, channel);
            
            result.channels.push(channelInfo);
            
            // Разделяем каналы по типам для удобства
            if (channel.type === 'required') {
                result.requiredChannels.push(channelInfo);
            } else if (channel.type === 'subgram') {
                result.subgramChannels.push(channelInfo);
            }
            
            // Отмечаем если есть ошибки проверки
            if (!channelInfo.canCheck) {
                result.hasErrors = true;
            }
            
            // Блокируем только если пользователь точно не подписан на проверяемый канал
            if (!channelInfo.subscribed && channelInfo.canCheck) {
                result.allSubscribed = false;
            }
        }

        // Записываем статистику
        if (recordStats) {
            try {
                await db.recordSubscriptionCheck(userId, result.allSubscribed || result.hasErrors);
            } catch (statError) {
                console.error('[UNIFIED] Error recording subscription check:', statError);
            }
        }

        // Обновляем статус подписки пользователя
        if (!result.allSubscribed && !result.hasErrors) {
            try {
                const user = await db.getUser(userId);
                if (user && user.subscription_notified && user.is_subscribed) {
                    const unsubscribedChannels = result.channels.filter(ch => !ch.subscribed && ch.canCheck);
                    if (unsubscribedChannels.length > 0) {
                        await db.resetSubscriptionNotified(userId);
                        await db.updateUserField(userId, 'is_subscribed', false);
                        console.log(`[UNIFIED] Reset subscription status for user ${userId} due to unsubscription from ${unsubscribedChannels.length} channels`);
                    }
                }
            } catch (error) {
                console.error('[UNIFIED] Error updating subscription status:', error);
            }
        }

        console.log(`[UNIFIED] Check completed: allSubscribed=${result.allSubscribed}, channels=${result.channels.length}, errors=${result.hasErrors}`);
        return result;

    } catch (error) {
        console.error('[UNIFIED] Error in unified subscription check:', error);
        
        if (recordStats) {
            try {
                await db.recordSubscriptionCheck(userId, false);
            } catch (statError) {
                console.error('[UNIFIED] Error recording failed subscription check:', statError);
            }
        }
        
        return { 
            allSubscribed: false, 
            channels: [], 
            hasErrors: true,
            subgramChannels: [],
            requiredChannels: [],
            error: error.message
        };
    }
}

module.exports = {
    getAllChannelsToCheck,
    checkChannelSubscription,
    checkUnifiedSubscriptions
};
