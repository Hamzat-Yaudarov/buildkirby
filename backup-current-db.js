const { Pool } = require('pg');
const XLSX = require('xlsx');
const fs = require('fs');
const config = require('./config');

const pool = new Pool({
    connectionString: config.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function backupDatabase() {
    try {
        console.log('📋 Создаем backup текущей базы данных...');
        
        // Список таблиц для backup
        const tables = [
            'users',
            'tasks', 
            'user_tasks',
            'withdrawal_requests',
            'subgram_tasks',
            'sponsor_channels_stats',
            'sponsor_channel_user_checks',
            'promocodes',
            'promocode_uses'
        ];
        
        // Создаем папку для backup
        const backupDir = './backup-' + new Date().toISOString().split('T')[0];
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir);
        }
        
        for (const table of tables) {
            try {
                console.log(`📊 Backing up ${table}...`);
                
                const result = await pool.query(`SELECT * FROM ${table} ORDER BY created_at ASC`);
                
                if (result.rows.length === 0) {
                    console.log(`   ⚠️ Таблица ${table} пуста`);
                    continue;
                }
                
                // Конвертируем в xlsx
                const worksheet = XLSX.utils.json_to_sheet(result.rows);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, table);
                
                const fileName = `${backupDir}/${table}.xlsx`;
                XLSX.writeFile(workbook, fileName);
                
                console.log(`   ✅ ${table}: ${result.rows.length} записей -> ${fileName}`);
                
            } catch (tableError) {
                console.log(`   ❌ Ошибка backup ${table}: ${tableError.message}`);
            }
        }
        
        console.log(`🎉 Backup завершен! Файлы в папке: ${backupDir}`);
        
    } catch (error) {
        console.log('❌ Ошибка backup:', error.message);
        console.log('📋 Возможно, лимиты уже достигнуты. Используйте данные от 26 августа.');
    } finally {
        await pool.end();
    }
}

backupDatabase();
