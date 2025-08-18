console.log('[REFERRAL-AUDIT] Loading referral audit and correction system...');

const db = require('./database');

// Analyze all existing referrals and determine which are "inactive"
async function analyzeExistingReferrals() {
    try {
        console.log('[REFERRAL-AUDIT] Starting comprehensive referral analysis...');
        
        // Get all users who have referrals
        const referrers = await db.executeQuery(`
            SELECT 
                id as referrer_id,
                first_name,
                username,
                referrals_count,
                balance
            FROM users 
            WHERE referrals_count > 0
        `);

        console.log(`[REFERRAL-AUDIT] Found ${referrers.rows.length} users with referrals`);

        const auditResults = [];

        for (const referrer of referrers.rows) {
            // Get all users invited by this referrer
            const invitedUsers = await db.executeQuery(`
                SELECT 
                    id,
                    first_name,
                    username,
                    captcha_passed,
                    is_subscribed,
                    referrals_count,
                    registered_at
                FROM users 
                WHERE invited_by = $1
            `, [referrer.referrer_id]);

            let activeReferrals = 0;
            let inactiveReferrals = 0;
            const referralDetails = [];

            for (const invitedUser of invitedUsers.rows) {
                // Check if this referral is "active" (captcha passed + subscribed)
                // Note: For retroactive system, we don't require them to have their own referrals
                const isActive = invitedUser.captcha_passed && invitedUser.is_subscribed;
                
                if (isActive) {
                    activeReferrals++;
                } else {
                    inactiveReferrals++;
                }

                referralDetails.push({
                    userId: invitedUser.id,
                    name: invitedUser.first_name,
                    username: invitedUser.username,
                    captchaPassed: invitedUser.captcha_passed,
                    isSubscribed: invitedUser.is_subscribed,
                    referralsCount: invitedUser.referrals_count,
                    isActive: isActive,
                    registeredAt: invitedUser.registered_at
                });
            }

            // Calculate discrepancy
            const actualActiveReferrals = activeReferrals;
            const recordedReferrals = referrer.referrals_count;
            const overcount = recordedReferrals - actualActiveReferrals;
            const starsToDeduct = overcount * 3; // 3 stars per referral

            auditResults.push({
                referrerId: referrer.referrer_id,
                referrerName: referrer.first_name,
                referrerUsername: referrer.username,
                currentBalance: parseFloat(referrer.balance),
                recordedReferrals: recordedReferrals,
                actualActiveReferrals: actualActiveReferrals,
                inactiveReferrals: inactiveReferrals,
                overcount: overcount,
                starsToDeduct: starsToDeduct,
                referralDetails: referralDetails
            });
        }

        console.log('[REFERRAL-AUDIT] Analysis complete');
        return auditResults;

    } catch (error) {
        console.error('[REFERRAL-AUDIT] Error during analysis:', error);
        throw error;
    }
}

// Apply corrections - deduct stars for inactive referrals
async function applyReferralCorrections(auditResults, dryRun = true) {
    try {
        console.log(`[REFERRAL-AUDIT] ${dryRun ? 'DRY RUN' : 'APPLYING'} referral corrections...`);
        
        let totalUsersAffected = 0;
        let totalStarsDeducted = 0;
        const corrections = [];

        for (const audit of auditResults) {
            if (audit.starsToDeduct > 0) {
                const newBalance = Math.max(0, audit.currentBalance - audit.starsToDeduct);
                const actualDeducted = audit.currentBalance - newBalance;

                if (!dryRun) {
                    // Apply the correction
                    await db.executeQuery(`
                        UPDATE users 
                        SET 
                            balance = $1,
                            referrals_count = $2
                        WHERE id = $3
                    `, [newBalance, audit.actualActiveReferrals, audit.referrerId]);

                    // Log the correction
                    console.log(`[REFERRAL-AUDIT] Corrected user ${audit.referrerId}: -${actualDeducted}⭐, referrals: ${audit.recordedReferrals} → ${audit.actualActiveReferrals}`);
                }

                corrections.push({
                    referrerId: audit.referrerId,
                    referrerName: audit.referrerName,
                    oldBalance: audit.currentBalance,
                    newBalance: newBalance,
                    starsDeducted: actualDeducted,
                    oldReferrals: audit.recordedReferrals,
                    newReferrals: audit.actualActiveReferrals,
                    inactiveReferrals: audit.inactiveReferrals
                });

                totalUsersAffected++;
                totalStarsDeducted += actualDeducted;
            }
        }

        const summary = {
            dryRun: dryRun,
            totalUsersAffected: totalUsersAffected,
            totalStarsDeducted: totalStarsDeducted,
            corrections: corrections
        };

        console.log(`[REFERRAL-AUDIT] ${dryRun ? 'Would affect' : 'Affected'} ${totalUsersAffected} users, ${dryRun ? 'would deduct' : 'deducted'} ${totalStarsDeducted} stars total`);

        return summary;

    } catch (error) {
        console.error('[REFERRAL-AUDIT] Error applying corrections:', error);
        throw error;
    }
}

