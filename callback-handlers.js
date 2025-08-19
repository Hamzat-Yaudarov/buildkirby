// Temporary handlers for new subscription buttons

const stepByStepSubs = require('./step-by-step-subscriptions');

async function handleCheckSponsorsOnly(bot, chatId, messageId, userId) {
    try {
        console.log(`[SPONSORS_CHECK] Checking sponsors for user ${userId}`);
        
        const sponsorCheck = await stepByStepSubs.checkSponsorsOnly(bot, userId);
        
        if (!sponsorCheck.hasSponsors) {
            // No sponsors - check required
            const requiredCheck = await stepByStepSubs.checkRequiredChannelsOnly(bot, userId);
            if (requiredCheck.hasRequired && !requiredCheck.allSubscribed) {
                const msg = stepByStepSubs.getRequiredChannelsMessage(requiredCheck.channels);
                await bot.editMessageText(msg.message, {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: msg.buttons }
                });
            } else {
                await bot.editMessageText('✅ Все подписки проверены!', {
                    chat_id: chatId, message_id: messageId
                });
            }
        } else if (sponsorCheck.allSubscribed) {
            // Sponsors OK - check required
            const requiredCheck = await stepByStepSubs.checkRequiredChannelsOnly(bot, userId);
            if (requiredCheck.hasRequired && !requiredCheck.allSubscribed) {
                const msg = stepByStepSubs.getRequiredChannelsMessage(requiredCheck.channels);
                await bot.editMessageText(msg.message, {
                    chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: msg.buttons }
                });
            } else {
                await bot.editMessageText('✅ Все подписки проверены!', {
                    chat_id: chatId, message_id: messageId
                });
            }
        } else {
            // Still need to subscribe to sponsors
            const msg = stepByStepSubs.getSponsorSubscriptionMessage(sponsorCheck.channels);
            await bot.editMessageText(msg.message, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: msg.buttons }
            });
        }
        
    } catch (error) {
        console.error('[SPONSORS_CHECK] Error:', error);
        await bot.editMessageText('❌ Ошибка проверки спонсорских каналов.', {
            chat_id: chatId, message_id: messageId
        });
    }
}

async function handleCheckRequiredOnly(bot, chatId, messageId, userId) {
    try {
        console.log(`[REQUIRED_CHECK] Checking required for user ${userId}`);
        
        const requiredCheck = await stepByStepSubs.checkRequiredChannelsOnly(bot, userId);
        
        if (!requiredCheck.hasRequired || requiredCheck.allSubscribed) {
            await bot.editMessageText('✅ Все подписки проверены!', {
                chat_id: chatId, message_id: messageId
            });
        } else {
            const msg = stepByStepSubs.getRequiredChannelsMessage(requiredCheck.channels);
            await bot.editMessageText(msg.message, {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: msg.buttons }
            });
        }
        
    } catch (error) {
        console.error('[REQUIRED_CHECK] Error:', error);
        await bot.editMessageText('❌ Ошибка проверки обязательных каналов.', {
            chat_id: chatId, message_id: messageId
        });
    }
}

module.exports = {
    handleCheckSponsorsOnly,
    handleCheckRequiredOnly
};
