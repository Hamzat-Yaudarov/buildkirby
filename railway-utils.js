const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Утилиты для Railway

async function analyzeUserLoss() {
    try {
        console.log('🔍 АНАЛИЗ ПОТЕРИ ПОЛЬЗОВАТЕЛЕЙ НА RAILWAY\n');
        
        const total = await pool.query('SELECT COUNT(*) as count FROM users');
        console.log(`👥 Всего пользователей в БД: ${total.rows[0].count}`);

        const recent = await pool.query(`
            SELECT COUNT(*) as count FROM users 
            WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
        `);
        console.log(`📅 Новых за 7 дней: ${recent.rows[0].count}`);

        const captcha = await pool.query(`
            SELECT captcha_passed, COUNT(*) as count 
            FROM users 
            GROUP BY captcha_passed
        `);
        console.log('\n🤖 КАПЧА:');
        captcha.rows.forEach(row => {
            const status = row.captcha_passed ? 'Прошли' : 'НЕ прошли';
            console.log(`   ${status}: ${row.count}`);
        });

        const languages = await pool.query(`
            SELECT language_code, COUNT(*) as count 
            FROM users 
            GROUP BY language_code 
            ORDER BY count DESC LIMIT 10
        `);
        console.log('\n🌐 ТОП ЯЗЫКИ:');
        languages.rows.forEach(row => {
            const blocked = ['fa', 'ar'].includes(row.language_code) ? '🚫' : '✅';
            console.log(`   ${blocked} ${row.language_code}: ${row.count}`);
        });

        const dates = await pool.query(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users 
            WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC LIMIT 5
        `);
        console.log('\n📊 ПОСЛЕДНИЕ 5 ДНЕЙ:');
        dates.rows.forEach(row => {
            console.log(`   ${row.date}: ${row.count} пользователей`);
        });

    } catch (error) {
        console.error('❌ Ошибка анализа:', error);
    } finally {
        await pool.end();
    }
}

async function mergeDatabases() {
    console.log('🔄 ЗАПУСК ОБЪЕДИНЕНИЯ БАЗ НА RAILWAY...\n');
    
    const DB1_URL = config.DATABASE_URL; // Текущая
    const DB2_URL = 'postgresql://neondb_owner:npg_kA5CYbq6KRQD@ep-late-math-a23qdcph-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
    
    const db1 = new Pool({ connectionString: DB1_URL, ssl: { rejectUnauthorized: false } });
    const db2 = new Pool({ connectionString: DB2_URL, ssl: { rejectUnauthorized: false } });
    
    try {
        // Тест подключений
        await db1.query('SELECT NOW()');
        await db2.query('SELECT NOW()');
        console.log('✅ Обе базы доступны');
        
        // Анализ
        const db1Users = await db1.query('SELECT COUNT(*) as count FROM users');
        const db2Users = await db2.query('SELECT COUNT(*) as count FROM users');
        
        console.log(`DB1 (текущая): ${db1Users.rows[0].count} пользователей`);
        console.log(`DB2 (старая): ${db2Users.rows[0].count} пользователей`);
        
        if (parseInt(db2Users.rows[0].count) > parseInt(db1Users.rows[0].count)) {
            console.log('\n🔄 Переносим пользователей из DB2...');
            
            // Получаем пользователей из старой БД
            const oldUsers = await db2.query('SELECT * FROM users ORDER BY created_at ASC');
            
            let added = 0;
            let skipped = 0;
            
            for (const user of oldUsers.rows) {
                try {
                    await db1.query(`
                        INSERT INTO users (
                            user_id, username, first_name, language_code, is_premium,
                            balance, total_earned, referral_earned, total_referrals,
                            referrer_id, referral_completed, captcha_passed, created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                        ON CONFLICT (user_id) DO UPDATE SET
                            balance = GREATEST(users.balance, EXCLUDED.balance),
                            total_earned = GREATEST(users.total_earned, EXCLUDED.total_earned)
                    `, [
                        user.user_id, user.username, user.first_name, user.language_code, user.is_premium,
                        user.balance, user.total_earned, user.referral_earned, user.total_referrals,
                        user.referrer_id, user.referral_completed, user.captcha_passed, user.created_at
                    ]);
                    added++;
                } catch (error) {
                    skipped++;
                }
                
                if ((added + skipped) % 100 === 0) {
                    console.log(`   Обработано: ${added + skipped}, добавлено: ${added}`);
                }
            }
            
            console.log(`\n✅ Объединение завершено: добавлено ${added}, пропущено ${skipped}`);
        }
        
    } catch (error) {
        console.error('❌ Ошибка объединения:', error);
    } finally {
        await db1.end();
        await db2.end();
    }
}

// Исправляем нумерацию заявок
async function fixWithdrawalNumbering() {
    try {
        console.log('🔢 ИСПРАВЛЕНИЕ НУМЕРАЦИИ ЗАЯВОК...');
        
        const result = await pool.query(`
            SELECT setval('withdrawal_requests_id_seq', 520, true);
        `);
        
        console.log('✅ Нумерация установлена с 521');
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        await pool.end();
    }
}

// Запуск по команде
const command = process.argv[2];

switch (command) {
    case 'analyze':
        analyzeUserLoss();
        break;
    case 'merge':
        mergeDatabases();
        break;
    case 'fix-numbering':
        fixWithdrawalNumbering();
        break;
    default:
        console.log('🚀 RAILWAY УТИЛИТЫ ДЛЯ БОТА\n');
        console.log('Команды:');
        console.log('node railway-utils.js analyze      - анализ потери пользователей');
        console.log('node railway-utils.js merge        - объединение баз данных');
        console.log('node railway-utils.js fix-numbering - установить нумерацию с 521');
        break;
}
