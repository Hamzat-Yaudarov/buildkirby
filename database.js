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

        // First, add captcha_passed column if it doesn't exist (migration)
        try {
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS captcha_passed BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ captcha_passed column migration completed');
        } catch (migrationError) {
            // If table doesn't exist yet, this will fail, which is fine
            console.log('ℹ️  captcha_passed migration: table might not exist yet');
        }

        // Add referral_processed column if it doesn't exist (migration)
        try {
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS referral_processed BOOLEAN DEFAULT FALSE
            `);
            console.log('✅ referral_processed column migration completed');
        } catch (migrationError) {
            console.log('ℹ���  referral_processed migration: table might not exist yet');
        }

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
                captcha_passed BOOLEAN DEFAULT FALSE,
                referral_processed BOOLEAN DEFAULT FALSE,
                temp_action VARCHAR(100),
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                clicks_today INTEGER DEFAULT 0,
                weekly_points INTEGER DEFAULT 0
            );

            -- Tasks table
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                channel_id VARCHAR(100) UNIQUE NOT NULL,
                channel_name VARCHAR(100),
                reward DECIMAL(10,2) DEFAULT 1.00,
                max_completions INTEGER DEFAULT NULL,
                current_completions INTEGER DEFAULT 0,
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
                ticket_price DECIMAL(10,2) NOT NULL CHECK (ticket_price >= 0),
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
                type VARCHAR(20) NOT NULL CHECK (type IN ('stars', 'crypto', 'bank', 'premium')),
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

            -- Referral lotteries table
            CREATE TABLE IF NOT EXISTS referral_lotteries (
                id SERIAL PRIMARY KEY,
                lottery_id INTEGER,
                required_referrals INTEGER,
                referral_time_hours INTEGER,
                additional_ticket_price DECIMAL(10,2),
                ends_at TIMESTAMP NOT NULL,
                is_manual_selection BOOLEAN DEFAULT TRUE,
                winners_selected BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Lottery prizes table
            CREATE TABLE IF NOT EXISTS lottery_prizes (
                id SERIAL PRIMARY KEY,
                lottery_id INTEGER,
                place INTEGER NOT NULL,
                prize_amount DECIMAL(10,2) NOT NULL,
                winner_user_id BIGINT DEFAULT NULL,
                awarded_at TIMESTAMP DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Referral lottery tickets table
            CREATE TABLE IF NOT EXISTS referral_lottery_tickets (
                id SERIAL PRIMARY KEY,
                lottery_id INTEGER,
                user_id BIGINT NOT NULL,
                ticket_type VARCHAR(20) NOT NULL,
                referral_user_id BIGINT DEFAULT NULL,
                purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Lottery participants table
            CREATE TABLE IF NOT EXISTS lottery_participants (
                id SERIAL PRIMARY KEY,
                lottery_id INTEGER,
                user_id BIGINT NOT NULL,
                total_tickets INTEGER DEFAULT 0,
                free_tickets INTEGER DEFAULT 0,
                purchased_tickets INTEGER DEFAULT 0,
                referral_tickets INTEGER DEFAULT 0,
                referrals_count INTEGER DEFAULT 0,
                qualified BOOLEAN DEFAULT FALSE,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(lottery_id, user_id)
            );

            -- Weekly rewards settings table
            CREATE TABLE IF NOT EXISTS weekly_rewards_settings (
                id SERIAL PRIMARY KEY,
                auto_rewards_enabled BOOLEAN DEFAULT TRUE,
                last_manual_trigger TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Weekly points history table
            CREATE TABLE IF NOT EXISTS weekly_points_history (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                points_earned INTEGER DEFAULT 0,
                activity_type VARCHAR(50),
                week_start DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_weekly_points_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            -- Channel subscription statistics table
            CREATE TABLE IF NOT EXISTS channel_subscription_stats (
                id SERIAL PRIMARY KEY,
                channel_id VARCHAR(100) NOT NULL,
                successful_checks INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(channel_id)
            );

            -- Subscription check events table
            CREATE TABLE IF NOT EXISTS subscription_check_events (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN DEFAULT TRUE,
                active_channels_count INTEGER DEFAULT 0
            );

            -- Table to track unique users who had successful subscription checks
            CREATE TABLE IF NOT EXISTS unique_subscription_users (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL UNIQUE,
                first_success_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- SubGram API configuration table
            CREATE TABLE IF NOT EXISTS subgram_settings (
                id SERIAL PRIMARY KEY,
                api_key VARCHAR(200),
                api_url VARCHAR(500) DEFAULT 'https://api.subgram.ru/request-op/',
                enabled BOOLEAN DEFAULT TRUE,
                max_sponsors INTEGER DEFAULT 3,
                default_action VARCHAR(20) DEFAULT 'subscribe',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- SubGram user sessions - для отслеживания состо��ния пользователей
            CREATE TABLE IF NOT EXISTS subgram_user_sessions (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                session_data JSONB,
                channels_data JSONB,
                last_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(20) DEFAULT 'active',
                gender VARCHAR(10),
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            );

            -- SubGram channels - для хранения полученных каналов
            CREATE TABLE IF NOT EXISTS subgram_channels (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                channel_link VARCHAR(500) NOT NULL,
                channel_name VARCHAR(200),
                channel_logo VARCHAR(500),
                channel_type VARCHAR(20) DEFAULT 'channel',
                subscription_status VARCHAR(20) DEFAULT 'unsubscribed',
                needs_subscription BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, channel_link)
            );

            -- SubGram API requests log - для отслеживания запр��сов к API
            CREATE TABLE IF NOT EXISTS subgram_api_requests (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                request_type VARCHAR(20) DEFAULT 'request_sponsors',
                request_params JSONB,
                response_data JSONB,
                success BOOLEAN DEFAULT FALSE,
                error_message TEXT,
                api_status VARCHAR(20),
                api_code INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

            await pool.query(`
                ALTER TABLE tasks
                ADD COLUMN IF NOT EXISTS max_completions INTEGER DEFAULT NULL;
            `);

            await pool.query(`
                ALTER TABLE tasks
                ADD COLUMN IF NOT EXISTS current_completions INTEGER DEFAULT 0;
            `);

            await pool.query(`
                ALTER TABLE lotteries
                ADD COLUMN IF NOT EXISTS lottery_type VARCHAR(20) DEFAULT 'standard';
            `);

            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS clicks_today INTEGER DEFAULT 0;
            `);

            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS weekly_points INTEGER DEFAULT 0;
            `);

            // Initialize weekly rewards settings if not exists
            await pool.query(`
                INSERT INTO weekly_rewards_settings (auto_rewards_enabled)
                VALUES (TRUE)
                ON CONFLICT DO NOTHING;
            `);

            // Remove unique index constraint - allow multiple withdrawal requests
            await pool.query(`
                DROP INDEX IF EXISTS idx_unique_pending_withdrawal;
            `);

            // Add indexes for performance
            await pool.query(`
                CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance);
                CREATE INDEX IF NOT EXISTS idx_users_weekly_points ON users(weekly_points);
                CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
                CREATE INDEX IF NOT EXISTS idx_weekly_points_history_user_week ON weekly_points_history(user_id, week_start);
                CREATE INDEX IF NOT EXISTS idx_channel_subscription_stats_channel ON channel_subscription_stats(channel_id);
                CREATE INDEX IF NOT EXISTS idx_subscription_check_events_user ON subscription_check_events(user_id);
                CREATE INDEX IF NOT EXISTS idx_subscription_check_events_checked_at ON subscription_check_events(checked_at);
                CREATE INDEX IF NOT EXISTS idx_unique_subscription_users_user ON unique_subscription_users(user_id);
            `);

            console.log('✅ Database columns updated');
        } catch (error) {
            console.log('ℹ️ Column update attempt (may already exist):', error.message);
        }

        // Initialize SubGram settings
        await initializeSubGramSettings();

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
            
            // If user was invited, setup referral relationship (bonus will be awarded when qualified)
            if (invitedBy) {
                await setupReferralRelationship(result.rows[0].id, invitedBy);
            }
            
            return result.rows[0];
        }
    } catch (error) {
        console.error('Error creating/updating user:', error);
        throw error;
    }
}

// New qualified referral system - this function now sets up the referral relationship
// but doesn't award bonus immediately
async function setupReferralRelationship(newUserId, referrerId, newUserName = 'Новый пользователь') {
    try {
        // Set the invited_by relationship
        await executeQuery(
            'UPDATE users SET invited_by = $1 WHERE id = $2',
            [referrerId, newUserId]
        );

        console.log(`[REFERRAL] Set up referral relationship: User ${newUserId} invited by ${referrerId}`);
        console.log(`[REFERRAL] Bonus will be awarded when user ${newUserId} qualifies (captcha + subscription + 1 referral)`);

        return { success: true };
    } catch (error) {
        console.error('Error setting up referral relationship:', error);
        throw error;
    }
}

// Trigger referral qualification check when user gets their first referral
async function handleNewReferralEarned(userId) {
    try {
        // This user just earned a referral, check if they now qualify
        const qualification = await checkReferralQualification(userId);

        if (qualification.qualified) {
            const result = await checkAndProcessPendingReferrals(userId);
            if (result.processed > 0) {
                console.log(`[REFERRAL] User ${userId} qualified and processed for referrer ${result.referrerId}`);
                return { qualified: true, processed: true, referrerId: result.referrerId };
            }
        } else {
            console.log(`[REFERRAL] User ${userId} not yet qualified: ${qualification.reason}`);
        }

        return { qualified: qualification.qualified, processed: false };
    } catch (error) {
        console.error('Error handling new referral earned:', error);
        return { qualified: false, processed: false };
    }
}

// Check if user can now activate their referral (for retroactive system)
// For old referrals, only captcha + subscription required (no need for own referral)
async function checkRetroactiveReferralActivation(userId) {
    try {
        const user = await getUser(userId);
        if (!user || !user.invited_by) {
            return { canActivate: false, reason: 'No referrer' };
        }

        // Check if already processed
        if (user.referral_processed) {
            return { canActivate: false, reason: 'Already processed' };
        }

        // For retroactive activation: only captcha + subscription required
        const hasCaptcha = user.captcha_passed;
        const hasSubscription = user.is_subscribed;
        const isNowActive = hasCaptcha && hasSubscription;

        if (!isNowActive) {
            const missing = [];
            if (!hasCaptcha) missing.push('прохождение капчи');
            if (!hasSubscription) missing.push('подписка на каналы');

            return {
                canActivate: false,
                reason: `Отсутствует: ${missing.join(', ')}`,
                captchaPassed: hasCaptcha,
                isSubscribed: hasSubscription
            };
        }

        return {
            canActivate: true,
            referrerId: user.invited_by,
            userName: user.first_name
        };

    } catch (error) {
        console.error('Error checking retroactive activation:', error);
        return { canActivate: false, reason: 'Database error' };
    }
}

// Activate retroactive referral and return stars
async function activateRetroactiveReferral(userId) {
    try {
        const activationCheck = await checkRetroactiveReferralActivation(userId);

        if (!activationCheck.canActivate) {
            return {
                success: false,
                reason: activationCheck.reason,
                details: activationCheck
            };
        }

        const referrerId = activationCheck.referrerId;

        // Use transaction to ensure atomicity and prevent race conditions
        await executeQuery('BEGIN');

        try {
            // Double-check that user is still unprocessed (protect against race conditions)
            const recheck = await executeQuery('SELECT referral_processed FROM users WHERE id = $1', [userId]);
            if (recheck.rows.length === 0 || recheck.rows[0].referral_processed) {
                await executeQuery('ROLLBACK');
                return { success: false, reason: 'Already processed or user not found' };
            }

            // Mark as processed first to prevent duplicate processing
            const processedResult = await executeQuery(`
                UPDATE users
                SET referral_processed = TRUE
                WHERE id = $1 AND referral_processed = FALSE
                RETURNING id
            `, [userId]);

            if (processedResult.rows.length === 0) {
                await executeQuery('ROLLBACK');
                return { success: false, reason: 'Already processed by another thread' };
            }

            // Award the referral bonus back
            await executeQuery(`
                UPDATE users
                SET
                    balance = balance + 3,
                    referrals_count = referrals_count + 1
                WHERE id = $1
            `, [referrerId]);

            await executeQuery('COMMIT');

            console.log(`[REFERRAL] Retroactive activation: User ${userId} → Referrer ${referrerId} (+3⭐)`);

            return {
                success: true,
                referrerId: referrerId,
                userName: activationCheck.userName,
                starsAwarded: 3
            };

        } catch (error) {
            await executeQuery('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error activating retroactive referral:', error);
        return { success: false, reason: 'Database error' };
    }
}

// Legacy function - DEPRECATED! Do not use!
// This function is kept only for compatibility and should not be called
async function addReferralBonus(referrerId, newUserName = 'Новый пользователь') {
    console.warn(`[REFERRAL] ⚠️ DEPRECATED: Legacy addReferralBonus called - this should not happen!`);
    console.warn(`[REFERRAL] Stack trace:`, new Error().stack);

    // This function is deprecated and should not be used
    // Return without doing anything to prevent duplicate processing
    return {
        referrerId,
        bonus: 0,
        newUserName,
        deprecated: true,
        message: 'Function deprecated - use qualified referral system instead'
    };
}

async function updateUserBalance(userId, amount) {
    try {
        // Validate input parameters
        if (!userId || amount === undefined || amount === null) {
            throw new Error('Invalid parameters for updateUserBalance');
        }

        const result = await executeQuery(
            'UPDATE users SET balance = balance + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING balance',
            [amount, userId]
        );

        if (result.rows.length === 0) {
            throw new Error(`User ${userId} not found for balance update`);
        }

        const newBalance = result.rows[0].balance;

        // Prevent negative balance (except for legitimate withdrawals)
        if (newBalance < 0 && amount < 0) {
            console.warn(`Warning: User ${userId} balance went negative: ${newBalance}`);
        }

        return newBalance;
    } catch (error) {
        console.error('Error updating user balance:', error);
        throw error;
    }
}

async function updateUserField(userId, field, value) {
    try {
        // Validate field name to prevent SQL injection
        const allowedFields = [
            'username', 'first_name', 'balance', 'referrals_count', 'referrals_today',
            'invited_by', 'pending_referrer', 'last_click', 'last_case_open',
            'is_subscribed', 'temp_action', 'clicks_today', 'weekly_points'
        ];

        if (!allowedFields.includes(field)) {
            throw new Error(`Invalid field name: ${field}`);
        }

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
        const result = await executeQuery(`
            SELECT * FROM tasks
            WHERE is_active = TRUE
            AND (max_completions IS NULL OR current_completions < max_completions)
            ORDER BY id
        `);
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

        // Get task details
        const taskResult = await executeQuery(
            'SELECT reward, max_completions, current_completions FROM tasks WHERE id = $1 AND is_active = TRUE',
            [taskId]
        );
        if (taskResult.rows.length === 0) {
            throw new Error('Task not found or inactive');
        }

        const task = taskResult.rows[0];

        // Check if task has reached completion limit
        if (task.max_completions && task.current_completions >= task.max_completions) {
            throw new Error('Task completion limit reached');
        }

        // Begin transaction
        await executeQuery('BEGIN');

        try {
            // Mark task as completed
            await executeQuery(
                'INSERT INTO user_tasks (user_id, task_id) VALUES ($1, $2)',
                [userId, taskId]
            );

            // Increment current completions counter
            await executeQuery(
                'UPDATE tasks SET current_completions = current_completions + 1 WHERE id = $1',
                [taskId]
            );

            // Add reward to user balance
            await updateUserBalance(userId, task.reward);

            await executeQuery('COMMIT');

            // Add weekly points for task completion (after main transaction)
            try {
                await addWeeklyPoints(userId, 2, 'task_completion');
            } catch (pointsError) {
                console.error('Error adding weekly points for task completion:', pointsError);
            }
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

async function getTaskStats(taskId) {
    try {
        const result = await executeQuery(`
            SELECT
                t.id,
                t.channel_name,
                t.channel_id,
                t.reward,
                t.max_completions,
                t.current_completions,
                t.is_active,
                COUNT(ut.user_id) as total_completions,
                t.max_completions - t.current_completions as remaining_completions
            FROM tasks t
            LEFT JOIN user_tasks ut ON t.id = ut.task_id
            WHERE t.id = $1
            GROUP BY t.id
        `, [taskId]);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting task stats:', error);
        throw error;
    }
}

async function getAllTasksStats() {
    try {
        const result = await executeQuery(`
            SELECT
                t.id,
                t.channel_name,
                t.channel_id,
                t.reward,
                t.max_completions,
                t.current_completions,
                t.is_active,
                COUNT(ut.user_id) as total_completions,
                CASE
                    WHEN t.max_completions IS NULL THEN NULL
                    ELSE t.max_completions - t.current_completions
                END as remaining_completions
            FROM tasks t
            LEFT JOIN user_tasks ut ON t.id = ut.task_id
            GROUP BY t.id
            ORDER BY t.id
        `);
        return result.rows;
    } catch (error) {
        console.error('Error getting all tasks stats:', error);
        throw error;
    }
}

// Daily reset function
async function resetDailyData() {
    try {
        await executeQuery('UPDATE users SET referrals_today = 0, clicks_today = 0');
        console.log('��� Daily data reset completed');
    } catch (error) {
        console.error('Error resetting daily data:', error);
        throw error;
    }
}

// Weekly reset function
async function resetWeeklyData() {
    try {
        await executeQuery('UPDATE users SET weekly_points = 0');
        console.log('✅ Weekly data reset completed');
    } catch (error) {
        console.error('Error resetting weekly data:', error);
        throw error;
    }
}

// Weekly points functions
async function addWeeklyPoints(userId, points, activityType) {
    // Validate input parameters
    if (!userId || !points || !activityType) {
        console.error('Invalid parameters for addWeeklyPoints:', { userId, points, activityType });
        return false;
    }

    try {
        await executeQuery('BEGIN');

        // Check if user exists before updating
        const userCheck = await executeQuery('SELECT id FROM users WHERE id = $1', [userId]);
        if (userCheck.rows.length === 0) {
            await executeQuery('ROLLBACK');
            console.error(`User ${userId} not found for weekly points`);
            return false;
        }

        // Add points to user
        await executeQuery(
            'UPDATE users SET weekly_points = weekly_points + $1 WHERE id = $2',
            [points, userId]
        );

        // Record activity in history
        const weekStart = getWeekStart();
        await executeQuery(
            'INSERT INTO weekly_points_history (user_id, points_earned, activity_type, week_start) VALUES ($1, $2, $3, $4)',
            [userId, points, activityType, weekStart]
        );

        await executeQuery('COMMIT');
        return true;
    } catch (error) {
        try {
            await executeQuery('ROLLBACK');
        } catch (rollbackError) {
            console.error('Error rolling back weekly points transaction:', rollbackError);
        }
        console.error('Error adding weekly points:', error);
        // Don't throw - just log and return false to prevent breaking parent operations
        return false;
    }
}

async function getWeeklyTopUsers(limit = 5) {
    try {
        const result = await executeQuery(`
            SELECT id, first_name, username, weekly_points
            FROM users
            WHERE weekly_points > 0
            ORDER BY weekly_points DESC, registered_at ASC
            LIMIT $1
        `, [limit]);
        return result.rows;
    } catch (error) {
        console.error('Error getting weekly top users:', error);
        throw error;
    }
}

// Weekly rewards settings functions
async function getWeeklyRewardsSettings() {
    try {
        const result = await executeQuery('SELECT * FROM weekly_rewards_settings ORDER BY id DESC LIMIT 1');
        return result.rows[0] || { auto_rewards_enabled: true };
    } catch (error) {
        console.error('Error getting weekly rewards settings:', error);
        throw error;
    }
}

async function updateWeeklyRewardsSettings(autoEnabled) {
    try {
        await executeQuery(`
            UPDATE weekly_rewards_settings
            SET auto_rewards_enabled = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = (SELECT id FROM weekly_rewards_settings ORDER BY id DESC LIMIT 1)
        `, [autoEnabled]);
        return true;
    } catch (error) {
        console.error('Error updating weekly rewards settings:', error);
        throw error;
    }
}

async function recordManualRewardsTrigger() {
    try {
        await executeQuery(`
            UPDATE weekly_rewards_settings
            SET last_manual_trigger = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = (SELECT id FROM weekly_rewards_settings ORDER BY id DESC LIMIT 1)
        `);
        return true;
    } catch (error) {
        console.error('Error recording manual rewards trigger:', error);
        throw error;
    }
}

// Helper function to get week start date
function getWeekStart() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Start from Monday
    const weekStart = new Date(now); // Create copy to avoid mutating original
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
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

// Referral lottery functions
async function createReferralLottery(lotteryData, refLotteryData, prizes) {
    try {
        await executeQuery('BEGIN');

        // Create main lottery entry
        const lotteryResult = await executeQuery(`
            INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count, lottery_type, is_active)
            VALUES ($1, $2, $3, $4, $5, TRUE)
            RETURNING id
        `, [lotteryData.name, lotteryData.ticket_price, lotteryData.max_tickets, lotteryData.winners_count, lotteryData.lottery_type]);

        const lotteryId = lotteryResult.rows[0].id;

        // Create referral lottery details
        await executeQuery(`
            INSERT INTO referral_lotteries
            (lottery_id, required_referrals, referral_time_hours, additional_ticket_price, ends_at)
            VALUES ($1, $2, $3, $4, $5)
        `, [lotteryId, refLotteryData.required_referrals, refLotteryData.referral_time_hours,
            refLotteryData.additional_ticket_price, refLotteryData.ends_at]);

        // Create lottery prizes
        for (let i = 0; i < prizes.length; i++) {
            await executeQuery(`
                INSERT INTO lottery_prizes (lottery_id, place, prize_amount)
                VALUES ($1, $2, $3)
            `, [lotteryId, i + 1, prizes[i]]);
        }

        await executeQuery('COMMIT');
        return lotteryId;
    } catch (error) {
        await executeQuery('ROLLBACK');
        throw error;
    }
}

async function getReferralLotteries() {
    try {
        const result = await executeQuery(`
            SELECT l.*, rl.required_referrals, rl.referral_time_hours,
                   rl.additional_ticket_price, rl.ends_at as ref_ends_at,
                   rl.winners_selected, rl.is_manual_selection
            FROM lotteries l
            JOIN referral_lotteries rl ON l.id = rl.lottery_id
            WHERE l.is_active = TRUE AND l.lottery_type IN ('referral_condition', 'referral_auto')
            ORDER BY rl.ends_at ASC
        `);
        return result.rows;
    } catch (error) {
        console.error('Error getting referral lotteries:', error);
        throw error;
    }
}

async function getLotteryPrizes(lotteryId) {
    try {
        const result = await executeQuery(`
            SELECT * FROM lottery_prizes
            WHERE lottery_id = $1
            ORDER BY place ASC
        `, [lotteryId]);
        return result.rows;
    } catch (error) {
        console.error('Error getting lottery prizes:', error);
        throw error;
    }
}

async function addReferralTicket(lotteryId, userId, ticketType, referralUserId = null) {
    try {
        await executeQuery('BEGIN');

        // Add ticket
        await executeQuery(`
            INSERT INTO referral_lottery_tickets (lottery_id, user_id, ticket_type, referral_user_id)
            VALUES ($1, $2, $3, $4)
        `, [lotteryId, userId, ticketType, referralUserId]);

        // Update participant stats
        const ticketField = ticketType === 'free' ? 'free_tickets' :
                           ticketType === 'purchased' ? 'purchased_tickets' : 'referral_tickets';

        await executeQuery(`
            INSERT INTO lottery_participants (lottery_id, user_id, total_tickets, ${ticketField})
            VALUES ($1, $2, 1, 1)
            ON CONFLICT (lottery_id, user_id)
            DO UPDATE SET
                total_tickets = lottery_participants.total_tickets + 1,
                ${ticketField} = lottery_participants.${ticketField} + 1
        `, [lotteryId, userId]);

        await executeQuery('COMMIT');
        return true;
    } catch (error) {
        await executeQuery('ROLLBACK');
        throw error;
    }
}

async function checkReferralCondition(lotteryId, userId) {
    try {
        // Get lottery details
        const lotteryResult = await executeQuery(`
            SELECT rl.required_referrals, rl.referral_time_hours, rl.created_at
            FROM referral_lotteries rl
            WHERE rl.lottery_id = $1
        `, [lotteryId]);

        if (lotteryResult.rows.length === 0) return false;

        const lottery = lotteryResult.rows[0];
        const timeThreshold = new Date(lottery.created_at);
        timeThreshold.setHours(timeThreshold.getHours() + lottery.referral_time_hours);

        // Count referrals made after lottery creation
        const referralResult = await executeQuery(`
            SELECT COUNT(*) as count
            FROM users
            WHERE invited_by = $1
            AND registered_at >= $2
            AND registered_at <= $3
            AND is_subscribed = TRUE
        `, [userId, lottery.created_at, timeThreshold]);

        const referralCount = parseInt(referralResult.rows[0].count);
        const qualified = referralCount >= lottery.required_referrals;

        // Update participant qualification
        if (qualified) {
            await executeQuery(`
                INSERT INTO lottery_participants (lottery_id, user_id, referrals_count, qualified)
                VALUES ($1, $2, $3, TRUE)
                ON CONFLICT (lottery_id, user_id)
                DO UPDATE SET referrals_count = $3, qualified = TRUE
            `, [lotteryId, userId, referralCount]);
        }

        return { qualified, referralCount, required: lottery.required_referrals };
    } catch (error) {
        console.error('Error checking referral condition:', error);
        throw error;
    }
}

async function selectLotteryWinners(lotteryId, winners) {
    try {
        await executeQuery('BEGIN');

        // Update prizes with winners
        for (const [place, userId] of Object.entries(winners)) {
            const placeNum = parseInt(place);
            await executeQuery(`
                UPDATE lottery_prizes
                SET winner_user_id = $1, awarded_at = CURRENT_TIMESTAMP
                WHERE lottery_id = $2 AND place = $3
            `, [userId, lotteryId, placeNum]);

            // Get prize amount and add to user balance
            const prizeResult = await executeQuery(`
                SELECT prize_amount FROM lottery_prizes
                WHERE lottery_id = $1 AND place = $2
            `, [lotteryId, placeNum]);

            if (prizeResult.rows.length > 0) {
                const prizeAmount = prizeResult.rows[0].prize_amount;
                await updateUserBalance(userId, prizeAmount);
            }
        }

        // Mark lottery as completed
        await executeQuery(`
            UPDATE referral_lotteries
            SET winners_selected = TRUE
            WHERE lottery_id = $1
        `, [lotteryId]);

        await executeQuery(`
            UPDATE lotteries
            SET is_active = FALSE
            WHERE id = $1
        `, [lotteryId]);

        await executeQuery('COMMIT');
        return true;
    } catch (error) {
        await executeQuery('ROLLBACK');
        throw error;
    }
}

async function getLotteryParticipants(lotteryId) {
    try {
        const result = await executeQuery(`
            SELECT lp.*, u.first_name, u.username
            FROM lottery_participants lp
            JOIN users u ON lp.user_id = u.id
            WHERE lp.lottery_id = $1 AND lp.total_tickets > 0
            ORDER BY lp.total_tickets DESC, lp.joined_at ASC
        `, [lotteryId]);
        return result.rows;
    } catch (error) {
        console.error('Error getting lottery participants:', error);
        throw error;
    }
}

// Withdrawal functions
async function getWithdrawalRequest(userId, amount, type) {
    try {
        const result = await executeQuery(
            'SELECT * FROM withdrawal_requests WHERE user_id = $1 AND amount = $2 AND type = $3 AND status = $4',
            [userId, amount, type, 'pending']
        );
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting withdrawal request:', error);
        throw error;
    }
}

async function approveWithdrawalRequest(userId, amount, type, adminId) {
    try {
        await executeQuery('BEGIN');

        // Update withdrawal request status
        const result = await executeQuery(`
            UPDATE withdrawal_requests
            SET status = 'completed',
                processed_at = CURRENT_TIMESTAMP,
                processed_by = $1
            WHERE user_id = $2 AND amount = $3 AND type = $4 AND status = 'pending'
            RETURNING id
        `, [adminId, userId, amount, type]);

        if (result.rows.length === 0) {
            await executeQuery('ROLLBACK');
            return null;
        }

        await executeQuery('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await executeQuery('ROLLBACK');
        console.error('Error approving withdrawal:', error);
        throw error;
    }
}

async function approveWithdrawalRequestById(withdrawalId, adminId) {
    try {
        await executeQuery('BEGIN');

        // Update withdrawal request status by ID
        const result = await executeQuery(`
            UPDATE withdrawal_requests
            SET status = 'completed',
                processed_at = CURRENT_TIMESTAMP,
                processed_by = $1
            WHERE id = $2 AND status = 'pending'
            RETURNING id
        `, [adminId, withdrawalId]);

        if (result.rows.length === 0) {
            await executeQuery('ROLLBACK');
            return null;
        }

        await executeQuery('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await executeQuery('ROLLBACK');
        console.error('Error approving withdrawal by ID:', error);
        throw error;
    }
}

async function rejectWithdrawalRequest(userId, amount, type, adminId, reason) {
    try {
        await executeQuery('BEGIN');

        // Update withdrawal request status
        const result = await executeQuery(`
            UPDATE withdrawal_requests
            SET status = 'rejected',
                processed_at = CURRENT_TIMESTAMP,
                processed_by = $1,
                admin_notes = $5
            WHERE user_id = $2 AND amount = $3 AND type = $4 AND status = 'pending'
            RETURNING id
        `, [adminId, userId, amount, type, reason]);

        if (result.rows.length === 0) {
            await executeQuery('ROLLBACK');
            return null;
        }

        // Return balance to user
        await updateUserBalance(userId, amount);

        await executeQuery('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await executeQuery('ROLLBACK');
        console.error('Error rejecting withdrawal:', error);
        throw error;
    }
}

async function rejectWithdrawalRequestById(withdrawalId, adminId, reason) {
    try {
        await executeQuery('BEGIN');

        // Get withdrawal details first
        const withdrawalResult = await executeQuery(`
            SELECT user_id, amount FROM withdrawal_requests
            WHERE id = $1 AND status = 'pending'
        `, [withdrawalId]);

        if (withdrawalResult.rows.length === 0) {
            await executeQuery('ROLLBACK');
            return null;
        }

        const { user_id: userId, amount } = withdrawalResult.rows[0];

        // Update withdrawal request status
        const result = await executeQuery(`
            UPDATE withdrawal_requests
            SET status = 'rejected',
                processed_at = CURRENT_TIMESTAMP,
                processed_by = $1,
                admin_notes = $2
            WHERE id = $3 AND status = 'pending'
            RETURNING id
        `, [adminId, reason, withdrawalId]);

        if (result.rows.length === 0) {
            await executeQuery('ROLLBACK');
            return null;
        }

        // Return balance to user
        await updateUserBalance(userId, amount);

        await executeQuery('COMMIT');
        return result.rows[0].id;
    } catch (error) {
        await executeQuery('ROLLBACK');
        console.error('Error rejecting withdrawal by ID:', error);
        throw error;
    }
}

async function getCompletedWithdrawalsCount() {
    try {
        const result = await executeQuery(
            "SELECT COUNT(*) as count FROM withdrawal_requests WHERE status = 'completed'"
        );
        return parseInt(result.rows[0].count);
    } catch (error) {
        console.error('Error getting completed withdrawals count:', error);
        throw error;
    }
}

async function getWithdrawalById(withdrawalId) {
    try {
        const result = await executeQuery(`
            SELECT wr.*, u.first_name, u.username
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.id
            WHERE wr.id = $1
        `, [withdrawalId]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting withdrawal by ID:', error);
        throw error;
    }
}

// Channel subscription statistics functions
async function recordSubscriptionCheck(userId, success = true) {
    try {
        await executeQuery('BEGIN');

        // Get count of active channels at this moment
        const activeChannelsResult = await executeQuery(
            'SELECT COUNT(*) as count FROM required_channels WHERE is_active = TRUE'
        );
        const activeChannelsCount = parseInt(activeChannelsResult.rows[0].count);

        // Record the subscription check event
        await executeQuery(`
            INSERT INTO subscription_check_events (user_id, checked_at, success, active_channels_count)
            VALUES ($1, CURRENT_TIMESTAMP, $2, $3)
        `, [userId, success, activeChannelsCount]);

        // If successful, check if this is a new unique user and update statistics
        if (success) {
            // Check if this user already had a successful subscription check
            const existingUser = await executeQuery(
                'SELECT id FROM unique_subscription_users WHERE user_id = $1',
                [userId]
            );

            let isNewUniqueUser = false;

            // If user is not in unique users table, add them
            if (existingUser.rows.length === 0) {
                await executeQuery(`
                    INSERT INTO unique_subscription_users (user_id, first_success_at)
                    VALUES ($1, CURRENT_TIMESTAMP)
                `, [userId]);

                isNewUniqueUser = true;
                console.log(`[SUBSCRIPTION] New unique user ${userId} recorded for subscription stats`);
            } else {
                console.log(`[SUBSCRIPTION] User ${userId} already counted in subscription stats (not incrementing counter)`);
            }

            // Only increment counters for new unique users
            if (isNewUniqueUser) {
                const activeChannels = await executeQuery(
                    'SELECT channel_id FROM required_channels WHERE is_active = TRUE'
                );

                for (const channel of activeChannels.rows) {
                    await executeQuery(`
                        INSERT INTO channel_subscription_stats (channel_id, successful_checks, updated_at)
                        VALUES ($1, 1, CURRENT_TIMESTAMP)
                        ON CONFLICT (channel_id)
                        DO UPDATE SET
                            successful_checks = channel_subscription_stats.successful_checks + 1,
                            updated_at = CURRENT_TIMESTAMP
                    `, [channel.channel_id]);
                }
                console.log(`[SUBSCRIPTION] Incremented stats for ${activeChannels.rows.length} channels for new user ${userId}`);
            }
        }

        await executeQuery('COMMIT');
        return true;
    } catch (error) {
        await executeQuery('ROLLBACK');
        console.error('Error recording subscription check:', error);
        return false;
    }
}

async function getChannelSubscriptionStats() {
    try {
        const result = await executeQuery(`
            SELECT
                css.channel_id,
                rc.channel_name,
                css.successful_checks,
                rc.created_at as channel_added_at,
                css.updated_at as last_check_at,
                rc.is_active
            FROM channel_subscription_stats css
            LEFT JOIN required_channels rc ON css.channel_id = rc.channel_id
            ORDER BY rc.created_at ASC, css.successful_checks DESC
        `);
        return result.rows;
    } catch (error) {
        console.error('Error getting channel subscription stats:', error);
        throw error;
    }
}

async function getSubscriptionCheckHistory(limit = 100) {
    try {
        const result = await executeQuery(`
            SELECT
                sce.id,
                sce.user_id,
                u.first_name,
                u.username,
                sce.checked_at,
                sce.success,
                sce.active_channels_count
            FROM subscription_check_events sce
            LEFT JOIN users u ON sce.user_id = u.id
            ORDER BY sce.checked_at DESC
            LIMIT $1
        `, [limit]);
        return result.rows;
    } catch (error) {
        console.error('Error getting subscription check history:', error);
        throw error;
    }
}

async function getChannelStatsDetailed(channelId) {
    try {
        // Get channel info
        const channelResult = await executeQuery(`
            SELECT * FROM required_channels WHERE channel_id = $1
        `, [channelId]);

        if (channelResult.rows.length === 0) {
            return null;
        }

        const channel = channelResult.rows[0];

        // Get statistics
        const statsResult = await executeQuery(`
            SELECT successful_checks, updated_at FROM channel_subscription_stats
            WHERE channel_id = $1
        `, [channelId]);

        const stats = statsResult.rows[0] || { successful_checks: 0, updated_at: null };

        // Get recent checks count (last 24 hours)
        const recentChecksResult = await executeQuery(`
            SELECT COUNT(*) as recent_checks
            FROM subscription_check_events
            WHERE checked_at > CURRENT_TIMESTAMP - INTERVAL '24 hours'
            AND success = TRUE
            AND active_channels_count > 0
        `);

        const recentChecks = parseInt(recentChecksResult.rows[0].recent_checks);

        return {
            ...channel,
            successful_checks: stats.successful_checks,
            last_check_at: stats.updated_at,
            recent_checks_24h: recentChecks
        };
    } catch (error) {
        console.error('Error getting detailed channel stats:', error);
        throw error;
    }
}

// Get unique subscription users statistics
async function getUniqueSubscriptionUsersCount() {
    try {
        const result = await executeQuery(
            'SELECT COUNT(*) as unique_users FROM unique_subscription_users'
        );
        return parseInt(result.rows[0].unique_users);
    } catch (error) {
        console.error('Error getting unique subscription users count:', error);
        return 0;
    }
}

// Get latest unique subscription users
async function getLatestUniqueSubscriptionUsers(limit = 20) {
    try {
        const result = await executeQuery(`
            SELECT
                usu.user_id,
                usu.first_success_at,
                u.first_name,
                u.username
            FROM unique_subscription_users usu
            LEFT JOIN users u ON usu.user_id = u.id
            ORDER BY usu.first_success_at DESC
            LIMIT $1
        `, [limit]);
        return result.rows;
    } catch (error) {
        console.error('Error getting latest unique subscription users:', error);
        return [];
    }
}

// Referral qualification checking
async function checkReferralQualification(userId) {
    try {
        const user = await getUser(userId);
        if (!user) return { qualified: false, reason: 'User not found' };

        // Check 0: Must have a referrer to be qualified
        if (!user.invited_by) {
            return { qualified: false, reason: 'No referrer' };
        }

        // Check 1: Not already processed
        if (user.referral_processed) {
            return { qualified: false, reason: 'Already processed' };
        }

        // Check 2: Captcha passed
        if (!user.captcha_passed) {
            return { qualified: false, reason: 'Captcha not passed' };
        }

        // Check 3: Subscribed to all channels
        if (!user.is_subscribed) {
            return { qualified: false, reason: 'Not subscribed to channels' };
        }

        // Check 4: Has at least 1 referral - REMOVED
        // Referral now counts immediately after captcha + subscription
        // if (user.referrals_count < 1) {
        //     return { qualified: false, reason: 'No referrals yet' };
        // }

        return { qualified: true, reason: 'Captcha and subscription completed, not yet processed' };
    } catch (error) {
        console.error('Error checking referral qualification:', error);
        return { qualified: false, reason: 'Database error' };
    }
}

// Process pending referral for qualified user
async function processQualifiedReferral(userId) {
    try {
        const user = await getUser(userId);
        if (!user || !user.invited_by) {
            return { success: false, reason: 'No pending referral to process' };
        }

        // Check if referral was already processed
        if (user.referral_processed) {
            return { success: false, reason: 'Referral already processed' };
        }

        const qualification = await checkReferralQualification(userId);
        if (!qualification.qualified) {
            return { success: false, reason: qualification.reason };
        }

        const invitedBy = user.invited_by;
        if (!invitedBy) {
            return { success: false, reason: 'No referrer found' };
        }

        // Use transaction to ensure atomicity and prevent race conditions
        await executeQuery('BEGIN');

        try {
            // Double-check and mark as processed first to prevent duplicate processing
            const processedResult = await executeQuery(`
                UPDATE users
                SET referral_processed = TRUE
                WHERE id = $1 AND referral_processed = FALSE
                RETURNING id
            `, [userId]);

            if (processedResult.rows.length === 0) {
                await executeQuery('ROLLBACK');
                return { success: false, reason: 'Already processed by another thread' };
            }

            // Award referral bonus to the referrer
            await executeQuery(
                'UPDATE users SET referrals_count = referrals_count + 1, referrals_today = referrals_today + 1, balance = balance + 3 WHERE id = $1',
                [invitedBy]
            );

            await executeQuery('COMMIT');

            console.log(`[REFERRAL] Processed qualified referral: User ${userId} → Referrer ${invitedBy} (+3⭐)`);
            return {
                success: true,
                referrerId: invitedBy,
                userName: user.first_name
            };

        } catch (error) {
            await executeQuery('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Error processing qualified referral:', error);
        return { success: false, reason: 'Database error' };
    }
}

// Check and process all qualified referrals for a user who just became qualified
async function checkAndProcessPendingReferrals(newlyQualifiedUserId) {
    try {
        // This user just became qualified, check if they should be processed for their referrer
        const result = await processQualifiedReferral(newlyQualifiedUserId);

        if (result.success) {
            console.log(`[REFERRAL] User ${newlyQualifiedUserId} qualified - bonus awarded to referrer ${result.referrerId}`);
            return {
                processed: 1,
                referrerId: result.referrerId,
                userName: result.userName
            };
        } else {
            console.log(`[REFERRAL] User ${newlyQualifiedUserId} could not be processed: ${result.reason}`);
            return { processed: 0, reason: result.reason };
        }
    } catch (error) {
        console.error('Error checking pending referrals:', error);
        return { processed: 0, reason: 'Database error' };
    }
}

// Captcha management functions
async function setCaptchaPassed(userId, passed = true) {
    try {
        await executeQuery(
            'UPDATE users SET captcha_passed = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [passed, userId]
        );
        console.log(`[DB] Captcha status updated for user ${userId}: ${passed}`);
        return true;
    } catch (error) {
        console.error('Error updating captcha status:', error);
        throw error;
    }
}

async function getCaptchaStatus(userId) {
    try {
        const result = await executeQuery('SELECT captcha_passed FROM users WHERE id = $1', [userId]);
        return result.rows[0]?.captcha_passed || false;
    } catch (error) {
        console.error('Error getting captcha status:', error);
        return false;
    }
}

// Validation function to prevent referral anomalies
async function validateReferralIntegrity(userId) {
    try {
        const user = await getUser(userId);
        if (!user) return { valid: false, issues: ['User not found'] };

        const issues = [];

        // Check 1: If user has referral_processed = true, they must have captcha + subscription
        if (user.referral_processed && (!user.captcha_passed || !user.is_subscribed)) {
            issues.push('User marked as processed but missing captcha or subscription');
        }

        // Check 2: If user has captcha + subscription + referrer, they should be processed
        if (user.invited_by && user.captcha_passed && user.is_subscribed && !user.referral_processed) {
            issues.push('User qualifies but not yet processed (this is expected for new system)');
        }

        // Check 3: User cannot be their own referrer
        if (user.invited_by === userId) {
            issues.push('User cannot be their own referrer');
        }

        return {
            valid: issues.length === 0,
            issues: issues,
            user: {
                id: userId,
                name: user.first_name,
                invited_by: user.invited_by,
                captcha_passed: user.captcha_passed,
                is_subscribed: user.is_subscribed,
                referral_processed: user.referral_processed
            }
        };
    } catch (error) {
        console.error('Error validating referral integrity:', error);
        return { valid: false, issues: ['Database error'] };
    }
}

// Safe referral processing function with multiple validations
async function safeProcessReferral(userId, operation = 'qualification_check') {
    try {
        // Step 1: Validate integrity
        const validation = await validateReferralIntegrity(userId);
        if (!validation.valid) {
            console.warn(`[REFERRAL-SAFE] Validation failed for user ${userId}:`, validation.issues);
            return { success: false, reason: `Validation failed: ${validation.issues.join(', ')}` };
        }

        // Step 2: Check current qualification
        const qualification = await checkReferralQualification(userId);
        if (!qualification.qualified) {
            return { success: false, reason: qualification.reason };
        }

        // Step 3: Use safe processing with transaction
        const result = await processQualifiedReferral(userId);

        if (result.success) {
            console.log(`[REFERRAL-SAFE] Safely processed referral for user ${userId} (operation: ${operation})`);
        }

        return result;
    } catch (error) {
        console.error('Error in safe referral processing:', error);
        return { success: false, reason: 'Database error' };
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
    setupReferralRelationship,
    handleNewReferralEarned,
    updateUserBalance,
    updateUserField,
    getTasks,
    getUserCompletedTasks,
    completeTask,
    getPromocode,
    usePromocode,
    getUserStats,
    getTaskStats,
    getAllTasksStats,
    resetDailyData,
    resetWeeklyData,
    closeConnection,
    // Weekly points functions
    addWeeklyPoints,
    getWeeklyTopUsers,
    getWeeklyRewardsSettings,
    updateWeeklyRewardsSettings,
    recordManualRewardsTrigger,
    // Referral lottery functions
    createReferralLottery,
    getReferralLotteries,
    getLotteryPrizes,
    addReferralTicket,
    checkReferralCondition,
    selectLotteryWinners,
    getLotteryParticipants,
    // Withdrawal functions
    getWithdrawalRequest,
    approveWithdrawalRequest,
    approveWithdrawalRequestById,
    rejectWithdrawalRequest,
    rejectWithdrawalRequestById,
    getCompletedWithdrawalsCount,
    getWithdrawalById,
    // Channel subscription statistics functions
    recordSubscriptionCheck,
    getChannelSubscriptionStats,
    getSubscriptionCheckHistory,
    getChannelStatsDetailed,
    getUniqueSubscriptionUsersCount,
    getLatestUniqueSubscriptionUsers,
    // Captcha functions
    setCaptchaPassed,
    getCaptchaStatus,
    // Referral qualification functions
    checkReferralQualification,
    processQualifiedReferral,
    checkAndProcessPendingReferrals,
    checkRetroactiveReferralActivation,
    activateRetroactiveReferral,
    // Referral safety functions
    validateReferralIntegrity,
    safeProcessReferral,
    // SubGram functions
    initializeSubGramSettings,
    getSubGramSettings,
    updateSubGramSettings,
    saveSubGramUserSession,
    getSubGramUserSession,
    deleteSubGramUserSession,
    saveSubGramChannels,
    getSubGramChannels,
    updateSubGramChannelStatus,
    logSubGramAPIRequest,
    getSubGramAPIRequestHistory,
    cleanupExpiredSubGramSessions
};

// ==================== SubGram API Functions ====================

// Initialize SubGram settings
async function initializeSubGramSettings() {
    try {
        // Check if settings already exist
        const existing = await executeQuery('SELECT COUNT(*) as count FROM subgram_settings');
        if (parseInt(existing.rows[0].count) === 0) {
            // Insert default settings
            await executeQuery(`
                INSERT INTO subgram_settings (api_key, api_url, enabled, max_sponsors, default_action)
                VALUES ($1, $2, $3, $4, $5)
            `, [
                '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d',
                'https://api.subgram.ru/request-op/',
                true,
                3,
                'subscribe'
            ]);
            console.log('✅ SubGram settings initialized');
        }
        return true;
    } catch (error) {
        console.error('Error initializing SubGram settings:', error);
        return false;
    }
}

// Get SubGram settings
async function getSubGramSettings() {
    try {
        const result = await executeQuery('SELECT * FROM subgram_settings ORDER BY id DESC LIMIT 1');
        return result.rows[0] || null;
    } catch (error) {
        console.error('Error getting SubGram settings:', error);
        throw error;
    }
}

// Update SubGram settings
async function updateSubGramSettings(settings) {
    try {
        const { apiKey, apiUrl, enabled, maxSponsors, defaultAction } = settings;

        const result = await executeQuery(`
            UPDATE subgram_settings
            SET api_key = $1, api_url = $2, enabled = $3, max_sponsors = $4, default_action = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = (SELECT id FROM subgram_settings ORDER BY id DESC LIMIT 1)
            RETURNING *
        `, [apiKey, apiUrl, enabled, maxSponsors, defaultAction]);

        return result.rows[0];
    } catch (error) {
        console.error('Error updating SubGram settings:', error);
        throw error;
    }
}

// Save SubGram user session
async function saveSubGramUserSession(userId, sessionData, channelsData, gender = null) {
    try {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // Session expires in 1 hour

        const result = await executeQuery(`
            INSERT INTO subgram_user_sessions (user_id, session_data, channels_data, gender, expires_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id)
            DO UPDATE SET
                session_data = $2,
                channels_data = $3,
                gender = $4,
                expires_at = $5,
                last_check_at = CURRENT_TIMESTAMP,
                status = 'active'
            RETURNING *
        `, [userId, JSON.stringify(sessionData), JSON.stringify(channelsData), gender, expiresAt]);

        return result.rows[0];
    } catch (error) {
        console.error('Error saving SubGram user session:', error);
        throw error;
    }
}

// Get SubGram user session
async function getSubGramUserSession(userId) {
    try {
        const result = await executeQuery(`
            SELECT * FROM subgram_user_sessions
            WHERE user_id = $1 AND expires_at > CURRENT_TIMESTAMP AND status = 'active'
        `, [userId]);

        if (result.rows.length > 0) {
            const session = result.rows[0];
            // Parse JSON data
            if (session.session_data) {
                session.session_data = JSON.parse(session.session_data);
            }
            if (session.channels_data) {
                session.channels_data = JSON.parse(session.channels_data);
            }
            return session;
        }
        return null;
    } catch (error) {
        console.error('Error getting SubGram user session:', error);
        throw error;
    }
}

// Delete SubGram user session
async function deleteSubGramUserSession(userId) {
    try {
        await executeQuery('DELETE FROM subgram_user_sessions WHERE user_id = $1', [userId]);
        return true;
    } catch (error) {
        console.error('Error deleting SubGram user session:', error);
        throw error;
    }
}

// Save SubGram channels for user
async function saveSubGramChannels(userId, channels) {
    try {
        await executeQuery('BEGIN');

        // Clear existing channels for this user
        await executeQuery('DELETE FROM subgram_channels WHERE user_id = $1', [userId]);

        // Insert new channels
        for (const channel of channels) {
            await executeQuery(`
                INSERT INTO subgram_channels
                (user_id, channel_link, channel_name, channel_logo, channel_type, subscription_status, needs_subscription)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                userId,
                channel.link,
                channel.name,
                channel.logo,
                channel.type,
                channel.status,
                channel.needsSubscription
            ]);
        }

        await executeQuery('COMMIT');
        return true;
    } catch (error) {
        await executeQuery('ROLLBACK');
        console.error('Error saving SubGram channels:', error);
        throw error;
    }
}

