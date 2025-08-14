const db = require('./database');

async function testRatings() {
    try {
        console.log('🔄 Инициализация базы данных...');
        await db.initializeDatabase();
        
        console.log('📊 Тестирование запросов рейтинга...');
        
        // Тест 1: Проверка пользователей
        console.log('\n1. Проверка всех пользователей:');
        const allUsers = await db.executeQuery('SELECT id, first_name, referrals_count, registered_at FROM users LIMIT 5');
        console.log('Найдено пользователей:', allUsers.rows.length);
        if (allUsers.rows.length > 0) {
            allUsers.rows.forEach(user => {
                console.log(`  - ${user.first_name} (ID: ${user.id}): ${user.referrals_count} рефералов`);
            });
        }
        
        // Тест 2: Общий рейтинг
        console.log('\n2. Тест общего рейтинга:');
        try {
            const ratingsAll = await db.executeQuery(`
                SELECT first_name, referrals_count
                FROM users
                WHERE referrals_count > 0
                ORDER BY referrals_count DESC
                LIMIT 10
            `);
            console.log('Результат общего рейтинга:', ratingsAll.rows.length, 'пользователей');
            ratingsAll.rows.forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.first_name}: ${user.referrals_count} рефералов`);
            });
        } catch (error) {
            console.error('❌ Ошибка в общем рейтинге:', error.message);
        }
        
        // Тест 3: Недельный рейтинг
        console.log('\n3. Тест недельного рейтинга:');
        try {
            const ratingsWeek = await db.executeQuery(`
                SELECT first_name, referrals_count, registered_at, updated_at
                FROM users
                WHERE registered_at > NOW() - INTERVAL '7 days' OR updated_at > NOW() - INTERVAL '7 days'
                ORDER BY referrals_count DESC
                LIMIT 10
            `);
            console.log('Результат недельного рейтинга:', ratingsWeek.rows.length, 'пользователей');
            ratingsWeek.rows.forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.first_name}: ${user.referrals_count} рефералов`);
            });
        } catch (error) {
            console.error('❌ Ошибка в недельном рейтинге:', error.message);
        }
        
        // Тест 4: Альтернативный недельный рейтинг
        console.log('\n4. Тест альтернативного недельного рейтинга (упрощенный):');
        try {
            const simpleWeekRating = await db.executeQuery(`
                SELECT first_name, referrals_count
                FROM users
                WHERE referrals_count > 0
                ORDER BY referrals_count DESC
                LIMIT 10
            `);
            console.log('Результат альтернативного рейтинга:', simpleWeekRating.rows.length, 'пользователей');
            simpleWeekRating.rows.forEach((user, index) => {
                console.log(`  ${index + 1}. ${user.first_name}: ${user.referrals_count} рефералов`);
            });
        } catch (error) {
            console.error('❌ Ошибка в альтернативном рейтинге:', error.message);
        }
        
        // Тест 5: Проверка структуры таблицы users
        console.log('\n5. Проверка структуры таблицы users:');
        try {
            const tableInfo = await db.executeQuery(`
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = 'users'
                ORDER BY ordinal_position
            `);
            console.log('Колонки таблицы users:');
            tableInfo.rows.forEach(col => {
                console.log(`  - ${col.column_name}: ${col.data_type}`);
            });
        } catch (error) {
            console.error('❌ Ошибка при проверке структуры:', error.message);
        }
        
    } catch (error) {
        console.error('❌ Общая ошибка тестирования:', error);
    } finally {
        await db.closeConnection();
        console.log('\n✅ Тестирование завершено');
        process.exit(0);
    }
}

testRatings();
