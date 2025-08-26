const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

class Database {
    static get pool() {
        return pool;
    }

    static async init() {
        try {
            console.log('Инициализация базы данных...');

            // Проверяем подключение
            await pool.query('SELECT NOW()');
            console.log('Подключение к базе данных успешно');

            // БЕЗОПАСНАЯ ИНИЦИАЛИЗАЦИЯ: проверяем существование таблиц вместо их удаления
            console.log('Проверка существования таблиц...');

            // Проверяем существование основной таблицы users
            const usersTableExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'users'
                );
            `);

            if (usersTableExists.rows[0].exists) {
                console.log('✅ Основные таблицы уже существуют');

                // Проверяем и создаем таблицы спонсорских каналов отдельно
                await this.ensureSponsorChannelTables();

                console.log('База данных готова к работе!');
                return; // Выходим, не создавая основные таблицы заново
            }

            console.log('📝 Таблицы не найдены, создаём структуру БД...');

            // Создание таблицы пользователей
            await pool.query(`
                CREATE TABLE users (
                    user_id BIGINT PRIMARY KEY,
                    username VARCHAR(255),
                    first_name VARCHAR(255),
                    language_code VARCHAR(10) DEFAULT 'ru',
                    is_premium BOOLEAN DEFAULT FALSE,
                    balance DECIMAL(10,2) DEFAULT 0.00,
                    total_earned DECIMAL(10,2) DEFAULT 0.00,
                    referral_earned DECIMAL(10,2) DEFAULT 0.00,
                    total_referrals INTEGER DEFAULT 0,
                    daily_referrals INTEGER DEFAULT 0,
                    last_daily_reset DATE DEFAULT CURRENT_DATE,
                    clicks_today INTEGER DEFAULT 0,
                    last_click_time TIMESTAMP,
                    points INTEGER DEFAULT 0,
                    weekly_points INTEGER DEFAULT 0,
                    last_case_open DATE,
                    referrer_id BIGINT,
                    referral_completed BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Таблица users создана');

            // Создание таблицы заданий
            await pool.query(`
                CREATE TABLE tasks (
                    id SERIAL PRIMARY KEY,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    link VARCHAR(500),
                    reward DECIMAL(5,2) DEFAULT 0.3,
                    is_subgram BOOLEAN DEFAULT FALSE,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Таблица tasks создана');

            // Создание таблицы выполненных заданий
            await pool.query(`
                CREATE TABLE user_tasks (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    task_id INTEGER NOT NULL,
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (task_id) REFERENCES tasks(id)
                )
            `);
            console.log('Таблица user_tasks создана');

            // Создание таблицы промокодов
            await pool.query(`
                CREATE TABLE promocodes (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(50) UNIQUE NOT NULL,
                    reward DECIMAL(10,2) NOT NULL,
                    uses_limit INTEGER DEFAULT 1,
                    current_uses INTEGER DEFAULT 0,
                    is_active BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Таблица promocodes создана');

            // Создание таблицы использованных промокодов
            await pool.query(`
                CREATE TABLE promocode_uses (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    promocode_id INTEGER NOT NULL,
                    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (promocode_id) REFERENCES promocodes(id)
                )
            `);
            console.log('Таблица promocode_uses создана');

            // Создание таблицы лотерей
            await pool.query(`
                CREATE TABLE lotteries (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    ticket_price DECIMAL(10,2) NOT NULL,
                    total_tickets INTEGER NOT NULL,
                    sold_tickets INTEGER DEFAULT 0,
                    winners_count INTEGER NOT NULL,
                    bot_percentage INTEGER DEFAULT 30,
                    is_active BOOLEAN DEFAULT TRUE,
                    is_finished BOOLEAN DEFAULT FALSE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    finished_at TIMESTAMP
                )
            `);
            console.log('Таблица lotteries создана');

            // Создание таблицы билетов лотереи
            await pool.query(`
                CREATE TABLE lottery_tickets (
                    id SERIAL PRIMARY KEY,
                    lottery_id INTEGER NOT NULL,
                    user_id BIGINT NOT NULL,
                    ticket_number INTEGER NOT NULL,
                    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (lottery_id) REFERENCES lotteries(id)
                )
            `);
            console.log('Таблица lottery_tickets создана');

            // Создание таблицы заявок на вывод
            await pool.query(`
                CREATE TABLE withdrawal_requests (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    amount DECIMAL(10,2) NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending',
                    closure_number INTEGER,
                    rejection_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP
                )
            `);
            console.log('Таблица withdrawal_requests создана');

            // Создание последовательности для номеров закрытых заявок
            await pool.query(`
                CREATE SEQUENCE withdrawal_closure_seq START 437;
            `);
            console.log('Последовательность withdrawal_closure_seq создана');

            // Создание таблицы статистики
            await pool.query(`
                CREATE TABLE bot_stats (
                    id SERIAL PRIMARY KEY,
                    date DATE DEFAULT CURRENT_DATE,
                    total_users INTEGER DEFAULT 0,
                    new_users INTEGER DEFAULT 0,
                    total_stars_earned DECIMAL(15,2) DEFAULT 0,
                    total_withdrawals DECIMAL(15,2) DEFAULT 0,
                    active_users INTEGER DEFAULT 0
                )
            `);
            console.log('Таблица bot_stats создана');

            // Создание таблицы выполненных SubGram заданий
            await pool.query(`
                CREATE TABLE subgram_tasks (
                    id SERIAL PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    channel_link VARCHAR(500) NOT NULL,
                    channel_name VARCHAR(255),
                    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(user_id, channel_link)
                )
            `);
            console.log('Таблица subgram_tasks создана');

            // Создание таблицы статистики спонсорских каналов
            await pool.query(`
                CREATE TABLE IF NOT EXISTS sponsor_channels_stats (
                    id SERIAL PRIMARY KEY,
                    channel_identifier VARCHAR(255) UNIQUE NOT NULL,
                    channel_title VARCHAR(255) NOT NULL,
                    channel_url VARCHAR(500) NOT NULL,
                    is_enabled BOOLEAN DEFAULT true,
                    total_checks INTEGER DEFAULT 0,
                    unique_users_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('Таблица sponsor_channels_stats создана');

            // Создание таблицы для связи пользователей и спонсорских каналов
            await pool.query(`
                CREATE TABLE IF NOT EXISTS sponsor_channel_user_checks (
                    id SERIAL PRIMARY KEY,
                    channel_identifier VARCHAR(255) NOT NULL,
                    user_id BIGINT NOT NULL,
                    first_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    total_checks INTEGER DEFAULT 1,
                    UNIQUE(channel_identifier, user_id)
                )
            `);

            // Добавляем внешний ключ отдельно (если таблица уже существует, то ключ не будет добавлен повторно)
            try {
                await pool.query(`
                    ALTER TABLE sponsor_channel_user_checks
                    ADD CONSTRAINT fk_sponsor_channel_user_checks_channel
                    FOREIGN KEY (channel_identifier)
                    REFERENCES sponsor_channels_stats(channel_identifier)
                    ON DELETE CASCADE
                `);
            } catch (fkError) {
                // Внешний ключ уже существует, это нормально
                console.log('Внешний ключ для sponsor_channel_user_checks уже существует');
            }
            console.log('Таблица sponsor_channel_user_checks создана');

            // Создание индексов для производительности
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_sponsor_channels_enabled
                ON sponsor_channels_stats(is_enabled)
            `);

            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_sponsor_channel_user_checks_channel
                ON sponsor_channel_user_checks(channel_identifier)
            `);

            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_sponsor_channel_user_checks_user
                ON sponsor_channel_user_checks(user_id)
            `);
            console.log('Индексы для спонсорских каналов созданы');

            // Инициализация личных спонсорских каналов из конфигурации
            try {
                const config = require('./config');
                if (config.PERSONAL_SPONSOR_CHANNELS && config.PERSONAL_SPONSOR_CHANNELS.length > 0) {
                    console.log('📝 Инициализация личных спонсорских каналов из конфигурации...');

                    for (const channelInput of config.PERSONAL_SPONSOR_CHANNELS) {
                        const channelData = Database.normalizeChannelIdentifier(channelInput);

                        try {
                            await pool.query(`
                                INSERT INTO sponsor_channels_stats (
                                    channel_identifier,
                                    channel_title,
                                    channel_url,
                                    is_enabled
                                ) VALUES ($1, $2, $3, $4)
                                ON CONFLICT (channel_identifier) DO NOTHING
                            `, [
                                channelData.identifier,
                                channelData.title,
                                channelData.url,
                                true
                            ]);

                            console.log(`✅ Инициализирован канал: ${channelData.identifier}`);
                        } catch (error) {
                            console.error(`❌ Ошибка инициализации канала ${channelInput}:`, error.message);
                        }
                    }
                }
            } catch (configError) {
                console.log('⚠️ Ошибка чтения конфигурации каналов, пропускаем инициализацию');
            }

            console.log('База данных инициализирована успешно!');
        } catch (error) {
            console.error('Ошибка инициализации базы данных:', error);
            throw error;
        }
    }

    // Отдельный метод для проверки и создания таблиц спонсорских каналов
    static async ensureSponsorChannelTables() {
        try {
            console.log('🔍 Проверка таблиц спонсорских каналов...');

            // Проверяем существование таблицы sponsor_channels_stats
            const sponsorTableExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = 'sponsor_channels_stats'
                );
            `);

            if (!sponsorTableExists.rows[0].exists) {
                console.log('📝 Создаем таблицы спонсорских каналов...');

                // Создание таблицы статистики спонсорских каналов
                await pool.query(`
                    CREATE TABLE sponsor_channels_stats (
                        id SERIAL PRIMARY KEY,
                        channel_identifier VARCHAR(255) UNIQUE NOT NULL,
                        channel_title VARCHAR(255) NOT NULL,
                        channel_url VARCHAR(500) NOT NULL,
                        is_enabled BOOLEAN DEFAULT true,
                        total_checks INTEGER DEFAULT 0,
                        unique_users_count INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ Таблица sponsor_channels_stats создана');

                // Создание таблицы для связи пользователей и спонсорских каналов
                await pool.query(`
                    CREATE TABLE sponsor_channel_user_checks (
                        id SERIAL PRIMARY KEY,
                        channel_identifier VARCHAR(255) NOT NULL,
                        user_id BIGINT NOT NULL,
                        first_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        last_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        total_checks INTEGER DEFAULT 1,
                        UNIQUE(channel_identifier, user_id),
                        FOREIGN KEY (channel_identifier)
                        REFERENCES sponsor_channels_stats(channel_identifier)
                        ON DELETE CASCADE
                    )
                `);
                console.log('✅ Таблица sponsor_channel_user_checks создана');

                // Создание индексов
                await pool.query(`CREATE INDEX idx_sponsor_channels_enabled ON sponsor_channels_stats(is_enabled)`);
                await pool.query(`CREATE INDEX idx_sponsor_channel_user_checks_channel ON sponsor_channel_user_checks(channel_identifier)`);
                await pool.query(`CREATE INDEX idx_sponsor_channel_user_checks_user ON sponsor_channel_user_checks(user_id)`);
                console.log('✅ Индексы для спонсорских каналов созданы');

                // Инициализация каналов из конфигурации
                try {
                    const config = require('./config');
                    if (config.PERSONAL_SPONSOR_CHANNELS && config.PERSONAL_SPONSOR_CHANNELS.length > 0) {
                        console.log('📝 Инициализация личных спонсорских каналов из конфигурации...');

                        for (const channelInput of config.PERSONAL_SPONSOR_CHANNELS) {
                            const channelData = Database.normalizeChannelIdentifier(channelInput);

                            try {
                                await pool.query(`
                                    INSERT INTO sponsor_channels_stats (
                                        channel_identifier,
                                        channel_title,
                                        channel_url,
                                        is_enabled
                                    ) VALUES ($1, $2, $3, $4)
                                `, [
                                    channelData.identifier,
                                    channelData.title,
                                    channelData.url,
                                    true
                                ]);

                                console.log(`✅ Инициализирован канал: ${channelData.identifier}`);
                            } catch (error) {
                                console.error(`❌ Ошибка инициализации канала ${channelInput}:`, error.message);
                            }
                        }
                    }
                } catch (configError) {
                    console.log('⚠️ Ошибка чтения конфигурации каналов, пропускаем инициализацию');
                }

                console.log('🎉 Таблицы спонсорских каналов созданы и инициализированы!');
            } else {
                console.log('✅ Таблицы спонсорских каналов уже существуют');
            }
        } catch (error) {
            console.error('❌ Ошибка создания таблиц спонсорских каналов:', error);
            throw error;
        }
    }

