const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

function checkXlsxData() {
    const dataDir = './xlsx-data';
    
    if (!fs.existsSync(dataDir)) {
        console.log('❌ Папка xlsx-data не найдена');
        return;
    }
    
    const files = fs.readdirSync(dataDir).filter(f => f.endsWith('.xlsx'));
    console.log(`📁 Найдено ${files.length} xlsx файлов:\n`);
    
    files.forEach(file => {
        try {
            const filePath = path.join(dataDir, file);
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`📊 ${file}:`);
            console.log(`   Записей: ${data.length}`);
            
            if (data.length > 0) {
                const firstRow = data[0];
                console.log(`   Поля: ${Object.keys(firstRow).join(', ')}`);
                
                // Показываем даты если есть
                if (firstRow.created_at) {
                    console.log(`   Дата создания первой записи: ${firstRow.created_at}`);
                }
                if (data.length > 1) {
                    const lastRow = data[data.length - 1];
                    if (lastRow.created_at) {
                        console.log(`   Дата создания последней записи: ${lastRow.created_at}`);
                    }
                }
            }
            console.log('');
            
        } catch (error) {
            console.log(`❌ Ошибка чтения ${file}: ${error.message}\n`);
        }
    });
}

checkXlsxData();
