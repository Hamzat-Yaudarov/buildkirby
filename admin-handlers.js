const db = require('./database');

// Admin callback handler additions for index.js
async function handleAdminTasks(bot, chatId, messageId) {
    try {
        const message = `📋 **Управление заданиями**

Для создания задания отправьте сообщение в формате:
\`тип|название|награда|лимит\`

Пример: \`канал|@example|1|100\`

Доступные команды:
• /create_task - создать задание
• /delete_task ID - удалить задание
• /list_tasks - список заданий`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 ��писок заданий', callback_data: 'admin_list_tasks' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in handleAdminTasks:', error);
        await bot.editMessageText('❌ Ошибка загрузки управления заданиями.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

async function handleAdminChannels(bot, chatId, messageId) {
    try {
        const message = `📺 **Управление обязательными каналами**

Для добавления канала отправьте сообщение в формате:
\`@channel_name|Название канала\`

Доступные команды:
• /add_channel - добавить канал
• /remove_channel ID - удалить канал
• /list_channels - список каналов`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📺 Список каналов', callback_data: 'admin_list_channels' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in handleAdminChannels:', error);
        await bot.editMessageText('❌ Ошибка загрузки управления каналами.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

async function handleAdminLottery(bot, chatId, messageId) {
    try {
        const message = `🎰 **Управление лотереями**

Для создания лотереи отправьте сообщение в формате:
\`название|количество_билетов|цена_билета|количество_победителей|процент_боту\`

Пример: \`Еженедельная|100|5|10|20\`

Доступные команды:
• /create_lottery - создать лотерею
• /end_lottery ID - завершить лотерею
• /list_lotteries - список лотерей`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎰 Список лотерей', callback_data: 'admin_list_lotteries' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in handleAdminLottery:', error);
        await bot.editMessageText('❌ Ошибка загрузки управления лотереями.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

async function handleAdminPromocodes(bot, chatId, messageId) {
    try {
        const message = `🎁 **Управление промокодами**

Для создания промокода отправьте сообщение в формате:
\`КОД|количество_звезд|количество_активаций\`

Пример: \`WELCOME|0.5|100\`

Доступные команды:
• /create_promo - создать ��ромокод
• /deactivate_promo КОД - деактивировать
• /list_promos - список промокодов`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎁 Список промокодов', callback_data: 'admin_list_promos' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in handleAdminPromocodes:', error);
        await bot.editMessageText('❌ Ошибка загрузки управления промокодами.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

async function handleAdminBroadcast(bot, chatId, messageId) {
    try {
        const message = `📢 **Рассылка сообщений**

Выберите тип рассылки:`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 Новые задания ждут тебя', callback_data: 'broadcast_tasks' }],
                    [{ text: '🏆 Попади в топ 5 по рефералам', callback_data: 'broadcast_referrals' }],
                    [{ text: '✏️ Написать своё сообщение', callback_data: 'broadcast_custom' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('Error in handleAdminBroadcast:', error);
        await bot.editMessageText('❌ Ошибка загрузки рассылки.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    }
}

// Broadcast handlers
async function handleBroadcastTasks(bot, chatId, messageId) {
    try {
        const users = await db.executeQuery('SELECT id FROM users WHERE is_subscribed = TRUE');
        let successCount = 0;
        
        const message = `📋 **Новые задания ждут тебя!**

Не упусти возможность заработать дополнительные звёзды!`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 Задания', callback_data: 'tasks' }],
                    [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                ]
            }
        };

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.id, message, {
                    parse_mode: 'Markdown',
                    ...keyboard
                });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
            } catch (error) {
                console.error(`Failed to send to user ${user.id}:`, error.message);
            }
        }

        await bot.editMessageText(`✅ Рассылка завершена! Отправлено ${successCount} из ${users.rows.length} пользователей.`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_broadcast' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error in broadcast tasks:', error);
        await bot.editMessageText('❌ Ошибка рассылки.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_broadcast' }]
                ]
            }
        });
    }
}

async function handleBroadcastReferrals(bot, chatId, messageId) {
    try {
        const users = await db.executeQuery('SELECT id FROM users WHERE is_subscribed = TRUE');
        let successCount = 0;
        
        const message = `🏆 **Попади в топ 5 по рефералам и получи еженедельные призы!**

Приглашай друзей и зарабатывай больше звёзд!`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 Пригласить друга', callback_data: 'invite' }],
                    [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
                ]
            }
        };

        for (const user of users.rows) {
            try {
                await bot.sendMessage(user.id, message, {
                    parse_mode: 'Markdown',
                    ...keyboard
                });
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
            } catch (error) {
                console.error(`Failed to send to user ${user.id}:`, error.message);
            }
        }

        await bot.editMessageText(`✅ Рассылка завершена! Отправлено ${successCount} из ${users.rows.length} пользователей.`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_broadcast' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error in broadcast referrals:', error);
        await bot.editMessageText('❌ Ошибка рассылки.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_broadcast' }]
                ]
            }
        });
    }
}

