const db = require('./database');

async function createTestData() {
    try {
        console.log('🔄 Creating test data...');
        
        // Initialize database
        await db.initializeDatabase();
        
        // Create test tasks
        await db.executeQuery(`
            INSERT INTO tasks (channel_id, channel_name, reward, is_active) 
            VALUES 
                ('@testchannel1', 'Тестовый канал 1', 1.0, TRUE),
                ('@testchannel2', 'Тестовый канал 2', 1.5, TRUE),
                ('@testchannel3', 'Тестовый канал 3', 2.0, TRUE)
            ON CONFLICT (channel_id) DO NOTHING
        `);
        
        // Create test promocodes
        await db.executeQuery(`
            INSERT INTO promocodes (code, reward, max_uses, is_active) 
            VALUES 
                ('WELCOME', 0.5, 100, TRUE),
                ('BONUS', 1.0, 50, TRUE),
                ('VIP', 2.0, 10, TRUE)
            ON CONFLICT (code) DO NOTHING
        `);
        
        // Create test lottery
        await db.executeQuery(`
            INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count, is_active) 
            VALUES 
                ('Еженедельная лотерея', 5.0, 100, 10, TRUE)
            ON CONFLICT DO NOTHING
        `);
        
        // Create test required channel
        await db.executeQuery(`
            INSERT INTO required_channels (channel_id, channel_name, is_active) 
            VALUES 
                ('@kirbyvivodstars', 'Основной канал', TRUE)
            ON CONFLICT (channel_id) DO NOTHING
        `);
        
        console.log('✅ Test data created successfully!');
        console.log('📋 Created 3 test tasks');
        console.log('🎁 Created 3 test promocodes: WELCOME, BONUS, VIP');
        console.log('🎰 Created 1 test lottery');
        console.log('📺 Created 1 required channel');
        
    } catch (error) {
        console.error('❌ Error creating test data:', error);
    }
}

// Run if called directly
if (require.main === module) {
    createTestData()
        .then(() => {
            console.log('🎉 Test data creation completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Test data creation failed:', error);
            process.exit(1);
        });
}

module.exports = { createTestData };
