const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function resetDatabase() {
    try {
        console.log('🗑️ Очистка базы данных...');
        
        // Удаляем все таблицы
        await pool.query('DROP TABLE IF EXISTS withdrawal_requests CASCADE');
        await pool.query('DROP TABLE IF EXISTS lottery_tickets CASCADE');
        await pool.query('DROP TABLE IF EXISTS lotteries CASCADE');
        await pool.query('DROP TABLE IF EXISTS promocode_uses CASCADE');
        await pool.query('DROP TABLE IF EXISTS promocodes CASCADE');
        await pool.query('DROP TABLE IF EXISTS user_tasks CASCADE');
        await pool.query('DROP TABLE IF EXISTS tasks CASCADE');
        await pool.query('DROP TABLE IF EXISTS bot_stats CASCADE');
        await pool.query('DROP TABLE IF EXISTS users CASCADE');
        
        console.log('✅ База данных очищена');
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Ошибка очистки базы данных:', error);
        process.exit(1);
    }
}

resetDatabase();
