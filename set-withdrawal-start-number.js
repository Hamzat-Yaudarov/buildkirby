const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function setWithdrawalStartNumber() {
    try {
        console.log('Подключение к базе данных...');
        
        // Проверяем текущее значение последовательности
        const currentSeq = await pool.query(`
            SELECT last_value FROM withdrawal_requests_id_seq;
        `);
        
        console.log('Текущее значен��е последовательности:', currentSeq.rows[0]?.last_value);
        
        // Устанавливаем следующее значение как 435
        await pool.query(`
            SELECT setval('withdrawal_requests_id_seq', 434, true);
        `);
        
        console.log('✅ Последовательность установлена! Следующая заявка будет иметь номер 435');
        
        // Проверяем установленное значение
        const newSeq = await pool.query(`
            SELECT last_value FROM withdrawal_requests_id_seq;
        `);
        
        console.log('Новое значение последовательности:', newSeq.rows[0]?.last_value);
        console.log('Следующий ID заявки будет:', parseInt(newSeq.rows[0]?.last_value) + 1);
        
    } catch (error) {
        console.error('Ошибка установки начального номера:', error);
    } finally {
        await pool.end();
    }
}

// Запускаем скрипт
setWithdrawalStartNumber();
