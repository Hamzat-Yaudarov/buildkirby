const SubGram = require('./subgram');

async function testSubgramTasks() {
    const testUserId = 123456789;
    const testChatId = 123456789;
    
    console.log('🧪 Тестирование SubGram заданий...\n');
    
    console.log('1. Проверка подписки (для блокировки):');
    const subscription = await SubGram.checkSubscription(testUserId, testChatId);
    console.log('MaxOP: 3, action: subscribe');
    console.log('Результат:', {
        status: subscription.status,
        linksCount: subscription.links?.length || 0,
        links: subscription.links?.slice(0, 3) || []
    });
    
    console.log('\n2. Получение заданий:');
    const tasks = await SubGram.getTaskChannels(testUserId, testChatId);
    console.log('MaxOP: 10, action: newtask');
    console.log('Результат:', {
        status: tasks.status,
        linksCount: tasks.links?.length || 0,
        links: tasks.links?.slice(0, 5) || []
    });
    
    console.log('\n📊 Сравнение:');
    console.log(`Блокировка: ${subscription.links?.length || 0} каналов`);
    console.log(`Задания: ${tasks.links?.length || 0} каналов`);
    
    if (tasks.links && subscription.links) {
        const uniqueTaskChannels = tasks.links.filter(link => 
            !subscription.links.includes(link)
        );
        console.log(`Уникальных каналов для заданий: ${uniqueTaskChannels.length}`);
        console.log('Новые каналы:', uniqueTaskChannels.slice(0, 3));
    }
}

testSubgramTasks().catch(console.error);
