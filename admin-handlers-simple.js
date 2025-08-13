console.log('[ADMIN-HANDLERS] Starting import...');

let db = null;
try {
    db = require('./database');
    console.log('[ADMIN-HANDLERS] Database imported successfully:', typeof db);
} catch (error) {
    console.error('[ADMIN-HANDLERS] Error importing database:', error);
}

console.log('[ADMIN-HANDLERS] Import completed');

// Simple admin handlers that definitely work
async function handleAdminTasks(bot, chatId, messageId) {
    console.log('[SIMPLE ADMIN] handleAdminTasks called - START');
    console.log('[SIMPLE ADMIN] Parameters:', { chatId, messageId, botType: typeof bot });

    try {
        console.log('[SIMPLE ADMIN] Creating message...');
        const message = `📋 **Управление заданиями**

🛠️ **Команды для создания заданий:**
• /create_task канал|@example|1|100

📋 **Доступные действия:**
• Создание новых заданий
• Просмотр существующих заданий
• Управление активностью заданий`;

        console.log('[SIMPLE ADMIN] Calling bot.editMessageText...');
        console.log('[SIMPLE ADMIN] Message length:', message.length);

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 Список заданий', callback_data: 'admin_list_tasks' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });

        console.log('[SIMPLE ADMIN] handleAdminTasks completed successfully');
    } catch (error) {
        console.error('[SIMPLE ADMIN] Error in handleAdminTasks:', error);
        console.error('[SIMPLE ADMIN] Error type:', error.constructor.name);
        console.error('[SIMPLE ADMIN] Error message:', error.message);
        console.error('[SIMPLE ADMIN] Error stack:', error.stack);

        try {
            await bot.editMessageText('❌ Ошибка загрузки управления заданиями.', {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                    ]
                }
            });
        } catch (secondError) {
            console.error('[SIMPLE ADMIN] Error sending error message:', secondError);
        }
    }
}

async function handleAdminChannels(bot, chatId, messageId) {
    console.log('[SIMPLE ADMIN] handleAdminChannels called - START');

    try {
        console.log('[SIMPLE ADMIN] Testing ultra-simple message first...');

        // Сначала попробуем самое простое сообщение без Markdown
        await bot.editMessageText('ТЕСТ: Управление каналами работает!', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Назад', callback_data: 'admin_menu' }]
                ]
            }
        });

        console.log('[SIMPLE ADMIN] Ultra-simple test successful!');

    } catch (error) {
        console.error('[SIMPLE ADMIN] Error in handleAdminChannels:', error);
        console.error('[SIMPLE ADMIN] Error type:', error.constructor.name);
        console.error('[SIMPLE ADMIN] Error message:', error.message);

        try {
            // Попробуем отправить еще более простое сообщение
            await bot.editMessageText('ERROR', {
                chat_id: chatId,
                message_id: messageId
            });
        } catch (secondError) {
            console.error('[SIMPLE ADMIN] Error sending error message:', secondError);
        }
    }
}

async function handleAdminLottery(bot, chatId, messageId) {
    console.log('[SIMPLE ADMIN] handleAdminLottery called');
    
    try {
        const message = `🎰 **Управление лотереями**

🛠️ **Команд�� для создания лотерей:**
• /create_lottery название|100|5|10|20

🎰 **Доступные действия:**
• Создание новых лотерей
• Просмотр активных лотерей
• Завершение лотерей`;

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
        
        console.log('[SIMPLE ADMIN] handleAdminLottery completed successfully');
    } catch (error) {
        console.error('[SIMPLE ADMIN] Error in handleAdminLottery:', error);
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
    console.log('[SIMPLE ADMIN] handleAdminPromocodes called');
    
    try {
        const message = `🎁 **Управление промокодами**

🛠️ **Команды для создания промокодов:**
• /create_promo КОД|0.5|100

🎁 **Доступные действия:**
• Создание новых промокодов
• Просмотр активных промокодов
• Деактивация промокодов`;

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
        
        console.log('[SIMPLE ADMIN] handleAdminPromocodes completed successfully');
    } catch (error) {
        console.error('[SIMPLE ADMIN] Error in handleAdminPromocodes:', error);
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

// Simple list functions
async function handleAdminListTasks(bot, chatId, messageId) {
    try {
        const tasks = await db.executeQuery('SELECT * FROM tasks ORDER BY id');
        
        let message = '📋 **Список заданий**\n\n';
        
        if (tasks.rows.length === 0) {
            message += 'Заданий пока нет.';
        } else {
            tasks.rows.forEach((task, index) => {
                message += `${index + 1}. **${task.channel_name || task.channel_id}**\n`;
                message += `   ID: ${task.id} | Награда: ${task.reward} ⭐\n`;
                message += `   Статус: ${task.is_active ? '✅' : '❌'}\n\n`;
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
        console.error('[SIMPLE ADMIN] Error listing tasks:', error);
        await bot.editMessageText('❌ Ошибка ��агрузки заданий.', {
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
                message += `   ID: ${channel.id} | Канал: ${channel.channel_id}\n`;
                message += `   Статус: ${channel.is_active ? '✅' : '❌'}\n\n`;
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
        console.error('[SIMPLE ADMIN] Error listing channels:', error);
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
                message += `   ID: ${lottery.id} | Цена: ${lottery.ticket_price} ⭐\n`;
                message += `   Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
                message += `   Статус: ${lottery.is_active ? '✅' : '❌'}\n\n`;
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
        console.error('[SIMPLE ADMIN] Error listing lotteries:', error);
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
                message += `   ID: ${promo.id} | Награда: ${promo.reward} ⭐\n`;
                message += `   Использований: ${promo.current_uses}/${promo.max_uses || '∞'}\n`;
                message += `   Статус: ${promo.is_active ? '✅' : '❌'}\n\n`;
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
        console.error('[SIMPLE ADMIN] Error listing promocodes:', error);
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

// Stub functions for broadcast (basic implementation)
async function handleAdminBroadcast(bot, chatId, messageId) {
    await bot.editMessageText('📢 Функция рассылки в разработке', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: {
            inline_keyboard: [
                [{ text: '���� Назад', callback_data: 'admin_menu' }]
            ]
        }
    });
}

async function handleBroadcastTasks(bot, chatId, messageId) {
    await handleAdminBroadcast(bot, chatId, messageId);
}

async function handleBroadcastReferrals(bot, chatId, messageId) {
    await handleAdminBroadcast(bot, chatId, messageId);
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