    // Пользователи
    static async getUser(userId) {
        const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        return result.rows[0];
    }

    static async createUser(userData) {
        const { userId, username, firstName, languageCode, isPremium, referrerId } = userData;
        const result = await pool.query(`
            INSERT INTO users (user_id, username, first_name, language_code, is_premium, referrer_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (user_id) DO UPDATE SET
                username = $2,
                first_name = $3,
                language_code = $4,
                is_premium = $5,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [userId, username, firstName, languageCode, isPremium, referrerId]);

        // НЕ увеличиваем счетчики рефералов при создании пользователя
        // Рефералы буд��т засчитаны только после выполнения условий в checkReferralConditions()
        if (referrerId) {
            console.log(`👥 Новый пользователь ${userId} добавлен с реферером ${referrerId}, но счетчики пока не увеличиваем`);
        }

        return result.rows[0];
    }

    static async updateUserBalance(userId, amount, type = 'add') {
        // ИСПРАВЛЕНО: убрали Math.abs() - он превращал отрицательные числа в положительные!
        // Теперь можно передавать отрицательные числа для списания средств
        let actualAmount = amount;
        let actualType = type;

        // Если передано отрицательное число без указания типа, автоматически ставим 'subtract'
        if (amount < 0 && type === 'add') {
            actualAmount = Math.abs(amount);
            actualType = 'subtract';
        }

        const operator = actualType === 'add' ? '+' : '-';
        const result = await pool.query(`
            UPDATE users
            SET balance = balance ${operator} $2,
                total_earned = total_earned + CASE WHEN $3 = 'add' THEN $2 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            RETURNING *
        `, [userId, actualAmount, actualType]);
        return result.rows[0];
    }

    // УСТАРЕВШИЙ МЕТОД - теперь рефералы засчитываются только  checkReferralConditions()
    // Оставляем для совместимости, но не используем
    static async addReferral(referrerId) {
        console.log(`⚠️ УСТАРЕВШИЙ ВЫЗОВ addReferral для ${referrerId} - рефералы должны засчитываться через checkReferralConditions()`);
        // НЕ ДЕЛАЕМ НИЧЕГО - рефералы засчитываются только после выполнения условий
    }

    static async updateUserClicks(userId) {
        const result = await pool.query(`
            UPDATE users 
            SET clicks_today = CASE 
                    WHEN DATE(last_click_time) = CURRENT_DATE THEN clicks_today + 1
                    ELSE 1
                END,
                last_click_time = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            RETURNING clicks_today
        `, [userId]);
        return result.rows[0]?.clicks_today || 1;
    }

    static async updateUserPoints(userId, points) {
        await pool.query(`
            UPDATE users 
            SET points = points + $2,
                weekly_points = weekly_points + $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
        `, [userId, points]);
    }

    static async resetWeeklyPoints() {
        await pool.query('UPDATE users SET weekly_points = 0');
    }

    static async getWeeklyLeaderboard(limit = 10) {
        const result = await pool.query(`
            SELECT user_id, username, first_name, weekly_points 
            FROM users 
            WHERE weekly_points > 0 
            ORDER BY weekly_points DESC 
            LIMIT $1
        `, [limit]);
        return result.rows;
    }

    static async getOverallLeaderboard(limit = 10) {
        const result = await pool.query(`
            SELECT user_id, username, first_name, points 
            FROM users 
            WHERE points > 0 
            ORDER BY points DESC 
            LIMIT $1
        `, [limit]);
        return result.rows;
    }

    // Задания
    static async getTasks(isSubgram = false) {
        const result = await pool.query(`
            SELECT * FROM tasks 
            WHERE is_active = true AND is_subgram = $1 
            ORDER BY created_at DESC
        `, [isSubgram]);
        return result.rows;
    }

    static async createTask(taskData) {
        const { title, description, link, reward, isSubgram } = taskData;
        const result = await pool.query(`
            INSERT INTO tasks (title, description, link, reward, is_subgram)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [title, description, link, reward, isSubgram]);
        return result.rows[0];
    }

