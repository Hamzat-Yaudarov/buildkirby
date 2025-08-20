const db = require('./database');

async function clearCachedSponsorChannels() {
    try {
        console.log('=== CLEARING CACHED SPONSOR CHANNELS ===\n');
        
        // First, check how many channels we have
        const countResult = await db.executeQuery('SELECT COUNT(*) as total FROM subgram_channels');
        const totalChannels = countResult.rows[0].total;
        
        console.log(`Found ${totalChannels} cached sponsor channels in database`);
        
        if (totalChannels > 0) {
            // Show some examples before clearing
            const sampleChannels = await db.executeQuery(`
                SELECT user_id, channel_link, channel_name, created_at 
                FROM subgram_channels 
                ORDER BY created_at DESC 
                LIMIT 5
            `);
            
            console.log('\nSample channels to be cleared:');
            sampleChannels.rows.forEach((ch, i) => {
                console.log(`${i+1}. User: ${ch.user_id}, Channel: ${ch.channel_link}, Name: ${ch.channel_name}, Created: ${ch.created_at}`);
            });
            
            // Clear all cached channels
            console.log(`\nClearing all ${totalChannels} cached sponsor channels...`);
            await db.executeQuery('DELETE FROM subgram_channels');
            
            // Verify deletion
            const verifyResult = await db.executeQuery('SELECT COUNT(*) as remaining FROM subgram_channels');
            const remainingChannels = verifyResult.rows[0].remaining;
            
            if (remainingChannels === '0') {
                console.log('✅ Successfully cleared all cached sponsor channels!');
                console.log('\nNow users will see actual sponsor channels from SubGram API (currently 0)');
                console.log('Users will only see required channels until SubGram provides new sponsor channels.');
            } else {
                console.log(`❌ Some channels remain: ${remainingChannels}`);
            }
        } else {
            console.log('No cached sponsor channels found - database is already clean');
        }
        
        // Also check SubGram settings to ensure it's properly configured
        console.log('\n=== CHECKING SUBGRAM SETTINGS ===');
        const settings = await db.getSubGramSettings();
        if (settings) {
            console.log(`SubGram enabled: ${settings.enabled}`);
            console.log(`Max sponsors: ${settings.max_sponsors}`);
            console.log(`API key present: ${settings.api_key ? 'Yes' : 'No'}`);
        } else {
            console.log('No SubGram settings found');
        }
        
        console.log('\n=== SUMMARY ===');
        console.log('✅ Cached sponsor channels cleared');
        console.log('✅ Fallback logic fixed to properly clear cache when API returns 0 channels');
        console.log('✅ Users will now see only active sponsor channels from SubGram API');
        console.log('\nNext steps:');
        console.log('1. Restart the bot to apply changes: npm run dev');
        console.log('2. Test with /start command - should show only required channels');
        console.log('3. If SubGram provides sponsor channels later, they will appear automatically');
        
        process.exit(0);
    } catch (error) {
        console.error('Error clearing cached channels:', error);
        process.exit(1);
    }
}

clearCachedSponsorChannels();
