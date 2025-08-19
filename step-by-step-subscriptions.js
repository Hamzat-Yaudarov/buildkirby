/**
 * Модуль поэтапной проверки подписок
 * Сначала спонсоры, потом обязательные каналы
 */

const db = require('./database');

/**
 * Проверить только спонсорские каналы (SubGram)
 */
async function checkSponsorsOnly(bot, userId) {
    try {
        console.log(`[SPONSORS] Checking only sponsors for user ${userId}`);
        
        // Get SubGram channels only
        const { getAllChannelsToCheck } = require('./unified-subscription-check');
        const channelsData = await getAllChannelsToCheck(userId);
        
        if (channelsData.subgramChannels.length === 0) {
            console.log(`[SPONSORS] No sponsors found - user can proceed`);
            return { hasSponsors: false, allSubscribed: true, channels: [] };
        }
        
        // Check subscriptions only for SubGram channels
        const result = {
            hasSponsors: true,
            allSubscribed: true,
            channels: [],
            hasErrors: false
        };
        
        for (const channel of channelsData.subgramChannels) {
            const channelInfo = {
                id: channel.id,
                name: channel.name,
                type: channel.type,
                subscribed: false,
                canCheck: true,
                error: null,
                link: channel.link || channel.id
            };
            
            try {
                // Extract username from SubGram link
                let channelToCheck = channel.id;
                if (channel.id.includes('t.me/')) {
                    const match = channel.id.match(/t\.me\/([^\/\?]+)/);
                    if (match) {
                        channelToCheck = '@' + match[1];
                    }
                }
                
                const member = await bot.getChatMember(channelToCheck, userId);
                channelInfo.subscribed = !(member.status === 'left' || member.status === 'kicked');
                
            } catch (error) {
                console.log(`[SPONSORS] Cannot check ${channel.id}: ${error.message}`);
                channelInfo.canCheck = false;
                channelInfo.error = error.message;
                channelInfo.subscribed = true; // Assume subscribed if can't check
                result.hasErrors = true;
            }
            
            result.channels.push(channelInfo);
            
            if (!channelInfo.subscribed && channelInfo.canCheck) {
                result.allSubscribed = false;
            }
        }
        
        console.log(`[SPONSORS] Result: ${result.allSubscribed}, channels: ${result.channels.length}`);
        return result;
        
    } catch (error) {
        console.error('[SPONSORS] Error checking sponsors:', error);
        return { hasSponsors: false, allSubscribed: false, channels: [], hasErrors: true };
    }
}

/**
 * Проверить только обязательные каналы
 */
async function checkRequiredChannelsOnly(bot, userId) {
    try {
        console.log(`[REQUIRED] Checking only required channels for user ${userId}`);
        
        const requiredChannelsResult = await db.executeQuery(
            'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE'
        );
        
        if (requiredChannelsResult.rows.length === 0) {
            console.log(`[REQUIRED] No required channels - user can proceed`);
            return { hasRequired: false, allSubscribed: true, channels: [] };
        }
        
        const result = {
            hasRequired: true,
            allSubscribed: true,
            channels: [],
            hasErrors: false
        };
        
        for (const row of requiredChannelsResult.rows) {
            const channelInfo = {
                id: row.channel_id,
                name: row.channel_name || row.channel_id,
                type: 'required',
                subscribed: false,
                canCheck: true,
                error: null
            };
            
            try {
                const member = await bot.getChatMember(row.channel_id, userId);
                channelInfo.subscribed = !(member.status === 'left' || member.status === 'kicked');
                
            } catch (error) {
                console.log(`[REQUIRED] Cannot check ${row.channel_id}: ${error.message}`);
                channelInfo.canCheck = false;
                channelInfo.error = error.message;
                channelInfo.subscribed = true; // Assume subscribed if can't check
                result.hasErrors = true;
            }
            
            result.channels.push(channelInfo);
            
            if (!channelInfo.subscribed && channelInfo.canCheck) {
                result.allSubscribed = false;
            }
        }
        
        console.log(`[REQUIRED] Result: ${result.allSubscribed}, channels: ${result.channels.length}`);
        return result;
        
    } catch (error) {
        console.error('[REQUIRED] Error checking required channels:', error);
        return { hasRequired: false, allSubscribed: false, channels: [], hasErrors: true };
    }
}

/**
 * Создать сообщение для спонсорских каналов
 */
function getSponsorSubscriptionMessage(sponsorChannels) {
    let message = '🎯 **Спонсорские каналы**\n\n';
    message += 'Для использования бота необходимо подписаться на спонсорские каналы:\n\n';
    
    const buttons = [];
    
    sponsorChannels.forEach((channel, index) => {
        const statusIcon = channel.canCheck ? '💎' : '⚠️';
        const statusText = channel.canCheck ? '' : ' (не можем проверить)';
        
        message += `${index + 1}. ${channel.name}${statusText}\n`;
        
        buttons.push([{
            text: `${statusIcon} ${channel.name}`,
            url: channel.link
        }]);
    });
    
    message += '\n📌 После подписки на все спонсорские каналы нажмите кнопку проверки';
    
    buttons.push([{ text: '✅ Проверить спонсоров', callback_data: 'check_sponsors_only' }]);
    
    return { message, buttons };
}

/**
 * Создать сообщение для обязательных каналов
 */
function getRequiredChannelsMessage(requiredChannels) {
    let message = '📺 **Обязательные каналы**\n\n';
    message += 'Теперь подпишитесь на обязательные каналы:\n\n';
    
    const buttons = [];
    
    requiredChannels.forEach((channel, index) => {
        const statusIcon = channel.canCheck ? '📺' : '⚠️';
        const statusText = channel.canCheck ? '' : ' (не можем проверить)';
        
        message += `${index + 1}. ${channel.name}${statusText}\n`;
        
        const channelLink = channel.id.startsWith('@') ?
            `https://t.me/${channel.id.substring(1)}` :
            channel.id;
        
        buttons.push([{
            text: `${statusIcon} ${channel.name}`,
            url: channelLink
        }]);
    });
    
    message += '\n📌 После подписки на все обязательные каналы нажмите кнопку проверки';
    
    buttons.push([{ text: '✅ Проверить обязательные', callback_data: 'check_required_only' }]);
    
    return { message, buttons };
}

module.exports = {
    checkSponsorsOnly,
    checkRequiredChannelsOnly,
    getSponsorSubscriptionMessage,
    getRequiredChannelsMessage
};
