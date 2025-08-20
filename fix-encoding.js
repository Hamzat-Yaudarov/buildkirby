#!/usr/bin/env node
/**
 * Script to fix encoding issues in index.js
 */

const fs = require('fs');

console.log('🔧 Fixing encoding issues in index.js...');

try {
    // Read the file
    let content = fs.readFileSync('index.js', 'utf8');
    
    // Track changes
    let changes = 0;
    
    // Fix corrupted messages
    const fixes = [
        // Restart message
        {
            search: /await bot\.editMessageText\('🔄 Пер[^\s]*запуск\.\.\.'/g,
            replace: "await bot.editMessageText('🔄 Перезапу��к...'"
        },
        // Number input message
        {
            search: /💡 Введите только чи[^\s]*ло \(например: 26\)/g,
            replace: "💡 Введите только число (например: 26)"
        },
        // Confirm robot message
        {
            search: /Подт[^\s]*ердите, что вы не роб[^\s]*/g,
            replace: "Подтвердите, что вы не робот"
        },
        // Wait message  
        {
            search: /Подожди[^\s]*е \$\{remainingSeconds\}/g,
            replace: "Подождите ${remainingSeconds}"
        },
        // Processing message
        {
            search: /Обработка массового о[^\s]*клонения/g,
            replace: "Обработка массового отклонения"
        }
    ];
    
    // Apply fixes
    fixes.forEach((fix, index) => {
        const matches = content.match(fix.search);
        if (matches) {
            console.log(`✅ Fix ${index + 1}: Found ${matches.length} occurrence(s)`);
            content = content.replace(fix.search, fix.replace);
            changes += matches.length;
        } else {
            console.log(`⚪ Fix ${index + 1}: No matches found`);
        }
    });
    
    if (changes > 0) {
        // Write the fixed content
        fs.writeFileSync('index.js', content, 'utf8');
        console.log(`✅ Fixed ${changes} encoding issues in index.js`);
    } else {
        console.log('ℹ️ No encoding issues found to fix');
    }
    
} catch (error) {
    console.error('❌ Error fixing encoding:', error.message);
    process.exit(1);
}
