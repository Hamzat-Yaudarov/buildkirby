const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function debugDatabase() {
    try {
        console.log('🔍 Отладка базы данных...');
        
        // Проверяем подключение
        const time = await pool.query('SELECT NOW()');
        console.log('✅ Подключение работает:', time.rows[0].now);
        
        // Проверяем существующие таблицы
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        console.log('📋 Существующие таблицы:', tables.rows.map(r => r.table_name));
        
        // Проверяем структуру таблицы users (если она есть)
        try {
            const columns = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = 'users' AND table_schema = 'public'
                ORDER BY ordinal_position
            `);
            console.log('📊 Столбцы таблицы users:', columns.rows);
        } catch (e) {
            console.log('❌ Таблица users не найдена или недоступна');
        }
        
        // Проверяем все схемы
        const schemas = await pool.query(`
            SELECT schema_name 
            FROM information_schema.schemata
        `);
        console.log('🗂️ Доступные схемы:', schemas.rows.map(r => r.schema_name));
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Ошибка отладки:', error);
        process.exit(1);
    }
}

debugDatabase();
