import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import * as fs from "node:fs";
import sharp from "sharp";
import path from "path";
import { GEMINI_CONFIG } from "./configs/gemini_config.js";
import { upload as uploadToS3 } from "./API/amazonS3API.js";
import { VertexAI } from '@google-cloud/vertexai';


dotenv.config();

const vertexAI = new VertexAI({
    project: process.env.GOOGLE_CLOUD_PROJECT_ID, // ID проекта
    location: 'europe-west1', // или us-central1
    keyFilename: './credentials/gen-lang-client-0899262511-8141dc1b646c.json'
});

// Функция для создания папки, если её нет
function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`📁 Создана папка: ${dirPath}`);
    }
}

// Функция для удаления файла
async function deleteFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  Файл удалён: ${filePath}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error(`❌ Ошибка при удалении файла ${filePath}:`, error.message);
        return false;
    }
}

async function loadImageFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.statusText}`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString("base64");

    let mimeType = response.headers.get("content-type") || "image/jpeg";

    return {
        inlineData: {
            mimeType: mimeType,
            data: base64Image,
        },
    };
}

async function resizeImageTo2304x3080(imagePath) {
    try {
        const metadata = await sharp(imagePath).metadata();
        const currentWidth = metadata.width;
        const currentHeight = metadata.height;

        console.log(`📐 Текущее разрешение: ${currentWidth}x${currentHeight}`);

        if (currentWidth === 2304 && currentHeight === 3080) {
            console.log(`✅ Разрешение уже 2304x3080, изменение не требуется`);
            return { resized: false, width: currentWidth, height: currentHeight };
        }

        console.log(`🔄 Масштабирование до 2304x3080...`);

        await sharp(imagePath)
            .resize(2304, 3080, {
                fit: 'fill',
                kernel: sharp.kernel.lanczos3
            })
            .toFile(imagePath + '.temp');

        fs.unlinkSync(imagePath);
        fs.renameSync(imagePath + '.temp', imagePath);

        console.log(`✅ Изображение масштабировано до 2304x3080`);

        return { resized: true, width: 2304, height: 3080 };

    } catch (error) {
        console.error(`❌ Ошибка при масштабировании:`, error.message);
        throw error;
    }
}

export async function processEntity(imagesArray, serverPrompt) {
    const model = vertexAI.getGenerativeModel({
        model: 'gemini-2.0-flash-exp'
    });

    const outputDir = "generated_images";
    ensureDirectoryExists(outputDir);

    const imageUrls = imagesArray

    console.log("🔗 Подготовка изображений...");
    console.log(`📝 Промпт: ${serverPrompt.substring(0, 100)}...`);
    console.log(`🖼️  Изображений: ${imageUrls.length}`);

    // Загружаем reference изображения
    let referenceImages;
    try {
        console.log("⏳ Загрузка изображений из URL...");
        referenceImages = await Promise.all(
            imageUrls.map(async (url, index) => {
                console.log(`   ${index + 1}. Загружаю: ${url}`);
                return await loadImageFromUrl(url);
            })
        );
        console.log("✅ Все изображения загружены");
    } catch (error) {
        console.error("❌ Ошибка загрузки изображений:");
        console.error("   Message:", error.message);
        console.error("   Stack:", error.stack);
        console.error("   Cause:", error.cause);
        throw error;
    }

    // Модель Imagen 3 для генерации
    console.log("🔧 Инициализация Imagen модели...");
    console.log("   Project:", process.env.GOOGLE_CLOUD_PROJECT);
    console.log("   Location: us-central1");

    let imagenModel;
    try {
        imagenModel = vertexAI.preview.getGenerativeModel({
            model: 'imagegeneration@006',
        });
        console.log("✅ Модель инициализирована");
    } catch (error) {
        console.error("❌ Ошибка инициализации модели:");
        console.error("   Message:", error.message);
        console.error("   Stack:", error.stack);
        throw error;
    }

    console.log("🔗 Отправка запроса к Imagen 3...");

    const enhancedPrompt = `${serverPrompt}. Style and composition based on provided reference images.`;

    console.log("📋 Параметры запроса:");
    console.log("   Промпт длина:", enhancedPrompt.length);
    console.log("   Reference изображений:", referenceImages.length);

    const request = {
        prompt: enhancedPrompt,
        numberOfImages: 6,
        aspectRatio: '3:4',
        sampleCount: 6,
    };

    console.log("📤 Отправляю запрос...");
    let response;
    try {
        response = await imagenModel.generateImages(request);
        console.log("✅ Ответ получен!");
        console.log("   Predictions:", response.predictions ? response.predictions.length : 'undefined');
    } catch (error) {
        console.error("❌ ДЕТАЛЬНАЯ ОШИБКА:");
        console.error("   Type:", error.constructor.name);
        console.error("   Message:", error.message);
        console.error("   Code:", error.code);
        console.error("   Status:", error.status);
        console.error("   StatusCode:", error.statusCode);
        console.error("   Details:", JSON.stringify(error.details, null, 2));
        console.error("   Stack:", error.stack);

        // Если есть причина (cause)
        if (error.cause) {
            console.error("   Cause:", error.cause);
            console.error("   Cause message:", error.cause.message);
            console.error("   Cause code:", error.cause.code);
        }

        // Если есть response
        if (error.response) {
            console.error("   Response status:", error.response.status);
            console.error("   Response data:", JSON.stringify(error.response.data, null, 2));
        }

        throw error;
    }

    console.log("✅ Изображения сгенерированы!");

    let imageCounter = 1;
    const timestamp = Date.now();
    const uploadedUrls = [];

    // Обработка сгенерированных изображений
    for (const prediction of response.predictions) {
        const imageData = prediction.bytesBase64Encoded;
        const buffer = Buffer.from(imageData, "base64");

        const filename = `imagen-${timestamp}-${imageCounter}.png`;
        const filePath = path.join(outputDir, filename);
        fs.writeFileSync(filePath, buffer);

        console.log(`✓ Image ${imageCounter} saved as ${filePath}`);

        // Ресайз
        await resizeImageTo2304x3080(filePath);

        try {
            console.log(`📤 Загрузка изображения ${imageCounter} в S3...`);
            const s3Key = `photos/${filename}`;
            const s3Url = await uploadToS3(filePath, s3Key);
            uploadedUrls.push(s3Url);

            await deleteFile(filePath);
        } catch (error) {
            console.error(`❌ Ошибка при загрузке изображения ${imageCounter} в S3:`, error.message);
        }

        imageCounter++;
    }

    console.log(`\n📊 Итоги:`);
    console.log(`   ✅ Всего изображений сгенерировано: ${imageCounter - 1}`);
    console.log(`   ☁️  Загружено в S3: ${uploadedUrls.length}`);

    if (uploadedUrls.length > 0) {
        console.log(`\n🔗 Ссылки на изображения в S3:`);
        uploadedUrls.forEach((url, index) => {
            console.log(`   ${index + 1}. ${url}`);
        });
    }

    return {
        totalGenerated: imageCounter - 1,
        uploadedUrls: uploadedUrls
    };
}