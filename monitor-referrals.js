console.log('🔍 [MONITOR-REFERRALS] Запуск мониторинга системы рефералов...');

const db = require('./database');

async function monitorReferrals() {
    try {
        console.log('📊 [MONITOR-REFERRALS] Инициализация базы данных...');
        await db.initializeDatabase();

        console.log('🔍 [MONITOR-REFERRALS] Проверка целостности системы рефералов...');

        // 1. Проверка пользователей с неконсистентными флагами
        const inconsistentFlags = await db.executeQuery(`
            SELECT 
                id,
                first_name,
                invited_by,
                captcha_passed,
                is_subscribed,
                referral_processed,
                referrals_count,
                balance
            FROM users 
            WHERE invited_by IS NOT NULL 
            AND (
                (referral_processed = TRUE AND (captcha_passed = FALSE OR is_subscribed = FALSE))
                OR
                (referral_processed = FALSE AND captcha_passed = TRUE AND is_subscribed = TRUE)
            )
        `);

        if (inconsistentFlags.rows.length > 0) {
            console.log(`⚠️ [MONITOR-REFERRALS] Найдено ${inconsistentFlags.rows.length} пользователей с неконсистентными флагами:`);
            for (const user of inconsistentFlags.rows) {
                console.log(`   👤 ${user.first_name} (ID: ${user.id})`);
                console.log(`      Капча: ${user.captcha_passed}, Подписка: ${user.is_subscribed}, Обработан: ${user.referral_processed}`);
            }
        } else {
            console.log('✅ [MONITOR-REFERRALS] Все флаги консистентны');
        }

        // 2. Проверка рефереров с потенциально неправильными счётчиками
        const potentialIssues = await db.executeQuery(`
            SELECT 
                r.id as referrer_id,
                r.first_name as referrer_name,
                r.referrals_count as recorded_referrals,
                r.balance,
                COUNT(CASE WHEN i.captcha_passed = TRUE AND i.is_subscribed = TRUE THEN 1 END) as active_referrals,
                COUNT(CASE WHEN i.captcha_passed = TRUE AND i.is_subscribed = TRUE AND i.referral_processed = TRUE THEN 1 END) as processed_referrals,
                COUNT(i.id) as total_invited
            FROM users r
            LEFT JOIN users i ON r.id = i.invited_by
            WHERE r.referrals_count > 0
            GROUP BY r.id, r.first_name, r.referrals_count, r.balance
            HAVING r.referrals_count != COUNT(CASE WHEN i.captcha_passed = TRUE AND i.is_subscribed = TRUE THEN 1 END)
            ORDER BY r.referrals_count DESC
        `);

        if (potentialIssues.rows.length > 0) {
            console.log(`⚠️ [MONITOR-REFERRALS] Найдено ${potentialIssues.rows.length} рефереров с потенциальными проблемами:`);
            for (const issue of potentialIssues.rows) {
                const overcount = issue.recorded_referrals - issue.active_referrals;
                console.log(`   ��� ${issue.referrer_name} (ID: ${issue.referrer_id})`);
                console.log(`      Записано: ${issue.recorded_referrals}, Активных: ${issue.active_referrals}, Обработано: ${issue.processed_referrals}`);
                console.log(`      Переплата: ${overcount}, Всего приглашённых: ${issue.total_invited}`);
            }
        } else {
            console.log('✅ [MONITOR-REFERRALS] Все счётчики рефереров корректны');
        }

        // 3. Проверка на саморефералы
        const selfReferrals = await db.executeQuery(`
            SELECT id, first_name, invited_by
            FROM users 
            WHERE id = invited_by
        `);

        if (selfReferrals.rows.length > 0) {
            console.log(`🚨 [MONITOR-REFERRALS] КРИТИЧНО! Найдено ${selfReferrals.rows.length} саморефералов:`);
            for (const selfRef of selfReferrals.rows) {
                console.log(`   👤 ${selfRef.first_name} (ID: ${selfRef.id}) пригласил сам себя!`);
            }
        } else {
            console.log('✅ [MONITOR-REFERRALS] Саморефералов не найдено');
        }

        // 4. Проверка на циклические рефералы
        const cyclicReferrals = await db.executeQuery(`
            WITH RECURSIVE referral_chain AS (
                SELECT id, invited_by, 1 as depth, ARRAY[id] as chain
                FROM users
                WHERE invited_by IS NOT NULL
                
                UNION ALL
                
                SELECT u.id, u.invited_by, rc.depth + 1, rc.chain || u.id
                FROM users u
                JOIN referral_chain rc ON u.invited_by = rc.id
                WHERE rc.depth < 10 AND u.id != ALL(rc.chain)
            )
            SELECT DISTINCT chain
            FROM referral_chain rc1
            WHERE EXISTS (
                SELECT 1 FROM referral_chain rc2 
                WHERE rc1.id = rc2.invited_by AND rc2.id = ANY(rc1.chain)
            )
        `);

        if (cyclicReferrals.rows.length > 0) {
            console.log(`🚨 [MONITOR-REFERRALS] КРИТИЧНО! Найдено ${cyclicReferrals.rows.length} циклических реферальных цепочек:`);
            for (const cycle of cyclicReferrals.rows) {
                console.log(`   🔄 Циклическая цепочка: ${cycle.chain.join(' → ')}`);
            }
        } else {
            console.log('✅ [MONITOR-REFERRALS] Циклических рефералов не найдено');
        }

        // 5. Общая статистика
        const generalStats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN invited_by IS NOT NULL THEN 1 END) as users_with_referrer,
                COUNT(CASE WHEN referrals_count > 0 THEN 1 END) as users_with_referrals,
                COUNT(CASE WHEN captcha_passed = TRUE THEN 1 END) as users_with_captcha,
                COUNT(CASE WHEN is_subscribed = TRUE THEN 1 END) as subscribed_users,
                COUNT(CASE WHEN referral_processed = TRUE THEN 1 END) as processed_referrals,
                SUM(referrals_count) as total_referral_count,
                SUM(balance) as total_balance
            FROM users
        `);

        const stats = generalStats.rows[0];
        console.log('\n📊 [MONITOR-REFERRALS] ОБЩАЯ СТАТИСТИКА:');
        console.log('═'.repeat(50));
        console.log(`👥 Всего пользователей: ${stats.total_users}`);
        console.log(`🔗 Пользователей с рефереров: ${stats.users_with_referrer}`);
        console.log(`💰 Пользователей с рефералами: ${stats.users_with_referrals}`);
        console.log(`🤖 Прошли капчу: ${stats.users_with_captcha}`);
        console.log(`📺 Подписаны: ${stats.subscribed_users}`);
        console.log(`✅ Обработанных рефералов: ${stats.processed_referrals}`);
        console.log(`🔢 Общий счётчик рефералов: ${stats.total_referral_count}`);
        console.log(`⭐ Общий баланс: ${stats.total_balance}`);
        console.log('═'.repeat(50));

        // 6. Проверка актуального состояния системы
        const systemHealth = 
            inconsistentFlags.rows.length === 0 &&
            potentialIssues.rows.length === 0 &&
            selfReferrals.rows.length === 0 &&
            cyclicReferrals.rows.length === 0;

        if (systemHealth) {
            console.log('🎉 [MONITOR-REFERRALS] Система рефералов работает корректно!');
            return { status: 'healthy', issues: [] };
        } else {
            const issues = [];
            if (inconsistentFlags.rows.length > 0) issues.push(`${inconsistentFlags.rows.length} неконсистентных флагов`);
            if (potentialIssues.rows.length > 0) issues.push(`${potentialIssues.rows.length} проблем со счётчиками`);
            if (selfReferrals.rows.length > 0) issues.push(`${selfReferrals.rows.length} саморефералов`);
            if (cyclicReferrals.rows.length > 0) issues.push(`${cyclicReferrals.rows.length} циклических цепочек`);

            console.log(`⚠️ [MONITOR-REFERRALS] Найдены проблемы: ${issues.join(', ')}`);
            console.log('🔧 [MONITOR-REFERRALS] Рекомендуется запустить: npm run fix-referrals');
            
            return { 
                status: 'issues_found', 
                issues: issues,
                inconsistentFlags: inconsistentFlags.rows.length,
                potentialIssues: potentialIssues.rows.length,
                selfReferrals: selfReferrals.rows.length,
                cyclicReferrals: cyclicReferrals.rows.length
            };
        }

    } catch (error) {
        console.error('❌ [MONITOR-REFERRALS] Ошибка при мониторинге:', error);
        return { status: 'error', message: error.message };
    }
}

// Запуск скрипта
if (require.main === module) {
    monitorReferrals()
        .then((result) => {
            console.log(`🎯 [MONITOR-REFERRALS] Мониторинг завершён. Статус: ${result.status}`);
            process.exit(result.status === 'healthy' ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ [MONITOR-REFERRALS] Критическая ошибка:', error);
            process.exit(1);
        });
}

module.exports = { monitorReferrals };
