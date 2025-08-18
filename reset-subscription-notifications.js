const db = require('./database');

async function resetAllSubscriptionNotifications() {
    console.log('🔄 СБРОС СТАТУСА УВЕДОМЛЕНИЙ ДЛЯ ВСЕХ ПОЛЬЗОВАТЕЛЕЙ');
    console.log('(Как будто это первый запуск после обновления)');
    console.log('=' .repeat(50));

    try {
        // Подключаемся к базе данных
        await db.initializeDatabase();

        // Получаем статистику до сброса
        const statsBefore = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(*) FILTER (WHERE subscription_notified = TRUE) as notified_users,
                COUNT(*) FILTER (WHERE is_subscribed = TRUE) as subscribed_users
            FROM users
        `);

        console.log('\n📊 СТАТИСТИКА ДО СБРОСА:');
        console.log(`   - Общее количество пользователей: ${statsBefore.rows[0].total_users}`);
        console.log(`   - С уведомлениями о подписках: ${statsBefore.rows[0].notified_users}`);
        console.log(`   - Подписанных пользователей: ${statsBefore.rows[0].subscribed_users}`);

        // Выполняем сброс
        console.log('\n🔄 ВЫПОЛНЯЕТСЯ СБРОС...');
        const resetResult = await db.executeQuery('UPDATE users SET subscription_notified = FALSE');
        const resetCount = resetResult.rowCount;

        console.log(`✅ Сброшен статус уведомлений для ${resetCount} пользователей`);

        // Получаем статистику после сброса
        const statsAfter = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(*) FILTER (WHERE subscription_notified = TRUE) as notified_users,
                COUNT(*) FILTER (WHERE is_subscribed = TRUE) as subscribed_users
            FROM users
        `);

        console.log('\n📊 СТАТИСТИКА ПОСЛЕ СБРОСА:');
        console.log(`   - Общее количество пользователей: ${statsAfter.rows[0].total_users}`);
        console.log(`   - С уведомлениями о подписках: ${statsAfter.rows[0].notified_users}`);
        console.log(`   - Подписанных пользователей: ${statsAfter.rows[0].subscribed_users}`);

        // Проверяем активные каналы
        const channels = await db.executeQuery(`
            SELECT channel_id, channel_name 
            FROM required_channels 
            WHERE is_active = TRUE 
            ORDER BY created_at
        `);

        console.log('\n📺 АКТИВНЫЕ КАНАЛЫ:');
        if (channels.rows.length === 0) {
            console.log('   (Нет активных каналов)');
        } else {
            channels.rows.forEach((channel, index) => {
                console.log(`   ${index + 1}. ${channel.channel_name || channel.channel_id} (${channel.channel_id})`);
            });
        }

        console.log('\n✅ РЕЗУЛЬТАТ СБРОСА:');
        console.log(`   🔄 Обработано пользователей: ${resetCount}`);
        console.log(`   📱 При следующем /start все пользовате��и увидят сообщение о подписках`);
        console.log(`   🎯 Это эмулирует "первый запуск после обновления"`);

        console.log('\n📝 ЧТО ПРОИСХОДИТ ДАЛЬШЕ:');
        console.log('   1. При следующем /start каждый пользователь увидит сообщение о подписках');
        console.log('   2. После проверки подписок пользователь будет помечен как "уведомленный"');
        console.log('   3. При повторном /start будет автоматическая проверка подписок');

    } catch (error) {
        console.error('❌ ОШИБКА ПРИ СБРОСЕ:', error);
        throw error;
    }
}

// Запуск скрипта
if (require.main === module) {
    resetAllSubscriptionNotifications()
        .then(() => {
            console.log('\n🎉 СБРОС ЗАВЕРШЕН УСПЕШНО!');
            console.log('\n🚀 Теперь можно тестировать логику "первого запуска после обновления"');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 СБРОС ЗАВЕРШЕН С ОШИБКОЙ:', error);
            process.exit(1);
        });
}

module.exports = { resetAllSubscriptionNotifications };
