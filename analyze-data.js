const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

function analyzeData() {
    const dataDir = './xlsx-data';
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));
    
    console.log('📊 АНАЛИЗ ДАННЫХ ДЛЯ МИГРАЦИИ:\n');
    
    let totalStats = {
        users: 0,
        tasks: 0,
        userTasks: 0,
        withdrawals: 0,
        promocodes: 0,
        subgramTasks: 0
    };
    
    files.forEach(file => {
        try {
            const filePath = path.join(dataDir, file);
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`📋 ${file}:`);
            console.log(`   📊 Записей: ${data.length}`);
            
            // Сохраняем статистику
            const tableName = file.replace('.xlsx', '');
            if (tableName === 'users') totalStats.users = data.length;
            if (tableName === 'tasks') totalStats.tasks = data.length;
            if (tableName === 'user_tasks') totalStats.userTasks = data.length;
            if (tableName === 'withdrawal_requests') totalStats.withdrawals = data.length;
            if (tableName === 'promocodes') totalStats.promocodes = data.length;
            if (tableName === 'subgram_tasks') totalStats.subgramTasks = data.length;
            
            if (data.length > 0) {
                const firstRow = data[0];
                
                // Специальный анализ для пользователей
                if (tableName === 'users') {
                    const usersWithBalance = data.filter(u => parseFloat(u.balance) > 0).length;
                    const usersWithReferrals = data.filter(u => parseInt(u.total_referrals) > 0).length;
                    const premiumUsers = data.filter(u => u.is_premium === true || u.is_premium === 'true').length;
                    
                    console.log(`   💰 С балансом > 0: ${usersWithBalance}`);
                    console.log(`   👥 С рефералами: ${usersWithReferrals}`);
                    console.log(`   ⭐ Премиум: ${premiumUsers}`);
                    
                    // Проверяем даты
                    const datesFound = data.filter(u => u.created_at);
                    if (datesFound.length > 0) {
                        const dates = datesFound.map(u => new Date(u.created_at)).filter(d => !isNaN(d));
                        if (dates.length > 0) {
                            const minDate = new Date(Math.min(...dates));
                            const maxDate = new Date(Math.max(...dates));
                            console.log(`   📅 Период: ${minDate.toLocaleDateString()} - ${maxDate.toLocaleDateString()}`);
                        }
                    }
                }
                
                // Специальный анализ для заявок на вывод
                if (tableName === 'withdrawal_requests') {
                    const pending = data.filter(w => w.status === 'pending').length;
                    const approved = data.filter(w => w.status === 'approved').length;
                    const rejected = data.filter(w => w.status === 'rejected').length;
                    
                    console.log(`   ⏳ В ожидании: ${pending}`);
                    console.log(`   ✅ Одобрено: ${approved}`);
                    console.log(`   ❌ Отклонено: ${rejected}`);
                }
            }
            console.log('');
            
        } catch (error) {
            console.log(`❌ Ошибка чтения ${file}: ${error.message}\n`);
        }
    });
    
    console.log('🎯 ИТОГОВАЯ СТАТИСТИКА:');
    console.log(`   👥 Пользователей: ${totalStats.users}`);
    console.log(`   📋 Заданий: ${totalStats.tasks}`);
    console.log(`   ✅ Выполненных заданий: ${totalStats.userTasks}`);
    console.log(`   💸 Заявок на вывод: ${totalStats.withdrawals}`);
    console.log(`   🎫 Промокодов: ${totalStats.promocodes}`);
    console.log(`   📺 SubGram заданий: ${totalStats.subgramTasks}`);
    
    console.log('\n💡 РЕКОМЕНДАЦИИ:');
    if (totalStats.users < 3000) {
        console.log('   ⚠️ Количество пользователей меньше ожидаемого');
        console.log('   📋 Возможные причины: данные от 26.08, не все экспортировались');
    } else {
        console.log('   ✅ Количество пользователей нормальное для бекапа от 26.08');
    }
}

analyzeData();
