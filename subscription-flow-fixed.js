/**
 * ИСПРАВЛЕННАЯ поэтапная система подписок
 * Гарантирует строгое разделение: Спонсоры → Обязательные → Завершение
 */

const db = require('./database');
const { subgramAPI } = require('./subgram-api');

const STAGES = {
    SPONSORS: 'sponsors',
    REQUIRED: 'required', 
    COMPLETED: 'completed'
};

/**
 * Получить текущий этап пользователя
 * ПРОСТАЯ логика: сначала спонсоры, потом обязательные, потом готово
 */
async function getUserStage(bot, userId) {
    try {
        console.log(`[FIXED_FLOW] Checking stage for user ${userId}`);
        
        // 1. Получаем спонсорские каналы
        const sponsorChannels = await getSponsorChannelsSimple(userId);
        console.log(`[FIXED_FLOW] Found ${sponsorChannels.length} sponsor channels`);
        
        // 2. Если есть спонсоры - проверяем их подписки
        if (sponsorChannels.length > 0) {
            const sponsorStatus = await checkChannelsWithBot(bot, userId, sponsorChannels);
            console.log(`[FIXED_FLOW] Sponsor status: ${sponsorStatus.subscribed}/${sponsorStatus.total}`);
            
            if (!sponsorStatus.allSubscribed) {
                // Не все спонсоры подписаны - показываем этап спонсоров
                return {
                    stage: STAGES.SPONSORS,
                    channels: sponsorChannels,
                    allCompleted: false,
                    message: 'Подпишитесь на спонсорские каналы:',
                    buttonText: 'Проверить спонсоров',
                    buttonCallback: 'check_sponsors'
                };
            }
        }
        
        // 3. Спонсоры выполнены (или нет) - проверяем обязательные
        const requiredChannels = await getRequiredChannelsSimple();
        console.log(`[FIXED_FLOW] Found ${requiredChannels.length} required channels`);
        
        if (requiredChannels.length > 0) {
            const requiredStatus = await checkChannelsWithBot(bot, userId, requiredChannels);
            console.log(`[FIXED_FLOW] Required status: ${requiredStatus.subscribed}/${requiredStatus.total}`);
            
            if (!requiredStatus.allSubscribed) {
                // Не все обязательные подписаны - показываем этап обязательных
                return {
                    stage: STAGES.REQUIRED,
                    channels: requiredChannels,
                    allCompleted: false,
                    message: 'Подпишитесь на обязательные каналы:',
                    buttonText: 'Проверить обязательные',
                    buttonCallback: 'check_required'
                };
            }
        }
        
        // 4. Все выполнено
        return {
            stage: STAGES.COMPLETED,
            channels: [],
            allCompleted: true,
            message: 'Все подписки выполнены!',
            buttonText: 'В главное меню',
            buttonCallback: 'main_menu'
        };
        
    } catch (error) {
        console.error('[FIXED_FLOW] Error getting user stage:', error);
        return {
            stage: STAGES.SPONSORS,
            channels: [],
            allCompleted: false,
            message: 'Ошибка проверки подписок',
            buttonText: 'Попробовать снова',
            buttonCallback: 'check_sponsors'
        };
    }
}

/**
 * Получить спонсорские каналы (упрощенно)
 */
async function getSponsorChannelsSimple(userId) {
    try {
        // Проверяем настройки SubGram
        const subgramSettings = await db.getSubGramSettings();
        if (!subgramSettings || !subgramSettings.enabled) {
            console.log('[FIXED_FLOW] SubGram disabled');
            return [];
        }

        // Проверяем сохраненные каналы
        const savedChannels = await db.executeQuery(`
            SELECT DISTINCT channel_link, channel_name 
            FROM subgram_channels
            WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '1 hour'
            ORDER BY created_at DESC
        `, [userId]);

        if (savedChannels.rows && savedChannels.rows.length > 0) {
            console.log(`[FIXED_FLOW] Using ${savedChannels.rows.length} saved sponsor channels`);
            return savedChannels.rows.map(ch => ({
                id: ch.channel_link,
                name: ch.channel_name || 'Спонсорский канал',
                link: ch.channel_link,
                type: 'sponsor',
                subscribed: false
            }));
        }

        // Запрашиваем новые у SubGram
        console.log('[FIXED_FLOW] Requesting fresh sponsor channels...');
        const subgramResponse = await subgramAPI.requestSponsors({
            userId: userId.toString(),
            chatId: userId.toString(),
            maxOP: subgramSettings.max_sponsors || 3,
            action: 'subscribe',
            excludeChannelIds: [],
            withToken: true
        });

        if (subgramResponse.success && subgramResponse.data) {
            const processedData = subgramAPI.processAPIResponse(subgramResponse.data);
            if (processedData.channelsToSubscribe && processedData.channelsToSubscribe.length > 0) {
                const channels = processedData.channelsToSubscribe.map(ch => ({
                    id: ch.link,
                    name: ch.name || 'Спонсорский канал',
                    link: ch.link,
                    type: 'sponsor',
                    subscribed: false
                }));
                
                // Сохраняем новые каналы
                await db.executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);
                await db.saveSubGramChannels(userId, processedData.channelsToSubscribe);
                
                return channels;
            }
        }

        return [];
        
    } catch (error) {
        console.error('[FIXED_FLOW] Error getting sponsor channels:', error);
        return [];
    }
}

