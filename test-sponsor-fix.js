const db = require('./database');
const subscriptionFlow = require('./subscription-flow-manager');

async function testSponsorFix() {
    try {
        console.log('=== TESTING SPONSOR CHANNEL FIX ===\n');
        
        // Test user ID from logs
        const testUserId = 7961237966;
        
        console.log(`Testing with user ID: ${testUserId}`);
        console.log('Expected result: 0 sponsor channels (matching SubGram API response)\n');
        
        // 1. Check current sponsor channels
        console.log('1. Getting sponsor channels...');
        const sponsorChannels = await subscriptionFlow.getSponsorChannels(testUserId);
        console.log(`   Sponsor channels found: ${sponsorChannels.length}`);
        
        if (sponsorChannels.length > 0) {
            console.log('   Channels:');
            sponsorChannels.forEach((ch, i) => {
                console.log(`     ${i+1}. ${ch.name} (${ch.id})`);
            });
        } else {
            console.log('   ✅ No sponsor channels - matches SubGram API response!');
        }
        console.log();
        
        // 2. Check required channels
        console.log('2. Getting required channels...');
        const requiredChannels = await subscriptionFlow.getRequiredChannels();
        console.log(`   Required channels found: ${requiredChannels.length}`);
        
        requiredChannels.forEach((ch, i) => {
            console.log(`     ${i+1}. ${ch.name} (${ch.id})`);
        });
        console.log();
        
        // 3. Simulate subscription stage
        console.log('3. Simulating subscription stage...');
        const mockBot = {
            getChatMember: async (chatId, userId) => {
                return { status: 'member' }; // Mock as subscribed
            }
        };
        
        const stageInfo = await subscriptionFlow.updateSubscriptionStage(mockBot, testUserId);
        console.log(`   Stage: ${stageInfo.stage}`);
        console.log(`   All completed: ${stageInfo.allCompleted}`);
        console.log(`   Sponsor channels: ${stageInfo.sponsorChannels?.length || 0}`);
        console.log(`   Required channels: ${stageInfo.requiredChannels?.length || 0}`);
        console.log(`   Channels to show: ${stageInfo.channelsToShow?.length || 0}`);
        
        // 4. Check what message would be shown
        if (!stageInfo.allCompleted) {
            console.log('\n4. Checking subscription message...');
            const stageMessage = subscriptionFlow.formatStageMessage(stageInfo);
            console.log(`   Stage: ${stageInfo.stage}`);
            console.log(`   Buttons: ${stageMessage.buttons?.length || 0}`);
            
            // Show first few lines of message
            const messageLines = stageMessage.message.split('\n').slice(0, 3);
            console.log(`   Message preview:`);
            messageLines.forEach(line => console.log(`     ${line}`));
        }
        
        console.log('\n=== TEST RESULTS ===');
        if (sponsorChannels.length === 0) {
            console.log('✅ PASS: No sponsor channels shown (matches SubGram API)');
        } else {
            console.log('❌ FAIL: Still showing old sponsor channels');
        }
        
        if (requiredChannels.length > 0) {
            console.log('✅ PASS: Required channels are still shown');
        } else {
            console.log('⚠️  WARNING: No required channels found');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error testing sponsor fix:', error);
        process.exit(1);
    }
}

testSponsorFix();
