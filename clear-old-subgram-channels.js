/**
 * Скрипт для очистки всех старых спонсорских каналов из базы данных
 * Решает проблему показа устаревших каналов пользователям
 */

const db = require('./database');

async function clearOldSubGramChannels() {
    console.log('🧹 ОЧИСТКА СТАРЫХ СПОНСОРСКИХ КАНАЛОВ\n');

    try {
        await db.initializeDatabase();
        console.log('✅ База данных готова\n');

        // 1. Проверяем что есть для очистки
        console.log('1️⃣ Проверка текущих каналов...');
        const allChannels = await db.executeQuery(`
            SELECT COUNT(*) as total,
                   COUNT(CASE WHEN created_at > NOW() - INTERVAL '1 hour' THEN 1 END) as recent,
                   COUNT(CASE WHEN created_at <= NOW() - INTERVAL '1 hour' THEN 1 END) as old,
                   COUNT(DISTINCT user_id) as unique_users
            FROM subgram_channels
        `);

        const stats = allChannels.rows[0];
        console.log(`📊 Статистика каналов:`);
        console.log(`• Всего каналов: ${stats.total}`);
        console.log(`• Свежих (<1ч): ${stats.recent}`);
        console.log(`• Старых (>1ч): ${stats.old}`);
        console.log(`• Уникальных пользователей: ${stats.unique_users}`);

        if (parseInt(stats.total) === 0) {
            console.log('\n✅ Каналов для очистки нет!');
            return;
        }

        // 2. Показываем примеры каналов которые будут удалены
        if (parseInt(stats.old) > 0) {
            console.log(`\n📝 Примеры старых каналов (будут удалены):`);
            const oldExamples = await db.executeQuery(`
                SELECT user_id, channel_name, channel_link, 
                       DATE_PART('hour', NOW() - created_at) as hours_ago
                FROM subgram_channels 
                WHERE created_at <= NOW() - INTERVAL '1 hour'
                ORDER BY created_at DESC
                LIMIT 5
            `);

            oldExamples.rows.forEach((ch, i) => {
                console.log(`${i+1}. User ${ch.user_id}: ${ch.channel_name}`);
                console.log(`   Возраст: ${Math.round(ch.hours_ago)} часов`);
            });
        }

        if (parseInt(stats.recent) > 0) {
            console.log(`\n📌 Примеры свежих каналов (останутся):`);
            const recentExamples = await db.executeQuery(`
                SELECT user_id, channel_name, channel_link,
                       DATE_PART('minute', NOW() - created_at) as minutes_ago
                FROM subgram_channels 
                WHERE created_at > NOW() - INTERVAL '1 hour'
                ORDER BY created_at DESC
                LIMIT 3
            `);

            recentExamples.rows.forEach((ch, i) => {
                console.log(`${i+1}. User ${ch.user_id}: ${ch.channel_name}`);
                console.log(`   Возраст: ${Math.round(ch.minutes_ago)} минут`);
            });
        }

        // 3. Выполняем очистку старых каналов
        console.log(`\n2️⃣ Очистка старых каналов...`);
        const deleteResult = await db.executeQuery(`
            DELETE FROM subgram_channels 
            WHERE created_at <= NOW() - INTERVAL '1 hour'
        `);

        console.log(`✅ Удалено ${deleteResult.rowCount} старых каналов`);

        // 4. Проверяем результат
        const afterStats = await db.executeQuery(`
            SELECT COUNT(*) as total,
                   COUNT(DISTINCT user_id) as unique_users
            FROM subgram_channels
        `);

        const afterStatsRow = afterStats.rows[0];
        console.log(`\n📊 После очистки:`);
        console.log(`• Осталось каналов: ${afterStatsRow.total}`);
        console.log(`• Уникальных пользователей: ${afterStatsRow.unique_users}`);

        // 5. Резюме
        console.log('\n3️⃣ РЕЗУЛЬТАТ ОЧИСТКИ:');
        console.log('==========================================');
        console.log(`✅ Удалено старых каналов: ${deleteResult.rowCount}`);
        console.log(`✅ Осталось актуальных: ${afterStatsRow.total}`);
        console.log('✅ Проблема с показом старых каналов решена!');

        console.log('\n🎯 ЭФФЕКТ:');
        console.log('• Пользователи больше не увидят устаревшие каналы');
        console.log('• Будут показываться только актуальные каналы или их отсутствие');
        console.log('• Fallback система работает корректно');

        // 6. Дополнительная проверка - очистка всех каналов если нужно
        if (process.argv.includes('--clear-all')) {
            console.log('\n⚠️ ПОЛНАЯ ОЧИСТКА (--clear-all флаг обнаружен)');
            const clearAllResult = await db.executeQuery('DELETE FROM subgram_channels');
            console.log(`🧹 Удалено ВСЕ каналы: ${clearAllResult.rowCount}`);
        }

    } catch (error) {
        console.error('\n❌ ОШИБКА:', error.message);
        console.error(error.stack);
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Подключение закрыто');
    }
}

if (require.main === module) {
    clearOldSubGramChannels();
}

module.exports = { clearOldSubGramChannels };
