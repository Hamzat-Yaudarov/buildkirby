const { Pool } = require('pg');

// Подключения к ��азам данных
const oldDbConfig = {
    connectionString: 'postgresql://neondb_owner:npg_kA5CYbq6KRQD@ep-late-math-a23qdcph-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: { rejectUnauthorized: false }
};

const newDbConfig = {
    connectionString: 'postgresql://neondb_owner:npg_YC1S8JfBNKWg@ep-quiet-cloud-a2e7auqd-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
    ssl: { rejectUnauthorized: false }
};

const oldPool = new Pool(oldDbConfig);
const newPool = new Pool(newDbConfig);

// Функция для миграции данных из одной таблицы
async function migrateTable(tableName, primaryKey = 'id') {
    try {
        console.log(`📊 Миграция таблицы: ${tableName}`);

        // Получаем данные из старой БД
        const oldData = await oldPool.query(`SELECT * FROM ${tableName}`);
        console.log(`📥 Найдено записей в старой БД: ${oldData.rows.length}`);

        if (oldData.rows.length === 0) {
            console.log(`✅ Таблица ${tableName} пуста, пропускаем`);
            return { migrated: 0, total: 0 };
        }

        // Получаем структуру таблицы
        const columns = Object.keys(oldData.rows[0]);
        const columnsList = columns.join(', ');
        const valuesList = columns.map((_, index) => `$${index + 1}`).join(', ');

        let migratedCount = 0;
        let errorCount = 0;

        // Мигрируем каждую запись
        for (const row of oldData.rows) {
            try {
                const values = columns.map(col => row[col]);

                await newPool.query(`
                    INSERT INTO ${tableName} (${columnsList}) 
                    VALUES (${valuesList})
                    ON CONFLICT (${primaryKey}) DO UPDATE SET
                    ${columns.filter(col => col !== primaryKey).map(col => `${col} = EXCLUDED.${col}`).join(', ')}
                `, values);

                migratedCount++;
                
                if (migratedCount % 100 === 0) {
                    console.log(`📤 Мигрировано ${migratedCount}/${oldData.rows.length} записей из ${tableName}`);
                }
            } catch (error) {
                errorCount++;
                console.error(`❌ Ошибка миграции записи из ${tableName}:`, error.message);
                if (errorCount > 10) {
                    console.error(`🛑 Слишком много ошибок в таблице ${tableName}, прерываем`);
                    break;
                }
            }
        }

        console.log(`✅ Таблица ${tableName} мигрирована: ${migratedCount}/${oldData.rows.length} записей`);
        return { migrated: migratedCount, total: oldData.rows.length, errors: errorCount };

    } catch (error) {
        console.error(`❌ Ошибка миграции таблицы ${tableName}:`, error.message);
        return { migrated: 0, total: 0, errors: 1 };
    }
}

// Функция для создания структуры базы данных в новой БД
async function createDatabaseStructure() {
    try {
        console.log('🏗️ Создание структуры базы данных в новой БД...');
        
        const Database = require('./database');
        
        // Временно меняем подключение на новую БД
        const originalPool = Database.pool;
        Database.pool = newPool;
        
        // Инициализируем структуру БД
        await Database.init();
        
        // Возвращаем оригинальное подключение
        Database.pool = originalPool;
        
        console.log('✅ Структура базы данных создана в новой БД');
        
    } catch (error) {
        console.error('❌ Ошибка создания структуры БД:', error.message);
        throw error;
    }
}

// Основная функция миграции
async function migrateDatabase() {
    console.log('🚀 Начинаем миграцию базы данных...');
    console.log('📡 Старая БД:', oldDbConfig.connectionString.split('@')[1].split('/')[0]);
    console.log('📡 Новая БД:', newDbConfig.connectionString.split('@')[1].split('/')[0]);

    try {
        // Проверяем подключения
        console.log('🔍 Проверка подключений...');
        await oldPool.query('SELECT NOW()');
        await newPool.query('SELECT NOW()');
        console.log('✅ Подключения успешны');

        // Создаем структуру в новой БД
        await createDatabaseStructure();

        // Список таблиц для миграции (в правильном порядке)
        const tablesToMigrate = [
            { name: 'users', primaryKey: 'user_id' },
            { name: 'tasks', primaryKey: 'id' },
            { name: 'user_tasks', primaryKey: 'id' },
            { name: 'promocodes', primaryKey: 'id' },
            { name: 'promocode_uses', primaryKey: 'id' },
            { name: 'lotteries', primaryKey: 'id' },
            { name: 'lottery_tickets', primaryKey: 'id' },
            { name: 'withdrawal_requests', primaryKey: 'id' },
            { name: 'bot_stats', primaryKey: 'id' },
            { name: 'subgram_tasks', primaryKey: 'id' },
            { name: 'sponsor_channels_stats', primaryKey: 'channel_identifier' },
            { name: 'sponsor_channel_user_checks', primaryKey: 'id' }
        ];

        const migrationResults = {};

        // Мигрируем каждую таблицу
        for (const table of tablesToMigrate) {
            try {
                migrationResults[table.name] = await migrateTable(table.name, table.primaryKey);
            } catch (error) {
                console.error(`❌ Критическая ошибка миграции таблицы ${table.name}:`, error.message);
                migrationResults[table.name] = { migrated: 0, total: 0, errors: 1 };
            }
        }

        // Отчет о миграции
        console.log('\n📋 ОТЧЕТ О МИГРАЦИИ:');
        console.log('================================');
        
        let totalMigrated = 0;
        let totalRecords = 0;
        let totalErrors = 0;

        for (const [tableName, result] of Object.entries(migrationResults)) {
            const status = result.errors > 0 ? '⚠️' : '✅';
            console.log(`${status} ${tableName}: ${result.migrated}/${result.total} (ошибок: ${result.errors || 0})`);
            
            totalMigrated += result.migrated;
            totalRecords += result.total;
            totalErrors += result.errors || 0;
        }

        console.log('================================');
        console.log(`📊 ИТОГО: ${totalMigrated}/${totalRecords} записей мигрировано`);
        console.log(`❌ Ошибок: ${totalErrors}`);

        if (totalErrors === 0 && totalMigrated === totalRecords) {
            console.log('🎉 Миграция завершена успешно!');
            console.log('💡 Теперь обновите DATABASE_URL в config.js на новую базу данных');
            return true;
        } else {
            console.log('⚠️ Миграция завершена с ошибками. Проверьте данные перед переключением.');
            return false;
        }

    } catch (error) {
        console.error('💥 Критическая ошибка миграции:', error.message);
        return false;
    } finally {
        // Закрываем подключения
        await oldPool.end();
        await newPool.end();
        console.log('🔒 Подключения закрыты');
    }
}

// Запуск миграции
if (require.main === module) {
    migrateDatabase()
        .then((success) => {
            if (success) {
                console.log('\n✅ Миграция успешно завершена!');
                console.log('📝 Следующие шаги:');
                console.log('   1. Обновите DATABASE_URL в config.js');
                console.log('   2. Перезапустите бота');
                console.log('   3. Проверьте работу всех функций');
                process.exit(0);
            } else {
                console.log('\n❌ Миграция завершена с ошибками');
                process.exit(1);
            }
        })
        .catch((error) => {
            console.error('💥 Неожиданная ошибка:', error);
            process.exit(1);
        });
}

module.exports = { migrateDatabase };
