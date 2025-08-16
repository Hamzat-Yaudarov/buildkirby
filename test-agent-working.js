#!/usr/bin/env node
/**
 * Тест работы автоматического агента
 */

const starsAgent = require('./agent-integration');

async function testAgentWorking() {
    console.log('🧪 ТЕСТ РАБОТЫ АВТОМАТИЧЕСКОГО АГЕНТА\n');

    // 1. Проверка статуса агента
    console.log('💊 1. ЗДОРОВ��Е АГЕНТА:');
    const health = await starsAgent.checkAgentHealth();
    console.log(`   Статус: ${health.health_status}`);
    console.log(`   Запущен: ${health.agent_running ? '✅ ДА' : '❌ НЕТ'}`);

    // 2. Статистика
    console.log('\n📊 2. СТАТИСТИКА АГЕНТА:');
    const stats = await starsAgent.getAgentStats();
    
    if (stats.success) {
        console.log(`   📋 В очереди: ${stats.stats.queue_pending} заявок`);
        console.log(`   ✅ Выполнено: ${stats.stats.queue_completed} заявок`);
        console.log(`   ❌ Ошибок: ${stats.stats.queue_failed} заявок`);
        console.log(`   ⭐ Отправлено сегодня: ${stats.stats.stars_sent_today}/80 звёзд`);
    } else {
        console.log(`   ❌ Ошибка получения статистики: ${stats.error}`);
    }

    // 3. Тест добавления задания
    console.log('\n🎯 3. ТЕСТ ДОБАВЛЕНИЯ ЗАДАНИЯ:');
    try {
        const testUserId = 999999999; // Тестовый ID
        const testAmount = 5; // Небольшая сумма
        
        console.log(`   🔄 Добавляем тестовое задание: ${testAmount} звёзд для пользователя ${testUserId}`);
        
        const result = await starsAgent.sendStarsSafely(testUserId, testAmount, 'test');
        
        if (result.success) {
            console.log('   ✅ Тестовое задание добавлено успешно!');
            console.log(`   💬 Сообщение: ${result.message}`);
        } else {
            console.log('   ⚠️ Тест не прошёл:', result.error);
        }
    } catch (error) {
        console.log('   ❌ Ошибка теста:', error.message);
    }

    // 4. Проверка очереди после теста
    console.log('\n📈 4. ОЧЕРЕДЬ ПОСЛЕ ТЕСТА:');
    const newStats = await starsAgent.getAgentStats();
    
    if (newStats.success) {
        console.log(`   📋 Заданий в очереди: ${newStats.stats.queue_pending}`);
        if (newStats.stats.queue_pending > 0) {
            console.log('   🤖 Агент обработает задания в рабочие часы (9:00-23:00 МСК)');
        }
    }

    // 5. Проверка логов агента
    console.log('\n📝 5. ПОСЛЕДНИЕ ЛОГИ АГЕНТА:');
    const logs = await starsAgent.getAgentLogs(5);
    
    if (logs.success) {
        const lines = logs.logs.split('\n').filter(line => line.trim());
        lines.slice(-3).forEach(line => {
            if (line.includes('✅') || line.includes('Авторизован')) {
                console.log(`   ✅ ${line.trim()}`);
            } else if (line.includes('❌')) {
                console.log(`   ❌ ${line.trim()}`);
            } else if (line.includes('⚠️') || line.includes('спит')) {
                console.log(`   😴 ${line.trim()}`);
            } else {
                console.log(`   📄 ${line.trim()}`);
            }
        });
    }

    // 6. Время работы агента
    console.log('\n⏰ 6. РАБОЧИЕ ЧАСЫ АГЕНТА:');
    const now = new Date();
    const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000)); // МСК = UTC+3
    const hour = moscowTime.getHours();
    
    console.log(`   🕐 Текущее время МСК: ${moscowTime.toLocaleTimeString('ru-RU')}`);
    console.log(`   ⏰ Рабочие часы: 09:00-23:00 МСК`);
    
    if (hour >= 9 && hour <= 23) {
        console.log('   ✅ СЕЙЧАС РАБОЧЕЕ ВРЕМЯ - агент активен');
    } else {
        console.log('   😴 СЕЙЧАС НЕ РАБОЧЕЕ ВРЕМЯ - агент спит');
        const nextWorkHour = hour < 9 ? 9 : 9 + 24; // Следующие 9 утра
        console.log(`   ⏰ Агент активируется в ${nextWorkHour}:00 МСК`);
    }

    // 7. Итоговый статус
    console.log('\n🎯 7. ИТОГОВЫЙ СТАТУС АВТОМАТИЗАЦИИ:');
    
    if (health.agent_running) {
        console.log('   🎉 АГЕНТ ПОЛНОСТЬЮ РАБОТАЕТ!');
        console.log('   ⚡ Автоматический вывод звёзд АКТИВЕН');
        console.log('   📋 Заявки до 200 звёзд обрабатываются автоматически');
        console.log('   🕐 Работает только в рабочие часы (9:00-23:00 МСК)');
        console.log('   📊 Лимиты: 10 звёзд/час, 80 звёзд/день');
        
        if (hour >= 9 && hour <= 23) {
            console.log('   🚀 СЕЙЧАС АГЕНТ АКТИВНО ОБРАБАТЫВАЕТ ЗАЯВКИ!');
        } else {
            console.log('   😴 Сейчас агент спит до утра');
        }
    } else {
        console.log('   ⚠️ Агент не запущен - проверьте логи Railway');
    }

    console.log('\n✅ ТЕСТ ЗАВЕРШЕН');
    console.log('\n💡 СОВЕТ: Создайте небольшую заявку на вывод (5-10 звёзд) для полного теста!');
}

if (require.main === module) {
    testAgentWorking().catch(console.error);
}

module.exports = { testAgentWorking };
