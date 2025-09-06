const { Pool } = require('pg');

// Конфигурация баз данных
const DB1_URL = 'postgresql://neondb_owner:npg_YC1S8JfBNKWg@ep-quiet-cloud-a2e7auqd-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'; // Текущая в использовании
const DB2_URL = 'postgresql://neondb_owner:npg_kA5CYbq6KRQD@ep-late-math-a23qdcph-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'; // Старая БД

// Подключения к базам
const db1 = new Pool({
    connectionString: DB1_URL,
    ssl: { rejectUnauthorized: false }
});

const db2 = new Pool({
    connectionString: DB2_URL,
    ssl: { rejectUnauthorized: false }
});

class DatabaseMerger {
    constructor() {
        this.stats = {
            db1: {},
            db2: {},
            merged: {}
        };
        
        // Список таблиц для объединения в порядке зависимостей
        this.tables = [
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
    }

    async analyzeData() {
        console.log('📊 АНАЛИЗ ДАННЫХ В ДВУХ БАЗАХ...\n');

        for (const table of this.tables) {
            try {
                // Данные из DB1 (текущая)
                const db1Result = await db1.query(`SELECT COUNT(*) as count FROM ${table}`);
                const db1Count = parseInt(db1Result.rows[0].count);
                this.stats.db1[table] = db1Count;

                // Данные из DB2 (старая)
                const db2Result = await db2.query(`SELECT COUNT(*) as count FROM ${table}`);
                const db2Count = parseInt(db2Result.rows[0].count);
                this.stats.db2[table] = db2Count;

                console.log(`📋 ${table}:`);
                console.log(`   DB1 (текущая): ${db1Count} записей`);
                console.log(`   DB2 (старая): ${db2Count} записей`);
                console.log(`   Разница: ${Math.abs(db1Count - db2Count)} записей\n`);

            } catch (error) {
                console.log(`❌ Ошибка анализа таблицы ${table}: ${error.message}\n`);
                this.stats.db1[table] = 0;
                this.stats.db2[table] = 0;
            }
        }

        console.log('🎯 ИТОГОВАЯ СТАТИСТИКА:');
        console.log(`DB1 (текущая): ${Object.values(this.stats.db1).reduce((a, b) => a + b, 0)} записей`);
        console.log(`DB2 (старая): ${Object.values(this.stats.db2).reduce((a, b) => a + b, 0)} записей\n`);
    }

    async mergeData() {
        console.log('🔄 ОБЪЕДИНЕНИЕ ДАННЫХ...\n');

        for (const table of this.tables) {
            await this.mergeTable(table);
        }

        console.log('\n🎉 ОБЪЕДИНЕНИЕ ЗАВЕРШЕНО!');
    }

    async mergeTable(tableName) {
        try {
            console.log(`📋 Объединение таблицы: ${tableName}`);

            // Получаем данные из DB2 (старой)
            const db2Data = await db2.query(`SELECT * FROM ${tableName} ORDER BY created_at ASC`);
            
            if (db2Data.rows.length === 0) {
                console.log(`   ✅ Таблица ${tableName} в DB2 пуста, пропускаем\n`);
                return;
            }

            console.log(`   📊 Найдено ${db2Data.rows.length} записей в DB2`);

            let inserted = 0;
            let skipped = 0;
            let errors = 0;

            // Начинаем транзакцию в DB1
            const client = await db1.connect();
            
            try {
                await client.query('BEGIN');

                for (const row of db2Data.rows) {
                    try {
                        await this.insertRecord(client, tableName, row);
                        inserted++;

                        if (inserted % 100 === 0) {
                            console.log(`   📝 Обработано ${inserted} записей...`);
                        }

                    } catch (error) {
                        if (error.message.includes('duplicate key') || error.message.includes('already exists')) {
                            skipped++;
                        } else {
                            console.log(`   ❌ Ошибка записи: ${error.message}`);
                            errors++;
                        }
                    }
                }

                await client.query('COMMIT');
                console.log(`   ✅ ${tableName}: добавлено ${inserted}, пропущено ${skipped}, ошибок ${errors}\n`);

                this.stats.merged[tableName] = { inserted, skipped, errors };

            } catch (error) {
                await client.query('ROLLBACK');
                console.log(`   ❌ Ошибка транзакции для ${tableName}: ${error.message}\n`);
            } finally {
                client.release();
            }

        } catch (error) {
            console.log(`❌ Критическая ошибка объединения ${tableName}: ${error.message}\n`);
        }
    }

    async insertRecord(client, tableName, row) {
        switch (tableName) {
            case 'users':
                return await client.query(`
                    INSERT INTO users (
                        user_id, username, first_name, language_code, is_premium,
                        balance, total_earned, referral_earned, total_referrals, daily_referrals,
                        last_daily_reset, clicks_today, last_click_time, points, weekly_points,
                        last_case_open, referrer_id, referral_completed, captcha_passed, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
                    ON CONFLICT (user_id) DO UPDATE SET
                        -- Обновляем балансы только если новые данные больше
                        balance = GREATEST(users.balance, EXCLUDED.balance),
                        total_earned = GREATEST(users.total_earned, EXCLUDED.total_earned),
                        referral_earned = GREATEST(users.referral_earned, EXCLUDED.referral_earned),
                        total_referrals = GREATEST(users.total_referrals, EXCLUDED.total_referrals),
                        points = GREATEST(users.points, EXCLUDED.points),
                        weekly_points = GREATEST(users.weekly_points, EXCLUDED.weekly_points),
                        -- Обновляем текстовые поля если они не заполнены
                        username = COALESCE(users.username, EXCLUDED.username),
                        first_name = COALESCE(users.first_name, EXCLUDED.first_name),
                        -- Обновляем даты на более поздние
                        updated_at = GREATEST(users.updated_at, EXCLUDED.updated_at)
                `, [
                    row.user_id, row.username, row.first_name, row.language_code, row.is_premium,
                    row.balance, row.total_earned, row.referral_earned, row.total_referrals, row.daily_referrals,
                    row.last_daily_reset, row.clicks_today, row.last_click_time, row.points, row.weekly_points,
                    row.last_case_open, row.referrer_id, row.referral_completed, row.captcha_passed, row.created_at, row.updated_at
                ]);

            case 'tasks':
                return await client.query(`
                    INSERT INTO tasks (id, title, description, link, reward, is_subgram, is_active, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.title, row.description, row.link, row.reward, row.is_subgram, row.is_active, row.created_at
                ]);

            case 'withdrawal_requests':
                return await client.query(`
                    INSERT INTO withdrawal_requests (id, user_id, amount, status, closure_number, rejection_reason, created_at, processed_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.user_id, row.amount, row.status, row.closure_number, row.rejection_reason, row.created_at, row.processed_at
                ]);

            case 'user_tasks':
                return await client.query(`
                    INSERT INTO user_tasks (id, user_id, task_id, completed_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.user_id, row.task_id, row.completed_at
                ]);

            case 'subgram_tasks':
                return await client.query(`
                    INSERT INTO subgram_tasks (id, user_id, channel_link, channel_name, completed_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (user_id, channel_link) DO NOTHING
                `, [
                    row.id, row.user_id, row.channel_link, row.channel_name, row.completed_at
                ]);

            case 'promocodes':
                return await client.query(`
                    INSERT INTO promocodes (id, code, reward, uses_limit, current_uses, is_active, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.code, row.reward, row.uses_limit, row.current_uses, row.is_active, row.created_at
                ]);

            case 'promocode_uses':
                return await client.query(`
                    INSERT INTO promocode_uses (id, user_id, promocode_id, used_at)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.user_id, row.promocode_id, row.used_at
                ]);

            case 'sponsor_channels_stats':
                return await client.query(`
                    INSERT INTO sponsor_channels_stats (
                        id, channel_identifier, channel_title, channel_url, is_enabled,
                        total_checks, unique_users_count, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (channel_identifier) DO UPDATE SET
                        total_checks = GREATEST(sponsor_channels_stats.total_checks, EXCLUDED.total_checks),
                        unique_users_count = GREATEST(sponsor_channels_stats.unique_users_count, EXCLUDED.unique_users_count),
                        updated_at = GREATEST(sponsor_channels_stats.updated_at, EXCLUDED.updated_at)
                `, [
                    row.id, row.channel_identifier, row.channel_title, row.channel_url, row.is_enabled,
                    row.total_checks, row.unique_users_count, row.created_at, row.updated_at
                ]);

            case 'sponsor_channel_user_checks':
                return await client.query(`
                    INSERT INTO sponsor_channel_user_checks (
                        id, channel_identifier, user_id, first_check_at, last_check_at, total_checks
                    ) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (channel_identifier, user_id) DO UPDATE SET
                        total_checks = GREATEST(sponsor_channel_user_checks.total_checks, EXCLUDED.total_checks),
                        last_check_at = GREATEST(sponsor_channel_user_checks.last_check_at, EXCLUDED.last_check_at)
                `, [
                    row.id, row.channel_identifier, row.user_id, row.first_check_at, row.last_check_at, row.total_checks
                ]);

            case 'lotteries':
                return await client.query(`
                    INSERT INTO lotteries (
                        id, name, ticket_price, total_tickets, sold_tickets, winners_count,
                        bot_percentage, is_active, is_finished, created_at, finished_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.name, row.ticket_price, row.total_tickets, row.sold_tickets, row.winners_count,
                    row.bot_percentage, row.is_active, row.is_finished, row.created_at, row.finished_at
                ]);

            case 'lottery_tickets':
                return await client.query(`
                    INSERT INTO lottery_tickets (id, lottery_id, user_id, ticket_number, purchased_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.lottery_id, row.user_id, row.ticket_number, row.purchased_at
                ]);

            case 'bot_stats':
                return await client.query(`
                    INSERT INTO bot_stats (id, date, total_users, new_users, total_stars_earned, total_withdrawals, active_users)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id, row.date, row.total_users, row.new_users, row.total_stars_earned, row.total_withdrawals, row.active_users
                ]);

            default:
                throw new Error(`Неизвестная таблица: ${tableName}`);
        }
    }

    async generateReport() {
        console.log('\n📊 ОТЧЕТ О ОБЪЕДИНЕНИИ:\n');

        for (const table of this.tables) {
            if (this.stats.merged[table]) {
                const { inserted, skipped, errors } = this.stats.merged[table];
                console.log(`📋 ${table}:`);
                console.log(`   ✅ Добавлено: ${inserted}`);
                console.log(`   ⚠️ Пропущено: ${skipped}`);
                console.log(`   ❌ Ошибок: ${errors}\n`);
            }
        }

        // Финальный анализ после объединения
        console.log('🔍 ФИНАЛЬНАЯ ПРОВЕРКА DB1 ПОСЛЕ ОБЪЕДИНЕНИЯ:\n');
        
        for (const table of this.tables) {
            try {
                const finalResult = await db1.query(`SELECT COUNT(*) as count FROM ${table}`);
                const finalCount = parseInt(finalResult.rows[0].count);
                const originalDb1 = this.stats.db1[table] || 0;
                const added = finalCount - originalDb1;
                
                console.log(`📋 ${table}: ${originalDb1} → ${finalCount} (+${added})`);
                
            } catch (error) {
                console.log(`❌ Ошибка финальной проверки ${table}: ${error.message}`);
            }
        }
    }

    async run() {
        try {
            console.log('🚀 ЗАПУСК ОБЪЕДИНЕНИЯ БАЗ ДАННЫХ\n');
            console.log('📍 DB1 (текущая): ep-quiet-cloud-a2e7auqd');
            console.log('📍 DB2 (старая): ep-late-math-a23qdcph\n');

            // Тестируем подключения
            await this.testConnections();
            
            // Анализируем данные
            await this.analyzeData();
            
            // Объединяем данные
            await this.mergeData();
            
            // Генерируем отчет
            await this.generateReport();
            
            console.log('\n🎉 ОБЪЕДИНЕНИЕ ЗАВЕРШЕНО УСПЕШНО!');
            
        } catch (error) {
            console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error);
        } finally {
            await db1.end();
            await db2.end();
        }
    }

    async testConnections() {
        console.log('🔍 ТЕСТИРОВАНИЕ ПОДКЛЮЧЕНИЙ...\n');
        
        try {
            const db1Test = await db1.query('SELECT NOW() as time');
            console.log(`✅ DB1 (текущая): подключение успешно - ${db1Test.rows[0].time}`);
        } catch (error) {
            throw new Error(`❌ DB1 недоступна: ${error.message}`);
        }
        
        try {
            const db2Test = await db2.query('SELECT NOW() as time');
            console.log(`✅ DB2 (старая): подключение успешно - ${db2Test.rows[0].time}\n`);
        } catch (error) {
            throw new Error(`❌ DB2 недоступна: ${error.message}`);
        }
    }
}

// Запуск объединения
async function startMerge() {
    const merger = new DatabaseMerger();
    await merger.run();
}

startMerge();
