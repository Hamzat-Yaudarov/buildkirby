const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function diagnoseUsers() {
    try {
        console.log('🔍 ДИАГНОСТИКА ПРОБЛЕМЫ С 13 ТЫСЯЧАМИ ПОЛЬЗОВАТЕЛЕЙ\n');

        // Проверяем текущее количество пользователей в БД
        const totalUsers = await pool.query('SELECT COUNT(*) as count FROM users');
        console.log(`👥 Текущее количество пользователей в БД: ${totalUsers.rows[0].count}\n`);

        // Анализируем последних пользователей
        const recentUsers = await pool.query(`
            SELECT user_id, first_name, language_code, captcha_passed, referral_completed, created_at
            FROM users 
            ORDER BY created_at DESC 
            LIMIT 10
        `);

        console.log('📅 ПОСЛЕДНИЕ 10 ПОЛЬЗОВАТЕЛЕЙ:');
        recentUsers.rows.forEach((user, index) => {
            const date = new Date(user.created_at).toLocaleDateString('ru-RU');
            const time = new Date(user.created_at).toLocaleTimeString('ru-RU');
            console.log(`${index + 1}. ${user.first_name} (${user.user_id})`);
            console.log(`   📅 Дата: ${date} ${time}`);
            console.log(`   🌐 Язык: ${user.language_code}`);
            console.log(`   🤖 Капча: ${user.captcha_passed ? '✅' : '❌'}`);
            console.log(`   👥 Реферал: ${user.referral_completed ? '✅' : '❌'}\n`);
        });

        // Анализ по языкам
        const languageStats = await pool.query(`
            SELECT language_code, COUNT(*) as count
            FROM users 
            GROUP BY language_code 
            ORDER BY count DESC
        `);

        console.log('🌐 РАСПРЕДЕЛЕНИЕ ПО ЯЗЫКАМ:');
        languageStats.rows.forEach(stat => {
            const blocked = config.BLOCKED_LANGUAGE_CODES.includes(stat.language_code);
            const status = blocked ? '🚫 ЗАБЛОКИРОВАН' : '✅ РАЗРЕШЕН';
            console.log(`   ${stat.language_code}: ${stat.count} пользователей (${status})`);
        });

        // Подсчитываем заблокированных пользователей
        const blockedStats = await pool.query(`
            SELECT COUNT(*) as count
            FROM users 
            WHERE language_code = ANY($1)
        `, [config.BLOCKED_LANGUAGE_CODES]);

        console.log(`\n🚫 Заблокированных пользователей: ${blockedStats.rows[0].count}`);

        // Анализ капчи
        const captchaStats = await pool.query(`
            SELECT 
                captcha_passed,
                COUNT(*) as count
            FROM users 
            GROUP BY captcha_passed
        `);

        console.log('\n🤖 СТАТИСТИКА КАПЧИ:');
        captchaStats.rows.forEach(stat => {
            const status = stat.captcha_passed ? 'Прошли капчу' : 'НЕ прошли капчу';
            console.log(`   ${status}: ${stat.count} пользователей`);
        });

        // Анализ активации рефералов
        const referralStats = await pool.query(`
            SELECT 
                referral_completed,
                COUNT(*) as count
            FROM users 
            GROUP BY referral_completed
        `);

        console.log('\n👥 СТАТИСТИКА АКТИВАЦИИ РЕФЕРАЛОВ:');
        referralStats.rows.forEach(stat => {
            const status = stat.referral_completed ? 'Активированы' : 'НЕ активированы';
            console.log(`   ${status}: ${stat.count} пользователей`);
        });

        // Проверяем даты регистрации
        const dateStats = await pool.query(`
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as count
            FROM users 
            WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `);

        console.log('\n📊 РЕГИСТРАЦИИ ЗА ПОСЛЕДНИЕ 7 ДНЕЙ:');
        if (dateStats.rows.length === 0) {
            console.log('   ❌ Нет новых регистраций за последние 7 дней');
        } else {
            dateStats.rows.forEach(stat => {
                console.log(`   ${stat.date}: ${stat.count} пользователей`);
            });
        }

        console.log('\n🔍 ВОЗМОЖНЫЕ ПРИЧИНЫ ПОТЕРИ 13,000 ПОЛЬЗОВАТЕЛЕЙ:\n');

        console.log('1. 🤖 КАПЧА - пользователи должны пройти капчу ПЕРЕД сохранением в БД');
        console.log('   ❌ Не прошли капчу = НЕ сохранились в БД');

        console.log('\n2. 📢 СПОНСОРСКИЕ КАНАЛЫ - пользователи должны подписаться');
        console.log('   ❌ Не подписались = НЕ получили доступ к боту');

        console.log('\n3. 🚫 БЛОКИРОВКА ПО ЯЗЫКАМ - ar и fa заблокированы');
        console.log(`   🚫 Заблокированные языки: ${config.BLOCKED_LANGUAGE_CODES.join(', ')}`);

        console.log('\n4. 🔄 ЗАЩИТА ОТ СПАМА - повторные /start игнорируются');
        console.log('   ⏱️ Задержка между проверками: 3 секунды');

        console.log('\n5. 💔 ОШИБКИ БД - возможные сбои при создании пользователей');

        console.log('\n💡 РЕКОМЕНДАЦИИ ДЛЯ УВЕЛИЧЕНИЯ КОНВЕРСИИ:');
        console.log('• Упростить или убрать капчу');
        console.log('• Сохранять пользователей ДО проверки подписки');
        console.log('• Добавить аналитику отказов на каждом этапе');
        console.log('• Отправлять уведомления о незавершенной регистрации');

    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
    } finally {
        await pool.end();
    }
}

diagnoseUsers();
