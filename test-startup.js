console.log('🧪 Тестирование запуска бота...');

try {
    // Проверяем что все модули загружаются без ошибок
    const config = require('./config');
    console.log('✅ Config загружен');
    
    const Database = require('./database');
    console.log('✅ Database загружен');
    
    const SubGram = require('./subgram');
    console.log('✅ SubGram загружен');
    
    // Проверяем что переменные окружения доступны
    console.log('📋 Проверка переменных окружения:');
    console.log('- BOT_TOKEN:', config.BOT_TOKEN ? '✅ Установлен' : '❌ Отсутствует');
    console.log('- DATABASE_URL:', config.DATABASE_URL ? '✅ Установлен' : '❌ Отсутствует');
    console.log('- SUBGRAM_API_KEY:', config.SUBGRAM_API_KEY ? '✅ Установлен' : '❌ Отсутствует');
    
    console.log('\n🎉 Базовая проверка пройдена!');
    console.log('🚀 Бот готов к запуску');
    
} catch (error) {
    console.error('❌ Ошибка при тестировании:', error);
    process.exit(1);
}
