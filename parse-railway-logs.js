#!/usr/bin/env node

/**
 * СКРИПТ ДЛЯ АВТОМАТИЧЕСКОГО ПАРСИНГА ЛОГОВ RAILWAY
 * 
 * Автоматически извлекает ID пользователей из различных форматов логов:
 * - Текстовые логи Railway
 * - CSV файлы
 * - JSON логи
 * - Логи в формате Telegram Bot API
 */

const fs = require('fs');
const path = require('path');

// Паттерны для поиска пользовательских ID в логах
const USER_ID_PATTERNS = [
    // Telegram user ID patterns
    /user[_\s]*id[:\s]*(\d{6,15})/gi,
    /userId[:\s]*(\d{6,15})/gi,
    /from[:\s]*(\d{6,15})/gi,
    /chat[_\s]*id[:\s]*(\d{6,15})/gi,
    /chatId[:\s]*(\d{6,15})/gi,
    
    // Общие паттерны ID
    /"id"[:\s]*(\d{6,15})/gi,
    /'id'[:\s]*(\d{6,15})/gi,
    /\bid[:\s]*(\d{6,15})/gi,
    
    // Паттерны для логов бота
    /пользовател[ьяе][^\d]*(\d{6,15})/gi,
    /user[^\d]*(\d{6,15})/gi,
    /от пользователя[^\d]*(\d{6,15})/gi,
    
    // Паттерны для Telegram Bot API логов
    /"from":\s*{"id":(\d{6,15})/gi,
    /"chat":\s*{"id":(\d{6,15})/gi,
    /"user_id"[:\s]*(\d{6,15})/gi,
    
    // Капча и подписки
    /капч[аеу][^\d]*(\d{6,15})/gi,
    /подписк[аеу][^\d]*(\d{6,15})/gi,
    /subscription[^\d]*(\d{6,15})/gi,
    /captcha[^\d]*(\d{6,15})/gi,
];

// Функция для извлечения всех ID из текста
function extractUserIds(text) {
    const userIds = new Set();
    
    for (const pattern of USER_ID_PATTERNS) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const userId = parseInt(match[1]);
            
            // Валидация Telegram User ID (обычно от 100000 до 9999999999)
            if (userId >= 100000 && userId <= 9999999999) {
                userIds.add(userId);
            }
        }
    }
    
    return Array.from(userIds).sort((a, b) => a - b);
}

// Функция для парсинга CSV файла
function parseCSV(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        const userIds = new Set();
        
        for (const line of lines) {
            // Ищем числа, которые могут быть user ID
            const numbers = line.match(/\d{6,15}/g);
            if (numbers) {
                for (const num of numbers) {
                    const userId = parseInt(num);
                    if (userId >= 100000 && userId <= 9999999999) {
                        userIds.add(userId);
                    }
                }
            }
        }
        
        return Array.from(userIds).sort((a, b) => a - b);
    } catch (error) {
        console.error(`❌ Ошибка парсинга CSV файла ${filePath}:`, error.message);
        return [];
    }
}

// Функция для парсинга JSON файла
function parseJSON(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        let jsonData;
        
        try {
            jsonData = JSON.parse(content);
        } catch {
            // Если не валидный JSON, обрабатываем как текст
            return extractUserIds(content);
        }
        
        const userIds = new Set();
        
        // Рекурсивная функция для поиска ID в JSON
        function searchInObject(obj) {
            if (typeof obj === 'object' && obj !== null) {
                for (const [key, value] of Object.entries(obj)) {
                    if ((key === 'id' || key === 'user_id' || key === 'userId' || key === 'from') && 
                        typeof value === 'number' && value >= 100000 && value <= 9999999999) {
                        userIds.add(value);
                    }
                    
                    if (typeof value === 'object') {
                        searchInObject(value);
                    } else if (Array.isArray(value)) {
                        value.forEach(searchInObject);
                    }
                }
            }
        }
        
        if (Array.isArray(jsonData)) {
            jsonData.forEach(searchInObject);
        } else {
            searchInObject(jsonData);
        }
        
        return Array.from(userIds).sort((a, b) => a - b);
    } catch (error) {
        console.error(`❌ Ошибка парсинга JSON файла ${filePath}:`, error.message);
        return [];
    }
}

