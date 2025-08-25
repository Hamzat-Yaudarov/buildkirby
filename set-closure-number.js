const Database = require('./database');

async function setClosureStartNumber() {
    try {
        console.log('🔧 Установка начального номера для закрытых заявок...');
        
        await Database.init();
        
        // Устанавливаем начальное значение 438 (следующая заявка будет #438)
        const result = await Database.setWithdrawalClosureStartNumber(438);
        
        if (result.success) {
            console.log('✅ Успешно установлен начальный номер для закрытых заявок!');
            console.log(`📊 Следующая закрытая заявка будет иметь номер: ${result.nextClosureNumber}`);
        } else {
            console.error('❌ Ошибка установки:', result.error);
        }
        
    } catch (error) {
        console.error('❌ Критическая ошибка:', error);
    } finally {
        await Database.pool.end();
        console.log('🔚 Работа завершена');
    }
}

// Запускаем скрипт
setClosureStartNumber();
