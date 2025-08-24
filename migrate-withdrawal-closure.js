const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function migrateDatabase() {
    try {
        console.log('🔧 Начинаем миграцию базы данных для системы нумерации закрытых заявок...');
        
        // Проверяем существование поля closure_number
        const columnExists = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name = 'withdrawal_requests' 
                AND column_name = 'closure_number'
            );
        `);
        
        if (!columnExists.rows[0].exists) {
            console.log('📝 Добавляем поле closure_number в таблицу withdrawal_requests...');
            await pool.query(`
                ALTER TABLE withdrawal_requests 
                ADD COLUMN closure_number INTEGER;
            `);
            console.log('✅ Поле closure_number добавлено');
        } else {
            console.log('ℹ️ Поле closure_number уже существует');
        }
        
        // Проверяем существование последовательности
        const seqExists = await pool.query(`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.sequences 
                WHERE sequence_name = 'withdrawal_closure_seq'
            );
        `);
        
        if (!seqExists.rows[0].exists) {
            console.log('📝 Создаем последовательность withdrawal_closure_seq...');
            await pool.query(`
                CREATE SEQUENCE withdrawal_closure_seq START 437;
            `);
            console.log('✅ Последовательность withdrawal_closure_seq создана');
        } else {
            console.log('ℹ️ Последовтельность withdrawal_closure_seq уже существует');
        }
        
        console.log('🎉 Миграция завершена успешно!');
        console.log('📢 Теперь можно запустить set-closure-number.js для установки начального номера 438');
        
    } catch (error) {
        console.error('❌ Ошибка миграции:', error);
    } finally {
        await pool.end();
        console.log('🔚 Соединение с базой данных закрыто');
    }
}

// Запускаем миграцию
migrateDatabase();
