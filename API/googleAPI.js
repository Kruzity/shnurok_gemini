import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { GOOGLE_CONFIG } from "../configs/google_config";

import { JWT } from 'google-auth-library';
import { google } from "googleapis";

import dotenv from "dotenv";
dotenv.config();


var credentials = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadCredentials() {
    return new Promise((res, rej) => {
        try {
            if (!credentials) {
                const credentialsPath = join(__dirname, '../credentials/bitrix-sheet-api-750f664bfe2f.json');
                credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
            }
            return res(credentials);
        } catch (error) {
            return rej(`Failed to load credentials: ${error.message}`)
        }
    })

}

export async function auth() {
    let creds = await loadCredentials();

    const jwtClient = new google.auth.JWT(
        {
            email: creds.client_email,
            key: creds.private_key,
            scopes: GOOGLE_CONFIG.GOOGLE_API_SCOPE
        }
    );
    try {
        await jwtClient.authorize();
        console.log("Successful authorization!")
    }
    catch (err) {
        console.log("Failed authorization " + err)
    }

    return jwtClient;
}

export async function getAuthClient() {
    const creds = await loadCredentials();

    return new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: GOOGLE_CONFIG.GOOGLE_API_SCOPE
    });
}