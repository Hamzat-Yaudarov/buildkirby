#!/usr/bin/env node
/**
 * Диагностический скрипт для проверки работы бота и агента
 */

const { execSync } = require('child_process');
const fs = require('fs');

console.log('🔍 ДИАГНОСТИКА ДЕПЛОЯ НА RAILWAY\n');

// 1. Проверка основных переменных окружения
console.log('📋 1. ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ:');
const envVars = ['BOT_TOKEN', 'DATABASE_URL', 'NODE_ENV'];
envVars.forEach(varName => {
    const value = process.env[varName];
    console.log(`   ${varName}: ${value ? '✅ установлено' : '❌ НЕ УСТАНОВЛЕНО'}`);
});

// 2. Проверка файлов
console.log('\n📁 2. ФАЙЛЫ СИСТЕМЫ:');
const requiredFiles = [
    'index.js', 'database.js', 'userbot-agent.py', 
    'agent-integration.js', 'requirements.txt'
];

requiredFiles.forEach(file => {
    const exists = fs.existsSync(file);
    console.log(`   ${file}: ${exists ? '✅ найден' : '❌ отсутствует'}`);
});

// 3. Проверка Python зависимостей
console.log('\n🐍 3. PYTHON ЗАВИСИМОСТИ:');
try {
    const pythonVersion = execSync('python3 --version', { encoding: 'utf8' }).trim();
    console.log(`   Python: ✅ ${pythonVersion}`);
    
    try {
        execSync('python3 -c "import pyrogram; print(pyrogram.__version__)"', { encoding: 'utf8' });
        console.log('   Pyrogram: ✅ установлен');
    } catch (e) {
        console.log('   Pyrogram: ❌ НЕ УСТАНОВЛЕН');
    }
} catch (e) {
    console.log('   Python: ❌ НЕ НАЙДЕН');
}

// 4. Проверка базы данных
console.log('\n💾 4. БАЗА ДАННЫХ:');
if (process.env.DATABASE_URL) {
    try {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });
        
        pool.query('SELECT NOW()', (err, res) => {
            if (err) {
                console.log('   Подключение: ❌ ошибка -', err.message);
            } else {
                console.log('   Подключение: ✅ успешно');
            }
            pool.end();
        });
    } catch (e) {
        console.log('   Подключение: ❌ ошибка -', e.message);
    }
} else {
    console.log('   DATABASE_URL: ❌ не установлен');
}

// 5. Статус процессов
console.log('\n⚡ 5. ПРОЦЕССЫ:');
try {
    const processes = execSync('ps aux | grep -E "(node|python)" | grep -v grep', { encoding: 'utf8' });
    console.log('   Активные процессы:');
    processes.split('\n').filter(line => line.trim()).forEach(line => {
        console.log(`   📟 ${line.trim()}`);
    });
} catch (e) {
    console.log('   Процессы: ❌ ошибка получения списка');
}

console.log('\n🏁 ДИАГНОСТИКА ЗАВЕРШЕНА\n');
