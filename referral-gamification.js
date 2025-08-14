// Система геймификации рефералов

// Титулы и статусы
const REFERRAL_TITLES = {
    0: { name: "Новичок", emoji: "🌱", benefits: [] },
    5: { name: "Активист", emoji: "⭐", benefits: ["daily_bonus"] },
    25: { name: "Амбассадор", emoji: "🏆", benefits: ["vip_chat", "early_access"] },
    100: { name: "Легенда", emoji: "👑", benefits: ["personal_manager", "exclusive_features"] },
    500: { name: "Мастер", emoji: "💎", benefits: ["all_privileges"] }
};

// Достижения
const ACHIEVEMENTS = {
    first_friend: { name: "Первый друг", reward: 10, emoji: "🎉" },
    social_butterfly: { name: "Социальная бабочка", condition: "5 рефералов за день", reward: 25 },
    family_circle: { name: "Семейный круг", condition: "Привести 3 родственников", reward: 50 },
    streak_week: { name: "Недельная серия", condition: "7 дней подряд новые рефералы", reward: 100 },
    hundred_club: { name: "Клуб ста", condition: "100 рефералов", reward: 500 }
};

// Система прогресса
function calculateProgress(referrals) {
    const levels = Object.keys(REFERRAL_TITLES).map(Number).sort((a, b) => a - b);
    const currentLevel = levels.reverse().find(level => referrals >= level) || 0;
    const nextLevel = levels.find(level => level > referrals);
    
    return {
        current: REFERRAL_TITLES[currentLevel],
        next: nextLevel ? REFERRAL_TITLES[nextLevel] : null,
        progress: nextLevel ? referrals - currentLevel : 100,
        needed: nextLevel ? nextLevel - referrals : 0
    };
}

// Реферальные кейсы
const REFERRAL_CASES = {
    bronze: { requirement: 5, rewards: [10, 15, 20, 25], rarity: "common" },
    silver: { requirement: 25, rewards: [50, 75, 100], rarity: "rare" },
    gold: { requirement: 100, rewards: [200, 300, 500], rarity: "epic" },
    diamond: { requirement: 500, rewards: [1000, 1500, 2000], rarity: "legendary" }
};

// Турнирная система
class ReferralTournament {
    constructor() {
        this.participants = new Map();
        this.startTime = Date.now();
        this.duration = 7 * 24 * 60 * 60 * 1000; // 7 дней
    }
    
    addReferral(userId) {
        const current = this.participants.get(userId) || 0;
        this.participants.set(userId, current + 1);
    }
    
    getLeaderboard() {
        return Array.from(this.participants.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);
    }
    
    isActive() {
        return Date.now() - this.startTime < this.duration;
    }
}

// Стрики (серии)
function calculateStreak(user) {
    const today = new Date().toDateString();
    const lastReferral = user.last_referral_date;
    const currentStreak = user.referral_streak || 0;
    
    if (lastReferral === today) {
        return currentStreak; // Уже приглашал сегодня
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    
    if (lastReferral === yesterday.toDateString()) {
        return currentStreak + 1; // Продолжение серии
    }
    
    return 1; // Новая серия
}

// Социальные функции
function createReferralTeam(leaderId, teamName) {
    return {
        id: generateTeamId(),
        name: teamName,
        leader: leaderId,
        members: [leaderId],
        totalReferrals: 0,
        goals: {
            weekly: 50,
            monthly: 200
        },
        rewards: {
            teamBonus: 1.2, // 20% бонус к наградам
            exclusiveAccess: true
        }
    };
}

// Временные события
const SPECIAL_EVENTS = {
    weekend_boost: {
        name: "Выходные рефералов",
        multiplier: 2,
        condition: (date) => date.getDay() === 0 || date.getDay() === 6
    },
    friend_week: {
        name: "Неделя друзей",
        bonusRewards: [100, 200, 300],
        duration: 7 * 24 * 60 * 60 * 1000
    },
    holiday_special: {
        name: "Праздничный марафон",
        specialPrizes: ["premium_access", "exclusive_avatar", "bonus_multiplier"]
    }
};

// Система уведомлений
function sendAchievementNotification(userId, achievement) {
    const message = `
🎉 **Новое достижение!**

🏆 **${achievement.name}**
${achievement.emoji} Награда: +${achievement.reward} ⭐

💪 Продолжайте в том же духе!
    `;
    
    return message;
}

function sendProgressNotification(userId, progress) {
    const message = `
📈 **Прогресс рефералов**

${progress.current.emoji} Текущий статус: **${progress.current.name}**

${progress.next ? `
🎯 До следующего уровня: ${progress.needed} рефералов
📊 Прогресс: ${'█'.repeat(Math.floor(progress.progress/10))}${'░'.repeat(10-Math.floor(progress.progress/10))} ${Math.floor(progress.progress)}%

🎁 **Следующий уровень:** ${progress.next.emoji} ${progress.next.name}
💎 **Привилегии:** ${progress.next.benefits.join(', ')}
` : '👑 **Вы достигли максимального уровня!**'}
    `;
    
    return message;
}

// Экспорт функций
module.exports = {
    REFERRAL_TITLES,
    ACHIEVEMENTS,
    calculateProgress,
    ReferralTournament,
    calculateStreak,
    createReferralTeam,
    SPECIAL_EVENTS,
    sendAchievementNotification,
    sendProgressNotification
};
