#!/usr/bin/env node
/**
 * Проверка статуса агента после загрузки сессии
 */

const starsAgent = require('./agent-integration');

async function checkAgentStatus() {
    console.log('🔍 ПРОВЕРКА СТАТУСА АГЕНТА ПОСЛЕ ЗАГРУЗКИ СЕССИИ\n');

    // 1. Проверка здоровья агента
    console.log('💊 1. ЗДОРОВЬЕ АГЕНТА:');
    const health = await starsAgent.checkAgentHealth();
    console.log(`   Статус: ${health.health_status}`);
    console.log(`   Запущен: ${health.agent_running ? '✅ ДА' : '❌ НЕТ'}`);
    
    if (health.error) {
        console.log(`   ❌ Ошибка: ${health.error}`);
    }

    // 2. Статистика агента
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

    // 3. Последние логи
    console.log('\n📝 3. ПОСЛЕДНИЕ ЛОГИ АГЕНТА:');
    const logs = await starsAgent.getAgentLogs(10);
    
    if (logs.success) {
        const logLines = logs.logs.split('\n').filter(line => line.trim());
        logLines.slice(-5).forEach(line => {
            if (line.includes('✅') || line.includes('Авторизован')) {
                console.log(`   ✅ ${line.trim()}`);
            } else if (line.includes('❌') || line.includes('ERROR')) {
                console.log(`   ❌ ${line.trim()}`);
            } else {
                console.log(`   📄 ${line.trim()}`);
            }
        });
    } else {
        console.log(`   ❌ Логи недоступны: ${logs.logs}`);
    }

    // 4. Тест отправки
    console.log('\n🧪 4. ТЕСТ СИСТЕМЫ:');
    try {
        console.log('   🔄 Тестируем добавление задания в очередь...');
        
        const testResult = await starsAgent.sendStarsSafely(123456789, 1, 'test');
        
        if (testResult.success) {
            console.log('   ✅ Тест успешен - система готова к работе!');
            console.log(`   💬 ${testResult.message}`);
        } else {
            console.log('   ⚠️ Тест не прошёл:', testResult.error);
        }
    } catch (error) {
        console.log('   ❌ Ошибка теста:', error.message);
    }

    // 5. Вывод
    console.log('\n🎯 5. СТАТУС АВТОМАТИЗАЦИИ:');
    
    if (health.agent_running && stats.success) {
        console.log('   🎉 АГЕНТ РАБОТАЕТ!');
        console.log('   ⚡ Автоматический вывод звёзд АКТИВЕН');
        console.log('   📋 Заявки до 200 звёзд обрабатываются автоматически');
        console.log('   ⏰ Рабочие часы: 9:00-23:00 МСК');
    } else if (!health.agent_running) {
        console.log('   ⚠️ Агент не запущен - проверьте Railway логи');
        console.log('   🔧 Возможно нужно немного подождать запуска');
    } else {
        console.log('   ⚠️ Агент запущен но есть проблемы со статистикой');
    }

    console.log('\n✅ ПРОВЕРКА ЗАВЕРШЕНА');
}

if (require.main === module) {
    checkAgentStatus().catch(console.error);
}

module.exports = { checkAgentStatus };