// Get SubGram channels for user
async function getSubGramChannels(userId) {
    try {
        const result = await executeQuery(`
            SELECT * FROM subgram_channels
            WHERE user_id = $1
            ORDER BY created_at ASC
        `, [userId]);
        return result.rows;
    } catch (error) {
        console.error('Error getting SubGram channels:', error);
        throw error;
    }
}

// Update SubGram channel subscription status
async function updateSubGramChannelStatus(userId, channelLink, status) {
    try {
        const result = await executeQuery(`
            UPDATE subgram_channels
            SET subscription_status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $2 AND channel_link = $3
            RETURNING *
        `, [status, userId, channelLink]);

        return result.rows[0];
    } catch (error) {
        console.error('Error updating SubGram channel status:', error);
        throw error;
    }
}

// Log SubGram API request
async function logSubGramAPIRequest(userId, requestType, requestParams, responseData, success, errorMessage = null) {
    try {
        const apiStatus = responseData?.status || null;
        const apiCode = responseData?.code || null;

        await executeQuery(`
            INSERT INTO subgram_api_requests
            (user_id, request_type, request_params, response_data, success, error_message, api_status, api_code)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
            userId,
            requestType,
            JSON.stringify(requestParams),
            JSON.stringify(responseData),
            success,
            errorMessage,
            apiStatus,
            apiCode
        ]);

        return true;
    } catch (error) {
        console.error('Error logging SubGram API request:', error);
        return false;
    }
}

// Get SubGram API request history
async function getSubGramAPIRequestHistory(userId = null, limit = 50) {
    try {
        let query = `
            SELECT sar.*, u.first_name, u.username
            FROM subgram_api_requests sar
            LEFT JOIN users u ON sar.user_id = u.id
        `;
        let params = [];

        if (userId) {
            query += ' WHERE sar.user_id = $1';
            params.push(userId);
        }

        query += ' ORDER BY sar.created_at DESC LIMIT $' + (params.length + 1);
        params.push(limit);

        const result = await executeQuery(query, params);

        // Parse JSON data safely
        return result.rows.map(row => ({
            ...row,
            request_params: row.request_params ? (typeof row.request_params === 'string' ? JSON.parse(row.request_params) : row.request_params) : null,
            response_data: row.response_data ? (typeof row.response_data === 'string' ? JSON.parse(row.response_data) : row.response_data) : null
        }));
    } catch (error) {
        console.error('Error getting SubGram API request history:', error);
        throw error;
    }
}

// Cleanup expired SubGram sessions
async function cleanupExpiredSubGramSessions() {
    try {
        const result = await executeQuery(`
            DELETE FROM subgram_user_sessions
            WHERE expires_at < CURRENT_TIMESTAMP OR status = 'expired'
        `);

        console.log(`[SUBGRAM] Cleaned up ${result.rowCount} expired sessions`);
        return result.rowCount;
    } catch (error) {
        console.error('Error cleaning up expired SubGram sessions:', error);
        return 0;
    }
}

// SubGram functions are already exported above
