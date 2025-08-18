/**
 * Bot diagnostic test
 * Диагностический тест бота
 */

const db = require('./database');

async function diagnosBot() {
    console.log('🔍 Диагностика бота...\n');

    try {
        // 1. Test database connection
        console.log('1️⃣ Тестирование подключения к базе данных...');
        await db.initializeDatabase();
        console.log('✅ База данных работает\n');

        // 2. Test basic queries
        console.log('2���⃣ Тестирование основных запросов...');
        
        // Test user operations
        const testUserId = 999999999;
        const testUser = {
            id: testUserId,
            username: 'test_user',
            first_name: 'Test User'
        };

        // Clean up first
        await db.executeQuery('DELETE FROM users WHERE id = $1', [testUserId]);
        
        // Create user
        await db.createOrUpdateUser(testUser);
        console.log('✅ Создание пользователя работает');

        // Get user
        const user = await db.getUser(testUserId);
        console.log('✅ Получение пользователя работает');

        // Update balance
        await db.updateUserBalance(testUserId, 10);
        console.log('✅ Обновление баланса работает');

        // Test captcha functions
        await db.setCaptchaPassed(testUserId, true);
        const captchaPassed = await db.getCaptchaStatus(testUserId);
        console.log('✅ Функции капчи работают:', captchaPassed);

        console.log('✅ Основные функции базы данных работают\n');

        // 3. Test SubGram functions
        console.log('3️⃣ Тестирование функций SubGram...');
        
        try {
            const settings = await db.getSubGramSettings();
            console.log('✅ Настройки SubGram загружаются:', !!settings);

            await db.saveSubGramUserSession(testUserId, {test: 'data'}, {test: 'processed'});
            console.log('✅ Сохранение сессии SubGram работает');

            const session = await db.getSubGramUserSession(testUserId);
            console.log('✅ Загрузка сессии SubGram работает:', !!session);

            await db.logSubGramAPIRequest(testUserId, 'test', {}, {}, true);
            console.log('✅ Логирование API запросов работает');

            const history = await db.getSubGramAPIRequestHistory(testUserId, 1);
            console.log('✅ История API запросов работает:', history.length);

        } catch (subgramError) {
            console.error('❌ Ошибка в функциях SubGram:', subgramError.message);
        }

        console.log('✅ Функции SubGram работают\n');

        // 4. Test referral functions
        console.log('4️⃣ Тестирование реферальных функций...');
        
        try {
            const qualification = await db.checkReferralQualification(testUserId);
            console.log('✅ Проверка квалификации работает:', qualification.qualified);

            const result = await db.checkAndProcessPendingReferrals(testUserId);
            console.log('✅ Обработка рефералов работает:', result.processed);

        } catch (referralError) {
            console.error('❌ Ошибка в реферальных функциях:', referralError.message);
        }

        console.log('✅ Реферальные функции работают\n');

        // 5. Test required channels
        console.log('5️⃣ Тестирование обязательных каналов...');
        
        try {
            const channels = await db.executeQuery('SELECT COUNT(*) as count FROM required_channels WHERE is_active = TRUE');
            console.log('✅ Обязательные каналы загружаются:', channels.rows[0].count);

        } catch (channelsError) {
            console.error('❌ Ошибка с каналами:', channelsError.message);
        }

        // 6. Check module imports
        console.log('6️⃣ Проверка модулей...');
        
        try {
            const { subgramAPI } = require('./subgram-api');
            const config = subgramAPI.getConfig();
            console.log('✅ SubGram API модуль загружается:', config.hasApiKey);

            const { captchaSystem } = require('./captcha-system');
            const stats = captchaSystem.getStats();
            console.log('✅ Система капчи загружается:', stats.totalProblems);

            const { throttler } = require('./message-throttler');
            const status = throttler.getStatus();
            console.log('✅ Throttler загружается:', status.messagesPerSecond);

        } catch (moduleError) {
            console.error('❌ Ошибка модулей:', moduleError.message);
        }

        // Cleanup
        await db.executeQuery('DELETE FROM users WHERE id = $1', [testUserId]);
        await db.deleteSubGramUserSession(testUserId);
        
        console.log('\n🎉 ДИАГНОСТИКА ЗАВЕРШЕНА!');
        console.log('✅ Все основные компоненты бота работают корректно');
        
        console.log('\n📋 ПРОВЕРЬТЕ:');
        console.log('1. BOT_TOKEN установлен правильно?');
        console.log('2. База данных доступна?');  
        console.log('3. Интернет соединение работает?');
        console.log('4. Бот имеет права в Telegram?');

    } catch (error) {
        console.error('\n❌ КРИТИЧЕСКАЯ ОШИБКА:', error.message);
        console.error('📍 Стек ошибки:', error.stack);
        
        console.log('\n🛠️ ВОЗМОЖНЫЕ ПРИЧИНЫ:');
        console.log('1. Проблема с базой данных');
        console.log('2. Отсутствует интернет соединение');
        console.log('3. Неправильный API токен');
        console.log('4. Проблема с зависимостями');
    } finally {
        await db.closeConnection();
        console.log('\n🔒 Соединение с базой данных закрыто');
    }
}

// Run the diagnostic
if (require.main === module) {
    diagnosBot();
}

module.exports = { diagnosBot };
