const Database = require('./database');

async function createSponsorChannelsTable() {
    try {
        console.log('📊 Создаем таблицу статистики спонсорских каналов...');
        
        // Создаем таблицу для статистики спонсорских каналов
        await Database.pool.query(`
            CREATE TABLE IF NOT EXISTS sponsor_channels_stats (
                id SERIAL PRIMARY KEY,
                channel_identifier VARCHAR(255) UNIQUE NOT NULL, -- @username или https://t.me/username
                channel_title VARCHAR(255) NOT NULL,
                channel_url VARCHAR(500) NOT NULL,
                is_enabled BOOLEAN DEFAULT true, -- можно временно отключать канал
                total_checks INTEGER DEFAULT 0, -- общее количество проверок подписки
                unique_users_count INTEGER DEFAULT 0, -- количество уникальных пользователей
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Создаем таблицу для связи пользователей и каналов (для подсчета уникальных)
        await Database.pool.query(`
            CREATE TABLE IF NOT EXISTS sponsor_channel_user_checks (
                id SERIAL PRIMARY KEY,
                channel_identifier VARCHAR(255) NOT NULL,
                user_id BIGINT NOT NULL,
                first_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_check_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_checks INTEGER DEFAULT 1,
                UNIQUE(channel_identifier, user_id),
                FOREIGN KEY (channel_identifier) REFERENCES sponsor_channels_stats(channel_identifier) ON DELETE CASCADE
            )
        `);

        // Создаем индексы для производительности
        await Database.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_sponsor_channels_enabled 
            ON sponsor_channels_stats(is_enabled)
        `);
        
        await Database.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_sponsor_channel_user_checks_channel 
            ON sponsor_channel_user_checks(channel_identifier)
        `);
        
        await Database.pool.query(`
            CREATE INDEX IF NOT EXISTS idx_sponsor_channel_user_checks_user 
            ON sponsor_channel_user_checks(user_id)
        `);

        console.log('✅ Таблицы спонсорских каналов созданы успешно');
        
        // Добавляем текущие личные каналы из config.js
        const config = require('./config');
        if (config.PERSONAL_SPONSOR_CHANNELS && config.PERSONAL_SPONSOR_CHANNELS.length > 0) {
            console.log('📝 Добавляем существующие личные каналы из конфигурации...');
            
            for (const channelInput of config.PERSONAL_SPONSOR_CHANNELS) {
                const channelData = normalizeChannelIdentifier(channelInput);
                
                try {
                    await Database.pool.query(`
                        INSERT INTO sponsor_channels_stats (
                            channel_identifier, 
                            channel_title, 
                            channel_url, 
                            is_enabled
                        ) VALUES ($1, $2, $3, $4)
                        ON CONFLICT (channel_identifier) DO NOTHING
                    `, [
                        channelData.identifier,
                        channelData.title,
                        channelData.url,
                        true
                    ]);
                    
                    console.log(`✅ Добавлен канал: ${channelData.identifier}`);
                } catch (error) {
                    console.error(`❌ Ошибка добавления канала ${channelInput}:`, error.message);
                }
            }
        }
        
        console.log('🎉 Инициализация спонсорских каналов завершена');
        
    } catch (error) {
        console.error('❌ Ошибка создания таблиц спонсорских каналов:', error);
        throw error;
    }
}

// Функция для нормализации идентификатора канала (копируем из index.js)
function normalizeChannelIdentifier(channelInput) {
    if (channelInput.startsWith('https://t.me/')) {
        const username = channelInput.replace('https://t.me/', '');
        return {
            identifier: `@${username}`,
            title: username,
            url: channelInput
        };
    } else if (channelInput.startsWith('@')) {
        return {
            identifier: channelInput,
            title: channelInput.replace('@', ''),
            url: `https://t.me/${channelInput.replace('@', '')}`
        };
    } else {
        return {
            identifier: `@${channelInput}`,
            title: channelInput,
            url: `https://t.me/${channelInput}`
        };
    }
}

// Запускаем миграцию
if (require.main === module) {
    Database.init().then(async () => {
        try {
            await createSponsorChannelsTable();
            console.log('✅ Миграция завершена успешно');
            process.exit(0);
        } catch (error) {
            console.error('❌ Ошибка миграции:', error);
            process.exit(1);
        }
    });
}

module.exports = { createSponsorChannelsTable };