// Основная функция парсинга
async function parseLogFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Файл ${filePath} не найден`);
        }
        
        const stats = fs.statSync(filePath);
        const fileSize = (stats.size / 1024 / 1024).toFixed(2); // MB
        
        console.log(`📁 Обработка файла: ${filePath}`);
        console.log(`📊 Размер файла: ${fileSize} MB`);
        
        const fileExtension = path.extname(filePath).toLowerCase();
        let userIds = [];
        
        switch (fileExtension) {
            case '.csv':
                console.log('🔍 Режим парсинга: CSV');
                userIds = parseCSV(filePath);
                break;
                
            case '.json':
                console.log('🔍 Режим парсинга: JSON');
                userIds = parseJSON(filePath);
                break;
                
            case '.txt':
            case '.log':
            case '':
            default:
                console.log('🔍 Режим парсинга: Текстовый анализ');
                const content = fs.readFileSync(filePath, 'utf8');
                userIds = extractUserIds(content);
                break;
        }
        
        console.log(`✅ Найдено уникальных ID: ${userIds.length}`);
        
        if (userIds.length === 0) {
            console.log('⚠️ Не найдено валидных пользовательских ID в файле');
            console.log('💡 Проверьте формат файла или попробуйте другой режим парсинга');
            return [];
        }
        
        // Показываем примеры найденных ID
        console.log('\n📋 Примеры найденных ID:');
        userIds.slice(0, 10).forEach((id, index) => {
            console.log(`   ${index + 1}. ${id}`);
        });
        
        if (userIds.length > 10) {
            console.log(`   ... и еще ${userIds.length - 10} ID`);
        }
        
        return userIds;
        
    } catch (error) {
        console.error(`❌ Ошибка обработки файла ${filePath}:`, error.message);
        return [];
    }
}

// Функция для сохранения ID в файл
function saveUserIds(userIds, outputFile = 'extracted_user_ids.txt') {
    try {
        const content = userIds.join('\n');
        fs.writeFileSync(outputFile, content, 'utf8');
        
        console.log(`\n💾 ID пользователей сохранены в файл: ${outputFile}`);
        console.log(`📊 Всего ID: ${userIds.length}`);
        
        return outputFile;
    } catch (error) {
        console.error(`❌ Ошибка сохранения файла ${outputFile}:`, error.message);
        return null;
    }
}

// Функция для анализа и фильтрации пользователей
async function analyzeAndFilter(userIds, filterOptions = {}) {
    const {
        excludeBlocked = false,
        onlyFailedCaptcha = false,
        onlyNotSubscribed = false
    } = filterOptions;
    
    console.log('\n🔍 АНАЛИЗ И ФИЛЬТРАЦИЯ ПОЛЬЗОВАТЕЛЕЙ');
    
    if (userIds.length === 0) {
        console.log('❌ Нет пользователей для анализа');
        return [];
    }
    
    // Здесь можно добавить проверку пользователей в БД
    console.log(`📊 Всего пользователей для анализа: ${userIds.length}`);
    
    // Группируем по диапазонам для анализа
    const ranges = {
        'Очень старые (< 1M)': userIds.filter(id => id < 1000000),
        'Старые (1M-100M)': userIds.filter(id => id >= 1000000 && id < 100000000),
        'Средние (100M-1B)': userIds.filter(id => id >= 100000000 && id < 1000000000),
        'Новые (> 1B)': userIds.filter(id => id >= 1000000000)
    };
    
    console.log('\n📈 Распределение по возрасту аккаунтов:');
    for (const [range, ids] of Object.entries(ranges)) {
        if (ids.length > 0) {
            console.log(`   ${range}: ${ids.length} пользователей`);
        }
    }
    
    return userIds;
}

// Главная функция
async function main() {
    try {
        const args = process.argv.slice(2);
        
        if (args.length === 0) {
            console.log('🚀 АВТОМАТИЧЕСКИЙ ПАРСЕР ЛОГОВ RAILWAY\n');
            console.log('ИСПОЛЬЗОВАНИЕ:');
            console.log('  node parse-railway-logs.js <файл_логов> [опции]');
            console.log('');
            console.log('ПРИМЕРЫ:');
            console.log('  node parse-railway-logs.js railway_logs.txt');
            console.log('  node parse-railway-logs.js logs.csv');
            console.log('  node parse-railway-logs.js data.json');
            console.log('  node parse-railway-logs.js *.log');
            console.log('');
            console.log('ПОДДЕРЖИВАЕМЫЕ ФОРМАТЫ:');
            console.log('  • .txt - текстовые логи');
            console.log('  • .log - файлы логов');
            console.log('  • .csv - CSV файлы');
            console.log('  • .json - JSON файлы');
            console.log('  • без расширения - автоопределение');
            return;
        }
        
        const inputFile = args[0];
        const outputFile = args[1] || 'extracted_user_ids.txt';
        
        console.log('🌟 ===== АВТОМАТИЧЕСКИЙ ПАРСЕР ЛОГОВ RAILWAY =====\n');
        console.log('📅 Время запуска:', new Date().toLocaleString('ru-RU'));
        
        // Парсим файл
        const userIds = await parseLogFile(inputFile);
        
        if (userIds.length === 0) {
            console.log('\n❌ Парсинг завершен без результатов');
            return;
        }
        
        // Анализируем пользователей
        const filteredIds = await analyzeAndFilter(userIds);
        
        // Сохраняем результат
        const savedFile = saveUserIds(filteredIds, outputFile);
        
        if (savedFile) {
            console.log('\n🎉 ПАРСИНГ ЗАВЕРШЕН УСПЕШНО!');
            console.log(`📁 Результат сохранен: ${savedFile}`);
            console.log('\n📋 СЛЕДУЮЩИЕ ШАГИ:');
            console.log(`1. Проверьте файл ${savedFile}`);
            console.log(`2. Запустите: node railway-reminder-script.js ${savedFile}`);
        }
        
    } catch (error) {
        console.error('\n❌ Ошибка выполнения:', error.message);
        process.exit(1);
    }
}

// Запуск
if (require.main === module) {
    main();
}

module.exports = {
    parseLogFile,
    extractUserIds,
    saveUserIds,
    analyzeAndFilter
};
