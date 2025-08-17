console.log('[UPDATE] Setting existing users to bypass captcha...');

const db = require('./database');

async function updateExistingUsers() {
    try {
        // Set all existing users to captcha_passed = true
        const result = await db.executeQuery(`
            UPDATE users 
            SET captcha_passed = TRUE 
            WHERE captcha_passed IS NULL OR captcha_passed = FALSE
        `);
        
        console.log(`[UPDATE] ✅ Updated ${result.rowCount} existing users to bypass captcha`);
        
        // Get statistics
        const stats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN captcha_passed = TRUE THEN 1 END) as captcha_passed_users,
                COUNT(CASE WHEN captcha_passed = FALSE THEN 1 END) as captcha_pending_users
            FROM users
        `);
        
        if (stats.rows.length > 0) {
            const { total_users, captcha_passed_users, captcha_pending_users } = stats.rows[0];
            console.log(`[UPDATE] Statistics:`);
            console.log(`  - Total users: ${total_users}`);
            console.log(`  - Captcha passed: ${captcha_passed_users}`);
            console.log(`  - Captcha pending: ${captcha_pending_users}`);
        }
        
        return true;
    } catch (error) {
        console.error('[UPDATE] Error:', error);
        throw error;
    }
}

// Run update if called directly
if (require.main === module) {
    updateExistingUsers()
        .then(() => {
            console.log('[UPDATE] ✅ Update completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('[UPDATE] ❌ Update failed:', error);
            process.exit(1);
        });
}

module.exports = { updateExistingUsers };
