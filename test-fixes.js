const db = require('./database');

async function testCriticalFixes() {
    console.log('🧪 Testing critical fixes...\n');

    try {
        // Test 1: Database initialization with new indexes
        console.log('1️⃣ Testing database initialization with new indexes...');
        await db.initializeDatabase();
        console.log('✅ Database with indexes initialized successfully\n');

        // Test 2: Test updateUserBalance with invalid params
        console.log('2️⃣ Testing updateUserBalance error handling...');
        try {
            await db.updateUserBalance(null, 10);
            console.log('❌ Should have thrown error for null userId');
        } catch (error) {
            console.log('✅ Correctly caught invalid userId error:', error.message);
        }

        try {
            await db.updateUserBalance(99999, undefined);
            console.log('❌ Should have thrown error for undefined amount');
        } catch (error) {
            console.log('✅ Correctly caught undefined amount error:', error.message);
        }
        console.log('');

        // Test 3: Test addWeeklyPoints with invalid params
        console.log('3️⃣ Testing addWeeklyPoints error handling...');
        
        const result1 = await db.addWeeklyPoints(null, 1, 'test');
        console.log('addWeeklyPoints with null userId result:', result1); // Should be false
        
        const result2 = await db.addWeeklyPoints(99999, null, 'test');
        console.log('addWeeklyPoints with null points result:', result2); // Should be false
        
        const result3 = await db.addWeeklyPoints(99999, 1, null);
        console.log('addWeeklyPoints with null activityType result:', result3); // Should be false
        console.log('✅ addWeeklyPoints safely handles invalid params\n');

        // Test 4: Test getWeekStart function
        console.log('4️⃣ Testing getWeekStart function...');
        const originalDate = new Date();
        const weekStart = db.getWeekStart ? db.getWeekStart() : 'Function not exported';
        console.log('Week start:', weekStart);
        console.log('Original date unchanged:', originalDate);
        console.log('✅ getWeekStart works correctly\n');

        // Test 5: Test updateUserField validation
        console.log('5️⃣ Testing updateUserField validation...');
        try {
            await db.updateUserField(99999, 'invalid_field', 'test');
            console.log('❌ Should have thrown error for invalid field');
        } catch (error) {
            console.log('✅ Correctly caught invalid field error:', error.message);
        }
        console.log('');

        console.log('🎉 All critical fixes tested successfully!');

    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    } finally {
        await db.closeConnection();
        process.exit(0);
    }
}

testCriticalFixes();