// List handlers
async function handleAdminListTasks(bot, chatId, messageId) {
    try {
        const tasks = await db.executeQuery('SELECT * FROM tasks ORDER BY id');
        
        let message = '📋 **Список заданий**\n\n';
        
        if (tasks.rows.length === 0) {
            message += 'Заданий пока нет.';
        } else {
            tasks.rows.forEach((task, index) => {
                message += `${index + 1}. **${task.channel_name || task.channel_id}**\n`;
                message += `   ID: ${task.id}\n`;
                message += `   Канал: ${task.channel_id}\n`;
                message += `   Награда: ${task.reward} ⭐\n`;
                message += `   Статус: ${task.is_active ? '✅ Активно' : '❌ Неактивно'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_tasks' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error listing tasks:', error);
        await bot.editMessageText('❌ Ошибка загрузки заданий.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_tasks' }]
                ]
            }
        });
    }
}

async function handleAdminListChannels(bot, chatId, messageId) {
    try {
        const channels = await db.executeQuery('SELECT * FROM required_channels ORDER BY id');
        
        let message = '📺 **Список обязательных каналов**\n\n';
        
        if (channels.rows.length === 0) {
            message += 'Каналов пока нет.';
        } else {
            channels.rows.forEach((channel, index) => {
                message += `${index + 1}. **${channel.channel_name || channel.channel_id}**\n`;
                message += `   ID: ${channel.id}\n`;
                message += `   Канал: ${channel.channel_id}\n`;
                message += `   Статус: ${channel.is_active ? '✅ Активно' : '❌ Неактивно'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_channels' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error listing channels:', error);
        await bot.editMessageText('❌ Ошибка загрузки каналов.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_channels' }]
                ]
            }
        });
    }
}

async function handleAdminListLotteries(bot, chatId, messageId) {
    try {
        const lotteries = await db.executeQuery('SELECT * FROM lotteries ORDER BY id');
        
        let message = '🎰 **Список лотерей**\n\n';
        
        if (lotteries.rows.length === 0) {
            message += 'Лотерей пока нет.';
        } else {
            lotteries.rows.forEach((lottery, index) => {
                message += `${index + 1}. **${lottery.name}**\n`;
                message += `   ID: ${lottery.id}\n`;
                message += `   Цена билета: ${lottery.ticket_price} ⭐\n`;
                message += `   Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
                message += `   Победителей: ${lottery.winners_count}\n`;
                message += `   Статус: ${lottery.is_active ? '✅ Акти��но' : '❌ Завершено'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_lottery' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error listing lotteries:', error);
        await bot.editMessageText('❌ Ошибка загрузки лотерей.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_lottery' }]
                ]
            }
        });
    }
}

async function handleAdminListPromos(bot, chatId, messageId) {
    try {
        const promos = await db.executeQuery('SELECT * FROM promocodes ORDER BY id');
        
        let message = '🎁 **Список промокодов**\n\n';
        
        if (promos.rows.length === 0) {
            message += 'Промокодов пока нет.';
        } else {
            promos.rows.forEach((promo, index) => {
                message += `${index + 1}. **${promo.code}**\n`;
                message += `   ID: ${promo.id}\n`;
                message += `   Награда: ${promo.reward} ⭐\n`;
                message += `   Использований: ${promo.current_uses}/${promo.max_uses || '∞'}\n`;
                message += `   Статус: ${promo.is_active ? '✅ Активен' : '❌ Неактивен'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_promocodes' }]
                ]
            }
        });

    } catch (error) {
        console.error('Error listing promocodes:', error);
        await bot.editMessageText('❌ Ошибка загрузки промокодов.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад', callback_data: 'admin_promocodes' }]
                ]
            }
        });
    }
}

module.exports = {
    handleAdminTasks,
    handleAdminChannels,
    handleAdminLottery,
    handleAdminPromocodes,
    handleAdminBroadcast,
    handleBroadcastTasks,
    handleBroadcastReferrals,
    handleAdminListTasks,
    handleAdminListChannels,
    handleAdminListLotteries,
    handleAdminListPromos
};
