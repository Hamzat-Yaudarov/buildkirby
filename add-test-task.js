const Database = require('./database');

async function addTestTask() {
    try {
        await Database.init();
        
        // Создаем тестовое кастомное задание
        const task = await Database.createTask({
            title: "Подписаться на основной канал",
            description: "Подпишитесь на наш основной канал для получения новостей",
            link: "https://t.me/your_main_channel",
            reward: 0.5,
            isSubgram: false
        });
        
        console.log('✅ Тестовое задание создано:', task);
        process.exit(0);
        
    } catch (error) {
        console.error('❌ Ошибка создания задания:', error);
        process.exit(1);
    }
}

addTestTask();
