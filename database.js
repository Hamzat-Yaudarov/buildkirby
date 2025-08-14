const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection configuration
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_s6iWtmzZU8XA@ep-dawn-waterfall-a23jn5vi-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

// Create connection pool for better performance
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20, // Maximum number of connections
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Initialize database schema
async function initializeDatabase() {
    try {
        console.log('🔄 Initializing PostgreSQL database...');

        // Create tables without constraints to avoid conflicts
        await pool.query(`
            -- Users table
            CREATE TABLE IF NOT EXISTS users (
                id BIGINT PRIMARY KEY,
                username VARCHAR(32),
                first_name VARCHAR(64),
                balance DECIMAL(10,2) DEFAULT 0.00,
                referrals_count INTEGER DEFAULT 0,
                referrals_today INTEGER DEFAULT 0,
                invited_by BIGINT,
                pending_referrer BIGINT,
                last_click TIMESTAMP,
                last_case_open TIMESTAMP,
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_subscribed BOOLEAN DEFAULT FALSE,
                temp_action VARCHAR(100),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Tasks table
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                channel_id VARCHAR(100) UNIQUE NOT NULL,
                channel_name VARCHAR(100),
                reward DECIMAL(10,2) DEFAULT 1.00,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- User tasks completion
            CREATE TABLE IF NOT EXISTS user_tasks (
                user_id BIGINT,
                task_id INTEGER,
                completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, task_id)
            );

            -- Lotteries table
            CREATE TABLE IF NOT EXISTS lotteries (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                ticket_price DECIMAL(10,2) NOT NULL,
                max_tickets INTEGER NOT NULL,
                winners_count INTEGER NOT NULL,
                current_tickets INTEGER DEFAULT 0,
                bot_percent INTEGER DEFAULT 20,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP
            );

            -- Lottery tickets
            CREATE TABLE IF NOT EXISTS lottery_tickets (
                id SERIAL PRIMARY KEY,
                lottery_id INTEGER,
                user_id BIGINT,
                purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Withdrawal requests
            CREATE TABLE IF NOT EXISTS withdrawal_requests (
                id SERIAL PRIMARY KEY,
                user_id BIGINT,
                amount DECIMAL(10,2) NOT NULL,
                type VARCHAR(20) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                admin_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_at TIMESTAMP,
                processed_by BIGINT
            );

            -- Promocodes table
            CREATE TABLE IF NOT EXISTS promocodes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(20) UNIQUE NOT NULL,
                reward DECIMAL(10,2) NOT NULL,
                max_uses INTEGER,
                current_uses INTEGER DEFAULT 0,
                is_active BOOLEAN DEFAULT TRUE,
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by BIGINT
            );

            -- Promocode usage tracking
            CREATE TABLE IF NOT EXISTS promocode_usage (
                user_id BIGINT,
                promocode_id INTEGER,
                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, promocode_id)
            );

            -- Required channels for registration
            CREATE TABLE IF NOT EXISTS required_channels (
                id SERIAL PRIMARY KEY,
                channel_id VARCHAR(100) UNIQUE NOT NULL,
                channel_name VARCHAR(100),
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Tracking links for analytics
            CREATE TABLE IF NOT EXISTS tracking_links (
                id SERIAL PRIMARY KEY,
                tracking_id VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(200) NOT NULL,
                clicks_count INTEGER DEFAULT 0,
                created_by BIGINT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Tracking clicks for detailed analytics
            CREATE TABLE IF NOT EXISTS tracking_clicks (
                id SERIAL PRIMARY KEY,
                tracking_id VARCHAR(100) NOT NULL,
                user_id BIGINT,
                clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add missing columns if they don't exist
        try {
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS pending_referrer BIGINT;
            `);

            await pool.query(`
                ALTER TABLE lotteries
                ADD COLUMN IF NOT EXISTS bot_percent INTEGER DEFAULT 20;
            `);

            console.log('✅ Database columns updated');
        } catch (error) {
            console.log('ℹ️ Column update attempt (may already exist):', error.message);
        }

        console.log('✅ PostgreSQL database initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Error initializing database:', error);
        throw error;
    }
}

// Helper function to execute queries with retry logic
async function executeQuery(query, params = [], retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await pool.query(query, params);
            return result;
        } catch (error) {
            console.error(`❌ Query attempt ${attempt} failed:`, error.message);
            
            if (attempt === retries) {
                throw error;
            }
            
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
}

