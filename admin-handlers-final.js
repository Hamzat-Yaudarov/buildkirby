console.log('[ADMIN-FINAL] Loading final admin handlers...');

const db = require('./database');

// Final working admin handlers based on successful test
async function handleAdminTasks(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleAdminTasks called');
    
    try {
        const message = `📋 **Управление заданиями**

🛠️ **Команды для управления заданиями:**
• \`/create_task канал|название|награда|лимит\` - создать задание
• \`/delete_task ID\` - удалить задание

📋 **Доступные действия:**
• Создание новых заданий с лимитами
• Просмотр существующих заданий
• Удаление ненужных заданий
• Просмотр статистики выполнений

💡 **Примеры команд:**
• \`/create_task @myChannel|Мой канал|2\` - без лимита
• \`/create_task @myChannel|Мой канал|2|100\` - с лимитом 100 выполнений
• \`/delete_task 5\` (где 5 - ID задания)

🔢 **О лимитах:**
• Если лимит не указан - задание без ограничений
• С лимитом - задание автоматически завершится после N выполнений
• В списке заданий показывается прогресс выполнений`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 Список заданий', callback_data: 'admin_list_tasks' }],
                    [{ text: ' Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
        
        console.log('[ADMIN-FINAL] handleAdminTasks completed successfully');
    } catch (error) {
        console.error('[ADMIN-FINAL] Error in handleAdminTasks:', error);
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
    console.log('[ADMIN-FINAL] handleAdminChannels called');
    
    try {
        const message = `📺 **Управление обязательными каналами**

🛠️ **Команды для управления каналами:**
• \`/add_channel @channel|Название канала\` - добавить канал
• \`/delete_channel ID\` - удалить канал

📺 **Доступные действия:**
• Добавление обязательных каналов
• Просмотр списка каналов
• Удаление ненужных каналов

💡 **Примеры команд:**
• \`/add_channel @myChannel|Мой крутой канал\`
• \`/delete_channel 3\` (где 3 - ID канала)`;

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
        
        console.log('[ADMIN-FINAL] handleAdminChannels completed successfully');
    } catch (error) {
        console.error('[ADMIN-FINAL] Error in handleAdminChannels:', error);
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
    console.log('[ADMIN-FINAL] handleAdminLottery called');
    
    try {
        const message = `🎰 **Управление лотереями**

🛠️ **Команды для управления лотереями:**

**Обычные лотереи:**
• \`/create_lottery название|билеты|цена|победители|процент\` - создать обычную лотерею
• \`/endlottery ID\` - завершить лотерею вручную

**Реферальные лотереи:**
• \`/create_referral_lottery название|часов|рефералов|цена|1:приз1|2:��риз2\` - с условием
• \`/create_auto_referral_lottery название|часов|1:приз1|2:приз2\` - автоматическая

**Управление победителями:**
• \`/select_lottery_winners ID 1:userID 2:userID\` - выбрать победителей вручную

🎰 **Типы лотерей:**
• **Обычная** - покупка билетов за звезды
• **Реферальная** - нужно пригласить N рефералов + можно купить доп. билеты
• **Авто-реферальная** - каждый новый реферал = +1 билет

💡 **Примеры команд:**
• \`/create_lottery Еженедельная|100|5|10|20\`
• \`/create_referral_lottery Реф|168|3|1.5|1:50|2:30|3:20\`
• \`/create_auto_referral_lottery Авто|72|1:100|2:60|3:40\`
• \`/select_lottery_winners 5 1:123456 2:789012 3:345678\`

⚠️ **Важно:** Реферальные лотереи завершаются по времени, не по билетам!`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎰 Список ло��ерей', callback_data: 'admin_list_lotteries' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
        
        console.log('[ADMIN-FINAL] handleAdminLottery completed successfully');
    } catch (error) {
        console.error('[ADMIN-FINAL] Error in handleAdminLottery:', error);
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
    console.log('[ADMIN-FINAL] handleAdminPromocodes called');
    
    try {
        const message = `🎁 **Управление промокодами**

🛠️ **Команды для управления промокодами:**
• \`/create_promo КОД|награда|использования\` - создать промокод
• \`/delete_promo ID\` - удалить промокод

🎁 **Доступные действия:**
• Создание новых промокодов
• Просмотр активных п��омокодов
• Удаление ненужных промокодов

💡 **Примеры команд:**
• \`/create_promo WELCOME|0.5|100\`
• \`/delete_promo 7\` (где 7 - ID промокода)`;

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
        
        console.log('[ADMIN-FINAL] handleAdminPromocodes completed successfully');
    } catch (error) {
        console.error('[ADMIN-FINAL] Error in handleAdminPromocodes:', error);
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
    console.log('[ADMIN-FINAL] handleAdminBroadcast called');
    
    try {
        const message = `📢 **Рассылка сообщений**

Выберите тип рассылки:`;

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 О новых заданиях', callback_data: 'broadcast_tasks' }],
                    [{ text: '🏆 О рефералах', callback_data: 'broadcast_referrals' }],
                    [{ text: '✏️ Своя рассылка', callback_data: 'broadcast_custom' }],
                    [{ text: '🔙 Назад', callback_data: 'admin_menu' }]
                ]
            }
        });
    } catch (error) {
        console.error('[ADMIN-FINAL] Error in handleAdminBroadcast:', error);
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

// List functions with database integration
async function handleAdminListTasks(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleAdminListTasks called');

    try {
        const tasks = await db.getAllTasksStats();

        let message = '📋 **Список заданий с статистикой**\n\n';

        if (tasks.length === 0) {
            message += '❌ Заданий пока нет.\n\n';
            message += '💡 **Создайте задание командой:**\n';
            message += '`/create_task канал|название|награда|лимит`';
        } else {
            tasks.forEach((task, index) => {
                message += `${index + 1}. **${task.channel_name || task.channel_id}**\n`;
                message += `   • ID: ${task.id}\n`;
                message += `   • Награда: ${task.reward} ⭐\n`;
                message += `   • Выполнений: ${task.current_completions}`;

                if (task.max_completions) {
                    message += `/${task.max_completions} (осталось: ${task.remaining_completions})\n`;
                    // Показать прогресс-бар
                    const progress = Math.round((task.current_completions / task.max_completions) * 10);
                    const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);
                    message += `   • Прогресс: [${progressBar}] ${Math.round((task.current_completions / task.max_completions) * 100)}%\n`;
                } else {
                    message += ' (без лимита)\n';
                }

                message += `   • Статус: ${task.is_active ? '✅ Активно' : '❌ Неактивно'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к заданиям', callback_data: 'admin_tasks' }]
                ]
            }
        });
    } catch (error) {
        console.error('[ADMIN-FINAL] Error listing tasks:', error);
        await bot.editMessageText('❌ Ошибка загрузки списка заданий.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к заданиям', callback_data: 'admin_tasks' }]
                ]
            }
        });
    }
}

async function handleAdminListChannels(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleAdminListChannels called');
    
    try {
        const channels = await db.executeQuery('SELECT * FROM required_channels ORDER BY id');
        
        let message = '📺 **Список обязательных каналов**\n\n';
        
        if (channels.rows.length === 0) {
            message += '❌ Каналов пока нет.\n\n';
            message += '💡 **Добавьте канал командой:**\n';
            message += '`/add_channel @channel|Название`';
        } else {
            channels.rows.forEach((channel, index) => {
                message += `${index + 1}. **${channel.channel_name || channel.channel_id}**\n`;
                message += `   • ID: ${channel.id}\n`;
                message += `   • Канал: ${channel.channel_id}\n`;
                message += `   • Статус: ${channel.is_active ? '✅ Активно' : '❌ Неактивно'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к каналам', callback_data: 'admin_channels' }]
                ]
            }
        });
    } catch (error) {
        console.error('[ADMIN-FINAL] Error listing channels:', error);
        await bot.editMessageText('❌ Ошибка загрузки списка каналов.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к каналам', callback_data: 'admin_channels' }]
                ]
            }
        });
    }
}

