import { google } from "googleapis";
import path from 'path';
import fs from 'fs';

const getMimeType = (fileName) => {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'image/png';
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const deleteFile = async (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
            console.log(`🗑️  Файл удалён: ${filePath}`);
            return true;
        } else {
            console.log(`⚠️  Файл не найден для удаления: ${filePath}`);
            return false;
        }
    } catch (error) {
        console.error(`❌ Ошибка при удалении файла ${filePath}:`, error.message);
        return false;
    }
};

const retryWithBackoff = async (fn, options = {}) => {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        onRetry = null
    } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries) {
                throw error;
            }

            const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);

            if (onRetry) {
                onRetry(attempt, maxRetries, delay, error);
            } else {
                console.log(`⚠️  Попытка ${attempt}/${maxRetries} не удалась. Повтор через ${delay}ms...`);
                console.log(`   Ошибка: ${error.message}`);
            }

            await sleep(delay);
        }
    }
};

export const uploadFilesToDrive = async (files, options = {}) => {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 10000,
        autoDelete = true
    } = options;

    const jwt = await auth();
    const drive = google.drive({ version: 'v3', auth: jwt });

    const uploadPromises = files.map(async (file, index) => {
        try {
            console.log(`\n📤 Загрузка файла ${index + 1}/${files.length}: ${file.fileName}`);

            const result = await retryWithBackoff(
                () => uploadSingleFile(drive, file),
                {
                    maxRetries,
                    baseDelay,
                    maxDelay,
                    onRetry: (attempt, maxAttempts, delay, error) => {
                        console.log(`⚠️  ${file.fileName}: попытка ${attempt}/${maxAttempts}. Повтор через ${delay}ms`);
                        console.log(`   Ошибка: ${error.message}`);
                    }
                }
            );

            console.log(`✅ ${file.fileName} загружен успешно`);

            if (autoDelete) {
                const deleted = await deleteFile(file.filePath);
                result.deleted = deleted;
            }

            return result;

        } catch (error) {
            console.error(`❌ ${file.fileName}: не удалось загрузить после ${maxRetries} попыток`);
            console.error(`   Финальная ошибка: ${error.message}`);

            return {
                success: false,
                fileName: file.fileName,
                filePath: file.filePath,
                error: error.message,
                deleted: false
            };
        }
    });

    const results = await Promise.allSettled(uploadPromises);

    const uploadResults = results.map(result => {
        if (result.status === 'fulfilled') {
            return result.value;
        } else {
            return {
                success: false,
                error: result.reason.message,
                deleted: false
            };
        }
    });

    const successful = uploadResults.filter(r => r.success).length;
    const failed = uploadResults.filter(r => !r.success).length;
    const deleted = uploadResults.filter(r => r.deleted).length;

    console.log(`\n📊 Итого:`);
    console.log(`   ✅ Загружено: ${successful}`);
    console.log(`   ❌ Ошибок: ${failed}`);
    if (autoDelete) {
        console.log(`   🗑️  Удалено: ${deleted}`);
    }

    return {
        results: uploadResults,
        summary: {
            total: files.length,
            successful: successful,
            failed: failed,
            deleted: deleted
        }
    };
};