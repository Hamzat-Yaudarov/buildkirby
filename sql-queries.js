/**
 * Централизованные SQL запросы для избежания дублирования
 * Все часто используемые запросы вынесены в отдельные функции
 */

class SQLQueries {
    // ==================== USER QUERIES ====================
    
    static getUserById(userId) {
        return {
            query: 'SELECT * FROM users WHERE id = $1',
            params: [userId]
        };
    }
    
    static updateUserBalance(userId, amount) {
        return {
            query: 'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING balance',
            params: [amount, userId]
        };
    }
    
    static updateUserField(userId, field, value) {
        return {
            query: `UPDATE users SET ${field} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
            params: [value, userId]
        };
    }
    
    static createUser(id, username, first_name, invited_by = null) {
        return {
            query: `INSERT INTO users (id, username, first_name, invited_by) 
                   VALUES ($1, $2, $3, $4) RETURNING *`,
            params: [id, username, first_name, invited_by]
        };
    }
    
    // ==================== TASK QUERIES ====================
    
    static getActiveTasks() {
        return {
            query: `SELECT * FROM tasks
                   WHERE is_active = TRUE
                   AND (max_completions IS NULL OR current_completions < max_completions)
                   ORDER BY id`,
            params: []
        };
    }
    
    static getUserCompletedTasks(userId) {
        return {
            query: `SELECT t.* FROM tasks t 
                   JOIN user_tasks ut ON t.id = ut.task_id 
                   WHERE ut.user_id = $1 AND t.is_active = TRUE`,
            params: [userId]
        };
    }
    
    static completeTask(userId, taskId) {
        return {
            query: 'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2)',
            params: [userId, taskId]
        };
    }
    
    static incrementTaskCompletions(taskId) {
        return {
            query: 'UPDATE tasks SET current_completions = current_completions + 1 WHERE id = $1',
            params: [taskId]
        };
    }
    
    // ==================== LOTTERY QUERIES ====================
    
    static getActiveLotteries() {
        return {
            query: 'SELECT * FROM lotteries WHERE is_active = TRUE ORDER BY id',
            params: []
        };
    }
    
    static getLotteryById(lotteryId) {
        return {
            query: 'SELECT * FROM lotteries WHERE id = $1 AND is_active = TRUE',
            params: [lotteryId]
        };
    }
    
    static addLotteryTicket(lotteryId, userId) {
        return {
            query: 'INSERT INTO lottery_tickets (lottery_id, user_id) VALUES ($1, $2)',
            params: [lotteryId, userId]
        };
    }
    
    // ==================== CHANNEL QUERIES ====================
    
    static getRequiredChannels() {
        return {
            query: 'SELECT channel_id FROM required_channels WHERE is_active = TRUE',
            params: []
        };
    }
    
    static getChannelsData() {
        return {
            query: 'SELECT channel_id, channel_name FROM required_channels WHERE is_active = TRUE',
            params: []
        };
    }
    
    static addRequiredChannel(channelId, channelName) {
        return {
            query: `INSERT INTO required_channels (channel_id, channel_name) 
                   VALUES ($1, $2) ON CONFLICT (channel_id) DO NOTHING`,
            params: [channelId, channelName]
        };
    }
    
    // ==================== REFERRAL QUERIES ====================
    
    static getReferralsByUser(userId) {
        return {
            query: 'SELECT COUNT(*) as count FROM users WHERE invited_by = $1',
            params: [userId]
        };
    }
    
    static setReferralProcessed(userId) {
        return {
            query: 'UPDATE users SET referral_processed = TRUE WHERE id = $1',
            params: [userId]
        };
    }
    
    static checkReferralQualification(userId) {
        return {
            query: `SELECT 
                       captcha_passed,
                       is_subscribed,
                       (SELECT COUNT(*) FROM users WHERE invited_by = $1) as referrals_count
                   FROM users WHERE id = $1`,
            params: [userId]
        };
    }
    
    // ==================== WITHDRAWAL QUERIES ====================
    
    static getPendingWithdrawals() {
        return {
            query: `SELECT wr.*, u.first_name, u.username
                   FROM withdrawal_requests wr
                   JOIN users u ON wr.user_id = u.id
                   WHERE wr.status = 'pending'
                   ORDER BY wr.created_at ASC`,
            params: []
        };
    }
    
    static createWithdrawalRequest(userId, amount, type) {
        return {
            query: `INSERT INTO withdrawal_requests (user_id, amount, type) 
                   VALUES ($1, $2, $3) RETURNING id`,
            params: [userId, amount, type]
        };
    }
    
    static approveWithdrawal(withdrawalId, adminId) {
        return {
            query: `UPDATE withdrawal_requests
                   SET status = 'completed',
                       processed_at = CURRENT_TIMESTAMP,
                       processed_by = $1
                   WHERE id = $2 AND status = 'pending'
                   RETURNING id`,
            params: [adminId, withdrawalId]
        };
    }
    
    // ==================== STATISTICS QUERIES ====================
    
    static getUserStats() {
        return {
            query: `SELECT
                       COUNT(*) as total_users,
                       SUM(balance) as total_balance,
                       SUM(referrals_count) as total_referrals,
                       COUNT(*) FILTER (WHERE registered_at > CURRENT_DATE) as today_users
                   FROM users`,
            params: []
        };
    }
    
    static getTopUsersByBalance(limit = 10) {
        return {
            query: `SELECT id, first_name, username, balance
                   FROM users
                   WHERE balance > 0
                   ORDER BY balance DESC, registered_at ASC
                   LIMIT $1`,
            params: [limit]
        };
    }
    
    static getTopUsersByReferrals(limit = 10) {
        return {
            query: `SELECT id, first_name, username, referrals_count
                   FROM users
                   WHERE referrals_count > 0
                   ORDER BY referrals_count DESC, registered_at ASC
                   LIMIT $1`,
            params: [limit]
        };
    }
    
    static getWeeklyTopUsers(limit = 5) {
        return {
            query: `SELECT id, first_name, username, weekly_points
                   FROM users
                   WHERE weekly_points > 0
                   ORDER BY weekly_points DESC, registered_at ASC
                   LIMIT $1`,
            params: [limit]
        };
    }
    
    // ==================== SUBGRAM QUERIES ====================
    
    static saveSubGramSession(userId, sessionData, channelsData, gender = null, expiresAt) {
        return {
            query: `INSERT INTO subgram_user_sessions (user_id, session_data, channels_data, gender, expires_at)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (user_id)
                   DO UPDATE SET
                       session_data = $2,
                       channels_data = $3,
                       gender = $4,
                       expires_at = $5,
                       last_check_at = CURRENT_TIMESTAMP,
                       status = 'active'
                   RETURNING *`,
            params: [userId, JSON.stringify(sessionData), JSON.stringify(channelsData), gender, expiresAt]
        };
    }
    
    static getSubGramSession(userId) {
        return {
            query: `SELECT * FROM subgram_user_sessions
                   WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP AND status = 'active'`,
            params: [userId]
        };
    }
    
    static logSubGramAPIRequest(userId, requestType, requestParams, responseData, success, errorMessage = null) {
        return {
            query: `INSERT INTO subgram_api_requests
                   (user_id, request_type, request_params, response_data, success, error_message, api_status, api_code)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            params: [
                userId,
                requestType,
                JSON.stringify(requestParams),
                JSON.stringify(responseData),
                success,
                errorMessage,
                responseData?.status || null,
                responseData?.code || null
            ]
        };
    }
    
    // ==================== UTILITY METHODS ====================
    
    /**
     * Выполняет запрос с автоматической подстановкой параметров
     * @param {Function} executeQuery - функция выполнения запроса из database.js
     * @param {string} queryName - название метода запроса
     * @param {...any} params - параметры для запроса
     * @returns {Promise} результат выполнения запроса
     */
    static async execute(executeQuery, queryName, ...params) {
        if (typeof SQLQueries[queryName] !== 'function') {
            throw new Error(`Unknown query method: ${queryName}`);
        }
        
        const { query, params: queryParams } = SQLQueries[queryName](...params);
        return await executeQuery(query, queryParams);
    }
    
    /**
     * Получает все доступные методы запросов
     * @returns {Array} массив названий методов
     */
    static getAvailableQueries() {
        return Object.getOwnPropertyNames(SQLQueries)
            .filter(name => typeof SQLQueries[name] === 'function' && name !== 'execute' && name !== 'getAvailableQueries');
    }
}

module.exports = SQLQueries;
