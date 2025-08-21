const Database = require('./database');

async function testBot() {
    try {
        console.log('🧪 Тестирование функций бота...');
        
        // Инициализируем БД
        await Database.init();
        
        // Тестируем создание пользователя
        const testUserId = 123456789;
        const userData = {
            userId: testUserId,
            username: 'testuser',
            firstName: 'Test User',
            languageCode: 'ru',
            isPremium: false,
            referrerId: null
        };
        
        console.log('Создаем тестового пользователя...');
        const user = await Database.createUser(userData);
        console.log('✅ Пользователь создан:', user.user_id);
        
        // Тестируем получение пользователя
        console.log('Получаем пользователя...');
        const retrievedUser = await Database.getUser(testUserId);
        console.log('✅ Пользователь получен:', retrievedUser.first_name);
        
        // Тестируем обновление баланса
        console.log('Обновляем баланс...');
        await Database.updateUserBalance(testUserId, 10.5);
        const updatedUser = await Database.getUser(testUserId);
        console.log('✅ Баланс обновлен:', updatedUser.balance);
        
        // Тестируем создание промокода
        console.log('Создаем промокод...');
        const promocode = await Database.createPromocode('TEST123', 5.0, 10);
        console.log('✅ Промокод создан:', promocode.code);
        
        console.log('🎉 Все тесты прошли успешно!');
        console.log('🤖 Бот готов к работе!');
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Ошибка тестирования:', error);
        process.exit(1);
    }
}

testBot();