    static async completeTask(userId, taskId) {
        const result = await pool.query(`
            INSERT INTO user_tasks (user_id, task_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            RETURNING *
        `, [userId, taskId]);
        return result.rows[0];
    }

    static async isTaskCompleted(userId, taskId) {
        const result = await pool.query(`
            SELECT * FROM user_tasks 
            WHERE user_id = $1 AND task_id = $2
        `, [userId, taskId]);
        return result.rows.length > 0;
    }

    static async getUserCompletedTasks(userId) {
        const result = await pool.query(`
            SELECT COUNT(*) as count FROM user_tasks WHERE user_id = $1
        `, [userId]);
        return parseInt(result.rows[0].count);
    }

    // Промокоды
    static async createPromocode(code, reward, usesLimit) {
        const result = await pool.query(`
            INSERT INTO promocodes (code, reward, uses_limit)
            VALUES ($1, $2, $3)
            RETURNING *
        `, [code, reward, usesLimit]);
        return result.rows[0];
    }

    static async usePromocode(userId, code) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const promocode = await client.query(`
                SELECT * FROM promocodes 
                WHERE code = $1 AND is_active = true 
                AND current_uses < uses_limit
            `, [code]);
            
            if (promocode.rows.length === 0) {
                throw new Error('Промокод недействителен или исчерпан');
            }
            
