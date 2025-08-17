console.log('[MIGRATION] Starting captcha migration...');

const db = require('./database');

async function migrateCaptchaField() {
    try {
        console.log('[MIGRATION] Adding captcha_passed field to users table...');
        
        // Add captcha_passed column if it doesn't exist
        await db.executeQuery(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS captcha_passed BOOLEAN DEFAULT FALSE
        `);
        
        console.log('[MIGRATION] captcha_passed field added successfully');
        
        // Set all existing users to captcha_passed = true so they don't have to pass captcha again
        const result = await db.executeQuery(`
            UPDATE users 
            SET captcha_passed = TRUE 
            WHERE captcha_passed IS NULL OR captcha_passed = FALSE
        `);
        
        console.log(`[MIGRATION] Updated ${result.rowCount} existing users to bypass captcha`);
        
        // Get statistics
        const stats = await db.executeQuery(`
            SELECT 
                COUNT(*) as total_users,
                COUNT(CASE WHEN captcha_passed = TRUE THEN 1 END) as captcha_passed_users,
                COUNT(CASE WHEN captcha_passed = FALSE THEN 1 END) as captcha_pending_users
            FROM users
        `);
        
        const { total_users, captcha_passed_users, captcha_pending_users } = stats.rows[0];
        
        console.log('[MIGRATION] Migration completed successfully!');
        console.log(`[MIGRATION] Statistics:`);
        console.log(`  - Total users: ${total_users}`);
        console.log(`  - Captcha passed: ${captcha_passed_users}`);
        console.log(`  - Captcha pending: ${captcha_pending_users}`);
        
        return true;
    } catch (error) {
        console.error('[MIGRATION] Error during migration:', error);
        throw error;
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateCaptchaField()
        .then(() => {
            console.log('[MIGRATION] Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('[MIGRATION] Migration failed:', error);
            process.exit(1);
        });
}

module.exports = {
    migrateCaptchaField
};
