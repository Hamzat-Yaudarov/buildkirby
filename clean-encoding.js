#!/usr/bin/env node
/**
 * Простой скрипт для очистки символов замещения
 */

const fs = require('fs');

function cleanFile(filePath) {
    console.log(`Очистка файла: ${filePath}`);
    
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let originalLength = content.length;
        
        // Подсчитаем количество проблемных символов
        const badCharsRegex = /\uFFFD/g; // Unicode replacement character
        const matches = content.match(badCharsRegex);
        const badCharsCount = matches ? matches.length : 0;
        
        // Удаляем все символы замещения
        content = content.replace(/\uFFFD+/g, '');
        
        // Исправляем конкретные проблемы
        const fixes = [
            ['Пригл\uFFFD\uFFFDсить', 'Пригласить'],
            ['розыг\uFFFD\uFFFDышах', 'розыгрышах'],
            ['н\uFFFD\uFFFDт', 'нет'],
            ['сохра\uFFFD\uFFFDены', 'сохранены'],
            ['Л\uFFFD\uFFFDтерея', 'Лотерея'],
            ['распреде\uFFFD\uFFFDены', 'распределены'],
            ['\uFFFD\uFFFDайден', 'найден'],
            ['\uFFFD\uFFFDанал', 'Канал'],
            ['созда\uFFFD\uFFFDа', 'создана'],
            ['часо\uFFFD\uFFFD', 'часов'],
            ['пригл\uFFFD\uFFFDсить', 'пригласить'],
            ['по\uFFFD\uFFFDьзователям', 'пользователям'],
            ['д\uFFFD\uFFFDузей', 'друзей'],
            ['биле\uFFFD\uFFFD', 'билет'],
            ['Побе\uFFFD\uFFFDители', 'Победители'],
            ['Использо\uFFFD\uFFFDаний', 'Использований'],
            ['приглаша\uFFFD\uFFFD', 'приглашать'],
            ['\uFFFD\uFFFDапускаю', 'Запускаю'],
            ['функциона\uFFFD\uFFFDьность', 'функциональность'],
            ['обра\uFFFD\uFFFDотка', 'обработка'],
            ['\uFFFD\uFFFDроизошла', 'Произошла'],
            ['Н\uFFFD\uFFFDграда', 'Награда'],
            ['персональ\uFFFD\uFFFDый', 'персональный'],
            ['\uFFFD\uFFFDриглашайте', 'Приглашайте'],
            ['формиров\uFFFD\uFFFDния', 'формирования'],
            ['Подписк\uFFFD\uFFFD', 'Подписка'],
            ['рейтин\uFFFD\uFFFDа', 'рейтинга'],
            ['П\uFFFD\uFFFDльзователей', 'Пользователей'],
            ['О\uFFFD\uFFFDщий', 'Общий'],
            ['Ук\uFFFD\uFFFDжите', 'Укажите'],
            ['расс\uFFFD\uFFFDлку', 'рассылку'],
            ['бу\uFFFD\uFFFDет', 'будет'],
            ['сообщ\uFFFD\uFFFDние', 'сообщение'],
            ['Н\uFFFD\uFFFDграды', 'Награды'],
            ['по\uFFFD\uFFFDьзователей', 'пользователей'],
            ['отключе\uFFFD\uFFFDа', 'отключена'],
            ['обр\uFFFD\uFFFDботка', 'обработка'],
            ['заяв\uFFFD\uFFFDок', 'заявок'],
            ['а\uFFFD\uFFFDтомат', 'автомат'],
            ['Р\uFFFD\uFFFDкомендуемые', 'Рекомендуемые'],
            ['безоп\uFFFD\uFFFDсные', 'безопасные'],
            ['пр\uFFFD\uFFFDцессе', 'процессе'],
            ['Отпр\uFFFD\uFFFDвлено', 'Отправлено']
        ];
        
        for (const [broken, fixed] of fixes) {
            content = content.replace(new RegExp(broken, 'g'), fixed);
        }
        
        // Также заменим эмодзи коды
        content = content.replace(/\uFFFD\uFFFD\uFFFD/g, '🎉');
        content = content.replace(/\uFFFD\uFFFD\uFFFD Telegram/g, '🔥 Telegram');
        content = content.replace(/\uFFFD\uFFFD\uFFFD \*\*Советы:\*\*/g, '💡 **Советы:**');
        
        fs.writeFileSync(filePath, content, 'utf8');
        
        console.log(`✅ Удалено ${badCharsCount} проблемных символов`);
        console.log(`✅ Размер изменился с ${originalLength} до ${content.length} символов`);
        
    } catch (error) {
        console.error(`❌ О��ибка: ${error.message}`);
    }
}

// Очищаем index.js
cleanFile('index.js');

console.log('\n✅ Очистка завершена!');
