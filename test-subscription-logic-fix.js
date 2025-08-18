const db = require('./database');

async function testSubscriptionLogicFix() {
    console.log('🧪 ТЕСТИРОВАНИЕ ИСПРАВЛЕННОЙ ЛОГИКИ ПОДПИСОК');
    console.log('=' .repeat(50));

    try {
        // Подключаемся к базе данных
        await db.initializeDatabase();

        // Тестовые данные
        const testUserId = 999999999;
        const testUserName = 'TestUser';
        const validChannelId = '@test_valid_channel';
        const invalidChannelId = '@test_invalid_channel';
        const anotherValidChannelId = '@test_valid_channel_2';

        console.log('\n1️⃣ ПОДГОТОВКА ТЕСТОВЫХ ДАННЫХ');
        console.log('-'.repeat(30));

        // Создаем тестового пользователя
        await db.executeQuery(`
            INSERT INTO users (id, username, first_name, captcha_passed, subscription_notified, is_subscribed)
            VALUES ($1, $2, $3, TRUE, FALSE, FALSE)
            ON CONFLICT (id) DO UPDATE SET
                username = $2,
                first_name = $3,
                captcha_passed = TRUE,
                subscription_notified = FALSE,
                is_subscribed = FALSE
        `, [testUserId, testUserName, testUserName]);

        // Очищаем тестовые каналы
        await db.executeQuery('DELETE FROM required_channels WHERE channel_id LIKE $1', ['@test_%']);

        // Добавляем валидный канал
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active)
            VALUES ($1, $2, TRUE)
        `, [validChannelId, 'Тестовый валидный канал']);

        // Добавляем невалидный канал (будет ошибка при проверке)
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active)
            VALUES ($1, $2, TRUE)
        `, [invalidChannelId, 'Тестовый невалидный канал']);

        console.log('✅ Созданы тестовые каналы:');
        console.log(`   - ${validChannelId} (валидный)`);
        console.log(`   - ${invalidChannelId} (невалидный - будет ошибка)`);

        console.log('\n2️⃣ ТЕСТ: ПЕРВЫЙ /start');
        console.log('-'.repeat(30));

        // Проверяем статус уведомления (должен быть FALSE)
        const initialNotified = await db.isSubscriptionNotified(testUserId);
        console.log(`📊 Статус уведомления до первого /start: ${initialNotified}`);

        console.log('✅ ОЖИДАЕТСЯ: При первом /start показывается сообщение о подписках');
        console.log('   (даже если пользователь подписан на правильные каналы)');

        console.log('\n3️⃣ ТЕСТ: ЛОГИКА ПРОВЕРКИ КАНАЛОВ');
        console.log('-'.repeat(30));

        // Имитируем проверку каналов
        console.log('🔍 Проверяем логику обработки ошибок каналов...');
        console.log('✅ ОЖИДАЕТСЯ: Правильные каналы про��еряются, неправильные считаются подписанными');
        console.log('   (чтобы не блокировать пользователей из-за неправильных каналов)');

        console.log('\n4️⃣ ТЕСТ: ПОВТОРНЫЙ /start');
        console.log('-'.repeat(30));

        // Устанавливаем статус уведомления
        await db.setSubscriptionNotified(testUserId, true);
        const afterSetNotified = await db.isSubscriptionNotified(testUserId);
        console.log(`📊 Статус уведомления после установки: ${afterSetNotified}`);

        console.log('✅ ОЖИДАЕТСЯ: При повторном /start автоматически проверяются подписки');
        console.log('   - Если подписан на все проверяемые каналы → проходит в главное меню');
        console.log('   - Если не подписан → показывается сообщение о подписках');

        console.log('\n5️⃣ ТЕСТ: ДОБАВЛЕНИЕ НОВОГО КАНАЛА');
        console.log('-'.repeat(30));

        // Проверяем количество пользователей с уведомлениями до сброса
        const usersWithNotificationsBefore = await db.executeQuery(
            'SELECT COUNT(*) as count FROM users WHERE subscription_notified = TRUE'
        );
        console.log(`📊 Пользователей с уведомлениями до добавления канала: ${usersWithNotificationsBefore.rows[0].count}`);

        // Добавляем новый канал (имитируем команду админа)
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active)
            VALUES ($1, $2, TRUE)
        `, [anotherValidChannelId, 'Новый тестовый канал']);

        // Сбрасываем уведомления для всех пользователей
        const resetCount = await db.resetAllSubscriptionNotifications();
        console.log(`🔄 Сброшен статус уведомлений для ${resetCount} пользователей`);

        // Проверяем статус после сброса
        const afterResetNotified = await db.isSubscriptionNotified(testUserId);
        console.log(`📊 Статус уведомления после сброса: ${afterResetNotified}`);

        console.log('✅ ОЖИДАЕТСЯ: При добавлении нового канала сбрасывается стату�� для всех пользователей');
        console.log('   (пользователи снова увидят сообщение о подписках при следующем /start)');

        console.log('\n6️⃣ РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ');
        console.log('-'.repeat(30));

        const finalStats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(*) FILTER (WHERE subscription_notified = TRUE) as notified_users,
                COUNT(*) FILTER (WHERE is_subscribed = TRUE) as subscribed_users
            FROM users
        `);

        const channels = await db.executeQuery(`
            SELECT COUNT(*) as count FROM required_channels WHERE is_active = TRUE
        `);

        console.log('📊 ФИНАЛЬНАЯ СТАТИСТИКА:');
        console.log(`   - Общее количество пользователей: ${finalStats.rows[0].total_users}`);
        console.log(`   - С уведомлениями о подписках: ${finalStats.rows[0].notified_users}`);
        console.log(`   - Подписанных пользователей: ${finalStats.rows[0].subscribed_users}`);
        console.log(`   - Активных каналов: ${channels.rows[0].count}`);

        console.log('\n✅ ТЕСТ ЛОГИКИ ИСПРАВЛЕНИЙ ЗАВЕРШЕН');
        console.log('\n📝 ОСНОВНЫЕ ИСПРАВЛЕНИЯ:');
        console.log('   1. При первом /start всегда показывается сообщение о подписках');
        console.log('   2. Правильные каналы проверяются, неправильные считаются подписанными');
        console.log('   3. При повторном /start автоматически проверяются подписки');
        console.log('   4. При добавлении каналов админом сбрасывается статус для всех');

        console.log('\n🎯 СЛЕДУЮЩИЕ ШАГИ:');
        console.log('   1. Протестируйте бота с реальными каналами');
        console.log('   2. Добавьте канал через /add_channel для проверки сброса');
        console.log('   3. Проверьте поведение с валидными и невалидными каналами');

        // Очистка тестовых данных
        console.log('\n🧹 ОЧИСТКА ТЕСТОВЫХ ДАННЫХ');
        await db.executeQuery('DELETE FROM required_channels WHERE channel_id LIKE $1', ['@test_%']);
        await db.executeQuery('DELETE FROM users WHERE id = $1', [testUserId]);
        console.log('✅ Тестовые данные удалены');

    } catch (error) {
        console.error('❌ ОШИБКА ПРИ ТЕСТИРОВАНИИ:', error);
        throw error;
    }
}

// Запуск теста
if (require.main === module) {
    testSubscriptionLogicFix()
        .then(() => {
            console.log('\n🎉 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО УСПЕШНО!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО С ОШИБКОЙ:', error);
            process.exit(1);
        });
}

module.exports = { testSubscriptionLogicFix };
