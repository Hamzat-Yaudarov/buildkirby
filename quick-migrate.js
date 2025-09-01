const XlsxMigration = require('./migrate-from-xlsx.js');

async function quickMigrate() {
    try {
        console.log('🚀 СРОЧНАЯ МИГРАЦИЯ: Восстанавливаем данные от 26 августа');
        console.log('📋 Это лучше чем потерять ВСЕ данные!\n');
        
        const migration = new (require('./migrate-from-xlsx.js'));
        await migration.migrate();
        
        console.log('\n🎉 ВОССТАНОВЛЕНИЕ ЗАВЕРШЕНО!');
        console.log('📊 Что восстановлено:');
        console.log('  ✅ Пользователи с балансами от 26.08');
        console.log('  ✅ Задания и выполненные задания');  
        console.log('  ✅ Заявки на вывод');
        console.log('  ✅ Промокоды и их использования');
        console.log('  ✅ Спонсорские каналы и статистика');
        
        console.log('\n⚠️ Что потеряно:');
        console.log('  ❌ Новые пользователи (26.08 - 01.09)');
        console.log('  ❌ Активность за последние 6 дней');
        
        console.log('\n🚀 Что делать дальше:');
        console.log('  1. npm start - запустить бота');
        console.log('  2. Проверить работу всех функций');
        console.log('  3. Уведомить пользователей о техработах');
        
    } catch (error) {
        console.error('\n❌ ОШИБКА МИГРАЦИИ:', error.message);
        console.log('\n🔧 Проверьте:');
        console.log('  1. DATABASE_URL в config.js');
        console.log('  2. Подключение к новой БД');
        console.log('  3. Файлы в папке xlsx-data/');
    }
}

quickMigrate();
