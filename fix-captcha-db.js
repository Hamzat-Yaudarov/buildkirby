console.log('[FIX] Adding captcha_passed column to users table...');

const db = require('./database');

async function addCaptchaColumn() {
    try {
        console.log('[FIX] Connecting to database...');
        
        // Add captcha_passed column to users table
        await db.executeQuery(`
            ALTER TABLE users 
            ADD COLUMN captcha_passed BOOLEAN DEFAULT FALSE
        `);
        
        console.log('[FIX] ✅ captcha_passed column added successfully');
        
        // Set all existing users to captcha_passed = true so they don't have to pass captcha again
        const result = await db.executeQuery(`
            UPDATE users 
            SET captcha_passed = TRUE
        `);
        
        console.log(`[FIX] ✅ Updated ${result.rowCount} existing users to bypass captcha`);
        
        // Verify the column was added
        const verifyResult = await db.executeQuery(`
            SELECT column_name, data_type, column_default 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND column_name = 'captcha_passed'
        `);
        
        if (verifyResult.rows.length > 0) {
            console.log('[FIX] ✅ Column verification successful:', verifyResult.rows[0]);
        } else {
            console.log('[FIX] ❌ Column verification failed');
        }
        
        // Get count of users with captcha status
        const statsResult = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN captcha_passed = TRUE THEN 1 END) as captcha_passed_users,
                COUNT(CASE WHEN captcha_passed = FALSE THEN 1 END) as captcha_pending_users
            FROM users
        `);
        
        if (statsResult.rows.length > 0) {
            const stats = statsResult.rows[0];
            console.log('[FIX] Final statistics:');
            console.log(`  - Total users: ${stats.total_users}`);
            console.log(`  - Captcha passed: ${stats.captcha_passed_users}`);
            console.log(`  - Captcha pending: ${stats.captcha_pending_users}`);
        }
        
        console.log('[FIX] ✅ Database fix completed successfully!');
        return true;
        
    } catch (error) {
        console.error('[FIX] ❌ Error fixing database:', error);
        throw error;
    }
}

// Run the fix
addCaptchaColumn()
    .then(() => {
        console.log('[FIX] Database fix completed, restarting bot recommended');
        process.exit(0);
    })
    .catch((error) => {
        console.error('[FIX] Database fix failed:', error);
        process.exit(1);
    });
