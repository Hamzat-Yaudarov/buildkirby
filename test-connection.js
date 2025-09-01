const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function testConnection() {
    try {
        console.log('🔗 Проверяем подключение к старой БД...');
        
        const result = await pool.query('SELECT COUNT(*) FROM users');
        console.log('✅ Подключение работает! Пользователей:', result.rows[0].count);
        
        const latestUser = await pool.query('SELECT created_at FROM users ORDER BY created_at DESC LIMIT 1');
        console.log('📅 Последний пользователь:', latestUser.rows[0]?.created_at);
        
        const tables = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public' ORDER BY table_name
        `);
        console.log('📋 Доступные таблицы:', tables.rows.map(r => r.table_name).join(', '));
        
        await pool.end();
        return true;
    } catch (error) {
        console.log('❌ Ошибка подключения:', error.message);
        await pool.end();
        return false;
    }
}

testConnection();