            const alreadyUsed = await client.query(`
                SELECT * FROM promocode_uses 
                WHERE user_id = $1 AND promocode_id = $2
            `, [userId, promocode.rows[0].id]);
            
            if (alreadyUsed.rows.length > 0) {
                throw new Error('Промокод уже использован');
            }
            
            await client.query(`
                INSERT INTO promocode_uses (user_id, promocode_id)
                VALUES ($1, $2)
            `, [userId, promocode.rows[0].id]);
            
            await client.query(`
                UPDATE promocodes 
                SET current_uses = current_uses + 1
                WHERE id = $1
            `, [promocode.rows[0].id]);
            
            await client.query('COMMIT');
            return promocode.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Лотереи
    static async createLottery(lotteryData) {
        const { name, ticketPrice, totalTickets, winnersCount, botPercentage } = lotteryData;
        const result = await pool.query(`
            INSERT INTO lotteries (name, ticket_price, total_tickets, winners_count, bot_percentage)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `, [name, ticketPrice, totalTickets, winnersCount, botPercentage]);
        return result.rows[0];
    }

    static async getActiveLotteries() {
        const result = await pool.query(`
            SELECT * FROM lotteries 
            WHERE is_active = true AND is_finished = false
            ORDER BY created_at DESC
        `);
        return result.rows;
    }

