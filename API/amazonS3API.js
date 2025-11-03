import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import dotenv from "dotenv";
dotenv.config()

const s3 = new S3Client({
    region: 'eu-central-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

const bucket = process.env.AWS_BUCKET;
const cloudFrontDomain = process.env.AWS_CLOUD_FRONT_DOMAIN;

function getPublicUrl(key) {
    return `https://${cloudFrontDomain}/${key}`;
}

export async function upload(filePath, key) {
    const file = readFileSync(filePath);

    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file,
        ContentType: 'image/jpeg'
    }));

    const url = getPublicUrl(key);
    console.log('Загружено:', url);
    return url;
}

// async function main(){
//     let url = await upload("./gemini-image-1.png", "photos/test.png");

//     console.log(url)
// }

// main()