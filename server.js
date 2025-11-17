import express from 'express';
import dotenv from 'dotenv';
import axios from 'axios';
import { processEntity } from './index.js';

dotenv.config();

const GOOGLE_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzqFOuhIscPLHuujTJu6qAv38hNq9E8U2j5ohu2eXrvOtaOrXvPOG7rGI1XyTR6r2q_/exec";

const app = express();
app.use(express.json());

const processingState = {
    isProcessing: false,
    total: 0,
    processed: 0,
    remaining: 0,
    failed: 0,
    currentItem: null,
    startTime: null
};

async function writeToSheet(row, data, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await axios.post(GOOGLE_WEBAPP_URL, [{
                row: row,
                data: data
            }], {
                timeout: 10000
            });
            console.log(`✅ Строка ${row}: записано в таблицу`);
            return true;
        } catch (error) {
            console.error(`❌ Попытка ${attempt}/${retries} - Ошибка записи строки ${row}:`, error.message);

            if (attempt < retries) {
                const delay = attempt * 2000; // 2s, 4s, 6s
                console.log(`⏳ Повтор через ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`❌ Не удалось записать строку ${row} после ${retries} попыток`);
                return false;
            }
        }
    }
}

async function processBatch(items) {
    processingState.isProcessing = true;
    processingState.total = items.length;
    processingState.processed = 0;
    processingState.remaining = items.length;
    processingState.failed = 0;
    processingState.startTime = Date.now();

    console.log(`\n🚀 Начало обработки`);
    console.log(`📊 Всего задач: ${processingState.total}`);

    let i = 0;

    for (const item of items) {
        processingState.currentItem = i + 1;

        try {
            console.log(`\n⏳ Обработка ${i + 1}/${items.length}`);
            console.log(`📝 Промпт: ${item.prompt.substring(0, 50)}...`);
            console.log(`🖼️  Изображений: ${item.imageUrls.length}`);

            const result = await processEntity(item.imageUrls, item.prompt);

            processingState.processed++;
            processingState.remaining--;

            console.log(`✅ Обработано: ${processingState.processed}/${processingState.total}`);
            console.log(`⏱️  Осталось: ${processingState.remaining}`);

            if (!result.uploadedUrls || !result.uploadedUrls.length) {
                processingState.failed++;
                continue;
            }

            if (item.row) {
                const dataToWrite = [
                    ...result.uploadedUrls
                ];
                await writeToSheet(item.row, dataToWrite);
            }

            i++;

        } catch (error) {
            console.error(`❌ Ошибка при обработке элемента ${i + 1}:`, error.message);

            if (item.row) {
                await writeToSheet(item.row, ['❌ Ошибка', new Date().toISOString(), error.message]);
            }

            processingState.failed++;
            processingState.remaining--;
            i++;
        }
    }

    const duration = ((Date.now() - processingState.startTime) / 1000).toFixed(2);
    console.log(`\n🎉 Обработка завершена!`);
    console.log(`✅ Успешно: ${processingState.processed}`);
    console.log(`❌ Ошибок: ${processingState.failed}`);
    console.log(`⏱️  Время: ${duration}s`);

    processingState.isProcessing = false;
    processingState.currentItem = null;
}

app.get('/', async (req, res) => {
    res.send("helllo")
})

app.post('/api/process', async (req, res) => {
    const { items } = req.body;

    console.log(items);

    return res.status(200);

    if (processingState.isProcessing) {
        return res.status(409).json({
            status: 'processing',
            message: 'Идёт обработка предыдущего запроса',
            progress: {
                total: processingState.total,
                processed: processingState.processed,
                remaining: processingState.remaining,
                failed: processingState.failed,
                currentItem: processingState.currentItem,
                percentage: Math.round((processingState.processed / processingState.total) * 100)
            }
        });
    }

    if (!items || !Array.isArray(items)) {
        return res.status(400).json({
            status: 'error',
            error: 'Требуется массив items'
        });
    }

    if (items.length === 0) {
        return res.status(400).json({
            status: 'error',
            error: 'Массив items не может быть пустым'
        });
    }

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.imageUrls || !Array.isArray(item.imageUrls) || item.imageUrls.length === 0) {
            return res.status(400).json({
                status: 'error',
                error: `Элемент ${i + 1}: отсутствует imageUrls`
            });
        }
        if (!item.prompt || typeof item.prompt !== 'string') {
            return res.status(400).json({
                status: 'error',
                error: `Элемент ${i + 1}: отсутствует prompt`
            });
        }
    }

    console.log(`\n📨 Новый запрос получен!`);
    console.log(`📦 Элементов к обработке: ${items.length}`);

    res.json({
        status: 'started',
        message: 'Обработка запущена',
        itemsCount: items.length
    });

    processBatch(items).catch(error => {
        console.error('❌ Критическая ошибка:', error);
        processingState.isProcessing = false;
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
});