    static async buyLotteryTicket(userId, lotteryId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const lottery = await client.query(`
                SELECT * FROM lotteries 
                WHERE id = $1 AND is_active = true AND is_finished = false
            `, [lotteryId]);
            
            if (lottery.rows.length === 0) {
                throw new Error('Лотерея не найдена или завершена');
            }
            
            const lotteryData = lottery.rows[0];
            if (lotteryData.sold_tickets >= lotteryData.total_tickets) {
                throw new Error('Все билеты проданы');
            }
            
            const user = await client.query(`
                SELECT balance FROM users WHERE user_id = $1
            `, [userId]);
            
            if (user.rows[0].balance < lotteryData.ticket_price) {
                throw new Error('Недостаточно средств');
            }
            
            await client.query(`
                UPDATE users 
                SET balance = balance - $2
                WHERE user_id = $1
            `, [userId, lotteryData.ticket_price]);
            
            const ticketNumber = lotteryData.sold_tickets + 1;
            
            await client.query(`
                INSERT INTO lottery_tickets (lottery_id, user_id, ticket_number)
                VALUES ($1, $2, $3)
            `, [lotteryId, userId, ticketNumber]);
            
            await client.query(`
                UPDATE lotteries 
                SET sold_tickets = sold_tickets + 1
                WHERE id = $1
            `, [lotteryId]);
            
            await client.query('COMMIT');
            return ticketNumber;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Заявки на вывод
    static async createWithdrawalRequest(userId, amount) {
        const result = await pool.query(`
            INSERT INTO withdrawal_requests (user_id, amount)
            VALUES ($1, $2)
            RETURNING *
        `, [userId, amount]);
        return result.rows[0];
    }

    static async getPendingWithdrawals() {
        const result = await pool.query(`
            SELECT wr.*, u.username, u.first_name, u.balance
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.user_id
            WHERE wr.status = 'pending'
            ORDER BY wr.created_at ASC
        `);
        return result.rows;
    }

    static async processWithdrawal(requestId, status, reason = null) {
        const result = await pool.query(`
            UPDATE withdrawal_requests
            SET status = $2,
                closure_number = CASE WHEN $2 IN ('approved', 'rejected') THEN nextval('withdrawal_closure_seq') ELSE closure_number END,
                rejection_reason = $3,
                processed_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
        `, [requestId, status, reason]);
        return result.rows[0];
    }

    // SubGram задания
    static async completeSubgramTask(userId, channelLink, channelName = null) {
        const result = await pool.query(`
            INSERT INTO subgram_tasks (user_id, channel_link, channel_name)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, channel_link) DO NOTHING
            RETURNING *
        `, [userId, channelLink, channelName]);
        return result.rows[0];
    }

    static async getCompletedSubgramTasks(userId) {
        const result = await pool.query(`
            SELECT channel_link FROM subgram_tasks WHERE user_id = $1
        `, [userId]);
        return result.rows.map(row => row.channel_link);
    }

    static async getUserSubgramTasksCount(userId) {
        const result = await pool.query(`
            SELECT COUNT(*) as count FROM subgram_tasks WHERE user_id = $1
        `, [userId]);
        return parseInt(result.rows[0].count);
    }

    static async isSubgramTaskCompleted(userId, channelLink) {
        const result = await pool.query(`
            SELECT * FROM subgram_tasks
            WHERE user_id = $1 AND channel_link = $2
        `, [userId, channelLink]);
        return result.rows.length > 0;
    }

    // Методы для работы с рефералами
    static async getUserReferrals(userId) {
        const result = await pool.query(`
            SELECT user_id, first_name, username, referral_completed, created_at
            FROM users
            WHERE referrer_id = $1
            ORDER BY created_at DESC
        `, [userId]);
        return result.rows;
    }

    static async getActivatedReferrals(userId) {
        const result = await pool.query(`
            SELECT user_id, first_name, username, created_at
            FROM users
            WHERE referrer_id = $1 AND referral_completed = TRUE
            ORDER BY created_at DESC
        `, [userId]);
        return result.rows;
    }

    static async getNonActivatedReferrals(userId) {
        const result = await pool.query(`
            SELECT user_id, first_name, username, created_at
            FROM users
            WHERE referrer_id = $1 AND referral_completed = FALSE
            ORDER BY created_at DESC
        `, [userId]);
        return result.rows;
    }

    static async getReferralStats(userId) {
        const result = await pool.query(`
            SELECT
                COUNT(*) as total_referrals,
                COUNT(CASE WHEN referral_completed = TRUE THEN 1 END) as activated_referrals,
                COUNT(CASE WHEN referral_completed = FALSE THEN 1 END) as non_activated_referrals
            FROM users
            WHERE referrer_id = $1
        `, [userId]);
        return result.rows[0];
    }

    // Оценка количество подписок пользователя на спонсорские каналы
    // Базируется на том, что активированные пользователи точно подписаны
    static async getUserSponsorSubscriptions(userId) {
        const user = await pool.query('SELECT referral_completed FROM users WHERE user_id = $1', [userId]);
        if (user.rows.length === 0) return 0;

        // Если пользователь активирован (referral_completed = true), значит подписан на спонсорские каналы
        // Примерная оценка: 3-5 спонсорских каналов в среднем
        return user.rows[0].referral_completed ? 4 : 0;
    }

    // Оценка количества подписок рефералов пользователя
    static async getReferralsSponsorSubscriptions(userId) {
        const result = await pool.query(`
            SELECT COUNT(CASE WHEN referral_completed = TRUE THEN 1 END) as activated_referrals
            FROM users
            WHERE referrer_id = $1
        `, [userId]);

        // Каждый активированный реферал подписан на спонсорские каналы (примерно 4 канала)
        const activatedReferrals = parseInt(result.rows[0].activated_referrals) || 0;
        return activatedReferrals * 4;
    }

    // Получить расширенную информацию о пользователе для заявки на вывод
    static async getUserWithdrawalInfo(userId) {
        try {
            const user = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
            if (user.rows.length === 0) return null;

            const userData = user.rows[0];

            // Получаем статистику рефералов
            const referralStats = await this.getReferralStats(userId);

            // Получаем оценку подписок
            const userSubscriptions = await this.getUserSponsorSubscriptions(userId);
            const referralsSubscriptions = await this.getReferralsSponsorSubscriptions(userId);

            return {
                ...userData,
                referral_stats: referralStats,
                sponsor_subscriptions: userSubscriptions,
                referrals_subscriptions: referralsSubscriptions
            };
        } catch (error) {
            console.error('Ошибка получения информации о пользователе для вывода:', error);
            return null;
        }
    }

    // Установка начального номера для заявок на вывод
    static async setWithdrawalStartNumber(startNumber) {
        try {
            // Проверяем текущее значение последовательности
            const currentSeq = await pool.query(`
                SELECT last_value FROM withdrawal_requests_id_seq;
            `);

            const currentValue = parseInt(currentSeq.rows[0]?.last_value) || 0;
            console.log(`Текущее значение последовательности: ${currentValue}`);

            // Устанавливаем новое значение (startNumber - 1, чтобы следующий ID был именно startNumber)
            await pool.query(`
                SELECT setval('withdrawal_requests_id_seq', $1, true);
            `, [startNumber - 1]);

            // Проверяем установленное значение
            const newSeq = await pool.query(`
                SELECT last_value FROM withdrawal_requests_id_seq;
            `);

            const newValue = parseInt(newSeq.rows[0]?.last_value);
            console.log(`✅ Последовательность установлена! Следующая заявка будет иметь номер ${newValue + 1}`);

            return {
                success: true,
                previousValue: currentValue,
                newValue: newValue,
                nextWithdrawalId: newValue + 1
            };

        } catch (error) {
            console.error('Ошибка установки начального номера заявок:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Установка начального номера для нумерации закрытых заявок
    static async setWithdrawalClosureStartNumber(startNumber) {
        try {
            // Проверяем существование последовательности
            const seqExists = await pool.query(`
                SELECT EXISTS (
                    SELECT 1 FROM information_schema.sequences
                    WHERE sequence_name = 'withdrawal_closure_seq'
                );
            `);

            if (!seqExists.rows[0].exists) {
                // Создаем последовательность если не существует
                await pool.query(`
                    CREATE SEQUENCE withdrawal_closure_seq START ${startNumber - 1};
                `);
                console.log(`✅ Создана последовательность withdrawal_closure_seq, начиная с ${startNumber - 1}`);
            } else {
                // Устанавливаем новое значение
                await pool.query(`
                    SELECT setval('withdrawal_closure_seq', $1, true);
                `, [startNumber - 1]);
                console.log(`✅ Последовательность withdrawal_closure_seq установлена на ${startNumber - 1}`);
            }

            // Проверяем установленное значение
            const newSeq = await pool.query(`
                SELECT last_value FROM withdrawal_closure_seq;
            `);

            const newValue = parseInt(newSeq.rows[0]?.last_value);
            console.log(`✅ Следующая закрытая заявка будет иметь номер ${newValue + 1}`);

            return {
                success: true,
                newValue: newValue,
                nextClosureNumber: newValue + 1
            };

        } catch (error) {
            console.error('Ошибка установки начального номера закрытых заявок:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ==================== SPONSOR CHANNELS STATISTICS ====================

    // Функция для нормализации идентификатора канала
    static normalizeChannelIdentifier(channelInput) {
        if (channelInput.startsWith('https://t.me/')) {
            const username = channelInput.replace('https://t.me/', '');
            return {
                identifier: `@${username}`,
                title: username,
                url: channelInput
            };
        } else if (channelInput.startsWith('@')) {
            return {
                identifier: channelInput,
                title: channelInput.replace('@', ''),
                url: `https://t.me/${channelInput.replace('@', '')}`
            };
        } else {
            return {
                identifier: `@${channelInput}`,
                title: channelInput,
                url: `https://t.me/${channelInput}`
            };
        }
    }

    // Добавить или обновить статистику спонсорского канала
    static async addOrUpdateSponsorChannel(channelIdentifier, channelTitle, channelUrl, isEnabled = true) {
        try {
            const result = await pool.query(`
                INSERT INTO sponsor_channels_stats (
                    channel_identifier,
                    channel_title,
                    channel_url,
                    is_enabled,
                    updated_at
                ) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
                ON CONFLICT (channel_identifier)
                DO UPDATE SET
                    channel_title = EXCLUDED.channel_title,
                    channel_url = EXCLUDED.channel_url,
                    is_enabled = EXCLUDED.is_enabled,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `, [channelIdentifier, channelTitle, channelUrl, isEnabled]);

            return result.rows[0];
        } catch (error) {
            console.error('Ошибка добавления/обновления спонсорского канала:', error);
            throw error;
        }
    }

    // Получить все спонсорские каналы
    static async getAllSponsorChannels() {
        try {
            const result = await pool.query(`
                SELECT * FROM sponsor_channels_stats
                ORDER BY created_at DESC
            `);
            return result.rows;
        } catch (error) {
            console.error('Ошибка получения спонсорских каналов:', error);
            throw error;
        }
    }

    // Получить только активные спонсорские каналы
    static async getActiveSponsorChannels() {
        try {
            const result = await pool.query(`
                SELECT * FROM sponsor_channels_stats
                WHERE is_enabled = true
                ORDER BY created_at DESC
            `);
            return result.rows;
        } catch (error) {
            console.error('Ошибка получения активных спонсорских каналов:', error);
            throw error;
        }
    }

    // Включить/выключить спонсорский канал
    static async toggleSponsorChannel(channelIdentifier, isEnabled) {
        try {
            const result = await pool.query(`
                UPDATE sponsor_channels_stats
                SET is_enabled = $2, updated_at = CURRENT_TIMESTAMP
                WHERE channel_identifier = $1
                RETURNING *
            `, [channelIdentifier, isEnabled]);

            if (result.rows.length === 0) {
                throw new Error(`Канал ${channelIdentifier} не найден`);
            }

            return result.rows[0];
        } catch (error) {
            console.error('Ошибка переключения статуса канала:', error);
            throw error;
        }
    }

    // Записать проверку подписки пользователя на канал (с учетом уникальности)
    static async recordSponsorChannelCheck(channelIdentifier, userId) {
        try {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');

                // Проверяем, была ли уже проверка этого пользователя для этого канала
                const existingCheck = await client.query(`
                    SELECT id, total_checks FROM sponsor_channel_user_checks
                    WHERE channel_identifier = $1 AND user_id = $2
                `, [channelIdentifier, userId]);

                if (existingCheck.rows.length > 0) {
                    // Обновляем существующую запись (увеличиваем счетчик, но НЕ увеличиваем unique_users_count)
                    await client.query(`
                        UPDATE sponsor_channel_user_checks
                        SET total_checks = total_checks + 1, last_check_at = CURRENT_TIMESTAMP
                        WHERE channel_identifier = $1 AND user_id = $2
                    `, [channelIdentifier, userId]);

                    // Увеличиваем только общий счетчик проверок для канала
                    await client.query(`
                        UPDATE sponsor_channels_stats
                        SET total_checks = total_checks + 1, updated_at = CURRENT_TIMESTAMP
                        WHERE channel_identifier = $1
                    `, [channelIdentifier]);

                    console.log(`📊 Обновлена проверка канала ${channelIdentifier} для пользователя ${userId} (повторная)`);
                } else {
                    // Новый пользователь - добавляем запись и увеличиваем оба счетчика
                    await client.query(`
                        INSERT INTO sponsor_channel_user_checks (channel_identifier, user_id)
                        VALUES ($1, $2)
                    `, [channelIdentifier, userId]);

                    // Увеличиваем оба счетчика для канала
                    await client.query(`
                        UPDATE sponsor_channels_stats
                        SET total_checks = total_checks + 1,
                            unique_users_count = unique_users_count + 1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE channel_identifier = $1
                    `, [channelIdentifier]);

                    console.log(`📊 Новая проверка канала ${channelIdentifier} для пользователя ${userId} (уникальная)`);
                }

                await client.query('COMMIT');
                return { success: true };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Ошибка записи проверки канала:', error);
            throw error;
        }
    }

    // Получить статистику канала
    static async getSponsorChannelStats(channelIdentifier) {
        try {
            const result = await pool.query(`
                SELECT * FROM sponsor_channels_stats
                WHERE channel_identifier = $1
            `, [channelIdentifier]);

            if (result.rows.length === 0) {
                return null;
            }

            return result.rows[0];
        } catch (error) {
            console.error('Ошибка получения статистики канала:', error);
            throw error;
        }
    }

    // Удалить спонсорский канал
    static async deleteSponsorChannel(channelIdentifier) {
        try {
            const result = await pool.query(`
                DELETE FROM sponsor_channels_stats
                WHERE channel_identifier = $1
                RETURNING *
            `, [channelIdentifier]);

            if (result.rows.length === 0) {
                throw new Error(`Канал ${channelIdentifier} не найден`);
            }

            return result.rows[0];
        } catch (error) {
            console.error('Ошибка удаления спонсорского канала:', error);
            throw error;
        }
    }

    // Получить топ каналов по количеств�� проверок
    static async getTopSponsorChannels(limit = 10) {
        try {
            const result = await pool.query(`
                SELECT
                    channel_identifier,
                    channel_title,
                    total_checks,
                    unique_users_count,
                    is_enabled,
                    ROUND((unique_users_count::float / NULLIF(total_checks, 0) * 100), 2) as uniqueness_rate
                FROM sponsor_channels_stats
                ORDER BY total_checks DESC
                LIMIT $1
            `, [limit]);

            return result.rows;
        } catch (error) {
            console.error('Ошибка получения топа каналов:', error);
            throw error;
        }
    }
}

module.exports = Database;
