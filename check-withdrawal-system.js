#!/usr/bin/env node

/**
 * Скрипт для диагностики проблем с выводом звёзд
 */

const db = require('./database');

async function checkWithdrawalSystem() {
    console.log('🔍 Диагностика системы вывода звёзд...\n');

    try {
        // 1. Проверка pending заявок
        console.log('1️⃣ Проверка pending заявок...');
        const pendingWithdrawals = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_pending,
                SUM(amount) as total_amount,
                MIN(created_at) as oldest_request
            FROM withdrawal_requests 
            WHERE status = 'pending'
        `);

        const pending = pendingWithdrawals.rows[0];
        console.log(`   📋 Заявок в ожидании: ${pending.total_pending}`);
        console.log(`   💰 ��бщая сумма: ${pending.total_amount || 0} ⭐`);
        if (pending.oldest_request) {
            console.log(`   ⏰ Самая старая заявка: ${new Date(pending.oldest_request).toLocaleString('ru-RU')}`);
        }

        // 2. Проверка проблемных пользователей
        console.log('\n2️⃣ Поиск пользователей с множественными неудачными попытками...');
        const problemUsers = await db.executeQuery(`
            SELECT 
                user_id, 
                COUNT(*) as failed_attempts,
                u.first_name,
                u.balance
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.id
            WHERE wr.status = 'pending' 
            GROUP BY user_id, u.first_name, u.balance
            HAVING COUNT(*) > 2
            ORDER BY failed_attempts DESC
            LIMIT 10
        `);

        if (problemUsers.rows.length > 0) {
            console.log('   ⚠️ Пользователи с множественными заявками:');
            problemUsers.rows.forEach(user => {
                console.log(`   👤 ${user.first_name} (ID: ${user.user_id}) - ${user.failed_attempts} заявок, баланс: ${user.balance}⭐`);
            });
        } else {
            console.log('   ✅ Проблемных пользователей не найдено');
        }

        // 3. Статистика по типам заявок
        console.log('\n3️⃣ Статистика по типам заявок...');
        const typeStats = await db.executeQuery(`
            SELECT 
                type,
                status,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM withdrawal_requests 
            GROUP BY type, status
            ORDER BY type, status
        `);

        const stats = {};
        typeStats.rows.forEach(row => {
            if (!stats[row.type]) stats[row.type] = {};
            stats[row.type][row.status] = {
                count: row.count,
                amount: parseFloat(row.total_amount || 0)
            };
        });

        Object.keys(stats).forEach(type => {
            console.log(`   📊 ${type.toUpperCase()}:`);
            Object.keys(stats[type]).forEach(status => {
                const data = stats[type][status];
                console.log(`      ${status}: ${data.count} заявок (${data.amount}⭐)`);
            });
        });

        // 4. Проверка баланса пользователей с pending заявками
        console.log('\n4️⃣ Прове��ка балансов пользователей с pending заявками...');
        const balanceCheck = await db.executeQuery(`
            SELECT 
                wr.user_id,
                wr.amount as requested,
                u.balance as current_balance,
                u.first_name,
                wr.created_at
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.id
            WHERE wr.status = 'pending'
            AND u.balance < wr.amount
            ORDER BY wr.created_at ASC
        `);

        if (balanceCheck.rows.length > 0) {
            console.log('   ⚠️ Пользователи с недостаточным балансом:');
            balanceCheck.rows.forEach(user => {
                console.log(`   👤 ${user.first_name} - запросил ${user.requested}⭐, есть ${user.current_balance}⭐`);
            });
        } else {
            console.log('   ✅ Все пользователи имеют достаточный баланс');
        }

        // 5. Проверка последних ошибок
        console.log('\n5️⃣ Рекомендации по решению проблем...');
        
        if (parseInt(pending.total_pending) > 0) {
            console.log('\n🔧 РЕКОМЕНДАЦИИ:');
            console.log('   1. Запустите userbot: `python3 userbot-agent-fixed.py`');
            console.log('   2. Или обработайте вручную: `/process_old_withdrawals`');
            console.log('   3. Проверьте логи: `tail -f userbot-agent.log`');
            
            if (parseInt(pending.total_pending) > 50) {
                console.log('\n⚠️ КРИТИЧНО: Слишком много pending заявок!');
                console.log('   - Возможно userbot не работает несколько дней');
                console.log('   - Рекомендуется срочная ручная обработка');
            }
        } else {
            console.log('\n✅ Система работает нормально - нет pending заявок');
        }

        // 6. Быстрый тест создания заявки
        console.log('\n6️⃣ Проверка возможности создания тестовой заявки...');
        try {
            const testUserId = 999999999; // Несуществующий пользователь
            await db.executeQuery('BEGIN');
            await db.executeQuery(
                'INSERT INTO withdrawal_requests (user_id, amount, type) VALUES ($1, $2, $3)',
                [testUserId, 1, 'stars']
            );
            await db.executeQuery('DELETE FROM withdrawal_requests WHERE user_id = $1', [testUserId]);
            await db.executeQuery('COMMIT');
            console.log('   ✅ База данных работает корректно');
        } catch (error) {
            await db.executeQuery('ROLLBACK');
            console.log('   ❌ Ошибка работы с БД:', error.message);
        }

    } catch (error) {
        console.error('❌ Ошибка диагностики:', error);
    }
}

// Запуск если вызван напрямую
if (require.main === module) {
    checkWithdrawalSystem().then(() => {
        console.log('\n🏁 Диагностика завершена');
        process.exit(0);
    }).catch(error => {
        console.error('💥 Критическая ошибка:', error);
        process.exit(1);
    });
}

module.exports = { checkWithdrawalSystem };
