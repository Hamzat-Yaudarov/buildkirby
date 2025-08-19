/**
 * Простой тест SubGram API для проверки работы с токеном
 */

const axios = require('axios');

const API_KEY = '5d4c6c5283559a05a9558b677669871d6ab58e00e71587546b25b4940ea6029d';
const API_URL = 'https://api.subgram.ru/request-op/';

async function testSubGramAPI() {
    console.log('🧪 Тестирование SubGram API с токеном...\n');

    // Тестовый запрос ДЛЯ РАБОТЫ С ТОКЕНОМ (без лишних полей)
    const requestData = {
        UserId: "123456789",
        ChatId: "123456789", 
        MaxOP: 3,
        action: "subscribe",
        exclude_channel_ids: []
        // НЕ отправляем first_name, language_code, Premium 
        // так как наш бот должен быть добавлен в SubGram С ТОКЕНОМ
    };

    console.log('📤 Отправляю запрос к SubGram API:');
    console.log('URL:', API_URL);
    console.log('API Key (первые 20 символов):', API_KEY.substring(0, 20) + '...');
    console.log('Данные запроса:', JSON.stringify(requestData, null, 2));
    console.log('');

    try {
        const response = await axios.post(API_URL, requestData, {
            headers: {
                'Auth': API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log('✅ Запрос выполнен успешно!');
        console.log('📥 Ответ от SubGram API:');
        console.log('HTTP Status:', response.status);
        console.log('Данные ответа:', JSON.stringify(response.data, null, 2));

        // Анализ ответа
        const { status, code, message } = response.data;
        console.log('\n📊 Анализ ответа:');
        console.log('• Статус:', status);
        console.log('• Код:', code);
        console.log('• Сообщение:', message);

        if (status === 'warning') {
            console.log('🔔 Статус "warning" оз��ачает, что пользователь не подписан на каналы');
            console.log('✅ Это нормальный ответ для тестового пользователя');
        } else if (status === 'ok') {
            console.log('✅ Статус "ok" означает, что пользователь подписан на все каналы');
        } else if (status === 'gender') {
            console.log('👤 Статус "gender" означает, что требуется указать пол пользователя');
        } else if (status === 'error') {
            console.log('❌ Статус "error" означает ошибку в API');
        }

        if (response.data.links && response.data.links.length > 0) {
            console.log(`\n📺 Получено ${response.data.links.length} спонсорских каналов:`);
            response.data.links.slice(0, 3).forEach((link, index) => {
                console.log(`${index + 1}. ${link}`);
            });
        }

        if (response.data.additional?.sponsors) {
            console.log(`\n📋 Детальная информация о ${response.data.additional.sponsors.length} спонсорах:`);
            response.data.additional.sponsors.slice(0, 3).forEach((sponsor, index) => {
                console.log(`${index + 1}. ${sponsor.resource_name || 'Без имени'} - ${sponsor.status}`);
            });
        }

        console.log('\n🎉 ТЕСТ УСПЕШЕН!');
        console.log('✅ API ключ валиден и работает');
        console.log('✅ Запросы с токеном обрабатываются корректно');

    } catch (error) {
        console.error('\n❌ ОШИБКА ЗАПРОСА:', error.message);

        if (error.response) {
            console.error('HTTP Status:', error.response.status);
            console.error('Ответ сервера:', JSON.stringify(error.response.data, null, 2));
            
            if (error.response.status === 401) {
                console.error('🔑 Проблема с аутентификацией - проверьте API ключ');
            } else if (error.response.status === 400) {
                console.error('📝 Неправильный формат запроса');
            } else if (error.response.status === 404) {
                console.error('🔍 API эндпоинт не найден');
            }
        } else if (error.request) {
            console.error('🌐 Проблема с сетевым соединением');
        } else {
            console.error('⚙️ Ошибка н��стройки запроса');
        }

        console.log('\n🛠️ Возможные решения:');
        console.log('1. Проверьте корректность API ключа');
        console.log('2. Убедитесь что SubGram сервис доступен');
        console.log('3. Проверьте что бот добавлен в SubGram с токеном');
    }
}

// Запуск теста
if (require.main === module) {
    testSubGramAPI();
}

module.exports = { testSubGramAPI };
