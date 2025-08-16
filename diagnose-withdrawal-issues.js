#!/usr/bin/env node
/**
 * Диагностика проблем с выводом звезд
 * Анализирует различия между пользователями, которые могут и не могут выводить
 */

const db = require('./database');

async function diagnoseWithdrawalIssues() {
    console.log('🔍 Диагностика проблем с выводом звезд...\n');
    
    try {
        await db.initializeDatabase();
        
        // 1. Анализ пользователей с заявками на вывод
        console.log('1️⃣ Анализ успешных заявок на вывод...');
        const successfulUsers = await db.executeQuery(`
            SELECT DISTINCT u.id, u.first_name, u.username, u.balance, u.referrals_count, 
                   u.is_subscribed, u.registered_at
            FROM users u
            JOIN withdrawal_requests wr ON u.id = wr.user_id
            WHERE wr.created_at > NOW() - INTERVAL '7 days'
            ORDER BY wr.created_at DESC
            LIMIT 10
        `);
        
        console.log(`✅ Найдено ${successfulUsers.rows.length} пользователей с недавними заявками:`);
        for (const user of successfulUsers.rows) {
            console.log(`  • ID: ${user.id}, Баланс: ${user.balance}⭐, Рефералы: ${user.referrals_count}, Подписан: ${user.is_subscribed}`);
        }
        
        // 2. Анализ пользователей с достаточным балансом но без заявок
        console.log('\n2️⃣ Анализ пользователей с балансом ≥15⭐ без заявок...');
        const eligibleUsers = await db.executeQuery(`
            SELECT u.id, u.first_name, u.username, u.balance, u.referrals_count, 
                   u.is_subscribed, u.registered_at
            FROM users u
            LEFT JOIN withdrawal_requests wr ON u.id = wr.user_id 
                AND wr.created_at > NOW() - INTERVAL '7 days'
            WHERE u.balance >= 15 
            AND u.referrals_count >= 5
            AND wr.id IS NULL
            ORDER BY u.balance DESC
            LIMIT 10
        `);
        
        console.log(`📊 Найдено ${eligibleUsers.rows.length} пользователей без заявок но с достаточным балансом:`);
        for (const user of eligibleUsers.rows) {
            console.log(`  • ID: ${user.id}, Баланс: ${user.balance}⭐, Рефералы: ${user.referrals_count}, Подписан: ${user.is_subscribed}`);
        }
        
        // 3. Проверка проблемных условий
        console.log('\n3️⃣ Проверка распространенных проблем...');
        
        // Пользователи без рефералов
        const noReferralsUsers = await db.executeQuery(`
            SELECT COUNT(*) as count FROM users 
            WHERE balance >= 15 AND referrals_count < 5
        `);
        console.log(`❌ Пользователей с балансом ≥15⭐ но <5 рефералов: ${noReferralsUsers.rows[0].count}`);
        
        // Пользователи без подписки
        const notSubscribedUsers = await db.executeQuery(`
            SELECT COUNT(*) as count FROM users 
            WHERE balance >= 15 AND referrals_count >= 5 AND is_subscribed = FALSE
        `);
        console.log(`❌ Пользователей без подписки: ${notSubscribedUsers.rows[0].count}`);
        
        // Пользователи с некорректными именами
        const badNamesUsers = await db.executeQuery(`
            SELECT COUNT(*) as count FROM users 
            WHERE balance >= 15 AND referrals_count >= 5 
            AND (first_name IS NULL OR LENGTH(first_name) > 100 OR first_name ~ '[\\x{FFFD}\\x{200D}\\x{200C}\\x{200B}]')
        `);
        console.log(`⚠️ Пользователей с проблемными именами: ${badNamesUsers.rows[0].count}`);
        
        // 4. Анализ недавних ошибок (если есть логи)
        console.log('\n4️⃣ Проверка структуры базы данных...');
        
        // Проверяем таблицу withdrawal_requests
        const tableInfo = await db.executeQuery(`
            SELECT column_name, data_type, is_nullable 
            FROM information_schema.columns 
            WHERE table_name = 'withdrawal_requests'
            ORDER BY ordinal_position
        `);
        
        console.log('📋 Структура таблицы withdrawal_requests:');
        for (const col of tableInfo.rows) {
            console.log(`  • ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
        }
        
        // 5. Проверка ограничений базы данных
        console.log('\n5️⃣ Проверка ограничений и индексов...');
        const constraints = await db.executeQuery(`
            SELECT constraint_name, constraint_type 
            FROM information_schema.table_constraints 
            WHERE table_name = 'withdrawal_requests'
        `);
        
        console.log('🔒 Ограничения таблицы withdrawal_requests:');
        for (const constraint of constraints.rows) {
            console.log(`  • ${constraint.constraint_name}: ${constraint.constraint_type}`);
        }
        
        // 6. Тест создания заявки для проблемного пользователя
        console.log('\n6️⃣ Тест создания заявки...');
        
        if (eligibleUsers.rows.length > 0) {
            const testUser = eligibleUsers.rows[0];
            console.log(`🧪 Тестируем создание заявки для пользователя ${testUser.id}...`);
            
            try {
                await db.executeQuery('BEGIN');
                
                // Пробуем создать заявку
                const result = await db.executeQuery(
                    'INSERT INTO withdrawal_requests (user_id, amount, type) VALUES ($1, $2, $3) RETURNING id',
                    [testUser.id, 15, 'stars']
                );
                
                console.log(`✅ Заявка создана успешно с ID: ${result.rows[0].id}`);
                
                // Откатываем тестовую заявку
                await db.executeQuery('ROLLBACK');
                console.log(`🔄 Тестовая заявка отменена`);
                
            } catch (error) {
                await db.executeQuery('ROLLBACK');
                console.error(`❌ Ошибка создания заявки: ${error.message}`);
                console.error(`   Детали: ${error.code || 'No code'}`);
            }
        }
        
        // 7. Рекомендации
        console.log('\n7️⃣ Рекомендации для исправления...');
        
        if (noReferralsUsers.rows[0].count > 0) {
            console.log('📝 Основная проблема: Недостаточно рефералов');
            console.log('   Решение: Пользователи должны пригласить минимум 5 друзей');
        }
        
        if (notSubscribedUsers.rows[0].count > 0) {
            console.log('📝 Проблема: Пользователи не подписаны на каналы');
            console.log('   Решение: Проверить обязательные каналы и подписки');
        }
        
        if (badNamesUsers.rows[0].count > 0) {
            console.log('📝 Проблема: Некорректные имена пользователей');
            console.log('   Решение: Улучшить функцию cleanDisplayText()');
        }
        
        console.log('\n🎯 Дополнительные проверки:');
        console.log('1. Запустите /withdrawal_diagnostics в боте');
        console.log('2. Проверьте логи бота на ошибки отправки в админский канал');
        console.log('3. Протестируйте вывод с тестовым пользователем');
        
    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
    } finally {
        await db.closeConnection();
    }
}

// Запуск диагностик��
if (require.main === module) {
    diagnoseWithdrawalIssues();
}

module.exports = { diagnoseWithdrawalIssues };
