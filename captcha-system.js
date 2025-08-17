console.log('[CAPTCHA] Loading captcha system...');

// Simple captcha system with 3 fixed math problems
class CaptchaSystem {
    constructor() {
        // 3 fixed math problems as requested
        this.captchaProblems = [
            {
                question: "3 + 23 = ?",
                answer: "26"
            },
            {
                question: "37 - 17 = ?", 
                answer: "20"
            },
            {
                question: "53 - 23 = ?",
                answer: "30"
            }
        ];
        
        // Store user captcha sessions
        this.userSessions = new Map();
        
        console.log('[CAPTCHA] System initialized with 3 fixed math problems');
    }
    
    // Generate a random captcha for user
    generateCaptcha(userId) {
        // Select random problem from 3 available
        const randomIndex = Math.floor(Math.random() * this.captchaProblems.length);
        const problem = this.captchaProblems[randomIndex];
        
        // Store the session
        this.userSessions.set(userId, {
            question: problem.question,
            correctAnswer: problem.answer,
            attempts: 0,
            maxAttempts: 3,
            createdAt: Date.now()
        });
        
        console.log(`[CAPTCHA] Generated captcha for user ${userId}: ${problem.question}`);
        return problem.question;
    }
    
    // Check if user answer is correct
    verifyAnswer(userId, userAnswer) {
        const session = this.userSessions.get(userId);
        
        if (!session) {
            console.log(`[CAPTCHA] No session found for user ${userId}`);
            return { success: false, message: 'Сессия капчи не найдена. Попробуйте еще раз.' };
        }
        
        // Check if session expired (10 minutes)
        if (Date.now() - session.createdAt > 10 * 60 * 1000) {
            this.userSessions.delete(userId);
            console.log(`[CAPTCHA] Session expired for user ${userId}`);
            return { success: false, message: 'Время сессии истекло. Попробуйте еще раз.' };
        }
        
        session.attempts++;
        
        // Clean user input
        const cleanAnswer = userAnswer.toString().trim();
        const isCorrect = cleanAnswer === session.correctAnswer;
        
        if (isCorrect) {
            // Success - remove session
            this.userSessions.delete(userId);
            console.log(`[CAPTCHA] User ${userId} passed captcha successfully`);
            return { 
                success: true, 
                message: '✅ Капча пройдена успешно!' 
            };
        } else {
            // Wrong answer
            const attemptsLeft = session.maxAttempts - session.attempts;
            
            if (attemptsLeft <= 0) {
                // No attempts left - remove session
                this.userSessions.delete(userId);
                console.log(`[CAPTCHA] User ${userId} failed captcha (no attempts left)`);
                return { 
                    success: false, 
                    message: '❌ Превышено количество попыток. Попробуйте еще раз.',
                    shouldRestart: true
                };
            } else {
                console.log(`[CAPTCHA] User ${userId} wrong answer. Attempts left: ${attemptsLeft}`);
                return { 
                    success: false, 
                    message: `❌ Неверный ответ. Осталось попыток: ${attemptsLeft}`,
                    attemptsLeft: attemptsLeft
                };
            }
        }
    }
    
    // Check if user has active captcha session
    hasActiveSession(userId) {
        const session = this.userSessions.get(userId);
        if (!session) return false;
        
        // Check if expired
        if (Date.now() - session.createdAt > 10 * 60 * 1000) {
            this.userSessions.delete(userId);
            return false;
        }
        
        return true;
    }
    
    // Get current question for user
    getCurrentQuestion(userId) {
        const session = this.userSessions.get(userId);
        return session ? session.question : null;
    }
    
    // Clear user session (for admin or reset)
    clearSession(userId) {
        const deleted = this.userSessions.delete(userId);
        console.log(`[CAPTCHA] Cleared session for user ${userId}: ${deleted}`);
        return deleted;
    }
    
    // Get system statistics
    getStats() {
        return {
            activeSessions: this.userSessions.size,
            totalProblems: this.captchaProblems.length,
            problems: this.captchaProblems.map(p => p.question)
        };
    }
    
    // Clean expired sessions (call periodically)
    cleanExpiredSessions() {
        const now = Date.now();
        let cleaned = 0;
        
        for (const [userId, session] of this.userSessions.entries()) {
            if (now - session.createdAt > 10 * 60 * 1000) {
                this.userSessions.delete(userId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`[CAPTCHA] Cleaned ${cleaned} expired sessions`);
        }
        
        return cleaned;
    }
}

// Create single instance
const captchaSystem = new CaptchaSystem();

// Clean expired sessions every 5 minutes
setInterval(() => {
    captchaSystem.cleanExpiredSessions();
}, 5 * 60 * 1000);

console.log('[CAPTCHA] Captcha system fully loaded and ready');

module.exports = {
    captchaSystem
};
