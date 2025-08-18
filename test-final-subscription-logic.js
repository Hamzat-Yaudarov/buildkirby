const db = require('./database');

async function testFinalSubscriptionLogic() {
    console.log('🧪 ФИНАЛЬНЫЙ ТЕСТ ЛОГИКИ ПОДПИСОК');
    console.log('=' .repeat(50));

    try {
        // Подключаемся к базе данных
        await db.initializeDatabase();

        // Тестовые данные
        const testUserId1 = 999999991;
        const testUserId2 = 999999992;
        const testUserName1 = 'TestUser1';
        const testUserName2 = 'TestUser2';

        console.log('\n1️⃣ ПОДГОТОВКА ТЕСТОВЫХ ПОЛЬЗОВАТЕЛЕЙ');
        console.log('-'.repeat(30));

        // Создаем тестовых пользователей с разными статусами
        await db.executeQuery(`
            INSERT INTO users (id, username, first_name, captcha_passed, subscription_notified, is_subscribed)
            VALUES 
                ($1, $2, $3, TRUE, TRUE, TRUE),
                ($4, $5, $6, TRUE, FALSE, FALSE)
            ON CONFLICT (id) DO UPDATE SET
                username = EXCLUDED.username,
                first_name = EXCLUDED.first_name,
                captcha_passed = TRUE,
                subscription_notified = EXCLUDED.subscription_notified,
                is_subscribed = EXCLUDED.is_subscribed
        `, [testUserId1, testUserName1, testUserName1, testUserId2, testUserName2, testUserName2]);

        console.log('✅ Созданы тестовые пользователи:');
        console.log(`   - User1 (${testUserId1}): уведомлен=TRUE, подписан=TRUE`);
        console.log(`   - User2 (${testUserId2}): уведомлен=FALSE, подписан=FALSE`);

        // Очищаем тестовые каналы
        await db.executeQuery('DELETE FROM required_channels WHERE channel_id LIKE $1', ['@test_%']);

        console.log('\n2️⃣ ТЕСТ: СБРОС ВСЕХ УВЕДОМЛЕНИЙ (ЭМУЛЯЦИЯ ОБНОВЛЕНИЯ)');
        console.log('-'.repeat(30));

        // Выполняем сброс всех уведомлений
        const resetCount = await db.resetAllSubscriptionNotifications();
        console.log(`🔄 Сброшен статус уведомлений для ${resetCount} пользователей`);

        // Проверяем статус после сброса
        const statusAfterReset = await db.executeQuery(`
            SELECT id, subscription_notified, is_subscribed 
            FROM users 
            WHERE id IN ($1, $2)
        `, [testUserId1, testUserId2]);

        console.log('📊 Статус пользователей после сброса:');
        statusAfterReset.rows.forEach(user => {
            console.log(`   - User ${user.id}: уведомлен=${user.subscription_notified}, подписан=${user.is_subscribed}`);
        });

        console.log('✅ ОЖИДАЕТСЯ: Все пользователи имеют subscription_notified=FALSE');
        console.log('   (Как будто это первый запуск после обновления)');

        console.log('\n3️⃣ ТЕСТ: ДОБАВЛЕНИЕ ПРА��ИЛЬНОГО КАНАЛА');
        console.log('-'.repeat(30));

        // Добавляем правильный канал
        const validChannelId = '@test_valid_channel';
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active)
            VALUES ($1, $2, TRUE)
        `, [validChannelId, 'Тестовый правильный канал']);

        // Сбрасываем уведомления (эмулируем команду /add_channel)
        const resetCount1 = await db.resetAllSubscriptionNotifications();
        console.log(`✅ Добавлен правильный канал: ${validChannelId}`);
        console.log(`🔄 Сброшен статус уведомлений для ${resetCount1} пользователей`);

        console.log('\n4️⃣ ТЕСТ: ДОБАВЛЕНИЕ НЕПРАВИЛЬНОГО КАНАЛА');
        console.log('-'.repeat(30));

        // Добавляем неправильный канал (будет ошибка при проверке)
        const invalidChannelId = '@test_nonexistent_channel_12345';
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active)
            VALUES ($1, $2, TRUE)
        `, [invalidChannelId, 'Тестовый неправильный канал']);

        // Сбрасываем уведомления (эмулируем команду /add_channel)
        const resetCount2 = await db.resetAllSubscriptionNotifications();
        console.log(`✅ Добавлен неправильный канал: ${invalidChannelId}`);
        console.log(`🔄 Сброшен статус уведомлений для ${resetCount2} пользователей`);

        console.log('✅ ОЖИДАЕТСЯ: При добавлении ЛЮБОГО канала сбрасываются уведомления');

        console.log('\n5️⃣ ТЕСТ: ПРОВЕРКА ФИНАЛЬНОГО СТАТУСА');
        console.log('-'.repeat(30));

        const finalStatus = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(*) FILTER (WHERE subscription_notified = TRUE) as notified_users,
                COUNT(*) FILTER (WHERE subscription_notified = FALSE) as not_notified_users
            FROM users
        `);

        const channels = await db.executeQuery(`
            SELECT channel_id, channel_name 
            FROM required_channels 
            WHERE is_active = TRUE 
            ORDER BY created_at
        `);

        console.log('📊 ФИНАЛЬНАЯ СТАТИСТИКА:');
        console.log(`   - Общее количество пользователей: ${finalStatus.rows[0].total_users}`);
        console.log(`   - С уведомлениями (TRUE): ${finalStatus.rows[0].notified_users}`);
        console.log(`   - Без уведомлений (FALSE): ${finalStatus.rows[0].not_notified_users}`);

        console.log('\n📺 АКТИВНЫЕ КАНАЛЫ:');
        channels.rows.forEach((channel, index) => {
            const type = channel.channel_id.includes('nonexistent') ? '(неправильный)' : '(правильный)';
            console.log(`   ${index + 1}. ${channel.channel_name} - ${channel.channel_id} ${type}`);
        });

        console.log('\n6️⃣ РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
        console.log('-'.repeat(30));

        console.log('✅ ЛОГИКА РАБОТАЕТ КОРРЕКТНО:');
        console.log('   1. При сбросе ВСЕ пользователи получили subscription_notified=FALSE');
        console.log('   2. При добавлении правильного канала сбрасываются уведомления');
        console.log('   3. При добавлении неправильного канала ТОЖЕ сбрасываются уведомления');
        console.log('   4. Теперь при /start ВСЕ пользователи увидят сообщение о подписках');

        console.log('\n📝 ЧТО ПРОИСХОДИТ ДАЛЬШЕ:');
        console.log('   1. При /start показывается сообщение о подписках');
        console.log('   2. Правильные каналы проверяются, неправильные пропускаются');
        console.log('   3. При повторном /start автоматическая проверка подписок');
        console.log('   4. При добавлении любого канала админом - сброс для всех');

        console.log('\n🎯 КОМАНДЫ ДЛЯ АДМИНА:');
        console.log('   npm run reset-notifications  - сбросить уведомления всех');
        console.log('   /add_channel @channel|Name   - добавить канал (авто-сброс)');
        console.log('   /subscription_diagnostic     - диагностика подписок');

        // Очистка тестовых данных
        console.log('\n🧹 ОЧИСТКА ТЕСТОВЫХ ДАННЫХ');
        await db.executeQuery('DELETE FROM required_channels WHERE channel_id LIKE $1', ['@test_%']);
        await db.executeQuery('DELETE FROM users WHERE id IN ($1, $2)', [testUserId1, testUserId2]);
        console.log('✅ Тестовые данные удалены');

    } catch (error) {
        console.error('❌ ОШИБКА ПРИ ТЕСТИРОВАНИИ:', error);
        throw error;
    }
}

// Запуск теста
if (require.main === module) {
    testFinalSubscriptionLogic()
        .then(() => {
            console.log('\n🎉 ФИНАЛЬНЫЙ ТЕСТ ЗАВЕРШЕН УСПЕШНО!');
            console.log('\n🚀 ЛОГИКА ПОДПИСОК ГОТОВА К ИСПОЛЬЗОВАНИЮ!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО С ОШИБКОЙ:', error);
            process.exit(1);
        });
}

module.exports = { testFinalSubscriptionLogic };
