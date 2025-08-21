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

            // ПОЛНАЯ ОЧИСТКА И ПЕРЕСОЗДАНИЕ
            console.log('Очистка существующих таблиц...');

            // Удаляем все таблицы в правильном порядке (с учетом внешних ключей)
            await pool.query('DROP TABLE IF EXISTS withdrawal_requests CASCADE');
            await pool.query('DROP TABLE IF EXISTS lottery_tickets CASCADE');
            await pool.query('DROP TABLE IF EXISTS lotteries CASCADE');
            await pool.query('DROP TABLE IF EXISTS promocode_uses CASCADE');
            await pool.query('DROP TABLE IF EXISTS promocodes CASCADE');
            await pool.query('DROP TABLE IF EXISTS user_tasks CASCADE');
            await pool.query('DROP TABLE IF EXISTS tasks CASCADE');
            await pool.query('DROP TABLE IF EXISTS subgram_tasks CASCADE');
            await pool.query('DROP TABLE IF EXISTS bot_stats CASCADE');
            await pool.query('DROP TABLE IF EXISTS users CASCADE');

            console.log('Старые таблицы удалены');

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
                    rejection_reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    processed_at TIMESTAMP
                )
            `);
            console.log('Таблица withdrawal_requests создана');

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

            console.log('База данных инициализирована успешно!');
        } catch (error) {
            console.error('Ошибка инициализации базы данных:', error);
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
        
        // Если есть реферер, увеличиваем его счетчики
        if (referrerId) {
            await this.addReferral(referrerId);
        }
        
        return result.rows[0];
    }

    static async updateUserBalance(userId, amount, type = 'add') {
        const operator = type === 'add' ? '+' : '-';
        const result = await pool.query(`
            UPDATE users 
            SET balance = balance ${operator} $2,
                total_earned = total_earned + CASE WHEN $3 = 'add' THEN $2 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            RETURNING *
        `, [userId, Math.abs(amount), type]);
        return result.rows[0];
    }

    static async addReferral(referrerId) {
        await pool.query(`
            UPDATE users 
            SET total_referrals = total_referrals + 1,
                daily_referrals = CASE 
                    WHEN last_daily_reset = CURRENT_DATE THEN daily_referrals + 1
                    ELSE 1
                END,
                last_daily_reset = CURRENT_DATE,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
        `, [referrerId]);
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
            SET status = $2, rejection_reason = $3, processed_at = CURRENT_TIMESTAMP
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
}

module.exports = Database;
