const { Pool } = require('pg');

// Конфигурация баз данных
const DB1_URL = 'postgresql://neondb_owner:npg_YC1S8JfBNKWg@ep-quiet-cloud-a2e7auqd-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'; // Текущая в использовании
const DB2_URL = 'postgresql://neondb_owner:npg_kA5CYbq6KRQD@ep-late-math-a23qdcph-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'; // Старая БД

const db1 = new Pool({
    connectionString: DB1_URL,
    ssl: { rejectUnauthorized: false }
});

const db2 = new Pool({
    connectionString: DB2_URL,
    ssl: { rejectUnauthorized: false }
});

async function quickAnalysis() {
    try {
        console.log('📊 БЫСТРЫЙ АНАЛИЗ ДВУХ БАЗ ДАННЫХ\n');
        console.log('🔍 DB1 (текущая): ep-quiet-cloud-a2e7auqd');
        console.log('🔍 DB2 (старая): ep-late-math-a23qdcph\n');

        // Тестируем подключения
        try {
            await db1.query('SELECT NOW()');
            console.log('✅ DB1: Подключение успешно');
        } catch (error) {
            console.log('❌ DB1: Ошибка подключения -', error.message);
            return;
        }

        try {
            await db2.query('SELECT NOW()');
            console.log('✅ DB2: Подключение успешно\n');
        } catch (error) {
            console.log('❌ DB2: Ошибка подключения -', error.message);
            return;
        }

        // Основные таблицы для анализа
        const tables = ['users', 'tasks', 'user_tasks', 'withdrawal_requests', 'subgram_tasks', 'promocodes', 'sponsor_channels_stats'];

        console.log('📋 СРАВНЕНИЕ КОЛИЧЕСТВА ЗАПИСЕЙ:\n');
        console.log('┌────────────────────────┬───────────┬─────��─────┬───────────┐');
        console.log('│ Таблица                │ DB1       │ DB2       │ Разница   │');
        console.log('├────────────────────────┼───────────┼───────────┼───────────┤');

        let totalDb1 = 0;
        let totalDb2 = 0;

        for (const table of tables) {
            try {
                const [db1Result, db2Result] = await Promise.all([
                    db1.query(`SELECT COUNT(*) as count FROM ${table}`),
                    db2.query(`SELECT COUNT(*) as count FROM ${table}`)
                ]);

                const db1Count = parseInt(db1Result.rows[0].count);
                const db2Count = parseInt(db2Result.rows[0].count);
                const diff = Math.abs(db1Count - db2Count);

                totalDb1 += db1Count;
                totalDb2 += db2Count;

                // Форматируем для таблицы
                const tableName = table.padEnd(22);
                const db1Str = db1Count.toString().padStart(9);
                const db2Str = db2Count.toString().padStart(9);
                const diffStr = diff.toString().padStart(9);

                console.log(`│ ${tableName} ��� ${db1Str} │ ${db2Str} │ ${diffStr} │`);

            } catch (error) {
                const tableName = table.padEnd(22);
                console.log(`│ ${tableName} │   ОШИБКА  │   ОШИБКА  │   ОШИБКА  │`);
            }
        }

        console.log('├────────────────────────┼───────────┼───────────┼───────────┤');
        const totalDb1Str = totalDb1.toString().padStart(9);
        const totalDb2Str = totalDb2.toString().padStart(9);
        const totalDiffStr = Math.abs(totalDb1 - totalDb2).toString().padStart(9);
        console.log(`│ ИТОГО                  │ ${totalDb1Str} │ ${totalDb2Str} │ ${totalDiffStr} │`);
        console.log('└────────────────────────┴───────────┴───────────┴───────────┘\n');

        // Детальный анализ пользователей
        console.log('👥 ДЕТАЛЬНЫЙ АНАЛИЗ ПОЛЬЗОВАТЕЛЕЙ:\n');

        try {
            // Пользователи с балансом
            const [db1Balance, db2Balance] = await Promise.all([
                db1.query(`SELECT COUNT(*) as count, SUM(balance) as total_balance FROM users WHERE balance > 0`),
                db2.query(`SELECT COUNT(*) as count, SUM(balance) as total_balance FROM users WHERE balance > 0`)
            ]);

            console.log('💰 Пользователи с балансом:');
            console.log(`   DB1: ${db1Balance.rows[0].count} пользователей, ${Math.round(db1Balance.rows[0].total_balance || 0)} звёзд`);
            console.log(`   DB2: ${db2Balance.rows[0].count} пользователей, ${Math.round(db2Balance.rows[0].total_balance || 0)} звёзд\n`);

            // Последние пользователи
            const [db1Recent, db2Recent] = await Promise.all([
                db1.query(`SELECT user_id, first_name, created_at FROM users ORDER BY created_at DESC LIMIT 3`),
                db2.query(`SELECT user_id, first_name, created_at FROM users ORDER BY created_at DESC LIMIT 3`)
            ]);

            console.log('📅 Последние пользователи DB1:');
            db1Recent.rows.forEach(user => {
                const date = new Date(user.created_at).toLocaleDateString('ru-RU');
                console.log(`   ${user.first_name} (${user.user_id}) - ${date}`);
            });

            console.log('\n📅 Последние пользователи DB2:');
            db2Recent.rows.forEach(user => {
                const date = new Date(user.created_at).toLocaleDateString('ru-RU');
                console.log(`   ${user.first_name} (${user.user_id}) - ${date}`);
            });

        } catch (error) {
            console.log('❌ Ошибка детального анализа:', error.message);
        }

        // Анализ заявок на вывод
        console.log('\n💸 АНАЛИЗ ЗАЯВОК НА ВЫВОД:\n');

        try {
            const [db1Withdrawals, db2Withdrawals] = await Promise.all([
                db1.query(`
                    SELECT 
                        status,
                        COUNT(*) as count,
                        SUM(amount) as total_amount
                    FROM withdrawal_requests 
                    GROUP BY status
                    ORDER BY status
                `),
                db2.query(`
                    SELECT 
                        status,
                        COUNT(*) as count,
                        SUM(amount) as total_amount
                    FROM withdrawal_requests 
                    GROUP BY status
                    ORDER BY status
                `)
            ]);

            console.log('DB1 заявки на вывод:');
            db1Withdrawals.rows.forEach(row => {
                console.log(`   ${row.status}: ${row.count} заявок, ${Math.round(row.total_amount || 0)} звёзд`);
            });

            console.log('\nDB2 заявки на вывод:');
            db2Withdrawals.rows.forEach(row => {
                console.log(`   ${row.status}: ${row.count} заявок, ${Math.round(row.total_amount || 0)} звёзд`);
            });

        } catch (error) {
            console.log('❌ Ошибка анализа заявок на вывод:', error.message);
        }

        console.log('\n🎯 РЕКОМЕНДАЦИИ:');
        
        if (totalDb1 > totalDb2) {
            console.log('• DB1 содержит больше данных - она основная');
            console.log('• Нужно перенести уникальные данные из DB2 в DB1');
        } else if (totalDb2 > totalDb1) {
            console.log('• DB2 содержит больше данных - возможно там более свежие данные');
            console.log('• Нужно аккуратно объединить данные');
        } else {
            console.log('• Базы содержат примерно одинаковое количество данных');
            console.log('• Нужен детальный анализ уникальных записей');
        }

        console.log('\n📋 ДЛЯ ОБЪЕДИНЕНИЯ ЗАПУСТИТЕ:');
        console.log('node merge-databases.js');

    } catch (error) {
        console.error('❌ Критическая ошибка анализа:', error);
    } finally {
        await db1.end();
        await db2.end();
    }
}

quickAnalysis();
