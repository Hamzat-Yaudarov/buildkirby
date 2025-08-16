#!/usr/bin/env node
/**
 * Поиск пользователей, которые могут испытывать проблемы с выводом
 */

const db = require('./database');

async function findProblematicUsers() {
    console.log('🔍 Поиск пользователей с возможными проблемами вывода...\n');
    
    try {
        await db.initializeDatabase();
        
        // 1. Пользователи с проблемными именами
        console.log('1️⃣ Пользователи с проблемными именами...');
        const badNameUsers = await db.executeQuery(`
            SELECT id, first_name, username, balance, referrals_count
            FROM users 
            WHERE balance >= 15 AND referrals_count >= 5
            AND (
                first_name IS NULL 
                OR LENGTH(first_name) > 100 
                OR first_name ~ '[\\x{FFFD}\\x{200D}\\x{200C}\\x{200B}]'
                OR first_name ~ '[\\x{2600}-\\x{26FF}\\x{2700}-\\x{27BF}]'
                OR LENGTH(TRIM(first_name)) = 0
            )
            LIMIT 10
        `);
        
        console.log(`Found ${badNameUsers.rows.length} users with problematic names:`);
        for (const user of badNameUsers.rows) {
            console.log(`  • ID: ${user.id}, Name: "${user.first_name}", Balance: ${user.balance}⭐`);
        }
        
        // 2. Пользователи с очень длинными username
        console.log('\n2️⃣ Пользователи с проблемными username...');
        const badUsernameUsers = await db.executeQuery(`
            SELECT id, first_name, username, balance, referrals_count
            FROM users 
            WHERE balance >= 15 AND referrals_count >= 5
            AND username IS NOT NULL
            AND LENGTH(username) > 32
            LIMIT 10
        `);
        
        console.log(`Found ${badUsernameUsers.rows.length} users with long usernames:`);
        for (const user of badUsernameUsers.rows) {
            console.log(`  • ID: ${user.id}, Username: "${user.username}", Length: ${user.username?.length}`);
        }
        
        // 3. Пользователи без подписки
        console.log('\n3️⃣ Пользователи без подписки на каналы...');
        const unsubscribedUsers = await db.executeQuery(`
            SELECT id, first_name, username, balance, referrals_count, registered_at
            FROM users 
            WHERE balance >= 15 AND referrals_count >= 5
            AND is_subscribed = FALSE
            ORDER BY balance DESC
            LIMIT 10
        `);
        
        console.log(`Found ${unsubscribedUsers.rows.length} eligible users not subscribed:`);
        for (const user of unsubscribedUsers.rows) {
            console.log(`  • ID: ${user.id}, Balance: ${user.balance}⭐, Refs: ${user.referrals_count}`);
        }
        
        // 4. Пользователи с очень высоким балансом без заявок
        console.log('\n4️⃣ Пользователи с высоким балансом без заявок...');
        const highBalanceUsers = await db.executeQuery(`
            SELECT u.id, u.first_name, u.username, u.balance, u.referrals_count, u.is_subscribed
            FROM users u
            LEFT JOIN withdrawal_requests wr ON u.id = wr.user_id 
                AND wr.created_at > NOW() - INTERVAL '30 days'
            WHERE u.balance >= 50 
            AND u.referrals_count >= 5
            AND u.is_subscribed = TRUE
            AND wr.id IS NULL
            ORDER BY u.balance DESC
            LIMIT 10
        `);
        
        console.log(`Found ${highBalanceUsers.rows.length} high-balance users without recent withdrawals:`);
        for (const user of highBalanceUsers.rows) {
            console.log(`  • ID: ${user.id}, Balance: ${user.balance}⭐, Subscribed: ${user.is_subscribed}`);
        }
        
        // 5. Пользователи с недавними неудачными попытками (если есть логи)
        console.log('\n5️⃣ Анализ активности пользователей...');
        const recentActiveUsers = await db.executeQuery(`
            SELECT id, first_name, balance, referrals_count, is_subscribed, updated_at
            FROM users 
            WHERE updated_at > NOW() - INTERVAL '24 hours'
            AND balance >= 15 
            AND referrals_count >= 5
            ORDER BY updated_at DESC
            LIMIT 10
        `);
        
        console.log(`Found ${recentActiveUsers.rows.length} recently active eligible users:`);
        for (const user of recentActiveUsers.rows) {
            console.log(`  • ID: ${user.id}, Balance: ${user.balance}⭐, Last activity: ${new Date(user.updated_at).toLocaleString()}`);
        }
        
        // 6. Создание команд для диагностики
        console.log('\n6️⃣ Команды для дальнейшей диагностики:');
        
        const allProblematicIds = [
            ...badNameUsers.rows.map(u => u.id),
            ...badUsernameUsers.rows.map(u => u.id),
            ...unsubscribedUsers.rows.slice(0, 3).map(u => u.id),
            ...highBalanceUsers.rows.slice(0, 3).map(u => u.id)
        ];
        
        const uniqueIds = [...new Set(allProblematicIds)];
        
        console.log('\nДля детальной диагностики выполните в боте:');
        for (const userId of uniqueIds.slice(0, 5)) {
            console.log(`/diagnose_user ${userId}`);
        }
        
        // 7. Статистика общих проблем
        console.log('\n7️⃣ Общая статистика проблем:');
        
        const stats = await db.executeQuery(`
            SELECT 
                COUNT(*) FILTER (WHERE referrals_count < 5) as insufficient_referrals,
                COUNT(*) FILTER (WHERE balance < 15) as insufficient_balance,
                COUNT(*) FILTER (WHERE is_subscribed = FALSE) as not_subscribed,
                COUNT(*) FILTER (WHERE first_name IS NULL OR LENGTH(TRIM(first_name)) = 0) as no_name,
                COUNT(*) as total_users
            FROM users
        `);
        
        const stat = stats.rows[0];
        console.log(`📊 Из ${stat.total_users} пользователей:`);
        console.log(`  • ${stat.insufficient_referrals} с недостаточными рефералами (<5)`);
        console.log(`  • ${stat.insufficient_balance} с недостаточным балансом (<15⭐)`);
        console.log(`  • ${stat.not_subscribed} без подписки на каналы`);
        console.log(`  • ${stat.no_name} без имени`);
        
        // 8. Рекомендации
        console.log('\n8️⃣ Рекомендации:');
        console.log('1. Проверьте пользователей с проблемными именами - используйте /diagnose_user');
        console.log('2. Убедитесь что функция cleanDisplayText корректно обрабатывает все символы');
        console.log('3. Проверьте работу проверки подписок на каналы');
        console.log('4. Мониторьте логи бота на п��едмет ошибок отправки в админский канал');
        
    } catch (error) {
        console.error('❌ Ошибка поиска проблемных пользователей:', error);
    } finally {
        await db.closeConnection();
    }
}

// Запуск поиска
if (require.main === module) {
    findProblematicUsers();
}

module.exports = { findProblematicUsers };
