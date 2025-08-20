const db = require('./database');
const subscriptionFlow = require('./subscription-flow-manager');

async function checkCurrentState() {
    try {
        console.log('=== CHECKING CURRENT SPONSOR CHANNEL STATE ===\n');
        
        // Test with a specific user ID from the logs
        const testUserId = 7961237966; // User from the logs
        
        console.log(`Testing with user ID: ${testUserId}\n`);
        
        // 1. Check what getSponsorChannels returns
        console.log('1. Getting sponsor channels from subscriptionFlow...');
        const sponsorChannels = await subscriptionFlow.getSponsorChannels(testUserId);
        console.log(`   Found ${sponsorChannels.length} sponsor channels:`);
        sponsorChannels.forEach((ch, i) => {
            console.log(`   ${i+1}. ${ch.name} (${ch.id}) - Type: ${ch.type}`);
        });
        console.log();
        
        // 2. Check what updateSubscriptionStage returns
        console.log('2. Simulating subscription stage update...');
        // We need to mock the bot object for this test
        const mockBot = {
            getChatMember: async (chatId, userId) => {
                // Mock successful subscription check
                return { status: 'member' };
            }
        };
        
        const stageInfo = await subscriptionFlow.updateSubscriptionStage(mockBot, testUserId);
        console.log(`   Stage: ${stageInfo.stage}`);
        console.log(`   All completed: ${stageInfo.allCompleted}`);
        console.log(`   Sponsor channels: ${stageInfo.sponsorChannels?.length || 0}`);
        console.log(`   Required channels: ${stageInfo.requiredChannels?.length || 0}`);
        console.log(`   Channels to show: ${stageInfo.channelsToShow?.length || 0}`);
        
        if (stageInfo.channelsToShow && stageInfo.channelsToShow.length > 0) {
            console.log(`   Channels to show:`);
            stageInfo.channelsToShow.forEach((ch, i) => {
                console.log(`     ${i+1}. ${ch.name} (${ch.id}) - Type: ${ch.type}`);
            });
        }
        console.log();
        
        // 3. Check database directly
        console.log('3. Checking database for saved channels...');
        const savedChannels = await db.executeQuery(`
            SELECT user_id, channel_link, channel_name, created_at
            FROM subgram_channels 
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [testUserId]);
        
        console.log(`   Found ${savedChannels.rows.length} saved channels for this user:`);
        savedChannels.rows.forEach((ch, i) => {
            console.log(`   ${i+1}. ${ch.channel_name} (${ch.channel_link}) - Created: ${ch.created_at}`);
        });
        console.log();
        
        // 4. Check what message would be shown
        console.log('4. Checking what message would be shown to user...');
        if (!stageInfo.allCompleted) {
            const stageMessage = subscriptionFlow.formatStageMessage(stageInfo);
            console.log(`   Message would be shown for stage: ${stageInfo.stage}`);
            console.log(`   Number of buttons: ${stageMessage.buttons?.length || 0}`);
            console.log(`   Message preview: ${stageMessage.message.substring(0, 200)}...`);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkCurrentState();