// User management functions
async function getUser(userId) {
    try {
        const result = await executeQuery('SELECT * FROM users WHERE id = $1', [userId]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting user:', error);
        throw error;
    }
}

async function createOrUpdateUser(user, invitedBy = null) {
    const { id, username, first_name } = user;
    
    try {
        // Try to get existing user first
        const existingUser = await getUser(id);
        
        if (existingUser) {
            // Update existing user
            const result = await executeQuery(
                'UPDATE users SET username = $1, first_name = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
                [username, first_name, id]
            );
            return result.rows[0];
        } else {
            // Create new user
            const result = await executeQuery(
                `INSERT INTO users (id, username, first_name, invited_by) 
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [id, username, first_name, invitedBy]
            );
            
            // If user was invited, add referral bonus
            if (invitedBy) {
                await addReferralBonus(invitedBy);
            }
            
            return result.rows[0];
        }
    } catch (error) {
        console.error('Error creating/updating user:', error);
        throw error;
    }
}

async function addReferralBonus(referrerId, newUserName = 'Новый пользователь') {
    const bonus = 3; // 3 stars for each referral

    try {
        await executeQuery(
            `UPDATE users SET
             balance = balance + $1,
             referrals_count = referrals_count + 1,
             referrals_today = referrals_today + 1,
             updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [bonus, referrerId]
        );

        // Return referrer and bonus info for notification
        return {
            referrerId,
            bonus,
            newUserName
        };
    } catch (error) {
        console.error('Error adding referral bonus:', error);
        throw error;
    }
}

async function updateUserBalance(userId, amount) {
    try {
        const result = await executeQuery(
            'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING balance',
            [amount, userId]
        );
        return result.rows[0]?.balance || 0;
    } catch (error) {
        console.error('Error updating user balance:', error);
        throw error;
    }
}

async function updateUserField(userId, field, value) {
    try {
        const result = await executeQuery(
            `UPDATE users SET ${field} = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
            [value, userId]
        );
        return result.rows[0];
    } catch (error) {
        console.error(`Error updating user ${field}:`, error);
        throw error;
    }
}

// Task management functions
async function getTasks() {
    try {
        const result = await executeQuery('SELECT * FROM tasks WHERE is_active = TRUE ORDER BY id');
        return result.rows;
    } catch (error) {
        console.error('Error getting tasks:', error);
        throw error;
    }
}

async function getUserCompletedTasks(userId) {
    try {
        const result = await executeQuery(
            `SELECT t.* FROM tasks t 
             JOIN user_tasks ut ON t.id = ut.task_id 
             WHERE ut.user_id = $1 AND t.is_active = TRUE`,
            [userId]
        );
        return result.rows;
    } catch (error) {
        console.error('Error getting user completed tasks:', error);
        throw error;
    }
}

async function completeTask(userId, taskId) {
    try {
        // Check if task already completed
        const existing = await executeQuery(
            'SELECT 1 FROM user_tasks WHERE user_id = $1 AND task_id = $2',
            [userId, taskId]
        );
        
        if (existing.rows.length > 0) {
            return false; // Already completed
        }
        
        // Get task reward
        const taskResult = await executeQuery('SELECT reward FROM tasks WHERE id = $1 AND is_active = TRUE', [taskId]);
        if (taskResult.rows.length === 0) {
            throw new Error('Task not found or inactive');
        }
        
        const reward = taskResult.rows[0].reward;
        
        // Begin transaction
        await executeQuery('BEGIN');
        
        try {
            // Mark task as completed
            await executeQuery(
                'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2)',
                [userId, taskId]
            );
            
            // Add reward to user balance
            await updateUserBalance(userId, reward);
            
            await executeQuery('COMMIT');
            return true;
        } catch (error) {
            await executeQuery('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Error completing task:', error);
        throw error;
    }
}

// Promocode functions
async function getPromocode(code) {
    try {
        const result = await executeQuery(
            'SELECT * FROM promocodes WHERE code = $1 AND is_active = TRUE',
            [code]
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting promocode:', error);
        throw error;
    }
}

async function usePromocode(userId, promocodeId) {
    try {
        // Check if already used
        const existing = await executeQuery(
            'SELECT 1 FROM promocode_usage WHERE user_id = $1 AND promocode_id = $2',
            [userId, promocodeId]
        );
        
        if (existing.rows.length > 0) {
            return false; // Already used
        }
        
        // Get promocode details
        const promoResult = await executeQuery(
            'SELECT * FROM promocodes WHERE id = $1 AND is_active = TRUE',
            [promocodeId]
        );
        
        if (promoResult.rows.length === 0) {
            throw new Error('Promocode not found or inactive');
        }
        
        const promocode = promoResult.rows[0];
        
        // Check if promocode is still valid
        if (promocode.max_uses && promocode.current_uses >= promocode.max_uses) {
            return false; // Max uses reached
        }
        
        if (promocode.expires_at && new Date() > new Date(promocode.expires_at)) {
            return false; // Expired
        }
        
        // Begin transaction
        await executeQuery('BEGIN');
        
        try {
            // Mark promocode as used
            await executeQuery(
                'INSERT INTO promocode_usage (user_id, promocode_id) VALUES ($1, $2)',
                [userId, promocodeId]
            );
            
            // Increment usage count
            await executeQuery(
                'UPDATE promocodes SET current_uses = current_uses + 1 WHERE id = $1',
                [promocodeId]
            );
            
            // Add reward to user balance
            await updateUserBalance(userId, promocode.reward);
            
            await executeQuery('COMMIT');
            return true;
        } catch (error) {
            await executeQuery('ROLLBACK');
            throw error;
        }
    } catch (error) {
        console.error('Error using promocode:', error);
        throw error;
    }
}

// Statistics functions
async function getUserStats() {
    try {
        const result = await executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                SUM(balance) as total_balance,
                SUM(referrals_count) as total_referrals,
                COUNT(*) FILTER (WHERE registered_at > CURRENT_DATE) as today_users
            FROM users
        `);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting user stats:', error);
        throw error;
    }
}

// Daily reset function
async function resetDailyData() {
    try {
        await executeQuery('UPDATE users SET referrals_today = 0');
        console.log('✅ Daily data reset completed');
    } catch (error) {
        console.error('Error resetting daily data:', error);
        throw error;
    }
}

// Clean up function
async function closeConnection() {
    try {
        await pool.end();
        console.log('✅ Database connection closed');
    } catch (error) {
        console.error('Error closing database connection:', error);
    }
}

// Export functions
module.exports = {
    pool,
    initializeDatabase,
    executeQuery,
    getUser,
    createOrUpdateUser,
    addReferralBonus,
    updateUserBalance,
    updateUserField,
    getTasks,
    getUserCompletedTasks,
    completeTask,
    getPromocode,
    usePromocode,
    getUserStats,
    resetDailyData,
    closeConnection
};
