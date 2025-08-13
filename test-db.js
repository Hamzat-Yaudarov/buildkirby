const db = require('./database');

async function testDatabase() {
    try {
        console.log('🔍 Testing PostgreSQL connection...');
        
        // Test basic connection
        const result = await db.executeQuery('SELECT NOW() as current_time');
        console.log('✅ Database connection successful!');
        console.log('📅 Current time:', result.rows[0].current_time);
        
        // Test user stats
        const stats = await db.getUserStats();
        console.log('📊 User stats:', stats);
        
        // Test tables exist
        const tables = await db.executeQuery(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        console.log('📋 Tables in database:', tables.rows.map(r => r.table_name));
        
        console.log('✅ All database tests passed!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Database test failed:', error.message);
        process.exit(1);
    }
}

testDatabase();
