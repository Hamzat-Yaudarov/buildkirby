const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('bot.db');

// Функция для добавления задания
function addTask(channelId, channelName, reward = 1) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO tasks (channel_id, channel_name, reward) VALUES (?, ?, ?)',
            [channelId, channelName, reward],
            function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`✅ Задание добавлено: ${channelName} (ID: ${this.lastID})`);
                    resolve(this.lastID);
                }
            }
        );
    });
}

// Функция для добавления лотереи
function addLottery(name, ticketPrice, maxTickets, winnersCount) {
    return new Promise((resolve, reject) => {
        db.run(
            'INSERT INTO lotteries (name, ticket_price, max_tickets, winners_count) VALUES (?, ?, ?, ?)',
            [name, ticketPrice, maxTickets, winnersCount],
            function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`🎰 Лотерея добавлена: ${name} (ID: ${this.lastID})`);
                    resolve(this.lastID);
                }
            }
        );
    });
}

// Функция для просмотра статистики
function getStats() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                COUNT(*) as total_users,
                SUM(balance) as total_balance,
                SUM(referrals_count) as total_referrals
            FROM users
        `, [], (err, stats) => {
            if (err) {
                reject(err);
            } else {
                console.log('\n📊 Статистика бота:');
                console.log(`👥 Всего пользователей: ${stats[0].total_users}`);
                console.log(`⭐️ Общий баланс: ${stats[0].total_balance || 0}`);
                console.log(`🔗 Всего рефералов: ${stats[0].total_referrals || 0}`);
                resolve(stats[0]);
            }
        });
    });
}

// Функция для получения топ пользователей
function getTopUsers() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT first_name, referrals_count, balance 
            FROM users 
            ORDER BY referrals_count DESC 
            LIMIT 10
        `, [], (err, users) => {
            if (err) {
                reject(err);
            } else {
                console.log('\n🏆 Топ пользователей:');
                users.forEach((user, index) => {
                    console.log(`${index + 1}. ${user.first_name} - ${user.referrals_count} реферал��в, ${user.balance} ⭐️`);
                });
                resolve(users);
            }
        });
    });
}

// Примеры использования
async function main() {
    try {
        console.log('🔧 Инструменты администратора бота\n');
        
        // Добавить примеры заданий (раскомментируйте при необходимости)
        /*
        await addTask('@yourchannel1', 'Ваш канал 1', 2);
        await addTask('@yourchannel2', 'Ваш канал 2', 2);
        await addTask('@yourchannel3', 'Ваш канал 3', 3);
        */
        
        // Добавить примеры лотерей (раскомментируйте при необходимости)
        /*
        await addLottery('Еженедельная лотерея', 5, 100, 10);
        await addLottery('Мега-лотерея', 10, 50, 5);
        */
        
        // Показать статистику
        await getStats();
        await getTopUsers();
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    } finally {
        db.close();
    }
}

// Если файл запускается напрямую
if (require.main === module) {
    main();
}

module.exports = {
    addTask,
    addLottery,
    getStats,
    getTopUsers
};
