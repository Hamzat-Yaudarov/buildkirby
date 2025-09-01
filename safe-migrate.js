const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const Database = require('./database');

class SafeMigration {
    constructor() {
        this.dataDir = './xlsx-data';
        this.batchSize = 100; // Обрабатываем по 100 записей
    }

    async migrate() {
        try {
            console.log('🚀 БЕЗОПАСНАЯ МИГРАЦИЯ: С прогрессом и обработкой ошибок\n');

            // Инициализируем базу данных
            console.log('📝 Инициализация базы данных...');
            await Database.init();

            // Проверяем папку
            if (!fs.existsSync(this.dataDir)) {
                console.log(`❌ Папка ${this.dataDir} не найдена`);
                return;
            }

            // Миграция в безопасном порядке
            const migrationOrder = ['users', 'tasks', 'promocodes', 'withdrawal_requests'];

            for (const tableName of migrationOrder) {
                await this.migrateTableSafe(tableName);
            }

            console.log('\n🎉 БЕЗОПАСНАЯ МИГРАЦИЯ ЗАВЕРШЕНА!');

        } catch (error) {
            console.error('❌ Критическая ошибка:', error);
        }
    }

    async migrateTableSafe(tableName) {
        const filePath = path.join(this.dataDir, `${tableName}.xlsx`);
        
        if (!fs.existsSync(filePath)) {
            console.log(`⚠️ Файл ${tableName}.xlsx не найден, пропускаем`);
            return;
        }

        try {
            console.log(`\n📋 === МИГРАЦИЯ: ${tableName.toUpperCase()} ===`);

            // Читаем файл
            const workbook = XLSX.readFile(filePath);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json(worksheet);

            if (data.length === 0) {
                console.log(`  ✅ Таблица пуста, пропускаем`);
                return;
            }

            console.log(`  📊 Всего записей: ${data.length}`);
            console.log(`  🔄 Обработка по ${this.batchSize} записей`);

            // Обра��отка по батчам
            let processed = 0;
            let errors = 0;

            for (let i = 0; i < data.length; i += this.batchSize) {
                const batch = data.slice(i, i + this.batchSize);
                const batchNum = Math.floor(i / this.batchSize) + 1;
                const totalBatches = Math.ceil(data.length / this.batchSize);

                console.log(`  📦 Батч ${batchNum}/${totalBatches} (записи ${i + 1}-${Math.min(i + this.batchSize, data.length)})`);

                try {
                    const result = await this.processBatch(tableName, batch, i);
                    processed += result.success;
                    errors += result.errors;

                    const percentage = Math.round((i + batch.length) / data.length * 100);
                    console.log(`  ✅ Батч завершен. Прогресс: ${percentage}%`);

                } catch (batchError) {
                    console.log(`  ❌ Ошибка батча: ${batchError.message}`);
                    errors += batch.length;
                }

                // Пауза между батчами
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            console.log(`  🎯 ИТОГО ${tableName}: успешно ${processed}, ошибок ${errors}`);

        } catch (error) {
            console.log(`❌ Ошибка таблицы ${tableName}: ${error.message}`);
        }
    }

    async processBatch(tableName, batch, startIndex) {
        const client = await Database.pool.connect();
        let success = 0;
        let errors = 0;

        try {
            for (let i = 0; i < batch.length; i++) {
                const row = batch[i];
                const recordIndex = startIndex + i + 1;

                try {
                    await this.insertRecord(client, tableName, row);
                    success++;

                    // Логируем каждую 50-ю запись
                    if (recordIndex % 50 === 0) {
                        console.log(`    📝 Обработано ${recordIndex} записей...`);
                    }

                } catch (recordError) {
                    console.log(`    ❌ Ошибка записи ${recordIndex}: ${recordError.message}`);
                    errors++;
                }
            }
        } finally {
            client.release();
        }

        return { success, errors };
    }

    async insertRecord(client, tableName, row) {
        switch (tableName) {
            case 'users':
                return await client.query(`
                    INSERT INTO users (
                        user_id, username, first_name, language_code, is_premium,
                        balance, total_earned, referral_earned, total_referrals,
                        referrer_id, referral_completed, captcha_passed, created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    ON CONFLICT (user_id) DO NOTHING
                `, [
                    row.user_id,
                    row.username || null,
                    row.first_name || null,
                    row.language_code || 'ru',
                    row.is_premium || false,
                    parseFloat(row.balance) || 0,
                    parseFloat(row.total_earned) || 0,
                    parseFloat(row.referral_earned) || 0,
                    parseInt(row.total_referrals) || 0,
                    row.referrer_id || null,
                    row.referral_completed || false,
                    row.captcha_passed || false,
                    row.created_at || new Date()
                ]);

            case 'tasks':
                return await client.query(`
                    INSERT INTO tasks (id, title, description, link, reward, is_subgram, is_active, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.title,
                    row.description || null,
                    row.link || null,
                    parseFloat(row.reward) || 0.3,
                    row.is_subgram || false,
                    row.is_active !== false,
                    row.created_at || new Date()
                ]);

            case 'withdrawal_requests':
                return await client.query(`
                    INSERT INTO withdrawal_requests (id, user_id, amount, status, created_at)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (id) DO NOTHING
                `, [
                    row.id,
                    row.user_id,
                    parseFloat(row.amount),
                    row.status || 'pending',
                    row.created_at || new Date()
                ]);

            default:
                throw new Error(`Неизвестная таблица: ${tableName}`);
        }
    }
}

// Запуск миграции
async function runSafeMigration() {
    const migration = new SafeMigration();
    await migration.migrate();
}

runSafeMigration();
