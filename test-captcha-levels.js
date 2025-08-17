/**
 * Тестирование работы 2 уровней сложности капчи
 */

const { captchaSystem } = require('./captcha-system');

// Тестовые функции
function testEasyLevel() {
    console.log('\n🟢 ТЕСТИРОВАНИЕ ЛЕГКОГО УРОВНЯ:');
    console.log('=====================================');
    
    for (let i = 0; i < 5; i++) {
        const captcha = captchaSystem.generateCaptcha(12345, captchaSystem.DIFFICULTY_LEVELS.EASY);
        console.log(`\nТест ${i + 1}:`);
        console.log(`Тип: ${captcha.type}`);
        console.log(`Вопрос: ${captcha.question}`);
        console.log(`Правильный ответ: ${captcha.answer}`);
        console.log(`П��инимаемые ответы: ${captcha.acceptedAnswers?.join(', ') || captcha.answer}`);
        
        if (captcha.hints && captcha.hints.length > 0) {
            console.log(`Подсказки: ${captcha.hints.join(', ')}`);
        }
    }
}

function testHardLevel() {
    console.log('\n🔴 ТЕСТИРОВАНИЕ СЛОЖНОГО УРОВНЯ:');
    console.log('=====================================');
    
    for (let i = 0; i < 5; i++) {
        const captcha = captchaSystem.generateCaptcha(54321, captchaSystem.DIFFICULTY_LEVELS.HARD);
        console.log(`\nТест ${i + 1}:`);
        console.log(`Тип: ${captcha.type}`);
        console.log(`Вопрос: ${captcha.question}`);
        console.log(`Правильный ответ: ${captcha.answer}`);
        console.log(`Принимаемые ответы: ${captcha.acceptedAnswers?.join(', ') || captcha.answer}`);
        
        if (captcha.hints && captcha.hints.length > 0) {
            console.log(`Подсказки: ${captcha.hints.join(', ')}`);
        }
    }
}

function testDifficultyLevels() {
    console.log('\n📊 ПРОВЕРКА ДОСТУПНЫХ УРОВНЕЙ СЛОЖНОСТИ:');
    console.log('==========================================');
    console.log('Доступные уровни:', captchaSystem.DIFFICULTY_LEVELS);
    
    const expectedLevels = ['EASY', 'HARD'];
    const actualLevels = Object.keys(captchaSystem.DIFFICULTY_LEVELS);
    
    console.log(`Ожидается: ${expectedLevels.join(', ')}`);
    console.log(`Фактически: ${actualLevels.join(', ')}`);
    
    const isCorrect = expectedLevels.length === actualLevels.length && 
                     expectedLevels.every(level => actualLevels.includes(level));
    
    console.log(`✅ Уровни корректны: ${isCorrect ? 'ДА' : 'НЕТ'}`);
    
    return isCorrect;
}

function testAllCaptchaTypes() {
    console.log('\n🎯 ТЕСТИРОВАНИЕ ВСЕХ ТИПОВ КАПЧИ НА ОБОИХ УРОВНЯХ:');
    console.log('==================================================');
    
    const types = Object.values(captchaSystem.CAPTCHA_TYPES);
    const levels = Object.values(captchaSystem.DIFFICULTY_LEVELS);
    
    console.log(`Типы капчи: ${types.join(', ')}`);
    console.log(`Уровни сложности: ${levels.join(', ')}`);
    
    let allWorking = true;
    
    for (const level of levels) {
        const levelName = level === 1 ? 'ЛЕГКИЙ' : 'СЛОЖНЫЙ';
        console.log(`\n--- ${levelName} УРОВЕНЬ ---`);
        
        for (let i = 0; i < 10; i++) {
            try {
                const captcha = captchaSystem.generateCaptcha(99999, level);
                console.log(`${i + 1}. ${captcha.type}: ${captcha.question.split('\\n')[0].substring(0, 50)}...`);
            } catch (error) {
                console.error(`❌ Ошибка генерации ${levelName} уровня:`, error.message);
                allWorking = false;
            }
        }
    }
    
    console.log(`\n✅ Все типы работают: ${allWorking ? 'ДА' : 'НЕТ'}`);
    return allWorking;
}

// Запуск тестов
console.log('🧪 ЗАПУСК ТЕСТИРОВАНИЯ СИСТЕМЫ КАПЧИ');
console.log('====================================');

try {
    // Проверка уровней сложности
    const levelsCorrect = testDifficultyLevels();
    
    if (!levelsCorrect) {
        console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Неверные уровни сложности!');
        process.exit(1);
    }
    
    // Тестирование легкого уровня
    testEasyLevel();
    
    // Тестирование сложного уровня
    testHardLevel();
    
    // Тестирование всех типов на всех уровнях
    const allTypesWorking = testAllCaptchaTypes();
    
    console.log('\n🎉 РЕЗУЛЬТАТЫ ТЕСТИРОВ��НИЯ:');
    console.log('===========================');
    console.log(`✅ Уровни сложности: ${levelsCorrect ? 'КОРРЕКТНЫ' : 'ОШИБКА'}`);
    console.log(`✅ Все типы капчи: ${allTypesWorking ? 'РАБОТАЮТ' : 'ОШИБКА'}`);
    console.log(`✅ Система готова: ${levelsCorrect && allTypesWorking ? 'ДА' : 'НЕТ'}`);
    
    if (levelsCorrect && allTypesWorking) {
        console.log('\n🚀 СИСТЕМА КАПЧИ С 2 УРОВНЯМИ ГОТОВА К РАБОТЕ!');
    } else {
        console.log('\n❌ ТРЕБУЕТСЯ ИСПРАВЛЕНИЕ ОШИБОК!');
        process.exit(1);
    }
    
} catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА ПРИ ТЕСТИРОВАНИИ:', error);
    process.exit(1);
}
