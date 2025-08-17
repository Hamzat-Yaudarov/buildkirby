console.log('[TEST] Testing captcha system...');

const { captchaSystem } = require('./captcha-system');

// Test captcha system
function testCaptchaSystem() {
    console.log('\n🤖 Testing Captcha System:');
    
    // Test 1: Generate captcha for user
    const userId = 12345;
    console.log(`\n1. Generating captcha for user ${userId}:`);
    const question = captchaSystem.generateCaptcha(userId);
    console.log(`   Question: ${question}`);
    
    // Test 2: Check if session exists
    console.log(`\n2. Checking active session:`);
    const hasSession = captchaSystem.hasActiveSession(userId);
    console.log(`   Has active session: ${hasSession}`);
    
    // Test 3: Get current question
    const currentQuestion = captchaSystem.getCurrentQuestion(userId);
    console.log(`   Current question: ${currentQuestion}`);
    
    // Test 4: Try wrong answer
    console.log(`\n3. Testing wrong answer:`);
    const wrongResult = captchaSystem.verifyAnswer(userId, "999");
    console.log(`   Result: ${JSON.stringify(wrongResult, null, 2)}`);
    
    // Test 5: Try correct answer (determine from question)
    console.log(`\n4. Testing correct answer:`);
    let correctAnswer;
    if (question.includes('3 + 23')) correctAnswer = '26';
    else if (question.includes('37 - 17')) correctAnswer = '20';
    else if (question.includes('53 - 23')) correctAnswer = '30';
    
    if (correctAnswer) {
        const correctResult = captchaSystem.verifyAnswer(userId, correctAnswer);
        console.log(`   Correct answer: ${correctAnswer}`);
        console.log(`   Result: ${JSON.stringify(correctResult, null, 2)}`);
    }
    
    // Test 6: Get system stats
    console.log(`\n5. System statistics:`);
    const stats = captchaSystem.getStats();
    console.log(`   Stats: ${JSON.stringify(stats, null, 2)}`);
    
    console.log('\n✅ Captcha system test completed!');
}

// Run test
testCaptchaSystem();

module.exports = { testCaptchaSystem };
