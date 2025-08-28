const fs = require('fs');
const path = require('path');

// Новая строка подключения к базе данных
const NEW_DATABASE_URL = 'postgresql://neondb_owner:npg_YC1S8JfBNKWg@ep-quiet-cloud-a2e7auqd-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

function updateDatabaseConfig() {
    try {
        console.log('🔧 Обновление конфигурации базы данных...');
        
        const configPath = path.join(__dirname, 'config.js');
        
        // Читаем текущий конфиг
        let configContent = fs.readFileSync(configPath, 'utf8');
        
        // Создаем резервную копию
        const backupPath = path.join(__dirname, 'config.js.backup');
        fs.writeFileSync(backupPath, configContent);
        console.log(`💾 Резервная копия сохранена: ${backupPath}`);
        
        // Заменяем DATABASE_URL
        const oldUrlPattern = /DATABASE_URL:\s*'[^']*'/;
        const newConfig = configContent.replace(oldUrlPattern, `DATABASE_URL: '${NEW_DATABASE_URL}'`);
        
        if (newConfig === configContent) {
            console.log('⚠️ Строка DATABASE_URL не найдена или уже обновлена');
            return false;
        }
        
        // Записываем обновленный конфиг
        fs.writeFileSync(configPath, newConfig);
        
        console.log('✅ Конфигурация базы данных обновлена!');
        console.log('📡 Новая база данных:', NEW_DATABASE_URL.split('@')[1].split('/')[0]);
        
        return true;
        
    } catch (error) {
        console.error('❌ Ошибка обновления конфигурации:', error.message);
        return false;
    }
}

// Запуск обновления конфигурации
if (require.main === module) {
    const success = updateDatabaseConfig();
    if (success) {
        console.log('\n🎉 Конфигураци�� успешно обновлена!');
        console.log('📝 Следующие шаги:');
        console.log('   1. Перезапустите бота');
        console.log('   2. Проверьте работу всех функций');
        console.log('   3. Удалите старую базу данных (после проверки)');
    } else {
        console.log('\n❌ Не удалось обновить конфигурацию');
    }
}

module.exports = { updateDatabaseConfig };
