/**
 * Максимально безопасная система капчи для защиты от ботов
 * Включает различные типы проверок: математические задачи, эмодзи, логические задачи,
 * анализ поведения и временные ограничения
 */

const crypto = require('crypto');

class CaptchaSystem {
    constructor() {
        // Типы капчи
        this.CAPTCHA_TYPES = {
            MATH: 'math',
            EMOJI: 'emoji', 
            LOGIC: 'logic',
            SEQUENCE: 'sequence',
            TEXT: 'text',
            BEHAVIOR: 'behavior'
        };

        // Сложность капчи - только 2 уровня
        this.DIFFICULTY_LEVELS = {
            EASY: 1,
            HARD: 2
        };

        // Emoji наборы для капчи
        this.EMOJI_SETS = {
            animals: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐸', '🐷', '🐵'],
            fruits: ['🍎', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍑', '🥭', '🍍', '🥝', '🍒', '🥥'],
            transport: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜'],
            nature: ['🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍃', '🪴', '🌱', '🌸', '🌺', '🌻'],
            objects: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒']
        };

        // Математические операции
        this.MATH_OPERATIONS = ['+', '-', '×', '÷'];

        // Логические операции
        this.LOGIC_PATTERNS = [
            'четное_нечетное',
            'больше_меньше', 
            'цвет_форма',
            'алфавит_порядок'
        ];

        // Временные метрики для определения ботов
        this.TIMING_THRESHOLDS = {
            MIN_SOLVE_TIME: 3000,  // Минимум 3 секунды
            MAX_SOLVE_TIME: 300000, // Максимум 5 минут
            SUSPICIOUS_FAST: 1000,  // Подозрительно быстро
            SUSPICIOUS_PATTERN: 5   // Одинаковое время 5 раз подряд
        };

        // Счетчики попыток
        this.userAttempts = new Map();
        this.userTimings = new Map();
        this.userBehavior = new Map();
    }

    /**
     * Генерирует уникальную капчу для пользователя
     */
    generateCaptcha(userId, difficulty = this.DIFFICULTY_LEVELS.EASY) {
        const captchaId = this.generateId();
        const types = Object.values(this.CAPTCHA_TYPES);
        const randomType = types[Math.floor(Math.random() * (types.length - 1))]; // Исключаем behavior
        
        let captcha;
        
        switch (randomType) {
            case this.CAPTCHA_TYPES.MATH:
                captcha = this.generateMathCaptcha(difficulty);
                break;
            case this.CAPTCHA_TYPES.EMOJI:
                captcha = this.generateEmojiCaptcha(difficulty);
                break;
            case this.CAPTCHA_TYPES.LOGIC:
                captcha = this.generateLogicCaptcha(difficulty);
                break;
            case this.CAPTCHA_TYPES.SEQUENCE:
                captcha = this.generateSequenceCaptcha(difficulty);
                break;
            case this.CAPTCHA_TYPES.TEXT:
                captcha = this.generateTextCaptcha(difficulty);
                break;
            default:
                captcha = this.generateMathCaptcha(difficulty);
        }

        captcha.id = captchaId;
        captcha.userId = userId;
        captcha.createdAt = Date.now();
        captcha.type = randomType;
        captcha.difficulty = difficulty;
        captcha.attempts = 0;
        captcha.maxAttempts = 3;

        return captcha;
    }

    /**
     * Математическая капча
     */
    generateMathCaptcha(difficulty) {
        let num1, num2, operation, answer, question;

        switch (difficulty) {
            case this.DIFFICULTY_LEVELS.EASY:
                // Простые операции до 10
                num1 = Math.floor(Math.random() * 10) + 1;
                num2 = Math.floor(Math.random() * 10) + 1;
                operation = ['+', '-'][Math.floor(Math.random() * 2)];
                break;
            case this.DIFFICULTY_LEVELS.HARD:
                // Сложные операции до 50 с умножением и делением
                num1 = Math.floor(Math.random() * 50) + 1;
                num2 = Math.floor(Math.random() * 20) + 1;
                operation = this.MATH_OPERATIONS[Math.floor(Math.random() * 4)];

                // Для деления подбираем делимые числа
                if (operation === '÷') {
                    num2 = Math.floor(Math.random() * 9) + 2; // 2-10
                    num1 = num2 * (Math.floor(Math.random() * 8) + 2); // Делимое число
                }
                break;
        }

        if (!question) {
            question = `${num1} ${operation} ${num2}`;
            answer = this.calculateMath(num1, operation, num2);
        }

        return {
            question: `🧮 **Решите пример:**\n\n${question} = ?`,
            answer: answer.toString(),
            acceptedAnswers: [answer.toString(), answer],
            hints: difficulty >= this.DIFFICULTY_LEVELS.HARD ? 
                [`Результат между ${Math.floor(answer/2)} и ${answer * 2}`] : []
        };
    }

    /**
     * Emoji капча
     */
    generateEmojiCaptcha(difficulty) {
        const categories = Object.keys(this.EMOJI_SETS);
        const category = categories[Math.floor(Math.random() * categories.length)];
        const emojis = this.EMOJI_SETS[category];
        
        let question, answer, variants;

        switch (difficulty) {
            case this.DIFFICULTY_LEVELS.EASY:
                // Найти количество определенного эмодзи
                const targetEmoji = emojis[Math.floor(Math.random() * emojis.length)];
                const count = Math.floor(Math.random() * 3) + 2; // 2-4
                const emojiLine = Array(count).fill(targetEmoji).join('');
                const mixedEmojis = this.shuffleArray([...emojiLine, ...this.getRandomEmojis(emojis, 3, targetEmoji)]).join('');

                question = `🔍 **Сколько ${targetEmoji} вы видите?**\n\n${mixedEmojis}`;
                answer = count.toString();
                break;

            case this.DIFFICULTY_LEVELS.HARD:
                // Найти лишний эмодзи + восстановление последовательности (комбинированная задача)
                if (Math.random() > 0.5) {
                    // Лишний эмодзи
                    const correctEmojis = this.getRandomEmojis(emojis, 4);
                    const wrongEmoji = this.getRandomEmojis(this.getAllEmojisExcept(category), 1)[0];
                    const allEmojis = this.shuffleArray([...correctEmojis, wrongEmoji]);

                    question = `🎯 **Найдите лишний эмодзи (${this.getCategoryName(category)}):**\n\n${allEmojis.join(' ')}`;
                    answer = wrongEmoji;
                } else {
                    // Последовательность с пропуском
                    const sequence = this.getRandomEmojis(emojis, 5);
                    const missingIndex = Math.floor(Math.random() * 5);
                    const missing = sequence[missingIndex];
                    sequence[missingIndex] = '❓';

                    question = `🧩 **Что пропущено в последовательности?**\n\n${sequence.join(' → ')}`;
                    answer = missing;
                }
                break;
        }

        return {
            question,
            answer,
            acceptedAnswers: [answer],
            hints: [`Это из категории: ${this.getCategoryName(category)}`]
        };
    }

    /**
     * Логическая капча
     */
    generateLogicCaptcha(difficulty) {
        const patterns = [
            this.generateNumberLogic.bind(this),
            this.generateWordLogic.bind(this),
            this.generatePatternLogic.bind(this)
        ];

        const generator = patterns[Math.floor(Math.random() * patterns.length)];
        return generator(difficulty);
    }

    /**
     * Последовательность
     */
    generateSequenceCaptcha(difficulty) {
        switch (difficulty) {
            case this.DIFFICULTY_LEVELS.EASY:
                // Простая числовая последовательность
                return this.generateNumberSequence(3);
            case this.DIFFICULTY_LEVELS.HARD:
                // Комбинированные задачи: буквы или сложные числа
                if (Math.random() > 0.5) {
                    return this.generateLetterSequence();
                } else {
                    return this.generateComplexSequence();
                }
        }
    }

    /**
     * Текстовая капча
     */
    generateTextCaptcha(difficulty) {
        const words = [
            'ЗВЕЗДА', 'ТЕЛЕГРАМ', 'КАПЧА', 'ЗАЩИТА', 'БЕЗОПАСНОСТЬ',
            'ПРОВЕРКА', 'СИСТЕМА', 'ПОЛЬЗОВАТЕЛЬ', 'РОБОТ', 'ЧЕЛОВЕК'
        ];

        const word = words[Math.floor(Math.random() * words.length)];
        let question, answer;

        switch (difficulty) {
            case this.DIFFICULTY_LEVELS.EASY:
                // Простое написание
                question = `✏️ **Напишите слово:**\n\n${word}`;
                answer = word;
                break;
            case this.DIFFICULTY_LEVELS.HARD:
                // Комбинированные сложные задачи
                const taskType = Math.floor(Math.random() * 3);
                switch (taskType) {
                    case 0:
                        // Наоборот
                        question = `🔄 **Напишите слово наоборот:**\n\n${word}`;
                        answer = word.split('').reverse().join('');
                        break;
                    case 1:
                        // Без определенной буквы
                        const excludeLetter = word[Math.floor(Math.random() * word.length)];
                        question = `🚫 **Уберите все буквы "${excludeLetter}" из слова:**\n\n${word}`;
                        answer = word.replace(new RegExp(excludeLetter, 'g'), '');
                        break;
                    case 2:
                        // Анаграмма
                        const shuffled = this.shuffleArray(word.split('')).join('');
                        question = `🎲 **Составьте с��ово из букв:**\n\n${shuffled}`;
                        answer = word;
                        break;
                }
                break;
        }

        return {
            question,
            answer,
            acceptedAnswers: [answer, answer.toLowerCase()],
            hints: [`Подсказка: слово из ${word.length} букв`]
        };
    }

    /**
     * Проверка ответа пользователя
     */
    async verifyCaptcha(captcha, userAnswer, responseTime, db) {
        const userId = captcha.userId;
        
        // Анализ поведения
        this.analyzeBehavior(userId, responseTime, userAnswer);
        
        // Проверка времени ответа
        if (responseTime < this.TIMING_THRESHOLDS.MIN_SOLVE_TIME) {
            this.markSuspicious(userId, 'too_fast', responseTime);
            return {
                success: false,
                reason: 'Слишком быстрый ответ. Попробуйте еще раз.',
                suspicious: true
            };
        }

        if (responseTime > this.TIMING_THRESHOLDS.MAX_SOLVE_TIME) {
            return {
                success: false,
                reason: 'Время истекло. Попробуйте еще раз.',
                expired: true
            };
        }

        // Проверка правильности ответа
        const isCorrect = this.checkAnswer(captcha, userAnswer);
        
        if (isCorrect) {
            // Успешное прохождение - записываем в БД
            await this.recordCaptchaSuccess(userId, captcha.type, responseTime, db);
            this.clearUserAttempts(userId);
            
            return {
                success: true,
                message: '✅ Проверка пройдена успешно!'
            };
        } else {
            // Неправильный ответ
            this.incrementAttempts(userId);
            captcha.attempts++;

            if (captcha.attempts >= captcha.maxAttempts) {
                this.markSuspicious(userId, 'max_attempts', captcha.attempts);
                return {
                    success: false,
                    reason: 'Превышено количество попыток. Попробуйте позже.',
                    blocked: true
                };
            }

            return {
                success: false,
                reason: `Неправильный ответ. Осталось попыток: ${captcha.maxAttempts - captcha.attempts}`,
                remainingAttempts: captcha.maxAttempts - captcha.attempts
            };
        }
    }

    /**
     * Проверка нужности капчи для пользователя
     */
    async needsCaptcha(userId, db) {
        try {
            // Проверяем статус прохождения капчи
            const result = await db.executeQuery(
                'SELECT * FROM user_captcha_status WHERE user_id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                return true; // Новый пользователь - нужна капча
            }

            const status = result.rows[0];
            
            // Если уже прошел и не подозрительный
            if (status.is_verified && !status.is_suspicious) {
                return false;
            }

            // Если подозрительный - нужна повторная проверка
            if (status.is_suspicious) {
                return true;
            }

            // Если не прошел - нужна капча
            return !status.is_verified;

        } catch (error) {
            console.error('Error checking captcha need:', error);
            return true; // В случае ошибки требуем капчу
        }
    }

    /**
     * Анализ поведения пользователя
     */
    analyzeBehavior(userId, responseTime, answer) {
        if (!this.userBehavior.has(userId)) {
            this.userBehavior.set(userId, {
                responseTimes: [],
                answers: [],
                patterns: {}
            });
        }

        const behavior = this.userBehavior.get(userId);
        behavior.responseTimes.push(responseTime);
        behavior.answers.push(answer);

        // Анализ паттернов времени ответа
        if (behavior.responseTimes.length >= 3) {
            const recent = behavior.responseTimes.slice(-3);
            const avgTime = recent.reduce((a, b) => a + b, 0) / recent.length;
            const variance = recent.reduce((acc, time) => acc + Math.pow(time - avgTime, 2), 0) / recent.length;
            
            // Очень маленькая дисперсия = подозрительно
            if (variance < 100) {
                this.markSuspicious(userId, 'consistent_timing', variance);
            }
        }

        // Анализ паттернов ответов
        if (behavior.answers.length >= 5) {
            const recentAnswers = behavior.answers.slice(-5);
            const uniqueAnswers = new Set(recentAnswers).size;
            
            // Слишком мало уникальных ответов
            if (uniqueAnswers <= 2) {
                this.markSuspicious(userId, 'repetitive_answers', uniqueAnswers);
            }
        }
    }

    /**
     * Отметить пользователя как подозрительного
     */
    markSuspicious(userId, reason, value) {
        console.log(`[CAPTCHA-SECURITY] User ${userId} marked suspicious: ${reason} (${value})`);
        
        if (!this.userBehavior.has(userId)) {
            this.userBehavior.set(userId, { suspicious: [] });
        }
        
        const behavior = this.userBehavior.get(userId);
        if (!behavior.suspicious) behavior.suspicious = [];
        
        behavior.suspicious.push({
            reason,
            value,
            timestamp: Date.now()
        });
    }

    /**
     * Запись успешного прохождения в БД
     */
    async recordCaptchaSuccess(userId, captchaType, responseTime, db) {
        try {
            const behavior = this.userBehavior.get(userId);
            const suspiciousEvents = behavior?.suspicious || [];
            const isSuspicious = suspiciousEvents.length > 0;

            await db.executeQuery(`
                INSERT INTO user_captcha_status (user_id, is_verified, captcha_type, response_time, is_suspicious, verification_date)
                VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                ON CONFLICT (user_id) 
                DO UPDATE SET 
                    is_verified = $2,
                    captcha_type = $3,
                    response_time = $4,
                    is_suspicious = $5,
                    verification_date = CURRENT_TIMESTAMP,
                    attempt_count = 0
            `, [userId, true, captchaType, responseTime, isSuspicious]);

            // Записываем детали подозрительного поведения
            if (isSuspicious) {
                for (const event of suspiciousEvents) {
                    await db.executeQuery(`
                        INSERT INTO captcha_suspicious_activity (user_id, activity_type, activity_value, detected_at)
                        VALUES ($1, $2, $3, $4)
                    `, [userId, event.reason, event.value.toString(), new Date(event.timestamp)]);
                }
            }

        } catch (error) {
            console.error('Error recording captcha success:', error);
        }
    }

    // ============ ВС��ОМОГАТЕЛЬНЫЕ МЕТОДЫ ============

    generateId() {
        return crypto.randomBytes(16).toString('hex');
    }

    calculateMath(num1, operation, num2, operation2 = null, num3 = null) {
        let result;
        switch (operation) {
            case '+':
                result = num1 + num2;
                break;
            case '-':
                result = num1 - num2;
                break;
            case '×':
                result = num1 * num2;
                break;
            case '÷':
                result = Math.floor(num1 / num2);
                break;
        }

        if (operation2 && num3 !== null) {
            switch (operation2) {
                case '+':
                    result = result + num3;
                    break;
                case '-':
                    result = result - num3;
                    break;
                case '×':
                    result = result * num3;
                    break;
                case '÷':
                    result = Math.floor(result / num3);
                    break;
            }
        }

        return result;
    }

    checkAnswer(captcha, userAnswer) {
        const cleanAnswer = userAnswer.toString().toLowerCase().trim();
        return captcha.acceptedAnswers.some(answer => 
            answer.toString().toLowerCase().trim() === cleanAnswer
        );
    }

    shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    getRandomEmojis(emojis, count, exclude = null) {
        const filtered = exclude ? emojis.filter(e => e !== exclude) : emojis;
        const shuffled = this.shuffleArray(filtered);
        return shuffled.slice(0, count);
    }

    getAllEmojisExcept(excludeCategory) {
        const allEmojis = [];
        for (const [category, emojis] of Object.entries(this.EMOJI_SETS)) {
            if (category !== excludeCategory) {
                allEmojis.push(...emojis);
            }
        }
        return allEmojis;
    }

    getCategoryName(category) {
        const names = {
            animals: 'животные',
            fruits: 'фрукты',
            transport: 'транспорт',
            nature: 'природа',
            objects: 'предметы'
        };
        return names[category] || category;
    }

    generateEmojiPattern(emojis) {
        const emoji1 = emojis[0];
        const emoji2 = emojis[1];
        const pattern = [emoji1, emoji2, emoji1, emoji2, '❓'];
        
        return {
            question: pattern.join(' → '),
            answer: emoji1
        };
    }

    generateNumberLogic(difficulty) {
        switch (difficulty) {
            case this.DIFFICULTY_LEVELS.EASY:
                // Простые четные числа
                const nums = [2, 4, 6, 8];
                return {
                    question: `🔢 **Найдите закономерность:**\n\n${nums.join(', ')}, ?`,
                    answer: '10',
                    acceptedAnswers: ['10'],
                    hints: ['Четные числа']
                };

            case this.DIFFICULTY_LEVELS.HARD:
                // Квадраты чисел или более сложные последовательности
                if (Math.random() > 0.5) {
                    const sequence = [1, 4, 9, 16];
                    return {
                        question: `🧮 **Продолжите последовательность:**\n\n${sequence.join(', ')}, ?`,
                        answer: '25',
                        acceptedAnswers: ['25'],
                        hints: ['Квадраты чисел: 1², 2², 3², 4², ?']
                    };
                } else {
                    const sequence = [2, 6, 12, 20];
                    return {
                        question: `🧠 **Какое число следующее:**\n\n${sequence.join(', ')}, ?`,
                        answer: '30',
                        acceptedAnswers: ['30'],
                        hints: ['n×(n+1): 1×2, 2×3, 3×4, 4×5, ?']
                    };
                }

            default:
                return this.generateNumberLogic(this.DIFFICULTY_LEVELS.EASY);
        }
    }

    generateWordLogic(difficulty) {
        const words = ['КОТ', 'СОБАКА', 'МЫШЬ'];
        return {
            question: `📝 **Что объединяет эти слова?**\n\n${words.join(', ')}`,
            answer: 'ЖИВОТНЫЕ',
            acceptedAnswers: ['ЖИВОТНЫЕ', 'животные', 'ЗВЕРИ', 'звери'],
            hints: ['Они все живые']
        };
    }

    generatePatternLogic(difficulty) {
        return {
            question: `🎯 **Выберите правильный вариант:**\n\n🔴🔵 → 🔵🔴\n🟡🟢 → ?`,
            answer: '🟢🟡',
            acceptedAnswers: ['🟢🟡'],
            hints: ['Порядок меняется местами']
        };
    }

    generateNumberSequence(length) {
        const start = Math.floor(Math.random() * 10) + 1;
        const step = Math.floor(Math.random() * 5) + 1;
        const sequence = [];
        
        for (let i = 0; i < length; i++) {
            sequence.push(start + (i * step));
        }
        
        const next = start + (length * step);
        
        return {
            question: `🔢 **Продолжите последовательность:**\n\n${sequence.join(', ')}, ?`,
            answer: next.toString(),
            acceptedAnswers: [next.toString()],
            hints: [`Разность: ${step}`]
        };
    }

    generateLetterSequence() {
        const letters = ['А', 'Б', 'В', 'Г'];
        return {
            question: `🔤 **Продолжите:**\n\n${letters.join(', ')}, ?`,
            answer: 'Д',
            acceptedAnswers: ['Д', 'д'],
            hints: ['Алфавитный порядок']
        };
    }

    generateComplexSequence() {
        const fib = [1, 1, 2, 3];
        return {
            question: `🌀 **Найдите следующее число:**\n\n${fib.join(', ')}, ?`,
            answer: '5',
            acceptedAnswers: ['5'],
            hints: ['Сумма двух предыдущих']
        };
    }

    incrementAttempts(userId) {
        const current = this.userAttempts.get(userId) || 0;
        this.userAttempts.set(userId, current + 1);
    }

    clearUserAttempts(userId) {
        this.userAttempts.delete(userId);
        // Оставляем поведенческие данные для анализа
    }

    /**
     * Получить статистику капчи для админов
     */
    async getCaptchaStats(db) {
        try {
            const result = await db.executeQuery(`
                SELECT 
                    COUNT(*) as total_users,
                    COUNT(*) FILTER (WHERE is_verified = true) as verified_users,
                    COUNT(*) FILTER (WHERE is_suspicious = true) as suspicious_users,
                    AVG(response_time) as avg_response_time,
                    COUNT(*) FILTER (WHERE captcha_type = 'math') as math_captchas,
                    COUNT(*) FILTER (WHERE captcha_type = 'emoji') as emoji_captchas,
                    COUNT(*) FILTER (WHERE captcha_type = 'logic') as logic_captchas
                FROM user_captcha_status
            `);

            return result.rows[0];
        } catch (error) {
            console.error('Error getting captcha stats:', error);
            return null;
        }
    }

    /**
     * Сброс статуса капчи для пользователя (админ функция)
     */
    async resetUserCaptcha(userId, db) {
        try {
            await db.executeQuery('DELETE FROM user_captcha_status WHERE user_id = $1', [userId]);
            await db.executeQuery('DELETE FROM captcha_suspicious_activity WHERE user_id = $1', [userId]);
            
            // Очистка локальных данных
            this.userAttempts.delete(userId);
            this.userBehavior.delete(userId);
            this.userTimings.delete(userId);
            
            return true;
        } catch (error) {
            console.error('Error resetting user captcha:', error);
            return false;
        }
    }
}

// Создаем глобальный экземпляр
const captchaSystem = new CaptchaSystem();

module.exports = {
    CaptchaSystem,
    captchaSystem
};