async function handleAdminListLotteries(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleAdminListLotteries called');

    try {
        // Get all lotteries including referral ones
        const lotteries = await db.executeQuery(`
            SELECT l.*, rl.required_referrals, rl.referral_time_hours,
                   rl.additional_ticket_price, rl.ends_at as ref_ends_at,
                   rl.winners_selected
            FROM lotteries l
            LEFT JOIN referral_lotteries rl ON l.id = rl.lottery_id
            ORDER BY l.id
        `);

        let message = '🎰 **Список всех лотерей**\n\n';

        if (lotteries.rows.length === 0) {
            message += '❌ Лотерей пока нет.\n\n';
            message += '💡 **Создайте лотерею командой:**\n';
            message += '`/create_lottery название|100|5|10|20` - обычная\n';
            message += '`/create_referral_lottery название|168|3|1.5|1:50|2:30` - реферальная';
        } else {
            lotteries.rows.forEach((lottery, index) => {
                const lotteryType = lottery.lottery_type || 'standard';
                const typeEmoji = lotteryType === 'standard' ? '🎫' :
                                lotteryType === 'referral_condition' ? '👥' : '🔄';
                const typeName = lotteryType === 'standard' ? 'обычная' :
                               lotteryType === 'referral_condition' ? 'реферальная' : 'авто-реферальная';

                message += `${index + 1}. ${typeEmoji} **${lottery.name}** (${typeName})\n`;
                message += `   • ID: ${lottery.id}\n`;

                if (lotteryType === 'standard') {
                    message += `   • Цена билета: ${lottery.ticket_price} ⭐\n`;
                    message += `   • Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
                } else {
                    // Referral lottery
                    if (lottery.ref_ends_at) {
                        const timeLeft = new Date(lottery.ref_ends_at) - new Date();
                        const hoursLeft = Math.max(0, Math.floor(timeLeft / (1000 * 60 * 60)));
                        message += `   • Осталось времени: ${hoursLeft} часов\n`;
                    }

                    if (lotteryType === 'referral_condition') {
                        message += `   • Условие: ${lottery.required_referrals} рефералов\n`;
                        message += `   • Доп. билет: ${lottery.additional_ticket_price} ⭐\n`;
                    }

                    if (lottery.winners_selected) {
                        message += `   • Победители: ✅ Выбраны\n`;
                    } else {
                        message += `   • Победители: ❌ Не выбраны\n`;
                    }
                }

                message += `   • Призовых мест: ${lottery.winners_count}\n`;
                message += `   • Статус: ${lottery.is_active ? '✅ Активна' : '❌ Завершена'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '�� Назад к лотереям', callback_data: 'admin_lottery' }]
                ]
            }
        });
    } catch (error) {
        console.error('[ADMIN-FINAL] Error listing lotteries:', error);
        await bot.editMessageText('❌ Ошибка загрузки списка лотерей.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к лотереям', callback_data: 'admin_lottery' }]
                ]
            }
        });
    }
}

