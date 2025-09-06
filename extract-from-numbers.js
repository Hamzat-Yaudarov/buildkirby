#!/usr/bin/env node

/**
 * РАБОТА С ФАЙЛОМ APPLE NUMBERS (.numbers)
 * 
 * Файл "Логи из Railway.numbers" - это формат Apple Numbers
 * Данный скрипт не может напрямую читать .numbers файлы, 
 * но предоставляет инструкции и альтернативы
 */

console.log('🍎 ===== РАБОТА С ФАЙЛОМ APPLE NUMBERS =====\n');

console.log('❌ ПРОБЛЕМА:');
console.log('   Файл "Логи из Railway.numbers" в формате Apple Numbers');
console.log('   Node.js не может напрямую читать файлы .numbers\n');

console.log('✅ РЕШЕНИЯ:\n');

console.log('🔄 ВАРИАНТ 1: ЭКСПОРТ В CSV/TXT');
console.log('   1. Откройте файл в Apple Numbers');
console.log('   2. Меню → Файл → Экспорт → CSV или TXT');
console.log('   3. Сохраните как "railway_logs.csv"');
console.log('   4. Запустите: node parse-railway-logs.js railway_logs.csv\n');

console.log('📋 ВАРИАНТ 2: КОПИРОВАНИЕ ДАННЫХ');
console.log('   1. Откройте файл в Apple Numbers');
console.log('   2. Выделите столбец с ID пользователей');
console.log('   3. Копируйте (Cmd+C)');
console.log('   4. Создайте файл user_ids.txt и вставьте данные');
console.log('   5. Запустите: node railway-reminder-script.js user_ids.txt\n');

console.log('🌐 ВАРИАНТ 3: GOOGLE SHEETS');
console.log('   1. Загрузите файл в Google Sheets');
console.log('   2. Экспортируйте как CSV');
console.log('   3. Запустите: node parse-railway-logs.js exported_file.csv\n');

console.log('⚡ ВАРИАНТ 4: АВТОМАТИЧЕСКОЕ ИЗВЛЕЧЕНИЕ (ЕСЛИ ЕСТЬ ТЕКСТОВЫЕ ЛОГИ)');
console.log('   Если у вас есть текстовые логи Railway, используйте:');
console.log('   node parse-railway-logs.js railway_logs.txt\n');

console.log('📊 КАКИЕ ДАННЫЕ НУЖНЫ:');
console.log('   • ID пользователей (числа от 100000 до 9999999999)');
console.log('   • Можно в любом формате: CSV, TXT, JSON');
console.log('   • Парсер автоматически найдет и извлечет все ID\n');

console.log('🔍 ПРИМЕР СТРУКТУРЫ ДАННЫХ:');
console.log('   user_id,action,timestamp');
console.log('   123456789,captcha_failed,2024-01-01');
console.log('   987654321,subscription_failed,2024-01-01');
console.log('   555444333,not_subscribed,2024-01-01\n');

console.log('💡 РЕКОМЕНДАЦИИ:');
console.log('   1. Экспортируйте .numbers файл в CSV формат');
console.log('   2. Используйте parse-railway-logs.js для автоматического извлечения ID');
console.log('   3. Запустите railway-reminder-script.js с полученным файлом\n');

// Функция для создания примера файла
function createExampleFile() {
    const fs = require('fs');
    
    const exampleData = `user_id,status,reason
123456789,failed,captcha_not_passed
987654321,failed,subscription_incomplete
555444333,failed,not_subscribed
111222333,failed,captcha_timeout
444555666,failed,sponsor_channels_not_joined`;

    try {
        fs.writeFileSync('example_user_ids.csv', exampleData, 'utf8');
        console.log('📁 Создан пример файла: example_user_ids.csv');
        console.log('   Используйте как шаблон для ваших данных\n');
    } catch (error) {
        console.error('❌ Ошибка создания примера файла:', error.message);
    }
}

// Функция для быстрого создания файла с ID
function createQuickIdFile() {
    const readline = require('readline');
    const fs = require('fs');
    
    console.log('⚡ БЫСТРОЕ СОЗДАНИЕ ФАЙЛА С ID');
    console.log('   Вставьте ID пользователей (по одному на строку)');
    console.log('   Для завершения введите пустую строку\n');
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const userIds = [];
    
    function askForId() {
        rl.question('ID пользователя (или Enter для завершения): ', (answer) => {
            if (!answer.trim()) {
                // Завершение ввода
                if (userIds.length > 0) {
                    const filename = 'manual_user_ids.txt';
                    fs.writeFileSync(filename, userIds.join('\n'), 'utf8');
                    console.log(`\n✅ Создан файл: ${filename}`);
                    console.log(`📊 Всего ID: ${userIds.length}`);
                    console.log(`🚀 Запустите: node railway-reminder-script.js ${filename}`);
                } else {
                    console.log('❌ ID не были введены');
                }
                rl.close();
                return;
            }
            
            const userId = parseInt(answer.trim());
            if (isNaN(userId) || userId < 100000 || userId > 9999999999) {
                console.log('❌ Неверный формат ID. Должно быть число от 100000 до 9999999999');
                askForId();
                return;
            }
            
            if (userIds.includes(userId)) {
                console.log('⚠️ ID уже добавлен');
            } else {
                userIds.push(userId);
                console.log(`✅ Добавлен ID: ${userId} (всего: ${userIds.length})`);
            }
            
            askForId();
        });
    }
    
    askForId();
}

// Главная функция
function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--example')) {
        createExampleFile();
    } else if (args.includes('--manual')) {
        createQuickIdFile();
    } else {
        console.log('🛠️ ДОПОЛНИТЕЛЬНЫЕ КОМАНДЫ:');
        console.log('   node extract-from-numbers.js --example  # Создать пример файла');
        console.log('   node extract-from-numbers.js --manual   # Ручной ввод ID');
    }
}

if (require.main === module) {
    main();
}
