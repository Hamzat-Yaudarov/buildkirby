#!/usr/bin/env node

/**
 * СКРИПТ ДЛЯ ОТПРАВКИ НАПОМИНАНИЙ ПОЛЬЗОВАТЕЛЯМ НА RAILWAY
 * 
 * Этот скрипт находит пользователей, которые не прошли капчу или не подписались на спонсоров,
 * и отправляет им сообщение "Напоминание о рейтинге"
 * 
 * ИСПОЛЬЗОВАНИЕ:
 * 1. Все пользователи с проблемами: node railway-reminder-script.js
 * 2. Конкретные ID: node railway-reminder-script.js 123456789 987654321
 * 3. Из файла: node railway-reminder-script.js user_ids.txt
 */

const { findAndMessageFailedUsers } = require('./find-failed-users');
const { sendReminderToUserIds, sendReminderFromFile } = require('./send-reminder-by-ids');
const { sendReminderWithDbSave, sendRemindersToFailedUsersWithSave } = require('./save-users-on-message');

async function main() {
    try {
        const args = process.argv.slice(2);
        
        console.log('🌟 ===== СКРИПТ ОТПРАВКИ НАПОМИНАНИЙ О РЕЙТИНГЕ =====\n');
        console.log('📅 Время запуска:', new Date().toLocaleString('ru-RU'));
        console.log('🖥️  Платформа: Railway');
        console.log('🤖 Бот: Звездный заработок\n');

        if (args.length === 0) {
            // Режим 1: Найти всех пользователей с проблемами автоматически + АВТОСОХРАНЕНИЕ
            console.log('🔍 РЕЖИМ 1: Автоматический поиск всех пользователей с проблемами');
            console.log('   ↳ Ищем пользователей, которые:');
            console.log('     • НЕ прошли капчу (captcha_passed = false)');
            console.log('     • Прошли капчу, но НЕ активированы (возможные проблемы с подпиской)');
            console.log('   ↳ ДОПОЛНИТЕЛЬНО: Автоматически сохраняем в БД пользователей из логов\n');

            await sendRemindersToFailedUsersWithSave();
            
        } else if (args.length === 1 && args[0].endsWith('.txt')) {
            // Режим 2: ��тение ID из файла + АВТОСОХРАНЕНИЕ
            console.log('📁 РЕЖИМ 2: Чтение ID пользователей из файла');
            console.log(`   ↳ Файл: ${args[0]}`);
            console.log('   ↳ ДОПОЛНИТЕЛЬНО: Автоматически сохраняем в БД пользователей из логов\n');

            // Читаем файл и используем улучшенную функцию
            const fs = require('fs');
            if (!fs.existsSync(args[0])) {
                console.log(`❌ Файл ${args[0]} не найден`);
                process.exit(1);
            }

            const fileContent = fs.readFileSync(args[0], 'utf8');
            const userIds = fileContent
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !isNaN(line))
                .map(line => parseInt(line));

            console.log(`📊 Загружено ${userIds.length} ID пользователей из файла`);
            await sendReminderWithDbSave(userIds);
            
        } else {
            // Режим 3: Конкретные ID из аргументов
            const userIds = args.map(id => parseInt(id)).filter(id => !isNaN(id));
            
            if (userIds.length === 0) {
                console.log('❌ Не найдено валидных ID пользователей в аргументах');
                console.log('\nПРИМЕРЫ ИСПОЛЬЗОВАНИЯ:');
                console.log('node railway-reminder-script.js');
                console.log('node railway-reminder-script.js 123456789 987654321');
                console.log('node railway-reminder-script.js user_ids.txt');
                process.exit(1);
            }

            console.log('👤 РЕЖИМ 3: Конкретные ID пользователей');
            console.log(`   ↳ Количество ID: ${userIds.length}`);
            console.log(`   ↳ ID пользователей: ${userIds.join(', ')}`);
            console.log('   ↳ ДОПОЛНИТЕЛЬНО: Автоматически сохраняем в БД пользователей из логов\n');

            await sendReminderWithDbSave(userIds);
        }

        console.log('\n🎉 ===== СКРИПТ ЗАВЕРШЕН УСПЕШНО =====');

    } catch (error) {
        console.error('\n❌ ===== ОШИБКА ВЫПОЛНЕНИЯ СКРИПТА =====');
        console.error('Время ошибки:', new Date().toLocaleString('ru-RU'));
        console.error('Детали ошибки:', error);
        
        // Даем подробную информацию об ошибке для отладки
        if (error.stack) {
            console.error('\nСтек вызовов:');
            console.error(error.stack);
        }
        
        process.exit(1);
    }
}

// Обработка сигналов завершения
process.on('SIGINT', () => {
    console.log('\n⚠️  Получен сигнал SIGINT (Ctrl+C). Завершение работы...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n⚠️  Получен сигнал SIGTERM. Завершение работы...');
    process.exit(0);
});

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n❌ НЕОБРАБОТАННОЕ ОТКЛОНЕНИЕ ПРОМИСА:');
    console.error('Promise:', promise);
    console.error('Reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('\n❌ НЕОБРАБОТАННОЕ ИСКЛЮЧЕНИЕ:');
    console.error(error);
    process.exit(1);
});

// Запуск основной функции
if (require.main === module) {
    main();
}

module.exports = { main };