// Check if a previously inactive referral can now be activated
async function checkReferralActivation(userId) {
    try {
        const user = await db.getUser(userId);
        if (!user || !user.invited_by) {
            return { canActivate: false, reason: 'No referrer' };
        }

        // Check if this referral is now active (captcha + subscription)
        const isNowActive = user.captcha_passed && user.is_subscribed;

        if (!isNowActive) {
            const missing = [];
            if (!user.captcha_passed) missing.push('captcha');
            if (!user.is_subscribed) missing.push('subscription');

            return {
                canActivate: false,
                reason: `Missing: ${missing.join(', ')}`,
                captchaPassed: user.captcha_passed,
                isSubscribed: user.is_subscribed
            };
        }

        // Check if this referral was already processed
        if (user.referral_processed) {
            return { canActivate: false, reason: 'Already processed' };
        }

        return { 
            canActivate: true, 
            referrerId: user.invited_by,
            userName: user.first_name 
        };

    } catch (error) {
        console.error('[REFERRAL-AUDIT] Error checking activation:', error);
        return { canActivate: false, reason: 'Database error' };
    }
}

// Activate a referral and return stars to referrer
async function activateReferral(userId) {
    try {
        const activationCheck = await checkReferralActivation(userId);
        
        if (!activationCheck.canActivate) {
            return { 
                success: false, 
                reason: activationCheck.reason,
                details: activationCheck
            };
        }

        const referrerId = activationCheck.referrerId;
        
        // Award the referral bonus
        await db.executeQuery(`
            UPDATE users 
            SET 
                balance = balance + 3,
                referrals_count = referrals_count + 1
            WHERE id = $1
        `, [referrerId]);

        // Mark as processed
        await db.executeQuery(`
            UPDATE users 
            SET referral_processed = TRUE 
            WHERE id = $1
        `, [userId]);

        console.log(`[REFERRAL-AUDIT] Activated referral: User ${userId} → Referrer ${referrerId} (+3⭐)`);

        return {
            success: true,
            referrerId: referrerId,
            userName: activationCheck.userName,
            starsAwarded: 3
        };

    } catch (error) {
        console.error('[REFERRAL-AUDIT] Error activating referral:', error);
        return { success: false, reason: 'Database error' };
    }
}

// Generate detailed audit report
async function generateAuditReport(auditResults) {
    try {
        let report = '\n📊 ПОЛНЫЙ АУДИТ РЕФЕРАЛЬНОЙ СИСТЕМЫ\n';
        report += '═'.repeat(50) + '\n\n';

        const totalUsers = auditResults.length;
        const usersWithIssues = auditResults.filter(r => r.overcount > 0).length;
        const totalOvercount = auditResults.reduce((sum, r) => sum + r.overcount, 0);
        const totalStarsToDeduct = totalOvercount * 3;

        report += `📈 ОБЩАЯ СТАТИСТИКА:\n`;
        report += `• Всего пользователей с рефералами: ${totalUsers}\n`;
        report += `• Пользователей с переплатой: ${usersWithIssues}\n`;
        report += `• Лишних рефералов: ${totalOvercount}\n`;
        report += `• Звёзд к списанию: ${totalStarsToDeduct}⭐\n\n`;

        if (usersWithIssues > 0) {
            report += `⚠️ ПОЛЬЗОВАТЕЛИ С ПЕРЕПЛАТОЙ:\n`;
            report += '─'.repeat(40) + '\n';

            for (const audit of auditResults) {
                if (audit.overcount > 0) {
                    report += `👤 ${audit.referrerName} (ID: ${audit.referrerId})\n`;
                    report += `   💰 Баланс: ${audit.currentBalance}⭐\n`;
                    report += `   👥 Записано рефералов: ${audit.recordedReferrals}\n`;
                    report += `   ✅ Активных рефералов: ${audit.actualActiveReferrals}\n`;
                    report += `   ❌ Неактивных рефералов: ${audit.inactiveReferrals}\n`;
                    report += `   💸 К списанию: ${audit.starsToDeduct}⭐\n`;
                    
                    if (audit.referralDetails.length > 0) {
                        report += `   📋 Детали рефералов:\n`;
                        for (const ref of audit.referralDetails) {
                            const status = ref.isActive ? '✅ Активен' : '❌ Неактивен';
                            const details = ref.isActive ? '' :
                                ` (капча: ${ref.captchaPassed ? '✅' : '❌'}, подписка: ${ref.isSubscribed ? '✅' : '❌'})`;
                            report += `      • ${ref.name} (${ref.userId}) - ${status}${details}\n`;
                        }
                    }
                    report += '\n';
                }
            }
        }

        const correctUsers = auditResults.filter(r => r.overcount === 0);
        if (correctUsers.length > 0) {
            report += `✅ ПОЛЬЗОВАТЕЛИ БЕЗ ПРОБЛЕМ: ${correctUsers.length}\n`;
            report += '─'.repeat(40) + '\n';
            for (const audit of correctUsers) {
                report += `👤 ${audit.referrerName} (${audit.actualActiveReferrals} активных рефералов) ✅\n`;
            }
        }

        return report;

    } catch (error) {
        console.error('[REFERRAL-AUDIT] Error generating report:', error);
        return 'Ошибка генерации отчёта';
    }
}

module.exports = {
    analyzeExistingReferrals,
    applyReferralCorrections,
    checkReferralActivation,
    activateReferral,
    generateAuditReport
};

console.log('[REFERRAL-AUDIT] Referral audit system loaded');
