const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_s6iWtmzZU8XA@ep-dawn-waterfall-a23jn5vi-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function checkSchema() {
    try {
        console.log('🔍 Проверка схемы базы данных...');
        
        // Проверка существования новых таблиц
        const tablesQuery = await pool.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name IN ('channel_subscription_stats', 'subscription_check_events')
            ORDER BY table_name, ordinal_position
        `);
        
        console.log('\n📋 Найденные таблицы и колонки:');
        let currentTable = '';
        for (const row of tablesQuery.rows) {
            if (row.table_name !== currentTable) {
                console.log(`\n📄 Таблица: ${row.table_name}`);
                currentTable = row.table_name;
            }
            console.log(`  - ${row.column_name} (${row.data_type})`);
        }
        
        if (tablesQuery.rows.length === 0) {
            console.log('❌ Новые таблицы не найдены. Возможно, они еще не созданы.');
        } else {
            console.log('\n✅ Новые таблицы созданы успешно!');
        }
        
        // Проверка существующих обязательных каналов
        const channelsQuery = await pool.query('SELECT * FROM required_channels ORDER BY created_at');
        
        console.log('\n📺 Текущие обязательные каналы:');
        if (channelsQuery.rows.length === 0) {
            console.log('❌ Обязательные каналы не настроены');
        } else {
            for (const channel of channelsQuery.rows) {
                console.log(`  - ${channel.channel_name || channel.channel_id} (${channel.channel_id}) - ${channel.is_active ? 'Активен' : 'Неактивен'}`);
                console.log(`    Добавлен: ${channel.created_at}`);
            }
        }
        
        console.log('\n🎯 Готово! Система статистики подписок настроена.');
        console.log('\n📖 Как использовать:');
        console.log('1. Добавьте обязательные каналы через /add_channel');
        console.log('2. Пользователи будут проходить проверку подписок');
        console.log('3. Статистика будет автоматически записываться');
        console.log('4. Просматривайте статистику через /subscription_stats или админ-панель');
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        await pool.end();
    }
}

checkSchema();
