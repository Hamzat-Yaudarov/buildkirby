#!/usr/bin/env node
/**
 * ПОЛНАЯ ДИАГНОСТИКА И ТЕСТ АВТОМАТИЧЕСКОЙ СИСТЕМЫ
 */

const starsAgent = require('./agent-integration');

async function runFullDiagnostic() {
    console.log('🔍 ПОЛНАЯ ДИАГНОСТИКА АВТОМАТИЧЕСКОЙ СИСТЕМЫ\n');

    // 1. Проверка состояния агента
    console.log('📊 1. СОСТОЯНИЕ АГЕНТА:');
    const health = await starsAgent.checkAgentHealth();
    console.log('   Агент запущен:', health.agent_running ? '✅ ДА' : '❌ НЕТ');
    console.log('   Статус здоровья:', health.health_status);
    
    if (health.error) {
        console.log('   ❌ Ошибка:', health.error);
    }

    // 2. Получение статистики
    console.log('\n📈 2. СТАТИСТИКА АГЕНТА:');
    const statsResult = await starsAgent.getAgentStats();
    
    if (statsResult.success) {
        const stats = statsResult.stats;
        console.log(`   📋 В очереди: ${stats.queue_pending} заявок`);
        console.log(`   ✅ Выполнено: ${stats.queue_completed} заявок`);
        console.log(`   ❌ Ошибки: ${stats.queue_failed} заявок`);
        console.log(`   ⭐ Отправлено сегодня: ${stats.stars_sent_today}/80 звёзд`);
        console.log(`   🔧 Ошибок сегодня: ${stats.errors_today}`);
    } else {
        console.log('   ❌ Не удалось получить статистику:', statsResult.error);
    }

    // 3. Проверка логов
    console.log('\n📝 3. ПОСЛЕДНИЕ ЛОГИ:');
    const logsResult = await starsAgent.getAgentLogs(5);
    
    if (logsResult.success) {
        console.log('   Последние 5 строк логов:');
        logsResult.logs.split('\n').forEach(line => {
            if (line.trim()) {
                console.log(`   📄 ${line.trim()}`);
            }
        });
    } else {
        console.log('   ❌ Логи недоступны:', logsResult.logs);
    }

    // 4. Тестовое добавление задания
    console.log('\n🧪 4. ТЕСТ ДОБАВЛЕНИЯ ЗАДАНИЯ:');
    try {
        const testUserId = 123456789; // Тестовый ID
        const testAmount = 1; // Тестовая сумма
        
        console.log(`   🔄 Добавляем тестовое задание: ${testAmount} звёзд для пользователя ${testUserId}`);
        
        const addResult = await starsAgent.addStarsJob(testUserId, testAmount, 'test');
        
        if (addResult) {
            console.log('   ✅ Тестовое задание добавлено успешно');
            
            // Проверяем обновленную статистику
            const newStats = await starsAgent.getAgentStats();
            if (newStats.success) {
                console.log(`   📊 Новое количество в очереди: ${newStats.stats.queue_pending}`);
            }
        } else {
            console.log('   ❌ Не удалось добавить тестовое задание');
        }
    } catch (error) {
        console.log('   ❌ Ошибка теста:', error.message);
    }

    // 5. Проверка базы данных агента
    console.log('\n💾 5. БАЗА ДАННЫХ АГЕНТА:');
    try {
        const { execSync } = require('child_process');
        const dbCheck = execSync(`python3 -c "
import sqlite3
import os

db_path = 'userbot_queue.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Проверяем таблицы
    cursor.execute(\\\"SELECT name FROM sqlite_master WHERE type='table'\\\")
    tables = cursor.fetchall()
    print('✅ База данных существует')
    print('📋 Таблицы:', [table[0] for table in tables])
    
    # Статистика заданий
    cursor.execute('SELECT status, COUNT(*) FROM withdrawal_queue GROUP BY status')
    status_counts = cursor.fetchall()
    print('📊 Статистика заданий:', dict(status_counts))
    
    conn.close()
else:
    print('❌ База данных не найдена')
"`, { encoding: 'utf8' });

        console.log('   ' + dbCheck.trim().replace(/\n/g, '\n   '));
    } catch (error) {
        console.log('   ❌ Ошибка проверки базы данных:', error.message);
    }

    // 6. Выводы и рекомендации
    console.log('\n🎯 6. ВЫВОДЫ И РЕКОМЕНДАЦИИ:');
    
    if (!health.agent_running) {
        console.log('   ⚠️ КРИТИЧНО: Агент не запущен!');
        console.log('   💡 Решение: Проверьте логи и перезапустите агент');
        console.log('   🔧 Команда: Посмотрите Railway логи или перезапустите деплой');
    }
    
    if (statsResult.success && statsResult.stats.queue_pending > 0) {
        console.log(`   📋 ВНИМАНИЕ: ${statsResult.stats.queue_pending} заявок в очереди`);
        console.log('   💡 Заявки будут обработаны автоматически в рабочие часы (9-23 МСК)');
    }
    
    if (statsResult.success && statsResult.stats.stars_sent_today > 60) {
        console.log('   ⚠️ ЛИМИТ: Приближается дневной лимит отправки звёзд');
        console.log('   💡 Возможно, потребуется ручная обработка или ожидание до завтра');
    }

    console.log('\n✅ ДИАГНОСТИКА ЗАВЕРШЕНА');
}

// Функция для создания тестовой заявки на вывод
async function createTestWithdrawal() {
    console.log('\n🧪 СОЗДАНИЕ ТЕСТОВОЙ ЗАЯВКИ НА ВЫВОД');
    
    try {
        const testAmount = 5; // Маленькая сумма для теста
        console.log(`🔄 Создаем тестовую заявку на ${testAmount} звёзд...`);
        
        const result = await starsAgent.sendStarsSafely(123456789, testAmount, 'stars');
        
        if (result.success) {
            console.log('✅ Тестовая заявка создана и добавлена в очередь');
            console.log('💬 Сообщение:', result.message);
        } else {
            console.log('❌ Ошибка создания тестовой заявки:', result.error);
        }
    } catch (error) {
        console.log('❌ Критическая ошибка:', error.message);
    }
}

// Запуск диагностики
if (require.main === module) {
    (async () => {
        await runFullDiagnostic();
        
        console.log('\n🔄 Хотите создать тестовую заявку? (y/n)');
        // await createTestWithdrawal(); // Раскомментируйте для тестовой заявки
    })();
}

module.exports = { runFullDiagnostic, createTestWithdrawal };
