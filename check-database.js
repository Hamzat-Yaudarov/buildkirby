const { Pool } = require('pg');
const config = require('./config');

async function checkDatabase() {
    console.log('🔍 Проверка состояния базы данных...');
    
    const pool = new Pool({
        connectionString: config.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });

    try {
        // Проверяем подключение
        await pool.query('SELECT NOW()');
        console.log('✅ Подключение к базе данных успешно');

        // Проверяем какие таблицы уже существуют
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);

        console.log('\n📋 Существующие таблицы:');
        if (result.rows.length === 0) {
            console.log('- Таблиц не найдено (чистая база данных)');
        } else {
            result.rows.forEach(row => {
                console.log(`- ${row.table_name}`);
            });
        }

        // Проверяем количество пользователей
        try {
            const userCount = await pool.query('SELECT COUNT(*) as count FROM users');
            console.log(`\n👥 Пользователей в базе: ${userCount.rows[0].count}`);
        } catch (e) {
            console.log('\n👥 Таблица users ещё не создана');
        }

        console.log('\n🎯 База данных готова к работе!');

    } catch (error) {
        console.error('❌ Ошибка проверки базы данных:', error);
        console.log('\n💡 Возможные решения:');
        console.log('1. Проверьте переменную DATABASE_URL');
        console.log('2. Убедитесь что база данных доступна');
        console.log('3. Проверьте права доступа');
    } finally {
        await pool.end();
    }
}

checkDatabase();
