// Конфигурация изображений для различных разделов бота
// Вы можете заменить URL на свои изображения

module.exports = {
    // Основные разделы
    MAIN_MENU: 'https://imgur.com/09xddzK', // Картинка для главного меню
    WELCOME: 'https://imgur.com/ZXQRIzE', // Приветственное сообщение
    
    // Разделы функционала
    PROFILE: 'https://imgur.com/k1sSUYM', // Профиль пользователя
    REFERRAL: 'https://imgur.com/NzrGU3a', // Реферальная система
    CLICKER: 'https://imgur.com/2tAlqP8', // Кликер
    TASKS: 'https://imgur.com/undefined', // Задания
    ROULETTE: 'https://imgur.com/NAAjrGp', // Рулетка
    CASES: 'https://i.imgur.com/example_cases.jpg', // Кейсы
    LOTTERY: 'https://imgur.com/MDyacgw', // Лотерея
    RATINGS: 'https://imgur.com/5JPR5rw', // Рейтинги
    WITHDRAW: 'https://imgur.com/IxQXHkj', // Вывод средств
    INSTRUCTIONS: 'https://imgur.com/4l8MWZe', // Инструкция
    
    // Спонсорские каналы
    SPONSORS: 'https://imgur.com/undefined',
    
    // Настройки по умолчанию
    DEFAULT_IMAGE: 'https://imgur.com/ZXQRIzE', // Изображение по умолчанию
    
    // Функция для получения изображения раздела
    getImageFor: function(section) {
        return this[section.toUpperCase()] || this.DEFAULT_IMAGE;
    },
    
    // Проверка на существование изображения
    hasImage: function(section) {
        return this[section.toUpperCase()] !== undefined;
    }
};

// Инструкция по добавлению собственных изображений:
// 
// 1. Загрузите ваши изображения на любой хостинг (imgur, cloudinary, и т.д.)
// 2. Замените URL в соответствующих полях выше
// 3. Рекомендуемые размеры: 800x600 или 1280x720
// 4. Поддерживаемые форматы: JPG, PNG, GIF
// 
// Например:
// MAIN_MENU: 'https://your-hosting.com/your-main-menu-image.jpg',
// PROFILE: 'https://your-hosting.com/your-profile-image.png',
