const SubGram = require('./subgram');
const config = require('./config');

async function testSubGram() {
    console.log('🧪 Тестирование SubGram API...');
    console.log('API ключ:', config.SUBGRAM_API_KEY ? 'настроен' : 'НЕ настроен');
    
    // Тестовый пользователь из логов
    const userId = 7038575557;
    const chatId = 7038575557;
    const firstName = '$LABR🐕Ame';
    
    try {
        console.log('\n1️⃣ Проверка подписки...');
        const result1 = await SubGram.checkSubscription(userId, chatId, firstName, 'ru', false);
        console.log('Результат:', JSON.stringify(result1, null, 2));
        
        if (result1.status === 'warning') {
            console.log('\n2️⃣ Статус warning - запрашиваем ссылки...');
            const result2 = await SubGram.getChannelLinks(userId, chatId, firstName, 'ru', false);
            console.log('Ссылки:', JSON.stringify(result2, null, 2));
        }
        
        console.log('\n3️⃣ Проверка заданий...');
        const result3 = await SubGram.getTaskChannels(userId, chatId, firstName, 'ru', false);
        console.log('Задания:', JSON.stringify(result3, null, 2));
        
    } catch (error) {
        console.error('❌ Ошибка теста:', error);
    }
}

testSubGram();
