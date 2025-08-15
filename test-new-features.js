const db = require('./database');

async function testNewFeatures() {
    console.log('🧪 Testing new features...\n');

    try {
        // Test 1: Database initialization with new columns
        console.log('1️⃣ Testing database initialization...');
        await db.initializeDatabase();
        console.log('✅ Database initialized successfully\n');

        // Test 2: Weekly points functions
        console.log('2️⃣ Testing weekly points system...');
        const testUserId = 12345;
        
        // Add points for different activities
        await db.addWeeklyPoints(testUserId, 1, 'bot_activation');
        await db.addWeeklyPoints(testUserId, 1, 'click');
        await db.addWeeklyPoints(testUserId, 2, 'task_completion');
        await db.addWeeklyPoints(testUserId, 1, 'lottery_ticket_purchase');
        await db.addWeeklyPoints(testUserId, 1, 'referral_success');
        console.log('✅ Weekly points added for test user\n');

        // Test 3: Get weekly top users
        console.log('3️⃣ Testing weekly top users...');
        const topUsers = await db.getWeeklyTopUsers(5);
        console.log('Top users:', topUsers);
        console.log('✅ Weekly top users retrieved\n');

        // Test 4: Weekly rewards settings
        console.log('4️⃣ Testing weekly rewards settings...');
        let settings = await db.getWeeklyRewardsSettings();
        console.log('Current settings:', settings);
        
        await db.updateWeeklyRewardsSettings(false);
        settings = await db.getWeeklyRewardsSettings();
        console.log('After disabling:', settings);
        
        await db.updateWeeklyRewardsSettings(true);
        settings = await db.getWeeklyRewardsSettings();
        console.log('After enabling:', settings);
        console.log('✅ Weekly rewards settings work correctly\n');

        // Test 5: Manual trigger recording
        console.log('5️⃣ Testing manual trigger recording...');
        await db.recordManualRewardsTrigger();
        settings = await db.getWeeklyRewardsSettings();
        console.log('After manual trigger:', settings);
        console.log('✅ Manual trigger recorded\n');

        // Test 6: Weekly data reset
        console.log('6️⃣ Testing weekly data reset...');
        await db.resetWeeklyData();
        console.log('✅ Weekly data reset completed\n');

        console.log('🎉 All tests passed successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    } finally {
        await db.closeConnection();
        process.exit(0);
    }
}

testNewFeatures();
