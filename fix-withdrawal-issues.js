#!/usr/bin/env node

/**
 * Скрипт для автоматического исправления проблем с выводом звёзд
 */

const db = require('./database');

async function fixWithdrawalIssues() {
    console.log('🔧 Исправление проблем с выводом звёзд...\n');

    try {
        let fixedCount = 0;

        // 1. Исправление заявок с недостаточным балансом
        console.log('1️⃣ Исправление заявок с недостаточным балансом...');
        
        const insufficientBalance = await db.executeQuery(`
            SELECT 
                wr.id,
                wr.user_id,
                wr.amount,
                u.balance,
                u.first_name
            FROM withdrawal_requests wr
            JOIN users u ON wr.user_id = u.id
            WHERE wr.status = 'pending'
            AND u.balance < wr.amount
        `);

        if (insufficientBalance.rows.length > 0) {
            console.log(`   Найдено ${insufficientBalance.rows.length} заявок с недостаточным балансом`);
            
            for (const request of insufficientBalance.rows) {
                console.log(`   🔄 Отклоняю заявку #${request.id} пользователя ${request.first_name}`);
                console.log(`      Запрошено: ${request.amount}⭐, доступно: ${request.balance}⭐`);
                
                // Отклоняем заявку - баланс НЕ возвращаем, так как его и не было
                await db.executeQuery(`
                    UPDATE withdrawal_requests
                    SET status = 'rejected',
                        processed_at = CURRENT_TIMESTAMP,
                        admin_notes = 'Автоматически отклонено: недостаточный баланс'
                    WHERE id = $1
                `, [request.id]);
                
                fixedCount++;
            }
        } else {
            console.log('   ✅ Заявки с недостаточным балансом не найдены');
        }

        // 2. Удаление дублирующих заявок одного пользователя
        console.log('\n2️⃣ Удаление дублирующих заявок...');
        
        const duplicates = await db.executeQuery(`
            SELECT 
                user_id,
                amount,
                type,
                COUNT(*) as count,
                string_agg(id::text, ',') as ids
            FROM withdrawal_requests
            WHERE status = 'pending'
            GROUP BY user_id, amount, type
            HAVING COUNT(*) > 1
        `);

        if (duplicates.rows.length > 0) {
            for (const dup of duplicates.rows) {
                const ids = dup.ids.split(',');
                const keepId = ids[0]; // Оставляем первую заявку
                const removeIds = ids.slice(1); // Удаляем остальные
                
                console.log(`   🔄 Пользователь ${dup.user_id}: оставляю заявку #${keepId}, удаляю дубли: ${removeIds.join(', ')}`);
                
                // Удаляем дублирующие заявки и возвращаем деньги
                for (const removeId of removeIds) {
                    await db.executeQuery(`
                        UPDATE withdrawal_requests
                        SET status = 'rejected',
                            processed_at = CURRENT_TIMESTAMP,
                            admin_notes = 'Автоматически отклонено: дублирующая заявка'
                        WHERE id = $1
                    `, [parseInt(removeId)]);
                    
                    // Возвращаем деньги за дублирующую заявку
                    await db.updateUserBalance(dup.user_id, parseFloat(dup.amount));
                    fixedCount++;
                }
            }
        } else {
            console.log('   ✅ Дублирующие заявки не найдены');
        }

        // 3. Проверка старых заявок (более 24 часов)
        console.log('\n3️⃣ Поиск старых pending заявок...');
        
        const oldRequests = await db.executeQuery(`
            SELECT 
                id,
                user_id,
                amount,
                type,
                created_at,
                (EXTRACT(EPOCH FROM (NOW() - created_at))/3600)::int as hours_old
            FROM withdrawal_requests
            WHERE status = 'pending'
            AND created_at < NOW() - INTERVAL '24 hours'
            ORDER BY created_at ASC
        `);

        if (oldRequests.rows.length > 0) {
            console.log(`   ⚠️ Найдено ${oldRequests.rows.length} старых заявок:`);
            oldRequests.rows.forEach(req => {
                console.log(`      Заявка #${req.id}: ${req.hours_old} часов назад (${req.amount}⭐)`);
            });
            console.log('\n   💡 Рекомендуется ручная обработка или запуск userbot');
        } else {
            console.log('   ✅ Старых заявок не найдено');
        }

        // 4. Проверка статистики после исправлений
        console.log('\n4️⃣ Статистика после исправлений...');
        
        const finalStats = await db.executeQuery(`
            SELECT 
                status,
                COUNT(*) as count,
                SUM(amount) as total_amount
            FROM withdrawal_requests
            GROUP BY status
            ORDER BY status
        `);

        finalStats.rows.forEach(stat => {
            console.log(`   ${stat.status}: ${stat.count} заявок (${parseFloat(stat.total_amount || 0)}⭐)`);
        });

        console.log(`\n✅ Исправлено проблем: ${fixedCount}`);
        
        if (fixedCount > 0) {
            console.log('\n📧 Рекомендуется уведомить пользователей об отклоненных заявках');
        }

        // 5. Проверка готовности к автоматической обработке
        const pendingCount = await db.executeQuery(`
            SELECT COUNT(*) as count FROM withdrawal_requests WHERE status = 'pending'
        `);
        
        const pending = parseInt(pendingCount.rows[0].count);
        
        if (pending === 0) {
            console.log('\n🎉 Отлично! Нет pending заявок для обработки');
        } else if (pending < 10) {
            console.log(`\n✅ Хорошо! Осталось ${pending} заявок для обработки`);
            console.log('   Можно запустить userbot или обработать вручную');
        } else {
            console.log(`\n⚠️ Внимание! Осталось ${pending} заявок для обработки`);
            console.log('   Рекомендуется запустить userbot или массовая ручная обработка');
        }

    } catch (error) {
        console.error('❌ Ошибка исправления:', error);
        throw error;
    }
}

// Запуск если вызван напрямую
if (require.main === module) {
    fixWithdrawalIssues().then(() => {
        console.log('\n🏁 Исправление завершено');
        process.exit(0);
    }).catch(error => {
        console.error('💥 Критическая ошибка:', error);
        process.exit(1);
    });
}

module.exports = { fixWithdrawalIssues };
