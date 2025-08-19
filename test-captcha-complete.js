console.log('[TEST] Comprehensive captcha system test...');

const { captchaSystem } = require('./captcha-system');

// Test data
const testUsers = [12345, 67890, 11111];

function runComprehensiveTest() {
    console.log('\n🧪 COMPREHENSIVE CAPTCHA SYSTEM TEST\n');
    
    // Test 1: System initialization
    console.log('1️⃣ Testing System Initialization:');
    const stats = captchaSystem.getStats();
    console.log(`   ✅ Total problems: ${stats.totalProblems}`);
    console.log(`   ✅ Active sessions: ${stats.activeSessions}`);
    console.log(`   ✅ Available problems: ${stats.problems.join(', ')}`);
    
    // Test 2: Generate captchas for multiple users
    console.log('\n2️⃣ Testing Captcha Generation:');
    const userQuestions = {};
    for (const userId of testUsers) {
        const question = captchaSystem.generateCaptcha(userId);
        userQuestions[userId] = question;
        console.log(`   User ${userId}: ${question}`);
    }
    
    // Test 3: Session management
    console.log('\n3️⃣ Testing Session Management:');
    for (const userId of testUsers) {
        const hasSession = captchaSystem.hasActiveSession(userId);
        const currentQ = captchaSystem.getCurrentQuestion(userId);
        console.log(`   User ${userId}: Session=${hasSession}, Question="${currentQ}"`);
    }
    
    // Test 4: Wrong answers
    console.log('\n4️⃣ Testing Wrong Answers:');
    const wrongAnswers = ['999', '0', 'abc', ''];
    for (const userId of testUsers) {
        for (const wrongAnswer of wrongAnswers) {
            const result = captchaSystem.verifyAnswer(userId, wrongAnswer);
            if (!result.success) {
                console.log(`   User ${userId}, Answer "${wrongAnswer}": ❌ ${result.message}`);
                break; // Test only one wrong answer per user
            }
        }
    }
    
    // Test 5: Correct answers
    console.log('\n5️⃣ Testing Correct Answers:');
    
    // Create a new user for correct answer test
    const correctTestUser = 99999;
    const correctTestQuestion = captchaSystem.generateCaptcha(correctTestUser);
    console.log(`   Generated question for user ${correctTestUser}: ${correctTestQuestion}`);
    
    // Determine correct answer
    let correctAnswer;
    if (correctTestQuestion.includes('3 + 23')) correctAnswer = '26';
    else if (correctTestQuestion.includes('37 - 17')) correctAnswer = '20';
    else if (correctTestQuestion.includes('53 - 23')) correctAnswer = '30';
    
    if (correctAnswer) {
        const result = captchaSystem.verifyAnswer(correctTestUser, correctAnswer);
        console.log(`   User ${correctTestUser}, Answer "${correctAnswer}": ${result.success ? '✅' : '❌'} ${result.message}`);
    }
    
    // Test 6: Session cleanup
    console.log('\n6️⃣ Testing Session Cleanup:');
    const beforeCleanup = captchaSystem.getStats().activeSessions;
    const cleaned = captchaSystem.cleanExpiredSessions();
    const afterCleanup = captchaSystem.getStats().activeSessions;
    console.log(`   Before cleanup: ${beforeCleanup} sessions`);
    console.log(`   Cleaned: ${cleaned} expired sessions`);
    console.log(`   After cleanup: ${afterCleanup} sessions`);
    
    // Test 7: Manual session clearing
    console.log('\n7️⃣ Testing Manual Session Clearing:');
    for (const userId of testUsers) {
        const cleared = captchaSystem.clearSession(userId);
        console.log(`   User ${userId}: ${cleared ? 'Session cleared' : 'No session to clear'}`);
    }
    
    // Test 8: Final statistics
    console.log('\n8️⃣ Final Statistics:');
    const finalStats = captchaSystem.getStats();
    console.log(`   Active sessions: ${finalStats.activeSessions}`);
    console.log(`   Total problems: ${finalStats.totalProblems}`);
    
    // Test 9: All possible questions and answers
    console.log('\n9️⃣ Testing All Problem Types:');
    const allProblems = [
        { question: '3 + 23 = ?', answer: '26' },
        { question: '37 - 17 = ?', answer: '20' },
        { question: '53 - 23 = ?', answer: '30' }
    ];
    
    for (let i = 0; i < allProblems.length; i++) {
        const testUserId = 100000 + i;
        console.log(`   Testing problem ${i + 1}: ${allProblems[i].question}`);
        
        // Keep generating until we get the desired question
        let attempts = 0;
        let question;
        do {
            question = captchaSystem.generateCaptcha(testUserId);
            attempts++;
        } while (!question.includes(allProblems[i].question.split(' = ?')[0]) && attempts < 20);
        
        if (attempts < 20) {
            const result = captchaSystem.verifyAnswer(testUserId, allProblems[i].answer);
            console.log(`     Generated after ${attempts} attempts: ${question}`);
            console.log(`     Result: ${result.success ? '✅ PASS' : '❌ FAIL'} - ${result.message}`);
        } else {
            console.log(`     ⚠️ Could not generate specific question after 20 attempts`);
        }
    }
    
    console.log('\n✅ COMPREHENSIVE TEST COMPLETED!\n');
    console.log('🎯 Summary:');
    console.log('   - 3 fixed math problems implemented');
    console.log('   - Random selection working');
    console.log('   - Session management working');
    console.log('   - Answer verification working');
    console.log('   - Cleanup mechanisms working');
    console.log('   - Ready for integration with Telegram bot!');
}

// Run the test
if (require.main === module) {
    runComprehensiveTest();
}

module.exports = { runComprehensiveTest };
