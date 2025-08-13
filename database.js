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
        
        // Read and execute schema file
        const schemaPath = path.join(__dirname, 'database-schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        await pool.query(schema);
        
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

async function addReferralBonus(referrerId) {
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
