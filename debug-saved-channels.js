const db = require('./database');

async function debugSavedChannels() {
    try {
        console.log('=== DEBUGGING SAVED SPONSOR CHANNELS ===\n');
        
        // Check if there are any saved SubGram channels
        const savedChannels = await db.executeQuery(`
            SELECT user_id, channel_link, channel_name, created_at, 
                   EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as hours_old
            FROM subgram_channels 
            ORDER BY created_at DESC 
            LIMIT 20
        `);
        
        console.log(`Found ${savedChannels.rows.length} saved SubGram channels:`);
        if (savedChannels.rows.length > 0) {
            savedChannels.rows.forEach((ch, i) => {
                console.log(`${i+1}. User: ${ch.user_id}, Channel: ${ch.channel_link}, Name: ${ch.channel_name}, Age: ${Math.round(ch.hours_old)}h`);
            });
        } else {
            console.log('No saved SubGram channels found in database');
        }
        console.log();
        
        // Check recent saved channels (within 1 hour) 
        const recentChannels = await db.executeQuery(`
            SELECT user_id, channel_link, channel_name, created_at
            FROM subgram_channels 
            WHERE created_at > NOW() - INTERVAL '1 hour'
            ORDER BY created_at DESC
        `);
        
        console.log(`Recent channels (within 1 hour): ${recentChannels.rows.length}`);
        if (recentChannels.rows.length > 0) {
            recentChannels.rows.forEach((ch, i) => {
                console.log(`${i+1}. User: ${ch.user_id}, Channel: ${ch.channel_link}, Name: ${ch.channel_name}`);
            });
        }
        console.log();
        
        // Check for any hardcoded or test data
        const testChannels = await db.executeQuery(`
            SELECT user_id, channel_link, channel_name 
            FROM subgram_channels 
            WHERE channel_link LIKE '%test%' 
               OR channel_link LIKE '%example%'
               OR channel_name LIKE '%тест%'
               OR channel_name LIKE '%Test%'
               OR channel_name LIKE '%спонсор%'
        `);
        
        console.log(`Test/hardcoded channels found: ${testChannels.rows.length}`);
        if (testChannels.rows.length > 0) {
            testChannels.rows.forEach((ch, i) => {
                console.log(`${i+1}. User: ${ch.user_id}, Channel: ${ch.channel_link}, Name: ${ch.channel_name}`);
            });
        }
        console.log();
        
        // Check SubGram settings
        const settings = await db.getSubGramSettings();
        console.log('SubGram Settings:');
        console.log(JSON.stringify(settings, null, 2));
        console.log();
        
        // Check recent API requests
        const apiRequests = await db.executeQuery(`
            SELECT user_id, api_status, success, response_data, created_at
            FROM subgram_api_requests 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        console.log(`Recent API requests: ${apiRequests.rows.length}`);
        apiRequests.rows.forEach((req, i) => {
            const responseText = JSON.stringify(req.response_data).substring(0, 100) + '...';
            console.log(`${i+1}. User: ${req.user_id}, Status: ${req.api_status}, Success: ${req.success}, Response: ${responseText}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

debugSavedChannels();
