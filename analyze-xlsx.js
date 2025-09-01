const XLSX = require('xlsx');

async function analyzeData() {
    try {
        console.log('📊 Анализ данных в xlsx файлах...\n');
        
        // Анализ пользователей
        const usersWorkbook = XLSX.readFile('./xlsx-data/users.xlsx');
        const usersWorksheet = usersWorkbook.Sheets[usersWorkbook.SheetNames[0]];
        const usersData = XLSX.utils.sheet_to_json(usersWorksheet);
        
        console.log('👥 ПОЛЬЗОВАТЕЛИ:');
        console.log(`   Количество: ${usersData.length}`);
        if (usersData.length > 0) {
            const lastUser = usersData[usersData.length - 1];
            console.log(`   Последний пользователь: ${lastUser.user_id} (${lastUser.created_at})`);
            console.log(`   Пример баланса: ${lastUser.balance || 0}`);
        }
        
        // Анализ заявок на вывод
        const withdrawalWorkbook = XLSX.readFile('./xlsx-data/withdrawal_requests.xlsx');
        const withdrawalWorksheet = withdrawalWorkbook.Sheets[withdrawalWorkbook.SheetNames[0]];
        const withdrawalData = XLSX.utils.sheet_to_json(withdrawalWorksheet);
        
        console.log('\n💸 ЗАЯВКИ НА ВЫВОД:');
        console.log(`   Количество: ${withdrawalData.length}`);
        if (withdrawalData.length > 0) {
            const lastWithdrawal = withdrawalData[withdrawalData.length - 1];
            console.log(`   Последняя заявка: ID ${lastWithdrawal.id} (${lastWithdrawal.created_at})`);
            console.log(`   Сумма: ${lastWithdrawal.amount}`);
        }
        
        // Анализ заданий
        const tasksWorkbook = XLSX.readFile('./xlsx-data/tasks.xlsx');
        const tasksWorksheet = tasksWorkbook.Sheets[tasksWorkbook.SheetNames[0]];
        const tasksData = XLSX.utils.sheet_to_json(tasksWorksheet);
        
        console.log('\n📋 ЗАДАНИЯ:');
        console.log(`   Количество: ${tasksData.length}`);
        
        // Проверим структуру данных
        console.log('\n🔍 СТРУКТУРА ДАННЫХ:');
        if (usersData.length > 0) {
            console.log('   Поля в users.xlsx:', Object.keys(usersData[0]));
        }
        
        if (withdrawalData.length > 0) {
            console.log('   Поля в withdrawal_requests.xlsx:', Object.keys(withdrawalData[0]));
        }
        
    } catch (error) {
        console.error('❌ Ошибка анализа:', error.message);
    }
}

analyzeData();
