-- PostgreSQL Schema for Telegram Bot
-- Optimized with indexes, constraints, and proper data types

-- Users table with improved constraints and indexes
CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    username VARCHAR(32),
    first_name VARCHAR(64),
    balance DECIMAL(10,2) DEFAULT 0.00 CHECK (balance >= 0),
    referrals_count INTEGER DEFAULT 0 CHECK (referrals_count >= 0),
    referrals_today INTEGER DEFAULT 0 CHECK (referrals_today >= 0),
    invited_by BIGINT REFERENCES users(id),
    last_click TIMESTAMP,
    last_case_open TIMESTAMP,
    registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_subscribed BOOLEAN DEFAULT FALSE,
    temp_action VARCHAR(50),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_invited_by ON users(invited_by);
CREATE INDEX IF NOT EXISTS idx_users_registered_at ON users(registered_at);
CREATE INDEX IF NOT EXISTS idx_users_balance ON users(balance);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(100) UNIQUE NOT NULL,
    channel_name VARCHAR(100),
    reward DECIMAL(10,2) DEFAULT 1.00 CHECK (reward > 0),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(is_active);

-- User tasks completion with compound primary key
CREATE TABLE IF NOT EXISTS user_tasks (
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tasks_completed_at ON user_tasks(completed_at);

-- Lotteries table
CREATE TABLE IF NOT EXISTS lotteries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    ticket_price DECIMAL(10,2) NOT NULL CHECK (ticket_price > 0),
    max_tickets INTEGER NOT NULL CHECK (max_tickets > 0),
    winners_count INTEGER NOT NULL CHECK (winners_count > 0 AND winners_count <= max_tickets),
    current_tickets INTEGER DEFAULT 0 CHECK (current_tickets >= 0 AND current_tickets <= max_tickets),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lotteries_active ON lotteries(is_active);
CREATE INDEX IF NOT EXISTS idx_lotteries_ends_at ON lotteries(ends_at);

-- Lottery tickets
CREATE TABLE IF NOT EXISTS lottery_tickets (
    id SERIAL PRIMARY KEY,
    lottery_id INTEGER REFERENCES lotteries(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lottery_tickets_lottery_id ON lottery_tickets(lottery_id);
CREATE INDEX IF NOT EXISTS idx_lottery_tickets_user_id ON lottery_tickets(user_id);

-- Withdrawal requests with better status tracking
CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    type VARCHAR(20) NOT NULL CHECK (type IN ('stars', 'crypto', 'bank')),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
    admin_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    processed_by BIGINT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_created_at ON withdrawal_requests(created_at);

-- Promocodes table with better tracking
CREATE TABLE IF NOT EXISTS promocodes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    reward DECIMAL(10,2) NOT NULL CHECK (reward > 0),
    max_uses INTEGER CHECK (max_uses > 0),
    current_uses INTEGER DEFAULT 0 CHECK (current_uses >= 0),
    is_active BOOLEAN DEFAULT TRUE,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by BIGINT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_promocodes_code ON promocodes(code);
CREATE INDEX IF NOT EXISTS idx_promocodes_active ON promocodes(is_active);
CREATE INDEX IF NOT EXISTS idx_promocodes_expires_at ON promocodes(expires_at);

-- Promocode usage tracking
CREATE TABLE IF NOT EXISTS promocode_usage (
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    promocode_id INTEGER REFERENCES promocodes(id) ON DELETE CASCADE,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, promocode_id)
);

CREATE INDEX IF NOT EXISTS idx_promocode_usage_used_at ON promocode_usage(used_at);

-- Required channels for registration
CREATE TABLE IF NOT EXISTS required_channels (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(100) UNIQUE NOT NULL,
    channel_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_required_channels_active ON required_channels(is_active);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add constraint to ensure current_uses doesn't exceed max_uses for promocodes
ALTER TABLE promocodes ADD CONSTRAINT check_promocode_uses 
    CHECK (max_uses IS NULL OR current_uses <= max_uses);

-- Add constraint for lottery tickets not exceeding max_tickets
ALTER TABLE lotteries ADD CONSTRAINT check_lottery_tickets 
    CHECK (current_tickets <= max_tickets);
