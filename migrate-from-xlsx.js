const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Database = require('./database');

class XlsxMigration {
    constructor() {
        this.dataDir = './xlsx-data'; // Папка с xlsx файлами
        this.tableMapping = {
            'users': 'users',
            'tasks': 'tasks', 
            'user_tasks': 'user_tasks',
            'withdrawal_requests': 'withdrawal_requests',
            'subgram_tasks': 'subgram_tasks',
            'sponsor_channels_stats': 'sponsor_channels_stats',
            'sponsor_channel_user_checks': 'sponsor_channel_user_checks',
            'promocodes': 'promocodes',
            'promocode_uses': 'promocode_uses',
            'lottery_tickets': 'lottery_tickets',
            'lotteries': 'lotteries',
            'bot_stats': 'bot_stats'
        };
    }

    async migrate() {
        try {
            console.log('🚀 Начинаем миграцию данных из xlsx файлов...');

            // Инициализируем базу данных (создаем таблицы)
            console.log('📝 Инициализация базы данных...');
            await Database.init();

            // Проверяем наличие папки с данными
            if (!fs.existsSync(this.dataDir)) {
                console.log(`📁 Создайте папку ${this.dataDir} и поместите туда xlsx файлы`);
                console.log('📋 Файлы должны называться: users.xlsx, tasks.xlsx, user_tasks.xlsx и т.д.');
                return;
            }

            // Получаем список xlsx файлов
            const xlsxFiles = fs.readdirSync(this.dataDir)
                .filter(file => file.endsWith('.xlsx'))
                .map(file => ({
                    file: file,
                    table: file.replace('.xlsx', ''),
                    path: path.join(this.dataDir, file)
                }));

            console.log(`📊 Найдено ${xlsxFiles.length} xlsx файлов:`);
            xlsxFiles.forEach(f => console.log(`  - ${f.file} -> ${f.table}`));

            // Миграция в правильном порядке (учитываем зависимости)
            const migrationOrder = [
                'users',
                'tasks', 
                'promocodes',
                'lotteries',
                'sponsor_channels_stats',
                'user_tasks',
                'withdrawal_requests',
                'subgram_tasks',
                'sponsor_channel_user_checks',
                'promocode_uses',
                'lottery_tickets',
                'bot_stats'
            ];

            for (const tableName of migrationOrder) {
                const fileInfo = xlsxFiles.find(f => f.table === tableName);
                if (fileInfo) {
                    await this.migrateTable(fileInfo);
                } else {
                    console.log(`⚠️ Файл ${tableName}.xlsx не найден, пропускаем`);
                }
            }

            console.log('🎉 Миграция завершена успешно!');

        } catch (error) {
            console.error('❌ Ошибка миграции:', error);
            throw error;
        }
    }

