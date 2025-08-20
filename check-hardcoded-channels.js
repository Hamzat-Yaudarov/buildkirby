const db = require('./database');

async function checkHardcodedChannels() {
    try {
        console.log('=== CHECKING FOR HARDCODED SPONSOR CHANNELS ===\n');
        
        // 1. Check subgram_channels table
        console.log('1. Checking subgram_channels table...');
        const allSubgramChannels = await db.executeQuery('SELECT * FROM subgram_channels ORDER BY created_at DESC');
        console.log(`   Total SubGram channels in DB: ${allSubgramChannels.rows.length}`);
        
        if (allSubgramChannels.rows.length > 0) {
            console.log('   Recent channels:');
            allSubgramChannels.rows.slice(0, 10).forEach((ch, i) => {
                console.log(`   ${i+1}. User: ${ch.user_id}, Link: ${ch.channel_link}, Name: ${ch.channel_name}, Created: ${ch.created_at}`);
            });
        }
        console.log();
        
        // 2. Check required_channels table
        console.log('2. Checking required_channels table...');
        const requiredChannels = await db.executeQuery('SELECT * FROM required_channels ORDER BY created_at DESC');
        console.log(`   Total required channels: ${requiredChannels.rows.length}`);
        
        requiredChannels.rows.forEach((ch, i) => {
            console.log(`   ${i+1}. ID: ${ch.channel_id}, Name: ${ch.channel_name}, Active: ${ch.is_active}, Created: ${ch.created_at}`);
        });
        console.log();
        
        // 3. Check for any test/demo data
        console.log('3. Checking for test/demo data...');
        const testData = await db.executeQuery(`
            SELECT 'subgram_channels' as table_name, user_id, channel_link as identifier, channel_name as name
            FROM subgram_channels 
            WHERE channel_link LIKE '%test%' 
               OR channel_link LIKE '%demo%' 
               OR channel_name LIKE '%тест%'
               OR channel_name LIKE '%demo%'
            UNION ALL
            SELECT 'required_channels' as table_name, 0 as user_id, channel_id as identifier, channel_name as name
            FROM required_channels 
            WHERE channel_id LIKE '%test%' 
               OR channel_id LIKE '%demo%' 
               OR channel_name LIKE '%тест%'
               OR channel_name LIKE '%demo%'
        `);
        
        console.log(`   Found ${testData.rows.length} test/demo entries:`);
        testData.rows.forEach((ch, i) => {
            console.log(`   ${i+1}. Table: ${ch.table_name}, User: ${ch.user_id}, ID: ${ch.identifier}, Name: ${ch.name}`);
        });
        console.log();
        
        // 4. Check SubGram settings
        console.log('4. Checking SubGram settings...');
        const settings = await db.getSubGramSettings();
        console.log('   Settings:', JSON.stringify(settings, null, 2));
        console.log();
        
        // 5. Check for recent users who might have sponsor channels
        console.log('5. Checking users with recent SubGram channels...');
        const usersWithChannels = await db.executeQuery(`
            SELECT DISTINCT user_id, COUNT(*) as channel_count, MAX(created_at) as latest_channel
            FROM subgram_channels 
            GROUP BY user_id 
            ORDER BY latest_channel DESC 
            LIMIT 5
        `);
        
        console.log(`   Users with sponsor channels: ${usersWithChannels.rows.length}`);
        usersWithChannels.rows.forEach((user, i) => {
            console.log(`   ${i+1}. User ID: ${user.user_id}, Channels: ${user.channel_count}, Latest: ${user.latest_channel}`);
        });
        
        // Get details for a specific user
        if (usersWithChannels.rows.length > 0) {
            const sampleUserId = usersWithChannels.rows[0].user_id;
            console.log(`\n   Sample channels for user ${sampleUserId}:`);
            const sampleChannels = await db.executeQuery(`
                SELECT channel_link, channel_name, created_at 
                FROM subgram_channels 
                WHERE user_id = $1 
                ORDER BY created_at DESC
            `, [sampleUserId]);
            
            sampleChannels.rows.forEach((ch, i) => {
                console.log(`     ${i+1}. ${ch.channel_name} (${ch.channel_link}) - ${ch.created_at}`);
            });
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkHardcodedChannels();
