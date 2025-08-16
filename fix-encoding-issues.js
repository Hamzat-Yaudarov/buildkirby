#!/usr/bin/env node
/**
 * Скрипт для исправления проблем с кодировкой в файлах
 */

const fs = require('fs');
const path = require('path');

// Карта замен для исправления кодировки
const encodingFixes = {
    // Основные проблемные символы
    '��': '',  // Удаляем символы замещения
    '���': '⭐',  // Звезда
    '��ы': 'ы',   // Окончание 'ы'
    '��а': 'а',   // Окончание 'а' 
    '��е': 'е',   // Окончание 'е'
    '��и': 'и',   // Окончание 'и'
    '��о': 'о',   // Окончание 'о'
    '��у': 'у',   // Окончание 'у'
    '��т': 'т',   // Окончание 'т'
    '��н': 'н',   // Окончание 'н'
    '��к': 'к',   // Окончание 'к'
    '��л': 'л',   // Окончание 'л'
    '��м': 'м',   // Окончание 'м'
    '��р': 'р',   // Окончание 'р'
    '��с': 'с',   // Окончание 'с'
    '��в': 'в',   // Окончание 'в'
    '��з': 'з',   // Окончание 'з'
    '��г': 'г',   // Окончание 'г'
    '��д': 'д',   // Окончание 'д'
    '��ф': 'ф',   // Окончание 'ф'
    '��ь': 'ь',   // Мягкий знак
    '��ъ': 'ъ',   // Твердый знак
    '��й': 'й',   // Й
    '��ц': 'ц',   // Ц
    '��ч': 'ч',   // Ч
    '��ш': 'ш',   // Ш
    '��щ': 'щ',   // Щ
    '��ю': 'ю',   // Ю
    '��я': 'я',   // Я
    '��ё': 'ё',   // Ё
    '��ж': 'ж',   // Ж
    '��х': 'х',   // Х
    '��п': 'п',   // П
    '��б': 'б',   // Б
    
    // Исправления для конкретных слов
    'Пригл��сить': 'Пригласить',
    'розыг��ышах': 'розыгрышах', 
    'н��т': 'нет',
    'сохра��ены': 'сохранены',
    'Л��терея': 'Лотерея',
    'распреде��ены': 'распределены',
    '��айден': 'найден',
    '��анал': 'Канал',
    'созда��а': 'создана',
    'часо��': 'часов',
    'пригл��сить': 'пригласить',
    'по��ьзователям': 'пользователям',
    'д��узей': 'друзей',
    'биле��': 'билет',
    'Побе��ители': 'Победители',
    'Использо��аний': 'Использований',
    'приглаша��': 'приглашать',
    '��апускаю': 'Запускаю',
    'функциона��ьность': 'функциональность',
    'обра��отка': 'обработка',
    '��роизошла': 'Произошла',
    'Н��града': 'Награда',
    'персональ��ый': 'персональный',
    '��риглашайте': 'Приглашайте',
    'формиров��ния': 'формирования',
    'Подписк��': 'Подписка',
    '��� Telegram': '🔥 Telegram',
    '��� **Советы:**': '💡 **Советы:**',
    'рейтин��а': 'рейтинга',
    'П��льзователей': 'Пользователей',
    'О��щий': 'Общий', 
    'Ук��жите': 'Укажите',
    'расс��лку': 'рассылку',
    'бу��ет': 'будет',
    'сообщ��ние': 'сообщение',
    '����': '🎉',
    'Н��грады': 'Награды',
    'по��ьзователей': 'пользователей',
    'отключе��а': 'отключена',
    'обр��ботка': 'обработка',
    'заяв��ок': 'заявок',
    'а��томат': 'автомат',
    'Р��комендуемые': 'Рекомендуемые',
    'безоп��сные': 'безопасные',
    'пр��цессе': 'процессе',
    'Отпр��влено': 'Отправлено',
    
    // Эмодзи исправления
    '����': '🎯',
    '��': '⚠️',
    '����': '🔧',
    '����': '✅'
};

function fixEncodingInFile(filePath) {
    console.log(`Исправление кодировки в файле: ${filePath}`);
    
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalContent = content;
        let changesCount = 0;
        
        // Применяем все исправления
        for (const [broken, fixed] of Object.entries(encodingFixes)) {
            const regex = new RegExp(broken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            const matches = content.match(regex);
            if (matches) {
                content = content.replace(regex, fixed);
                changesCount += matches.length;
                console.log(`  Заменено "${broken}" → "${fixed}" (${matches.length} раз)`);
            }
        }
        
        // Дополнительная очистка одиночных символов замещения
        const singleReplacementRegex = /��/g;
        const singleMatches = content.match(singleReplacementRegex);
        if (singleMatches) {
            content = content.replace(singleReplacementRegex, '');
            changesCount += singleMatches.length;
            console.log(`  Удалено одиночных символов замещения: ${singleMatches.length}`);
        }
        
        if (changesCount > 0) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Исправлено ${changesCount} проблем в ${filePath}`);
            return changesCount;
        } else {
            console.log(`✅ Пр��блем с кодировкой не найдено в ${filePath}`);
            return 0;
        }
        
    } catch (error) {
        console.error(`❌ Ошибка при обработке ${filePath}:`, error.message);
        return 0;
    }
}

function fixEncodingInDirectory(dirPath, extensions = ['.js']) {
    console.log(`Поиск файлов в директории: ${dirPath}\n`);
    
    let totalFixes = 0;
    const files = fs.readdirSync(dirPath);
    
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile() && extensions.some(ext => file.endsWith(ext))) {
            totalFixes += fixEncodingInFile(filePath);
            console.log(''); // Пустая строка для разделения
        }
    }
    
    console.log(`\n🎉 Всего исправлено проблем: ${totalFixes}`);
    return totalFixes;
}

// Запуск скрипта
if (require.main === module) {
    console.log('🔧 Запуск исправления проблем с кодировкой...\n');
    
    // Исправляем файлы в текущей директории
    const currentDir = process.cwd();
    const fixes = fixEncodingInDirectory(currentDir, ['.js', '.md']);
    
    if (fixes > 0) {
        console.log('\n✅ Исправление завершено! Проверьте изменения в файлах.');
    } else {
        console.log('\n✅ Все файлы уже в порядке!');
    }
}

module.exports = { fixEncodingInFile, fixEncodingInDirectory, encodingFixes };
