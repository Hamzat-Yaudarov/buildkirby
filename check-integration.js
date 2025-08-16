#!/usr/bin/env node
/**
 * Проверка интеграции между ботом и агентом
 */

const { execSync } = require('child_process');

async function checkIntegration() {
    console.log('🔧 ПРОВЕРКА ИНТЕГРАЦИИ БОТА И АГЕНТА\n');

    // 1. Проверка файлов
    console.log('📁 1. ПРОВЕРКА ФАЙЛОВ:');
    const files = [
        'userbot-agent.py',
        'agent-integration.js', 
        'userbot_session.session',
        'index.js'
    ];

    files.forEach(file => {
        try {
            const fs = require('fs');
            if (fs.existsSync(file)) {
                const stats = fs.statSync(file);
                console.log(`   ✅ ${file} (${stats.size} bytes)`);
            } else {
                console.log(`   ❌ ${file} - НЕ НАЙДЕН!`);
            }
        } catch (error) {
            console.log(`   ❌ ${file} - ошибка: ${error.message}`);
        }
    });

    // 2. Проверка базы данных агента
    console.log('\n💾 2. ПРОВЕРКА БАЗЫ ДАННЫХ АГЕНТА:');
    try {
        const dbCheck = execSync(`python3 -c "
import sqlite3
import os

db_path = 'userbot_queue.db'
if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Проверяем структуру таблиц
    cursor.execute(\\\"SELECT name FROM sqlite_master WHERE type='table'\\\")
    tables = cursor.fetchall()
    print('✅ БД агента существует')
    print('📋 Таблицы:', [table[0] for table in tables])
    
    # Считаем записи
    try:
        cursor.execute('SELECT COUNT(*) FROM withdrawal_queue')
        total = cursor.fetchone()[0]
        print(f'📊 Всего заданий: {total}')
        
        cursor.execute('SELECT COUNT(*) FROM withdrawal_queue WHERE status = \\\"pending\\\"')
        pending = cursor.fetchone()[0]
        print(f'⏳ В ожидании: {pending}')
        
        if pending > 0:
            cursor.execute('SELECT user_id, amount, created_at FROM withdrawal_queue WHERE status = \\\"pending\\\" ORDER BY created_at DESC LIMIT 3')
            tasks = cursor.fetchall()
            print('📝 Последние заявки:')
            for task in tasks:
                print(f'   - Пользователь {task[0]}: {task[1]} звёзд ({task[2]})')
    except Exception as e:
        print(f'⚠️ Ошибка чтения заданий: {e}')
    
    conn.close()
else:
    print('❌ База данных агента не найдена!')
"`, { encoding: 'utf8' });

        console.log('   ' + dbCheck.trim().replace(/\n/g, '\n   '));
    } catch (error) {
        console.log(`   ❌ Ошибка проверки БД: ${error.message}`);
    }

    // 3. Проверка процессов
    console.log('\n⚡ 3. ПРОВЕРКА ПРОЦЕССОВ:');
    try {
        const processes = execSync('ps aux | grep -E "(node|python)" | grep -v grep', { encoding: 'utf8' });
        const lines = processes.split('\\n').filter(line => line.trim());
        
        console.log(`   📟 Найдено ${lines.length} процессов:`);
        lines.forEach((line, index) => {
            if (line.includes('index.js')) {
                console.log(`   ✅ ${index + 1}. Основной бот: ${line.split(/\\s+/).slice(10).join(' ')}`);
            } else if (line.includes('userbot-agent.py')) {
                console.log(`   ✅ ${index + 1}. Агент: ${line.split(/\\s+/).slice(10).join(' ')}`);
            } else {
                console.log(`   📄 ${index + 1}. ${line.split(/\\s+/).slice(10).join(' ')}`);
            }
        });
    } catch (error) {
        console.log(`   ���️ Не удалось получить список процессов: ${error.message}`);
    }

    // 4. Проверка логов агента
    console.log('\\n📝 4. ПОСЛЕДНИЕ ЛОГИ АГЕНТА:');
    try {
        const fs = require('fs');
        if (fs.existsSync('userbot-agent.log')) {
            const logs = fs.readFileSync('userbot-agent.log', 'utf8');
            const lines = logs.split('\\n').filter(line => line.trim());
            
            console.log('   📄 Последние 5 строк логов:');
            lines.slice(-5).forEach(line => {
                if (line.includes('✅') || line.includes('Авторизован')) {
                    console.log(`   ✅ ${line.trim()}`);
                } else if (line.includes('❌') || line.includes('ERROR')) {
                    console.log(`   ❌ ${line.trim()}`);
                } else if (line.includes('⚠️') || line.includes('WARNING')) {
                    console.log(`   ⚠️ ${line.trim()}`);
                } else {
                    console.log(`   📄 ${line.trim()}`);
                }
            });
        } else {
            console.log('   ❌ Файл логов агента не найден');
        }
    } catch (error) {
        console.log(`   ❌ Ошибка чтения логов: ${error.message}`);
    }

    // 5. Рекомендации
    console.log('\\n🎯 5. РЕКОМЕНДАЦИИ:');
    console.log('   💡 Если заявки не обрабатываются автоматически:');
    console.log('   1. Создайте тестовую заявку на вывод 5-10 звёзд');
    console.log('   2. Проверьте что заявка попала в БД агента');
    console.log('   3. Убедитесь что агент работает в рабочие часы (00:00-23:00)');
    console.log('   4. Проверьте логи агента на ошибки');
    console.log('   5. При необходимости используйте /agent_stats в боте');

    console.log('\\n✅ ПРОВЕРКА ИНТЕГРАЦИИ ЗАВЕРШЕНА');
}

checkIntegration().catch(console.error);
