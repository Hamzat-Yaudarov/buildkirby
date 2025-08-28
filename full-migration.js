const { migrateDatabase } = require('./migrate-database');
const { updateDatabaseConfig } = require('./update-database-config');

async function fullMigration() {
    console.log('🚀 ПОЛНАЯ МИГРАЦИЯ БАЗЫ ДАННЫХ');
    console.log('=====================================');
    console.log('⚠️  ВНИМАНИЕ: Этот процесс может занять несколько минут');
    console.log('📊 Перенос данных из старой Neon БД в новую');
    console.log('=====================================\n');

    try {
        // Шаг 1: Миграция данных
        console.log('🗂️ ШАГ 1: Миграция данных из старой БД в новую');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        const migrationSuccess = await migrateDatabase();
        
        if (!migrationSuccess) {
            console.log('\n❌ Миграция данных неуспешна. Останавливаем процесс.');
            console.log('🔍 Проверьте ошибки выше и попробуйте снова.');
            return false;
        }

        console.log('\n✅ Данные успешно мигрированы!');
        
        // Пауза для проверки
        console.log('\n⏳ Пауза 3 секунды перед обновлением конфигурации...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Шаг 2: Обновление конфигурации
        console.log('\n⚙️ ШАГ 2: Обновление конфигурации подключения к БД');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        const configSuccess = updateDatabaseConfig();
        
        if (!configSuccess) {
            console.log('\n⚠️ Не удалось автоматически обновить конфигурацию.');
            console.log('📝 Вручную обновите DATABASE_URL в config.js на:');
            console.log('   postgresql://neondb_owner:npg_YC1S8JfBNKWg@ep-quiet-cloud-a2e7auqd-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
            return false;
        }

        // Финальные инструкции
        console.log('\n🎉 МИГРАЦИЯ ПОЛНОСТЬЮ ЗАВЕРШЕНА!');
        console.log('=====================================');
        console.log('✅ Все данные перенесены в новую базу данных');
        console.log('✅ Конфигурация обновлена');
        console.log('');
        console.log('📝 СЛЕДУЮЩИЕ ШАГИ:');
        console.log('   1. 🔄 Перезапустите бота (npm start или pm2 restart)');
        console.log('   2. 🧪 Протестируйте основные функции бота');
        console.log('   3. 👥 Проверьте данные пользователей');
        console.log('   4. 💰 Проверьте заявки на вывод');
        console.log('   5. 🗑️ Удалите старую БД после проверки');
        console.log('');
        console.log('⚠️  ВАЖНО: Не удаляйте старую БД до полной проверки новой!');
        console.log('💾 Резервная копия config.js создана: config.js.backup');
        
        return true;

    } catch (error) {
        console.error('💥 Критическая ошибка полной миграции:', error.message);
        console.log('\n🔧 ВОССТАНОВЛЕНИЕ:');
        console.log('   1. Проверьте подключение к интернету');
        console.log('   2. Убедитесь что новая БД доступна');
        console.log('   3. Попробуйте запустить миграцию еще раз');
        return false;
    }
}

// Запуск полной миграции
if (require.main === module) {
    fullMigration()
        .then((success) => {
            if (success) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        })
        .catch((error) => {
            console.error('💥 Неожиданная ошибка:', error);
            process.exit(1);
        });
}

module.exports = { fullMigration };
