console.log('🔧 [FIX-REFERRALS] Запуск скрипта исправления дублированных рефералов...');

const db = require('./database');

async function fixReferralDuplicates() {
    try {
        console.log('📊 [FIX-REFERRALS] Инициализация базы данных...');
        await db.initializeDatabase();

        console.log('🔍 [FIX-REFERRALS] Анализ всех пользователей с рефералами...');

        // Получаем всех пользователей с рефералами
        const referrers = await db.executeQuery(`
            SELECT 
                id as referrer_id,
                first_name,
                username,
                referrals_count,
                balance
            FROM users 
            WHERE referrals_count > 0
            ORDER BY referrals_count DESC
        `);

        console.log(`📈 [FIX-REFERRALS] Найдено ${referrers.rows.length} пользователей с рефералами`);

        let totalCorrections = 0;
        let totalStarsDeducted = 0;
        let totalUsersAffected = 0;

        for (const referrer of referrers.rows) {
            console.log(`👤 [FIX-REFERRALS] Проверка пользователя: ${referrer.first_name} (ID: ${referrer.referrer_id})`);

            // Получаем всех рефералов этого пользователя
            const invitedUsers = await db.executeQuery(`
                SELECT 
                    id,
                    first_name,
                    username,
                    captcha_passed,
                    is_subscribed,
                    referral_processed,
                    registered_at
                FROM users 
                WHERE invited_by = $1
            `, [referrer.referrer_id]);

            let activeReferrals = 0;
            let unprocessedActiveReferrals = 0;

            for (const invitedUser of invitedUsers.rows) {
                const isActive = invitedUser.captcha_passed && invitedUser.is_subscribed;
                
                if (isActive) {
                    activeReferrals++;
                    if (!invitedUser.referral_processed) {
                        unprocessedActiveReferrals++;
                    }
                }
            }

            const recordedReferrals = referrer.referrals_count;
            const shouldHaveReferrals = activeReferrals;
            const overcount = recordedReferrals - shouldHaveReferrals;

            console.log(`   📋 Записано рефералов: ${recordedReferrals}`);
            console.log(`   ✅ Активных рефералов: ${activeReferrals}`);
            console.log(`   🔄 Необработанных активных: ${unprocessedActiveReferrals}`);
            console.log(`   ⚠️ Переплата: ${overcount}`);

            if (overcount > 0) {
                // Исправляем переплату
                const starsToDeduct = overcount * 3;
                const newBalance = Math.max(0, referrer.balance - starsToDeduct);
                const actualDeducted = referrer.balance - newBalance;

                console.log(`   💸 Списание: ${actualDeducted} звёзд`);

                await db.executeQuery(`
                    UPDATE users 
                    SET 
                        balance = $1,
                        referrals_count = $2
                    WHERE id = $3
                `, [newBalance, shouldHaveReferrals, referrer.referrer_id]);

                totalCorrections++;
                totalStarsDeducted += actualDeducted;
                totalUsersAffected++;

                console.log(`   ✅ Исправлено: баланс ${referrer.balance} → ${newBalance}, рефералы ${recordedReferrals} → ${shouldHaveReferrals}`);
            }

            // Отмечаем активных рефералов как обработанных
            if (unprocessedActiveReferrals > 0) {
                console.log(`   🔄 Отмечаем ${unprocessedActiveReferrals} активных рефералов как обработанных...`);
                
                await db.executeQuery(`
                    UPDATE users 
                    SET referral_processed = TRUE 
                    WHERE invited_by = $1 
                    AND captcha_passed = TRUE 
                    AND is_subscribed = TRUE 
                    AND referral_processed = FALSE
                `, [referrer.referrer_id]);
            }
        }

        // Ищем пользователей с неправильно выставленным флагом referral_processed
        console.log('🔍 [FIX-REFERRALS] Проверка флагов referral_processed...');
        
        const wrongFlags = await db.executeQuery(`
            SELECT 
                id, 
                first_name, 
                invited_by, 
                captcha_passed, 
                is_subscribed, 
                referral_processed 
            FROM users 
            WHERE invited_by IS NOT NULL 
            AND (
                (referral_processed = TRUE AND (captcha_passed = FALSE OR is_subscribed = FALSE))
                OR
                (referral_processed = FALSE AND captcha_passed = TRUE AND is_subscribed = TRUE)
            )
        `);

        if (wrongFlags.rows.length > 0) {
            console.log(`⚠️ [FIX-REFERRALS] Найдено ${wrongFlags.rows.length} пользователей с неправильными флагами`);
            
            for (const user of wrongFlags.rows) {
                const shouldBeProcessed = user.captcha_passed && user.is_subscribed;
                
                if (user.referral_processed !== shouldBeProcessed) {
                    await db.executeQuery(`
                        UPDATE users 
                        SET referral_processed = $1 
                        WHERE id = $2
                    `, [shouldBeProcessed, user.id]);
                    
                    console.log(`   ✅ Исправлен флаг для ${user.first_name} (ID: ${user.id}): ${user.referral_processed} → ${shouldBeProcessed}`);
                }
            }
        }

        // Финальная статистика
        console.log('\n🎯 [FIX-REFERRALS] ИТОГОВАЯ СТАТИСТИКА:');
        console.log('═'.repeat(50));
        console.log(`👥 Пользователей проверено: ${referrers.rows.length}`);
        console.log(`⚠️ Пользователей с переплатой: ${totalUsersAffected}`);
        console.log(`💸 Всего звёзд списано: ${totalStarsDeducted}`);
        console.log(`✅ Исправлений флагов: ${wrongFlags.rows.length}`);
        console.log('═'.repeat(50));

        if (totalUsersAffected === 0) {
            console.log('🎉 [FIX-REFERRALS] Дублированных рефералов не найдено! Система работает корректно.');
        } else {
            console.log('✅ [FIX-REFERRALS] Все дублированные рефералы исправлены!');
        }

        // Проверим итоговое состояние
        console.log('\n📊 [FIX-REFERRALS] Финальная проверка системы...');
        
        const finalCheck = await db.executeQuery(`
            SELECT COUNT(*) as count 
            FROM users u1
            JOIN users u2 ON u1.id = u2.invited_by
            WHERE u2.captcha_passed = TRUE 
            AND u2.is_subscribed = TRUE 
            AND u2.referral_processed = FALSE
        `);

        const unprocessedActive = parseInt(finalCheck.rows[0].count);
        
        if (unprocessedActive > 0) {
            console.log(`⚠️ [FIX-REFERRALS] Внимание: найдено ${unprocessedActive} активных необработанных рефералов`);
            console.log('🔄 [FIX-REFERRALS] Эти рефералы будут обработаны при следующей активности пользователей');
        } else {
            console.log('✅ [FIX-REFERRALS] Все активные рефералы корректно обработаны!');
        }

    } catch (error) {
        console.error('❌ [FIX-REFERRALS] Ошибка при исправлении рефералов:', error);
        process.exit(1);
    }
}

// Запуск скрипта
if (require.main === module) {
    fixReferralDuplicates()
        .then(() => {
            console.log('🎯 [FIX-REFERRALS] Скрипт завершён успешно');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ [FIX-REFERRALS] Критическая ошибка:', error);
            process.exit(1);
        });
}

module.exports = { fixReferralDuplicates };