async function handleAdminListPromos(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleAdminListPromos called');
    
    try {
        const promos = await db.executeQuery('SELECT * FROM promocodes ORDER BY id');
        
        let message = '🎁 **Список промокодов**\n\n';
        
        if (promos.rows.length === 0) {
            message += '❌ Промокодов пока нет.\n\n';
            message += '💡 **Создайте промокод командой:**\n';
            message += '`/create_promo КОД|0.5|100`';
        } else {
            promos.rows.forEach((promo, index) => {
                message += `${index + 1}. **${promo.code}**\n`;
                message += `   • ID: ${promo.id}\n`;
                message += `   • Награда: ${promo.reward} ⭐\n`;
                message += `   • Использований: ${promo.current_uses}/${promo.max_uses || '∞'}\n`;
                message += `   • Статус: ${promo.is_active ? '✅ Активен' : '❌ Неактивен'}\n\n`;
            });
        }

        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к промокодам', callback_data: 'admin_promocodes' }]
                ]
            }
        });
    } catch (error) {
        console.error('[ADMIN-FINAL] Error listing promocodes:', error);
        await bot.editMessageText('❌ Ошибка загрузки списка промокодов.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к промокодам', callback_data: 'admin_promocodes' }]
                ]
            }
        });
    }
}

// Broadcast functions
async function handleBroadcastTasks(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleBroadcastTasks called');
    
    try {
        const users = await db.executeQuery('SELECT id FROM users WHERE is_subscribed = TRUE');
        let successCount = 0;
        
        const message = `📋 **Новые задания ждут вас!**

🎯 Не упустите возможность заработать дополнительные звёзды!
💰 Выполняйте задания и получайте награды!`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📋 Посмотреть задания', callback_data: 'tasks' }],
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
                console.error(`[ADMIN-FINAL] Failed to send to user ${user.id}:`, error.message);
            }
        }

        await bot.editMessageText(`✅ Рассылка завершена!\n\n📤 Отп��авлено: ${successCount} из ${users.rows.length} пользователей`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]
                ]
            }
        });

    } catch (error) {
        console.error('[ADMIN-FINAL] Error in broadcast tasks:', error);
        await bot.editMessageText('❌ Ошибка рассылки.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]
                ]
            }
        });
    }
}

async function handleBroadcastReferrals(bot, chatId, messageId) {
    console.log('[ADMIN-FINAL] handleBroadcastReferrals called');
    
    try {
        const users = await db.executeQuery('SELECT id FROM users WHERE is_subscribed = TRUE');
        let successCount = 0;
        
        const message = `🏆 **Попадите в топ-5 по рефералам!**

👥 Приглашайте друзей и зарабатывайте больше звёзд!
🎁 За каждого друга вы получаете 3 ⭐`;

        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '👥 Пригласить друга', callback_data: 'invite' }],
                    [{ text: '🏆 Посмотреть рейтинг', callback_data: 'ratings' }]
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
                console.error(`[ADMIN-FINAL] Failed to send to user ${user.id}:`, error.message);
            }
        }

        await bot.editMessageText(`✅ Рассылка завершена!\n\n📤 Отправлено: ${successCount} из ${users.rows.length} пользователей`, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]
                ]
            }
        });

    } catch (error) {
        console.error('[ADMIN-FINAL] Error in broadcast referrals:', error);
        await bot.editMessageText('❌ Ошибка рассылки.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔙 Назад к рассылке', callback_data: 'admin_broadcast' }]
                ]
            }
        });
    }
}

// Custom broadcast handler - теперь работает через inline interface в main file

console.log('[ADMIN-FINAL] All functions defined, exporting...');

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

console.log('[ADMIN-FINAL] Final admin handlers export completed');
