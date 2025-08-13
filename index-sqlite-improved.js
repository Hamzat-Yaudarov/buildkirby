const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const adminHandlers = require('./admin-handlers');

// Bot token - should be set via environment variable
const token = process.env.BOT_TOKEN || '8379368723:AAEnG133OZ4qMrb5vQfM7VdEFSuLiWydsyM';
const bot = new TelegramBot(token, { polling: true });

// Admin configuration
const ADMIN_ID = 6910097562;
const ADMIN_CHANNEL = process.env.ADMIN_CHANNEL || '@kirbyvivodstars';

// Initialize database with WAL mode for better concurrency
const db = new sqlite3.Database('bot.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('✅ SQLite database connected');
        
        // Enable WAL mode for better concurrency
        db.run('PRAGMA journal_mode = WAL');
        db.run('PRAGMA synchronous = NORMAL');
        db.run('PRAGMA cache_size = 1000');
        db.run('PRAGMA temp_store = MEMORY');
    }
});

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        balance REAL DEFAULT 0,
        referrals_count INTEGER DEFAULT 0,
        referrals_today INTEGER DEFAULT 0,
        invited_by INTEGER,
        last_click DATE,
        last_case_open DATE,
        registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_subscribed BOOLEAN DEFAULT 0,
        temp_action TEXT
    )`);

    // Tasks table
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT UNIQUE,
        channel_name TEXT,
        reward REAL DEFAULT 1,
        is_active BOOLEAN DEFAULT 1
    )`);

    // User tasks completion
    db.run(`CREATE TABLE IF NOT EXISTS user_tasks (
        user_id INTEGER,
        task_id INTEGER,
        completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, task_id)
    )`);

    // Lotteries table
    db.run(`CREATE TABLE IF NOT EXISTS lotteries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        ticket_price REAL,
        max_tickets INTEGER,
        winners_count INTEGER,
        current_tickets INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Lottery tickets
    db.run(`CREATE TABLE IF NOT EXISTS lottery_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lottery_id INTEGER,
        user_id INTEGER,
        purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Withdrawal requests
    db.run(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        amount REAL,
        type TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME
    )`);

    // Promocodes table
    db.run(`CREATE TABLE IF NOT EXISTS promocodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE,
        reward REAL,
        max_uses INTEGER,
        current_uses INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Promocode usage tracking
    db.run(`CREATE TABLE IF NOT EXISTS promocode_usage (
        user_id INTEGER,
        promocode_id INTEGER,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, promocode_id)
    )`);

    // Required channels
    db.run(`CREATE TABLE IF NOT EXISTS required_channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT UNIQUE,
        channel_name TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    console.log('✅ Database tables created/verified');
});

// Helper functions
function isAdmin(userId) {
    return userId === ADMIN_ID;
}

// Database helper functions with retry logic
function dbQuery(sql, params = []) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 3;
        
        function tryQuery() {
            attempts++;
            db.all(sql, params, (err, rows) => {
                if (err) {
                    console.error(`Database query attempt ${attempts} failed:`, err);
                    if (attempts < maxAttempts) {
                        setTimeout(tryQuery, Math.pow(2, attempts) * 100);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(rows);
                }
            });
        }
        
        tryQuery();
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 3;
        
        function tryRun() {
            attempts++;
            db.run(sql, params, function(err) {
                if (err) {
                    console.error(`Database run attempt ${attempts} failed:`, err);
                    if (attempts < maxAttempts) {
                        setTimeout(tryRun, Math.pow(2, attempts) * 100);
                    } else {
                        reject(err);
                    }
                } else {
                    resolve({ lastID: this.lastID, changes: this.changes });
                }
            });
        }
        
        tryRun();
    });
}

// User management
async function getUser(userId) {
    try {
        const rows = await dbQuery('SELECT * FROM users WHERE id = ?', [userId]);
        return rows[0] || null;
    } catch (error) {
        console.error('Error getting user:', error);
        return null;
    }
}

async function createOrUpdateUser(user, invitedBy = null) {
    const { id, username, first_name } = user;
    
    try {
        const existingUser = await getUser(id);
        
        if (existingUser) {
            await dbRun('UPDATE users SET username = ?, first_name = ? WHERE id = ?', 
                [username, first_name, id]);
            return existingUser;
        } else {
            await dbRun('INSERT INTO users (id, username, first_name, invited_by) VALUES (?, ?, ?, ?)', 
                [id, username, first_name, invitedBy]);
            
            if (invitedBy) {
                await addReferralBonus(invitedBy);
            }
            
            return { id, username, first_name, balance: 0, referrals_count: 0 };
        }
    } catch (error) {
        console.error('Error creating/updating user:', error);
        throw error;
    }
}

async function addReferralBonus(referrerId) {
    const bonus = 3;
    try {
        await dbRun(`UPDATE users SET 
            balance = balance + ?, 
            referrals_count = referrals_count + 1,
            referrals_today = referrals_today + 1
            WHERE id = ?`, [bonus, referrerId]);
    } catch (error) {
        console.error('Error adding referral bonus:', error);
    }
}

// Create admin handlers wrapper for SQLite
const sqliteAdminHandlers = {
    handleAdminTasks: async (bot, chatId, messageId) => {
        try {
            const message = `📋 **Управление заданиями**

Доступные команды:
• /create_task канал|@example|1|100
• Показать список заданий`;

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
        } catch (error) {
            console.error('Error in admin tasks:', error);
        }
    },
    
    handleAdminChannels: async (bot, chatId, messageId) => {
        try {
            const message = `📺 **Управление обязательными каналами**

Доступные команды:
• /add_channel @channel|Название
• Показать список каналов`;

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
            console.error('Error in admin channels:', error);
        }
    },
    
    handleAdminLottery: async (bot, chatId, messageId) => {
        try {
            const message = `🎰 **Управление лотереями**

Доступные команды:
• /create_lottery название|100|5|10|20
• Показать список лотерей`;

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
            console.error('Error in admin lottery:', error);
        }
    },
    
    handleAdminPromocodes: async (bot, chatId, messageId) => {
        try {
            const message = `🎁 **Управление промокодами**

Доступные команды:
• /create_promo КОД|0.5|100
• Показать список промокодов`;

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
            console.error('Error in admin promocodes:', error);
        }
    },
    
    handleAdminBroadcast: adminHandlers.handleAdminBroadcast,
    handleBroadcastTasks: adminHandlers.handleBroadcastTasks,
    handleBroadcastReferrals: adminHandlers.handleBroadcastReferrals,
    
    handleAdminListTasks: async (bot, chatId, messageId) => {
        try {
            const tasks = await dbQuery('SELECT * FROM tasks ORDER BY id');
            
            let message = '📋 **Список заданий**\n\n';
            
            if (tasks.length === 0) {
                message += 'Заданий пока нет.';
            } else {
                tasks.forEach((task, index) => {
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
        }
    },

    handleAdminListChannels: async (bot, chatId, messageId) => {
        try {
            const channels = await dbQuery('SELECT * FROM required_channels ORDER BY id');
            
            let message = '📺 **Список обязательных каналов**\n\n';
            
            if (channels.length === 0) {
                message += 'Каналов пока нет.';
            } else {
                channels.forEach((channel, index) => {
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
        }
    },
    
    handleAdminListLotteries: async (bot, chatId, messageId) => {
        try {
            const lotteries = await dbQuery('SELECT * FROM lotteries ORDER BY id');
            
            let message = '🎰 **Список лотерей**\n\n';
            
            if (lotteries.length === 0) {
                message += 'Лотерей пока нет.';
            } else {
                lotteries.forEach((lottery, index) => {
                    message += `${index + 1}. **${lottery.name}**\n`;
                    message += `   ID: ${lottery.id}\n`;
                    message += `   Цена билета: ${lottery.ticket_price} ⭐\n`;
                    message += `   Билетов: ${lottery.current_tickets}/${lottery.max_tickets}\n`;
                    message += `   Победителей: ${lottery.winners_count}\n`;
                    message += `   Статус: ${lottery.is_active ? '✅ Активно' : '❌ Завершено'}\n\n`;
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
        }
    },
    
    handleAdminListPromos: async (bot, chatId, messageId) => {
        try {
            const promos = await dbQuery('SELECT * FROM promocodes ORDER BY id');
            
            let message = '🎁 **Список промокодов**\n\n';
            
            if (promos.length === 0) {
                message += 'Промокодов пока нет.';
            } else {
                promos.forEach((promo, index) => {
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
        }
    }
};

console.log('🚀 Starting improved SQLite Telegram bot...');
