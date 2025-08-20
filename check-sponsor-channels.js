const db = require('./database');

async function checkChannels() {
    try {
        console.log('=== CHECKING SPONSOR CHANNELS DATABASE ===\n');
        
        // Check SubGram settings
        const settings = await db.getSubGramSettings();
        console.log('SubGram Settings:');
        console.log(settings);
        console.log();
        
        // Check saved SubGram channels
        const savedChannels = await db.executeQuery('SELECT * FROM subgram_channels ORDER BY created_at DESC LIMIT 10');
        console.log('Recent SubGram channels:');
        if (savedChannels.rows.length === 0) {
            console.log('No saved SubGram channels found');
        } else {
            savedChannels.rows.forEach(ch => {
                console.log(`- User: ${ch.user_id}, Channel: ${ch.channel_link}, Name: ${ch.channel_name}, Created: ${ch.created_at}`);
            });
        }
        console.log();
        
        // Check required channels
        const requiredChannels = await db.executeQuery('SELECT * FROM required_channels WHERE is_active = TRUE');
        console.log('Required channels:');
        if (requiredChannels.rows.length === 0) {
            console.log('No required channels found');
        } else {
            requiredChannels.rows.forEach(ch => {
                console.log(`- ID: ${ch.channel_id}, Name: ${ch.channel_name}`);
            });
        }
        console.log();
        
        // Check recent API requests
        const apiRequests = await db.executeQuery('SELECT * FROM subgram_api_requests ORDER BY created_at DESC LIMIT 5');
        console.log('Recent API requests:');
        if (apiRequests.rows.length === 0) {
            console.log('No recent API requests found');
        } else {
            apiRequests.rows.forEach(req => {
                console.log(`- User: ${req.user_id}, Success: ${req.success}, Status: ${req.api_status}, Response: ${JSON.stringify(req.response_data).substring(0, 100)}`);
            });
        }
        console.log();
        
        // Check if there are any other sponsor-related tables
        const tables = await db.executeQuery(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name LIKE '%sponsor%' OR table_name LIKE '%channel%'
        `);
        console.log('Channel/Sponsor related tables:');
        tables.rows.forEach(table => {
            console.log(`- ${table.table_name}`);
        });
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkChannels();
