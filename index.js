import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import * as fs from "node:fs";
import sharp from "sharp";
import path from "path";
import { GEMINI_CONFIG } from "./configs/gemini_config.js";
import { upload as uploadToS3 } from "./API/amazonS3API.js";


dotenv.config()

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

export async function processEntity(imagesArray, serverPrompts) {
    const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    });

    const outputDir = "generated_images";
    ensureDirectoryExists(outputDir);

    imagesArray = imagesArray.slice(0, 3)

    const imageUrls = imagesArray;

    // Загружаем изображения только один раз
    console.log("📥 Загрузка изображений...");
    const images = await Promise.all(
        imageUrls.map(url => loadImageFromUrl(url))
    );
    console.log(`✓ Загружено ${images.length} изображений\n`);

    let imageCounter = 1;
    const timestamp = Date.now();
    const uploadedUrls = [];

    // Проходимся по каждому промпту
    for (const [promptIndex, currentPrompt] of serverPrompts.entries()) {
        console.log(`\n🔄 Обработка промпта ${promptIndex + 1}/${serverPrompts.length}`);
        console.log(`📝 Промпт: ${currentPrompt.substring(0, 100)}${currentPrompt.length > 100 ? '...' : ''}\n`);

        const prompt = [
            {
                text: currentPrompt
            },
            ...images
        ];

        const response = await ai.models.generateContent({
            model: "gemini-3-pro-image-preview",
            contents: prompt,
            config: {
                responseModalities: ["Image"],
                imageConfig: {
                    aspectRatio: "3:4",
                    imageSize: "4K",
                }
            }
        });

        console.log("Processing response...\n");

        for (const part of response.candidates[0].content.parts) {
            if (part.text) {
                console.log("📄 Text response:");
                console.log(part.text);
                console.log("\n---\n");
            } else if (part.inlineData) {
                const imageData = part.inlineData.data;
                const buffer = Buffer.from(imageData, "base64");

                const filename = `gemini-image-${timestamp}-${imageCounter}.png`;
                const filePath = path.join(outputDir, filename);
                fs.writeFileSync(filePath, buffer);

                console.log(`✓ Image ${imageCounter} saved as ${filePath}`);

                const resizeResult = await resizeImageTo2304x3080(filePath);

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
        }
    }

    console.log(`\n📊 Итоги:`);
    console.log(`   🎯 Обработано промптов: ${serverPrompts.length}`);
    console.log(`   ✅ Всего изображений сгенерировано: ${imageCounter - 1}`);
    console.log(`   ☁️  Загружено в S3: ${uploadedUrls.length}`);

    if (uploadedUrls.length > 0) {
        console.log(`\n🔗 Ссылки на изображения в S3:`);
        uploadedUrls.forEach((url, index) => {
            console.log(`   ${index + 1}. ${url}`);
        });
    }

    return {
        totalPrompts: serverPrompts.length,
        totalGenerated: imageCounter - 1,
        uploadedUrls: uploadedUrls
    };
}