import { Storage, File } from 'megajs';
import crypto from 'crypto';
import fs from 'fs';

const auth = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
};

const MAPPING_FILE = './session_mappings.json';

// Generate short ID (8 characters)
function generateShortId() {
    return crypto.randomBytes(4).toString('hex'); // 8 chars
}

// Upload session to Mega and return short ID
export const uploadSession = async (sessionData, phoneNumber) => {
    const shortId = generateShortId();
    const fileName = `session_${phoneNumber}_${shortId}.json`;

    let storage;

    try {
        // megajs v1.x: await new Storage(auth).ready
        storage = await new Storage(auth).ready;

        const buffer = Buffer.from(sessionData);

        // megajs v1.x: storage.upload(name, data).complete returns the uploaded file
        const file = await storage.upload(fileName, buffer).complete;

        // Get shareable link
        const link = await file.link();

        // Save mapping
        await saveMapping(shortId, link, phoneNumber);

        // Close storage connection
        storage.close();

        return {
            shortId: shortId,
            fullId: `CODY_AI!M:${shortId}`,
            message: `Session stored on Mega! ID: ${shortId}`
        };

    } catch (err) {
        if (storage) {
            try { storage.close(); } catch (e) { /* ignore */ }
        }
        throw err;
    }
};

// Download session from Mega using short ID
export const downloadSession = async (shortId) => {
    const megaUrl = await getMapping(shortId);
    if (!megaUrl) throw new Error('Session not found on Mega');

    const file = File.fromURL(megaUrl);
    await file.loadAttributes();
    const buffer = await file.downloadBuffer();
    return buffer.toString('utf8');
};

// Store mapping in JSON file
async function saveMapping(shortId, megaUrl, phoneNumber) {
    let mappings = {};
    if (fs.existsSync(MAPPING_FILE)) {
        mappings = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    }
    mappings[shortId] = { megaUrl, phoneNumber, createdAt: Date.now() };
    fs.writeFileSync(MAPPING_FILE, JSON.stringify(mappings, null, 2));
}

async function getMapping(shortId) {
    if (!fs.existsSync(MAPPING_FILE)) return null;
    const mappings = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    return mappings[shortId]?.megaUrl || null;
}

// Clean old sessions (older than 30 days)
export const cleanOldSessions = () => {
    if (!fs.existsSync(MAPPING_FILE)) return;
    let mappings = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

    let changed = false;
    for (const [id, data] of Object.entries(mappings)) {
        if (now - data.createdAt > THIRTY_DAYS) {
            delete mappings[id];
            changed = true;
        }
    }
    if (changed) {
        fs.writeFileSync(MAPPING_FILE, JSON.stringify(mappings, null, 2));
    }
};

// Get all sessions (for admin)
export const listSessions = () => {
    if (!fs.existsSync(MAPPING_FILE)) return {};
    return JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));
};
