const Database = require('./database');

async function setNumbering521() {
    try {
        console.log('🔢 Устанавливаем нумерацию заявок на вывод с 521...');
        
        // Используем существующий метод для установки начального номера
        const result = await Database.setWithdrawalStartNumber(521);
        
        if (result.success) {
            console.log('✅ ГОТОВО! Нумерация заявок на вывод установлена с 521');
            console.log(`📊 Предыдущее значение: ${result.previousValue}`);
            console.log(`📊 Новое значение: ${result.newValue}`);
            console.log(`🆔 Следующая заявка получит номер: ${result.nextWithdrawalId}`);
        } else {
            console.log('❌ Ошибка:', result.error);
        }
        
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
        process.exit(1);
    }
}

setNumbering521();
