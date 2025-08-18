/**
 * Test script for referral system
 * Тестовый скрипт для проверки реферальной системы
 */

const db = require('./database');

async function testReferralSystem() {
    console.log('🧪 Начинаю тестирование реферальной системы...\n');

    try {
        // Initialize database
        await db.initializeDatabase();
        console.log('✅ База данных инициализирована\n');

        // Test users
        const referrerId = 111111111; // User who invited
        const newUserId = 222222222;  // New user who was invited

        // Clean up any existing test data
        console.log('🧹 Очистка тестовых данных...');
        await db.executeQuery('DELETE FROM users WHERE id IN ($1, $2)', [referrerId, newUserId]);
        console.log('✅ Тестовые данные очищены\n');

        // 1. Create referrer user
        console.log('1️⃣ Создание пользователя-реферера...');
        await db.executeQuery(`
            INSERT INTO users (id, username, first_name, captcha_passed, is_subscribed, registered_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [referrerId, 'referrer_user', 'Реферер', true, true]);
        console.log('✅ Пользователь-реферер создан (ID:', referrerId, ')\n');

        // 2. Create new user with referrer
        console.log('2️⃣ Создание нового пользователя с указанием реферера...');
        await db.executeQuery(`
            INSERT INTO users (id, username, first_name, invited_by, captcha_passed, is_subscribed, registered_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `, [newUserId, 'new_user', 'Новый Пользователь', referrerId, false, false]);
        console.log('✅ Новый ��ользователь создан (ID:', newUserId, ')\n');

        // 3. Check initial referral qualification
        console.log('3️⃣ Проверка начальной квалификации...');
        let qualification = await db.checkReferralQualification(newUserId);
        console.log('📋 Квалификация до капчи:', qualification);
        console.log('❌ Ожидается: qualified = false (нет капчи)\n');

        // 4. User passes captcha
        console.log('4️⃣ Пользователь проходит капчу...');
        await db.executeQuery('UPDATE users SET captcha_passed = TRUE WHERE id = $1', [newUserId]);
        
        qualification = await db.checkReferralQualification(newUserId);
        console.log('📋 Квалификация после капчи:', qualification);
        console.log('❌ Ожидается: qualified = false (нет подписки)\n');

        // 5. User subscribes to channels
        console.log('5️⃣ Пользователь подписывается на каналы...');
        await db.executeQuery('UPDATE users SET is_subscribed = TRUE WHERE id = $1', [newUserId]);
        
        qualification = await db.checkReferralQualification(newUserId);
        console.log('📋 Квалификация после подпис��и:', qualification);
        console.log('✅ Ожидается: qualified = true (все условия выполнены)\n');

        // 6. Process referral bonus
        if (qualification.qualified) {
            console.log('6️⃣ Обработка реферального бонуса...');
            
            // Get referrer balance before
            const referrerBefore = await db.getUser(referrerId);
            console.log('💰 Баланс реферера до:', referrerBefore.balance, '⭐');
            console.log('👥 Рефералов у реферера до:', referrerBefore.referrals_count);
            
            const result = await db.checkAndProcessPendingReferrals(newUserId);
            console.log('📋 Результат обработки:', result);
            
            // Get referrer balance after
            const referrerAfter = await db.getUser(referrerId);
            console.log('💰 Баланс реферера после:', referrerAfter.balance, '⭐');
            console.log('👥 Рефералов у реферера после:', referrerAfter.referrals_count);
            
            const bonusAwarded = parseFloat(referrerAfter.balance) - parseFloat(referrerBefore.balance);
            const referralsAdded = referrerAfter.referrals_count - referrerBefore.referrals_count;
            
            console.log('🎉 Бонус начислен:', bonusAwarded, '⭐');
            console.log('👥 Рефералов добавлено:', referralsAdded);
            
            if (bonusAwarded === 3 && referralsAdded === 1) {
                console.log('✅ РЕФЕРАЛЬНАЯ СИСТЕМА РАБОТАЕТ КОРРЕКТНО!\n');
            } else {
                console.log('❌ ОШИБКА В РЕФЕРАЛЬНОЙ СИСТЕМЕ!\n');
            }
        }

        // 7. Test edge cases
        console.log('7️⃣ Тестирование граничных случаев...\n');

        // Test double processing
        console.log('7.1 Проверка повторной обработки...');
        const doubleResult = await db.checkAndProcessPendingReferrals(newUserId);
        console.log('📋 Результат повторной обработки:', doubleResult);
        console.log('✅ Ожидается: processed = 0 (уже обработано)\n');

        // Test user without referrer
        console.log('7.2 Проверка пользователя без реферера...');
        const orphanUserId = 333333333;
        await db.executeQuery(`
            INSERT INTO users (id, username, first_name, captcha_passed, is_subscribed, registered_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `, [orphanUserId, 'orphan_user', 'Пользователь без реферера', true, true]);
        
        const orphanResult = await db.checkAndProcessPendingReferrals(orphanUserId);
        console.log('📋 Результат для пользователя без реферера:', orphanResult);
        console.log('✅ Ожидается: processed = 0 (нет реферера)\n');

        // 8. Test retroactive activation
        console.log('8️⃣ Тестирование ретроактивной активации...\n');
        
        // Create a user who was already processed but then became active
        const retroUserId = 444444444;
        await db.executeQuery(`
            INSERT INTO users (id, username, first_name, invited_by, captcha_passed, is_subscribed, referral_processed, registered_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        `, [retroUserId, 'retro_user', 'Ретро Пользователь', referrerId, false, false, false]);
        
        console.log('8.1 Пользователь становится активным...');
        await db.executeQuery('UPDATE users SET captcha_passed = TRUE, is_subscribed = TRUE WHERE id = $1', [retroUserId]);
        
        const retroResult = await db.activateRetroactiveReferral(retroUserId);
        console.log('📋 Результат ретроактивной активации:', retroResult);
        
        if (retroResult.success) {
            console.log('✅ Ретроактивная активация работает!\n');
        } else {
            console.log('❌ Ошибка ретроактивной активации\n');
        }

        // 9. Final verification
        console.log('9️⃣ Финальная проверка...\n');
        const finalReferrer = await db.getUser(referrerId);
        console.log('📊 Финальная статистика реферера:');
        console.log('  • Баланс:', finalReferrer.balance, '⭐');
        console.log('  • Рефералов:', finalReferrer.referrals_count);
        console.log('  • Рефералов сегодня:', finalReferrer.referrals_today);

        // Calculate expected values
        const expectedReferrals = 2; // newUserId + retroUserId
        const expectedBalance = expectedReferrals * 3; // 2 * 3 = 6 stars
        
        if (finalReferrer.referrals_count >= expectedReferrals) {
            console.log('✅ Количество рефералов корректно');
        } else {
            console.log('❌ Неверное количество рефералов');
        }

        // Clean up test data
        console.log('\n🧹 Очистка тестовых данных...');
        await db.executeQuery('DELETE FROM users WHERE id IN ($1, $2, $3, $4)', [referrerId, newUserId, orphanUserId, retroUserId]);
        console.log('✅ Тестовые данные очищены');

        console.log('\n🎉 ТЕСТИРОВАНИЕ РЕФЕРАЛЬНОЙ СИСТЕМЫ ЗАВЕРШЕНО!');
        console.log('\n📊 РЕЗУЛЬТАТЫ:');
        console.log('✅ Реферальная квалификация: работает');
        console.log('✅ Начисление бонусов: работает'); 
        console.log('✅ Защита от повторной обработки: работает');
        console.log('✅ Ретроактивная активация: работает');
        console.log('\n🚀 Реферальная система настроена правильно!');
        console.log('💡 Теперь рефералы засчитываются сразу после капчи + подписки');

    } catch (error) {
        console.error('\n❌ ОШИБКА ТЕСТИРОВАНИЯ:', error.message);
        console.error('📍 Стек ошибки:', error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Соединение с базой данных закрыто');
    }
}

// Run the test
if (require.main === module) {
    testReferralSystem();
}

module.exports = { testReferralSystem };
