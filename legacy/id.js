// id.js - CRYSNOVA Session Storage Client
// Uses Cloudflare Worker at https://id.crysnova.qzz.io

const CF_WORKER_URL = 'https://id.crysnova.qzz.io';

/**
 * Upload session to Cloudflare KV and get short ID
 * @param {string} sessionData - JSON string of the complete version-1 auth bundle
 * @param {string} phoneNumber - User's WhatsApp number
 * @returns {Promise<{shortId: string, fullId: string} | null>}
 */
export async function uploadSession(sessionData, phoneNumber) {
    try {
        const response = await fetch(`${CF_WORKER_URL}/session/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone: phoneNumber,
                sessionData: sessionData
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            console.log(`✅ Session stored with ID: ${result.shortId}`);
            return {
                shortId: result.shortId,
                fullId: result.sessionId
            };
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (err) {
        console.error('❌ KV upload failed:', err.message);
        return null;
    }
}

/**
 * Download session from Cloudflare KV using short ID
 * @param {string} shortId - The short ID (e.g., "abc12345")
 * @returns {Promise<string | null>}
 */
export async function downloadSession(shortId) {
    try {
        const response = await fetch(`${CF_WORKER_URL}/session/load/${shortId}`);
        const result = await response.json();
        
        if (result.success) {
            console.log(`✅ Session loaded for ${result.phone}`);
            return result.sessionData;
        } else {
            return null;
        }
    } catch (err) {
        console.error('❌ KV load failed:', err.message);
        return null;
    }
}

/**
 * Delete session from Cloudflare KV
 * @param {string} shortId - The short ID to delete
 * @returns {Promise<boolean>}
 */
export async function deleteSession(shortId) {
    try {
        const response = await fetch(`${CF_WORKER_URL}/session/delete/${shortId}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        return result.success === true;
    } catch (err) {
        console.error('❌ KV delete failed:', err.message);
        return false;
    }
}

/**
 * Generate a short ID locally (for testing)
 * @returns {string}
 */
export function generateShortId() {
    return Math.random().toString(36).substring(2, 10);
}

export const WORKER_URL = CF_WORKER_URL;