/**
 * Получить обязательные каналы (упрощенно)
 */
async function getRequiredChannelsSimple() {
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
            subscribed: false
        }));
        
    } catch (error) {
        console.error('[FIXED_FLOW] Error getting required channels:', error);
        return [];
    }
}

/**
 * Проверить подписки на каналы с помощью бота
 */
async function checkChannelsWithBot(bot, userId, channels) {
    let subscribedCount = 0;
    
    for (const channel of channels) {
        try {
            let channelToCheck = channel.id;
            
            // Для спонсорских каналов извлекаем username из ссылки
            if (channel.type === 'sponsor' && channel.id.includes('t.me/')) {
                const match = channel.id.match(/t\.me\/([^\/\?]+)/);
                if (match) {
                    channelToCheck = '@' + match[1];
                }
            }
            
            console.log(`[FIXED_FLOW] Checking ${channelToCheck} for user ${userId}`);
            
            const member = await bot.getChatMember(channelToCheck, userId);
            const isSubscribed = !(member.status === 'left' || member.status === 'kicked');
            
            channel.subscribed = isSubscribed;
            if (isSubscribed) {
                subscribedCount++;
            }
            
            console.log(`[FIXED_FLOW] ${channelToCheck}: ${isSubscribed ? 'subscribed' : 'not subscribed'}`);
            
        } catch (error) {
            console.log(`[FIXED_FLOW] Cannot check ${channel.id}: ${error.message}`);
            channel.subscribed = false; // В случае ошибки считаем НЕ подписанным
        }
    }
    
    return {
        allSubscribed: subscribedCount === channels.length,
        subscribed: subscribedCount,
        total: channels.length
    };
}

/**
 * Форматировать сообщение для этапа
 */
function formatStageMessage(stageInfo) {
    if (stageInfo.allCompleted) {
        return {
            message: '✅ **Отлично!**\n\nВы подписаны на все необходимые каналы!\n\n🎉 Можете пользоваться ботом.',
            buttons: [
                [{ text: '🏠 В главное меню', callback_data: 'main_menu' }]
            ]
        };
    }
    
    let message = '';
    const buttons = [];
    
    if (stageInfo.stage === STAGES.SPONSORS) {
        message = '🎯 **Спонсорские каналы**\n\nДля начала работы подпишитесь на спонсорские каналы:\n\n';
    } else if (stageInfo.stage === STAGES.REQUIRED) {
        message = '📋 **Обязательные каналы**\n\nТеперь подпишитесь на обязательные каналы:\n\n';
    }
    
    // Добавляем каналы
    stageInfo.channels.forEach((channel, index) => {
        message += `${index + 1}. ${channel.name}\n`;
        
        const emoji = stageInfo.stage === STAGES.SPONSORS ? '💎' : '📺';
        buttons.push([{
            text: `${emoji} ${channel.name}`,
            url: channel.link
        }]);
    });
    
    message += '\n📌 После подписки нажмите кнопку проверки';
    buttons.push([{ 
        text: `✅ ${stageInfo.buttonText}`, 
        callback_data: stageInfo.buttonCallback 
    }]);
    
    return { message, buttons };
}

/**
 * Проверить, может ли пользователь использовать бота
 */
async function canUserUseBot(bot, userId) {
    try {
        const stageInfo = await getUserStage(bot, userId);
        return stageInfo.allCompleted;
    } catch (error) {
        console.error('[FIXED_FLOW] Error checking bot access:', error);
        return false;
    }
}

module.exports = {
    STAGES,
    getUserStage,
    formatStageMessage,
    canUserUseBot,
    getSponsorChannelsSimple,
    getRequiredChannelsSimple,
    checkChannelsWithBot
};
