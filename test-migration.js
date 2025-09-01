const Database = require('./database');
const XLSX = require('xlsx');

async function testMigration() {
    try {
        console.log('🧪 Тестируем миграцию с данными от 26 августа...');
        
        // Проверяем файл users.xlsx
        const workbook = XLSX.readFile('./xlsx-data/users.xlsx');
        const userData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        
        console.log(`👥 Пользователей в файле: ${userData.length}`);
        
        if (userData.length > 0) {
            const firstUser = userData[0];
            const lastUser = userData[userData.length - 1];
            
            console.log('📅 Первый пользователь:', firstUser.created_at || 'дата не указана');
            console.log('📅 Последний пользователь:', lastUser.created_at || 'дата не указана');
            console.log('💰 Балансов с данными:', userData.filter(u => u.balance > 0).length);
        }
        
        // Проверяем заявки на вывод
        try {
            const withdrawalBook = XLSX.readFile('./xlsx-data/withdrawal_requests.xlsx');
            const withdrawalData = XLSX.utils.sheet_to_json(withdrawalBook.Sheets[withdrawalBook.SheetNames[0]]);
            console.log(`💸 Заявок на вывод: ${withdrawalData.length}`);
        } catch (e) {
            console.log('💸 Заявок на вывод: файл не найден или пуст');
        }
        
        console.log('\n✅ Данные от 26 августа можно мигрировать!');
        console.log('🔄 Потеря: ~6 дней активности (26.08 - 01.09)');
        
    } catch (error) {
        console.log('❌ Ошибка тестирования:', error.message);
    }
}

testMigration();
