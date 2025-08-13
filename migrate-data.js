const sqlite3 = require('sqlite3').verbose();
const db = require('./database');

async function migrateData() {
    console.log('🔄 Starting data migration from SQLite to PostgreSQL...');
    
    try {
        // Initialize PostgreSQL database
        await db.initializeDatabase();
        console.log('✅ PostgreSQL database initialized');
        
        // Open SQLite database
        const sqliteDb = new sqlite3.Database('bot.db');
        
        // Migrate users
        await migrateUsers(sqliteDb);
        
        // Migrate tasks
        await migrateTasks(sqliteDb);
        
        // Migrate user_tasks
        await migrateUserTasks(sqliteDb);
        
        // Migrate lotteries
        await migrateLotteries(sqliteDb);
        
        // Migrate lottery_tickets
        await migrateLotteryTickets(sqliteDb);
        
        // Migrate withdrawal_requests
        await migrateWithdrawalRequests(sqliteDb);
        
        // Migrate promocodes
        await migratePromocodes(sqliteDb);
        
        // Migrate promocode_usage
        await migratePromocodeUsage(sqliteDb);
        
        // Migrate required_channels
        await migrateRequiredChannels(sqliteDb);
        
        // Close SQLite connection
        sqliteDb.close();
        
        console.log('✅ Data migration completed successfully!');
        console.log('📝 You can now use the new PostgreSQL-powered bot');
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

function migrateUsers(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating users...');
        
        sqliteDb.all('SELECT * FROM users', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO users (id, username, first_name, balance, referrals_count, referrals_today, 
                         invited_by, last_click, last_case_open, registered_at, is_subscribed, temp_action) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                         ON CONFLICT (id) DO UPDATE SET
                         username = EXCLUDED.username,
                         first_name = EXCLUDED.first_name,
                         balance = EXCLUDED.balance,
                         referrals_count = EXCLUDED.referrals_count,
                         referrals_today = EXCLUDED.referrals_today,
                         updated_at = CURRENT_TIMESTAMP`,
                        [
                            row.id,
                            row.username,
                            row.first_name,
                            row.balance || 0,
                            row.referrals_count || 0,
                            row.referrals_today || 0,
                            row.invited_by,
                            row.last_click,
                            row.last_case_open,
                            row.registered_at,
                            row.is_subscribed || false,
                            row.temp_action
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} users`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migrateTasks(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating tasks...');
        
        sqliteDb.all('SELECT * FROM tasks', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO tasks (channel_id, channel_name, reward, is_active) 
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (channel_id) DO UPDATE SET
                         channel_name = EXCLUDED.channel_name,
                         reward = EXCLUDED.reward,
                         is_active = EXCLUDED.is_active`,
                        [
                            row.channel_id,
                            row.channel_name,
                            row.reward || 1,
                            row.is_active !== 0
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} tasks`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migrateUserTasks(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating user tasks...');
        
        sqliteDb.all('SELECT * FROM user_tasks', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    // Get task ID from channel_id mapping
                    const taskResult = await db.executeQuery(
                        'SELECT id FROM tasks WHERE channel_id = (SELECT channel_id FROM tasks WHERE id = $1)',
                        [row.task_id]
                    );
                    
                    if (taskResult.rows.length > 0) {
                        await db.executeQuery(
                            `INSERT INTO user_tasks (user_id, task_id, completed_at) 
                             VALUES ($1, $2, $3)
                             ON CONFLICT (user_id, task_id) DO NOTHING`,
                            [
                                row.user_id,
                                taskResult.rows[0].id,
                                row.completed_at
                            ]
                        );
                    }
                }
                console.log(`✅ Migrated ${rows.length} user task completions`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migrateLotteries(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating lotteries...');
        
        sqliteDb.all('SELECT * FROM lotteries', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count, current_tickets, is_active, created_at) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                        [
                            row.name,
                            row.ticket_price,
                            row.max_tickets,
                            row.winners_count,
                            row.current_tickets || 0,
                            row.is_active !== 0,
                            row.created_at
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} lotteries`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migrateLotteryTickets(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating lottery tickets...');
        
        sqliteDb.all('SELECT * FROM lottery_tickets', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO lottery_tickets (lottery_id, user_id, purchased_at) 
                         VALUES ($1, $2, $3)`,
                        [
                            row.lottery_id,
                            row.user_id,
                            row.purchased_at
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} lottery tickets`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migrateWithdrawalRequests(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating withdrawal requests...');
        
        sqliteDb.all('SELECT * FROM withdrawal_requests', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO withdrawal_requests (user_id, amount, type, status, created_at, processed_at) 
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            row.user_id,
                            row.amount,
                            row.type || 'stars',
                            row.status || 'pending',
                            row.created_at,
                            row.processed_at
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} withdrawal requests`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migratePromocodes(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating promocodes...');
        
        sqliteDb.all('SELECT * FROM promocodes', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO promocodes (code, reward, max_uses, current_uses, is_active, created_at) 
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (code) DO UPDATE SET
                         reward = EXCLUDED.reward,
                         max_uses = EXCLUDED.max_uses,
                         current_uses = EXCLUDED.current_uses,
                         is_active = EXCLUDED.is_active`,
                        [
                            row.code,
                            row.reward,
                            row.max_uses,
                            row.current_uses || 0,
                            row.is_active !== 0,
                            row.created_at
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} promocodes`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migratePromocodeUsage(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating promocode usage...');
        
        sqliteDb.all('SELECT * FROM promocode_usage', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO promocode_usage (user_id, promocode_id, used_at) 
                         VALUES ($1, $2, $3)
                         ON CONFLICT (user_id, promocode_id) DO NOTHING`,
                        [
                            row.user_id,
                            row.promocode_id,
                            row.used_at
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} promocode usages`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

function migrateRequiredChannels(sqliteDb) {
    return new Promise((resolve, reject) => {
        console.log('🔄 Migrating required channels...');
        
        sqliteDb.all('SELECT * FROM required_channels', [], async (err, rows) => {
            if (err) {
                reject(err);
                return;
            }
            
            try {
                for (const row of rows) {
                    await db.executeQuery(
                        `INSERT INTO required_channels (channel_id, channel_name, is_active, created_at) 
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (channel_id) DO UPDATE SET
                         channel_name = EXCLUDED.channel_name,
                         is_active = EXCLUDED.is_active`,
                        [
                            row.channel_id,
                            row.channel_name,
                            row.is_active !== 0,
                            row.created_at
                        ]
                    );
                }
                console.log(`✅ Migrated ${rows.length} required channels`);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

// Run migration if called directly
if (require.main === module) {
    migrateData()
        .then(() => {
            console.log('🎉 Migration completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { migrateData };
