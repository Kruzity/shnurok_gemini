import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import * as fs from "node:fs";

dotenv.config()

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

export async function processEntity(imageUrls, text_prompt) {
    const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    });

    // Загружаем изображения
    const images = await Promise.all(
        imageUrls.map(url => loadImageFromUrl(url))
    );

    const prompt = [
        { text: text_prompt },
        ...images
    ];

    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-image",
        contents: prompt,
    });

    // Создаём папку для результатов
    const outputDir = "generated_images";
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    let imageCounter = 1;
    const timestamp = Date.now();

    // Обрабатываем все части ответа
    for (const part of response.candidates[0].content.parts) {
        if (part.text) {
            console.log("📄 Text response:");
            console.log(part.text);
        } else if (part.inlineData) {
            const imageData = part.inlineData.data;
            const buffer = Buffer.from(imageData, "base64");
            const filename = path.join(outputDir, `img-${timestamp}-${imageCounter}.png`);
            fs.writeFileSync(filename, buffer);
            console.log(`✓ Изображение сохранено: ${filename}`);
            imageCounter++;
        }
    }

    return {
        imagesGenerated: imageCounter - 1,
        timestamp
    };
}