    async migrateTable(fileInfo) {
        try {
            console.log(`\n📋 Обработка таблицы: ${fileInfo.table}`);

            // Читаем xlsx файл
            const workbook = XLSX.readFile(fileInfo.path);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);

            if (data.length === 0) {
                console.log(`  ✅ Таблица ${fileInfo.table} пуста, пропускаем`);
                return;
            }

            console.log(`  📊 Найдено ${data.length} записей`);

            // Получаем колонки из первой строки
            const columns = Object.keys(data[0]);
            console.log(`  🏗️ Колонки: ${columns.join(', ')}`);

            // Загружаем данные в зависимости от таблицы
            switch (fileInfo.table) {
                case 'users':
                    await this.migrateUsers(data);
                    break;
                case 'tasks':
                    await this.migrateTasks(data);
                    break;
                case 'user_tasks':
                    await this.migrateUserTasks(data);
                    break;
                case 'withdrawal_requests':
                    await this.migrateWithdrawalRequests(data);
                    break;
                case 'subgram_tasks':
                    await this.migrateSubgramTasks(data);
                    break;
                case 'sponsor_channels_stats':
                    await this.migrateSponsorChannelsStats(data);
                    break;
                case 'sponsor_channel_user_checks':
                    await this.migrateSponsorChannelUserChecks(data);
                    break;
                case 'promocodes':
                    await this.migratePromocodes(data);
                    break;
                case 'promocode_uses':
                    await this.migratePromocodeUses(data);
                    break;
                case 'lottery_tickets':
                    await this.migrateLotteryTickets(data);
                    break;
                case 'lotteries':
                    await this.migrateLotteries(data);
                    break;
                case 'bot_stats':
                    await this.migrateBotStats(data);
                    break;
                default:
                    console.log(`  ⚠️ Неизвестная таблица: ${fileInfo.table}`);
            }

            console.log(`  ✅ Таблица ${fileInfo.table} загружена успешно`);

        } catch (error) {
            console.error(`❌ Ошибка загрузки табли��ы ${fileInfo.table}:`, error);
            throw error;
        }
    }

    async migrateUsers(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO users (
                        user_id, username, first_name, language_code, is_premium,
                        balance, total_earned, referral_earned, total_referrals, daily_referrals,
                        last_daily_reset, clicks_today, last_click_time, points, weekly_points,
                        last_case_open, referrer_id, referral_completed, captcha_passed,
                        created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                    ON CONFLICT (user_id) DO NOTHING
                `, [
                    row.user_id,
                    row.username || null,
                    row.first_name || null,
                    row.language_code || 'ru',
                    row.is_premium || false,
                    parseFloat(row.balance) || 0,
                    parseFloat(row.total_earned) || 0,
                    parseFloat(row.referral_earned) || 0,
                    parseInt(row.total_referrals) || 0,
                    parseInt(row.daily_referrals) || 0,
                    row.last_daily_reset || new Date().toISOString().split('T')[0],
                    parseInt(row.clicks_today) || 0,
                    row.last_click_time || null,
                    parseInt(row.points) || 0,
                    parseInt(row.weekly_points) || 0,
                    row.last_case_open || null,
                    row.referrer_id || null,
                    row.referral_completed || false,
                    row.captcha_passed || false,
                    row.created_at || new Date(),
                    row.updated_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateTasks(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO tasks (
                        id, title, description, link, reward, is_subgram, is_active, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.title,
                    row.description || null,
                    row.link || null,
                    parseFloat(row.reward) || 0.3,
                    row.is_subgram || false,
                    row.is_active !== false,
                    row.created_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateUserTasks(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO user_tasks (id, user_id, task_id, completed_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.user_id,
                    row.task_id,
                    row.completed_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateWithdrawalRequests(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO withdrawal_requests (
                        id, user_id, amount, status, closure_number, rejection_reason, created_at, processed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.user_id,
                    parseFloat(row.amount),
                    row.status || 'pending',
                    row.closure_number || null,
                    row.rejection_reason || null,
                    row.created_at || new Date(),
                    row.processed_at || null
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateSubgramTasks(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO subgram_tasks (id, user_id, channel_link, channel_name, completed_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.user_id,
                    row.channel_link,
                    row.channel_name || null,
                    row.completed_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateSponsorChannelsStats(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO sponsor_channels_stats (
                        id, channel_identifier, channel_title, channel_url, is_enabled,
                        total_checks, unique_users_count, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (channel_identifier) DO NOTHING
                `, [
                    row.id,
                    row.channel_identifier,
                    row.channel_title,
                    row.channel_url,
                    row.is_enabled !== false,
                    parseInt(row.total_checks) || 0,
                    parseInt(row.unique_users_count) || 0,
                    row.created_at || new Date(),
                    row.updated_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateSponsorChannelUserChecks(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO sponsor_channel_user_checks (
                        id, channel_identifier, user_id, first_check_at, last_check_at, total_checks
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.channel_identifier,
                    row.user_id,
                    row.first_check_at || new Date(),
                    row.last_check_at || new Date(),
                    parseInt(row.total_checks) || 1
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migratePromocodes(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO promocodes (
                        id, code, reward, uses_limit, current_uses, is_active, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.code,
                    parseFloat(row.reward),
                    parseInt(row.uses_limit) || 1,
                    parseInt(row.current_uses) || 0,
                    row.is_active !== false,
                    row.created_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migratePromocodeUses(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO promocode_uses (id, user_id, promocode_id, used_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.user_id,
                    row.promocode_id,
                    row.used_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateLotteries(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO lotteries (
                        id, name, ticket_price, total_tickets, sold_tickets, winners_count,
                        bot_percentage, is_active, is_finished, created_at, finished_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.name,
                    parseFloat(row.ticket_price),
                    parseInt(row.total_tickets),
                    parseInt(row.sold_tickets) || 0,
                    parseInt(row.winners_count),
                    parseInt(row.bot_percentage) || 30,
                    row.is_active !== false,
                    row.is_finished || false,
                    row.created_at || new Date(),
                    row.finished_at || null
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateLotteryTickets(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO lottery_tickets (id, lottery_id, user_id, ticket_number, purchased_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.lottery_id,
                    row.user_id,
                    parseInt(row.ticket_number),
                    row.purchased_at || new Date()
                ]);
            }
        } finally {
            client.release();
        }
    }

    async migrateBotStats(data) {
        const client = await Database.pool.connect();
        try {
            for (const row of data) {
                await client.query(`
                    INSERT INTO bot_stats (
                        id, date, total_users, new_users, total_stars_earned, total_withdrawals, active_users
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.date || new Date().toISOString().split('T')[0],
                    parseInt(row.total_users) || 0,
                    parseInt(row.new_users) || 0,
                    parseFloat(row.total_stars_earned) || 0,
                    parseFloat(row.total_withdrawals) || 0,
                    parseInt(row.active_users) || 0
                ]);
            }
        } finally {
            client.release();
        }
    }
}

// Запуск миграции
async function main() {
    try {
        const migration = new XlsxMigration();
        await migration.migrate();
        console.log('\n🎉 Миграция завершена! Теперь можно запускать бота.');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Ошибка миграции:', error);
        process.exit(1);
    }
}

// Запускаем только если файл вызван напрямую
if (require.main === module) {
    main();
}

module.exports = XlsxMigration;
