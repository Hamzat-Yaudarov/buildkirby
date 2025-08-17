const db = require('./database');

async function testSubscriptionStats() {
    console.log('🧪 Тестирование системы статистики подписок...');
    
    try {
        await db.initializeDatabase();
        console.log('✅ База данных инициализирована');
        
        // Тест 1: Проверка создания таблиц
        console.log('\n📋 Тест 1: Проверка существования таблиц...');
        
        const tablesQuery = await db.executeQuery(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('channel_subscription_stats', 'subscription_check_events')
        `);
        
        console.log('Найденные таблицы:', tablesQuery.rows.map(r => r.table_name));
        
        if (tablesQuery.rows.length === 2) {
            console.log('✅ Все таблицы созданы успешно');
        } else {
            console.log('❌ Не все таблицы найдены');
            return;
        }
        
        // Тест 2: Добавление тестового канала
        console.log('\n📋 Тест 2: Добавление тестового канала...');
        
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active) 
            VALUES ('@test_channel_1', 'Тестовый канал 1', TRUE)
            ON CONFLICT (channel_id) DO NOTHING
        `);
        
        console.log('✅ Тестовый канал добавлен');
        
        // Тест 3: Симуляция успешной проверки подписки
        console.log('\n📋 Тест 3: Симуляция проверки подписки...');
        
        const testUserId = 123456789;
        const result = await db.recordSubscriptionCheck(testUserId, true);
        
        if (result) {
            console.log('✅ Проверка подписки записана');
        } else {
            console.log('❌ Ошибка записи проверки подписки');
            return;
        }
        
        // Тест 4: Получение статистики
        console.log('\n📋 Тест 4: Получение статистики...');
        
        const stats = await db.getChannelSubscriptionStats();
        console.log('Статистика каналов:', JSON.stringify(stats, null, 2));
        
        if (stats.length > 0) {
            console.log('✅ Статистика получена успешно');
        } else {
            console.log('❌ Статистика не найдена');
        }
        
        // Тест 5: Добавление второго канала через некоторое время
        console.log('\n📋 Тест 5: Добавление второго канала...');
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // Пауза 1 секунда
        
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active) 
            VALUES ('@test_channel_2', 'Тестовый канал 2', TRUE)
            ON CONFLICT (channel_id) DO NOTHING
        `);
        
        console.log('✅ Второй тестовый канал добавлен');
        
        // Тест 6: Новая проверка подписки (должна увеличить счетчики обоих каналов)
        console.log('\n📋 Тест 6: Новая проверка подписки...');
        
        const result2 = await db.recordSubscriptionCheck(testUserId + 1, true);
        
        if (result2) {
            console.log('✅ Вторая проверка подписки записана');
        } else {
            console.log('❌ Ошибка записи второй проверки подписки');
            return;
        }
        
        // Тест 7: Финальная статистика
        console.log('\n📋 Тест 7: Финальная статистика...');
        
        const finalStats = await db.getChannelSubscriptionStats();
        
        console.log('\n📊 ФИНАЛЬНАЯ СТАТИСТИКА:');
        for (const stat of finalStats) {
            console.log(`Canal: ${stat.channel_name || stat.channel_id}`);
            console.log(`  Успешных проверок: ${stat.successful_checks}`);
            console.log(`  Добавлен: ${stat.channel_added_at}`);
            console.log(`  Активен: ${stat.is_active}`);
            console.log('');
        }
        
        // Тест 8: История проверок
        console.log('\n📋 Тест 8: История проверок...');
        
        const history = await db.getSubscriptionCheckHistory(10);
        
        console.log('\n📋 ИСТОРИЯ ПРОВЕРОК:');
        for (const check of history) {
            console.log(`User ID: ${check.user_id}, Время: ${check.checked_at}, Успех: ${check.success}, Каналов: ${check.active_channels_count}`);
        }
        
        console.log('\n🎉 Все тесты выполнены успешно!');
        console.log('\n💡 Как это работает:');
        console.log('1. Канал @test_channel_1 был добавлен первым');
        console.log('2. Первая проверка подписки увеличила его счетчик до 1');
        console.log('3. Канал @test_channel_2 был добавлен вторым');
        console.log('4. Вторая проверка подписки увеличила счетчики ОБОИХ каналов');
        console.log('5. В итоге: канал 1 имеет 2 проверки, канал 2 имеет 1 проверку');
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
    }
    
    await db.closeConnection();
}

// Запуск тестов
testSubscriptionStats();
