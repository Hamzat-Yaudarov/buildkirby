// Тест для проверки форматирования сообщений рейтинга

// Helper function to escape Markdown special characters
function escapeMarkdown(text) {
    if (!text) return '';
    
    // Remove or replace problematic characters
    let cleanText = text
        .replace(/[\*_`\[\]()~>#+=|{}.!-]/g, '\\$&') // Escape markdown
        .replace(/[\u0000-\u001f\u007f-\u009f]/g, '') // Remove control characters
        .replace(/[☭⧁⁣༒𓆩₦ł₦ℳ₳𓆪]/g, '') // Remove specific problematic symbols
        .replace(/[\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F]/g, '') // Remove various unicode spaces and symbols
        .trim();
    
    // Limit length to prevent issues
    if (cleanText.length > 20) {
        cleanText = cleanText.substring(0, 17) + '...';
    }
    
    // If name becomes empty after cleaning, use default
    return cleanText || 'Пользователь';
}

// Тестовые данные из лога
const testUsers = [
    { first_name: 'Youdarov', referrals_count: 8 },
    { first_name: 'DOVING_BG☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭ ☭', referrals_count: 2 },
    { first_name: 'Умный', referrals_count: 0 },
    { first_name: 'Зари', referrals_count: 0 },
    { first_name: 'Я', referrals_count: 0 },
    { first_name: '🌑Gerber🌑', referrals_count: 0 },
    { first_name: 'СПЛИНТЕР', referrals_count: 0 },
    { first_name: 'Gosha', referrals_count: 0 },
    { first_name: '⧁⁣༒𓆩₦ł₦ℳ₳𓆪༒⧂', referrals_count: 0 },
    { first_name: 'ICE', referrals_count: 0 }
];

function testRatingMessage() {
    console.log('🧪 Тестирование форматирования рейтинга...\n');
    
    let message = '📅 **Рейтинг за неделю по рефералам**\n\n';
    
    testUsers.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const safeName = escapeMarkdown(user.first_name) || 'Пользователь';
        const line = `${medal} ${safeName} - ${user.referrals_count} рефералов\n`;
        
        console.log(`Исходное имя: "${user.first_name}"`);
        console.log(`Безопасное имя: "${safeName}"`);
        console.log(`Строка рейтинга: "${line}"`);
        console.log('---');
        
        message += line;
    });
    
    console.log('\n📋 Полное сообщение:');
    console.log(message);
    
    console.log('\n📊 Статистика:');
    console.log(`Длина сообщения: ${message.length} символов`);
    console.log(`Количество строк: ${message.split('\n').length}`);
    
    // Проверим, есть ли проблемные символы
    const problematicChars = /[☭⧁⁣༒𓆩₦ł₦ℳ₳𓆪]/g;
    const matches = message.match(problematicChars);
    console.log(`Проблемные символы найдены: ${matches ? matches.length : 0}`);
    
    return message;
}

// Запуск теста
testRatingMessage();
