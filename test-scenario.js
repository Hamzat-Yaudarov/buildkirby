/**
 * Простой тестовый сценарий для проверки исправления
 * Эмулирует поведение пользователя и проверяет логику
 */

const smartSubGram = require('./subgram-smart-handler');
const db = require('./database');

async function runTestScenario() {
    console.log('🎬 Запуск тестового сценария...\n');

    try {
        // Инициализируем базу данных
        await db.initializeDatabase();
        console.log('✅ База данных готова\n');

        const testUserId = 7972065986; // ID админа для теста

        console.log('📋 ТЕСТОВЫЙ СЦЕНАРИЙ: Пользователь заходит в бота\n');

        // === СЦЕНАРИЙ 1: Проверка текущего состояния ===
        console.log('1️⃣ ЭТАП: Проверяем текущее состояние SubGram');
        console.log('='.repeat(50));

        const state = await smartSubGram.getSubGramState(testUserId);
        console.log(`✅ Состояние SubGram: ${state.state}`);
        console.log(`🔒 Должен блокировать: ${state.shouldBlock}`);
        console.log(`📺 Каналов найдено: ${state.channels.length}`);

        // === СЦЕНАРИЙ 2: Решение о доступе ===
        console.log('\n2️⃣ ЭТАП: Принимаем решение о доступе к боту');
        console.log('='.repeat(50));

        const accessDecision = await smartSubGram.shouldBlockBotAccess(testUserId);
        console.log(`🎯 Решение: ${accessDecision.shouldBlock ? 'БЛОКИРОВАТЬ' : 'РАЗРЕШИТЬ'}`);
        console.log(`📝 Причина: ${accessDecision.reason}`);

        // === СЦЕНАРИЙ 3: Сообщение для пользователя ===
        console.log('\n3️⃣ ЭТАП: Формируем ответ пользователю');
        console.log('='.repeat(50));

        const userMessage = await smartSubGram.getSubscriptionMessage(testUserId);
        console.log(`👤 Доступ разре��ен: ${userMessage.accessAllowed}`);

        if (!userMessage.accessAllowed) {
            console.log(`📺 Каналов для подписки: ${userMessage.channelsCount}`);
            console.log('💬 Пользователь увидит сообщение о подписке на каналы');
        } else {
            console.log('🏠 Пользователь увидит главное меню бота');
        }

        // === СЦЕНАРИЙ 4: Логика поведения бота ===
        console.log('\n4️⃣ ЭТАП: Как поведет себя бот');
        console.log('='.repeat(50));

        if (accessDecision.shouldBlock) {
            console.log('🚫 БЛОКИРОВКА АКТИВНА:');
            console.log('   • Команда /start покажет ТОЛЬКО спонсорские каналы');
            console.log('   • Главное меню НЕ будет отправлено');
            console.log('   • Кнопки бота будут заблокированы');
            console.log('   • При нажатии на кнопки будут показаны каналы');
        } else {
            console.log('✅ ДОСТУП РАЗРЕШЕН:');
            console.log('   • Команда /start покажет главное меню');
            console.log('   • Все кнопки бота работают нормально');
            console.log('   • Пользователь может пользоваться всеми функциями');
        }

        // === СЦЕНАРИЙ 5: Проверка исправления ===
        console.log('\n5️⃣ ЭТАП: Проверяем исправление проблемы');
        console.log('='.repeat(50));

        const isFixed = checkIfProblemIsFixed(state, accessDecision, userMessage);
        
        if (isFixed.success) {
            console.log('🎉 ПРОБЛЕМА ИСПРАВЛЕНА!');
            console.log(`✅ ${isFixed.reason}`);
        } else {
            console.log('❌ ПРОБЛЕМА ЕЩЁ ЕСТЬ!');
            console.log(`⚠️ ${isFixed.reason}`);
        }

        // === РЕЗУЛЬТАТ ===
        console.log('\n📊 ИТОГОВЫЙ РЕЗУЛЬТАТ:');
        console.log('='.repeat(50));

        if (state.channels.length === 0) {
            console.log('📋 Ситуация: Нет спонсорских каналов');
            console.log('🎯 Ожидание: Доступ должен быть разрешен');
            console.log(`🔍 Реальность: ${accessDecision.shouldBlock ? 'ЗАБЛОКИРОВАН ��' : 'РАЗРЕШЕН ✅'}`);
        } else {
            console.log('📋 Ситуация: Есть спонсорские каналы для подписки');
            console.log('🎯 Ожидание: Доступ должен быть заблокирован');
            console.log(`🔍 Реальность: ${accessDecision.shouldBlock ? 'ЗАБЛОКИРОВАН ✅' : 'РАЗРЕШЕН ❌'}`);
        }

        console.log('\n📝 Рекомендации:');
        if (isFixed.success) {
            console.log('✅ Система работает правильно');
            console.log('🚀 Можно запускать бота в продакшене');
        } else {
            console.log('🔧 Требуется дополнительная отладка');
            console.log('🧪 Используйте команды из TESTING_COMMANDS.md');
        }

    } catch (error) {
        console.error('❌ Ошибка в тестовом сценарии:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        try {
            await db.closeConnection();
            console.log('\n🔒 База данных закрыта');
        } catch (closeError) {
            console.error('Ошибка закрытия базы:', closeError);
        }
    }
}

function checkIfProblemIsFixed(state, accessDecision, userMessage) {
    // Логика проверки исправления
    
    if (state.channels.length === 0) {
        // Нет каналов - доступ должен быть разрешен
        if (!accessDecision.shouldBlock && userMessage.accessAllowed) {
            return {
                success: true,
                reason: 'Нет каналов → доступ разрешен → главное меню показано'
            };
        } else {
            return {
                success: false,
                reason: 'Нет каналов, но доступ всё равно блокируется'
            };
        }
    } else {
        // Есть каналы - доступ должен быть заблокирован
        if (accessDecision.shouldBlock && !userMessage.accessAllowed) {
            return {
                success: true,
                reason: 'Есть каналы → доступ заблокирован → показаны каналы'
            };
        } else {
            return {
                success: false,
                reason: 'Есть каналы, но доступ не блокируется (старая проблема)'
            };
        }
    }
}

// Запускаем тест
if (require.main === module) {
    runTestScenario().then(() => {
        console.log('\n✅ Тестовый сценарий завершен');
        process.exit(0);
    }).catch(error => {
        console.error('\n❌ Критическая ошибка сценария:', error);
        process.exit(1);
    });
}

module.exports = { runTestScenario };
