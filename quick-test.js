#!/usr/bin/env node
/**
 * Быстрый тест автоматической системы
 */

const starsAgent = require('./agent-integration');

async function quickTest() {
    console.log('🧪 БЫСТРЫЙ ТЕСТ АВТОМАТИЧЕСКОЙ СИСТЕМЫ\n');

    try {
        // 1. Проверка здоровья агента
        console.log('💊 1. ПРОВЕРКА АГЕНТА:');
        const health = await starsAgent.checkAgentHealth();
        console.log(`   Запущен: ${health.agent_running ? '✅ ДА' : '❌ НЕТ'}`);
        console.log(`   Статус: ${health.health_status}`);

        // 2. Статистика
        console.log('\n📊 2. СТАТИСТИКА:');
        const stats = await starsAgent.getAgentStats();
        
        if (stats.success) {
            console.log(`   📋 В очереди: ${stats.stats.queue_pending} заявок`);
            console.log(`   ✅ Выполнено: ${stats.stats.queue_completed} заявок`);
            console.log(`   ❌ Ошибок: ${stats.stats.queue_failed} заявок`);
            console.log(`   ⭐ Отправлено сегодня: ${stats.stats.stars_sent_today}/80 звёзд`);
        } else {
            console.log(`   ❌ Статистика недоступна: ${stats.error}`);
        }

        // 3. Тест добавления в очередь
        console.log('\n🎯 3. ТЕСТ ДОБАВЛЕНИЯ В ОЧЕРЕДЬ:');
        console.log('   🔄 Добавляем тестовое задание в очередь...');
        
        const testUserId = 123456789;
        const testAmount = 1;
        
        const result = await starsAgent.sendStarsSafely(testUserId, testAmount, 'test');
        
        if (result.success) {
            console.log('   ✅ Тестовое задание добавлено!');
            console.log(`   💬 ${result.message}`);
        } else {
            console.log('   ❌ Ошибка:', result.error);
        }

        // 4. Проверка обновленной статистики
        console.log('\n📈 4. ОБНОВЛЕННАЯ СТАТИСТИКА:');
        const newStats = await starsAgent.getAgentStats();
        
        if (newStats.success) {
            console.log(`   📋 Теперь в очереди: ${newStats.stats.queue_pending} заявок`);
            
            if (newStats.stats.queue_pending > 0) {
                console.log('   🤖 Агент должен обработать заявки автоматически!');
            }
        }

        // 5. Проверка рабочих часов
        console.log('\n⏰ 5. РАБОЧИЕ ЧАСЫ:');
        const now = new Date();
        const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
        const hour = moscowTime.getHours();
        
        console.log(`   🕐 Сейчас МСК: ${moscowTime.toLocaleTimeString('ru-RU')}`);
        console.log(`   ⏰ Рабочие часы: 00:00-23:00`);
        
        if (hour >= 0 && hour <= 23) {
            console.log('   ✅ СЕЙЧАС РАБОЧЕЕ ВРЕМЯ - агент должен работать!');
        } else {
            console.log('   😴 С��йчас не рабочее время');
        }

        // 6. Итог
        console.log('\n🎯 6. ДИАГНОЗ:');
        
        if (health.agent_running && stats.success) {
            console.log('   ✅ АГЕНТ РАБОТАЕТ И ГОТОВ!');
            
            if (hour >= 0 && hour <= 23) {
                console.log('   🚀 АВТОМАТИЧЕСКИЙ ВЫВОД ДОЛЖЕН ФУНКЦИОНИРОВАТЬ');
                console.log('   💡 Создайте реальную заявку на вывод для полного теста');
            } else {
                console.log('   😴 Агент активируется в рабочие часы');
            }
        } else {
            console.log('   ⚠️ ПРОБЛЕМЫ С АГЕНТОМ:');
            
            if (!health.agent_running) {
                console.log('   - Агент не запущен или недоступен');
            }
            
            if (!stats.success) {
                console.log('   - Статистика недоступна');
            }
        }

    } catch (error) {
        console.log('\n❌ ОШИБКА ТЕСТА:', error.message);
    }

    console.log('\n✅ ТЕСТ ЗАВЕРШЕН');
}

// Запуск
quickTest().catch(console.error);
