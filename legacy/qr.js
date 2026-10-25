import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } from 'plogme';
import { delay } from 'plogme';
import QRCode from 'qrcode';
import { uploadSession } from './id.js';

const router = express.Router();
const QR_SESSION_ROOT = path.resolve(process.env.CODY_PAIR_QR_SESSION_DIR || path.join(os.tmpdir(), 'cody-qr-sessions'));
fs.mkdirSync(QR_SESSION_ROOT, { recursive: true });

function encodeAuthBundle(sessionDir) {
    const files = {};
    for (const entry of fs.readdirSync(sessionDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        files[entry.name] = fs.readFileSync(path.join(sessionDir, entry.name), 'utf8');
    }
    const names = Object.keys(files);
    if (!names.includes('creds.json')) throw new Error('Auth bundle is missing creds.json');
    if (!names.some(name => name.startsWith('app-state-sync-key-') && name.endsWith('.json'))) {
        throw new Error('Auth bundle is missing app-state-sync-key-*.json; wait for WhatsApp app-state sync and retry');
    }
    return JSON.stringify({ version: 1, files });
}

function hasAppStateKeyFile(sessionDir) {
    return fs.readdirSync(sessionDir, { withFileTypes: true }).some(entry =>
        entry.isFile() && entry.name.startsWith('app-state-sync-key-') && entry.name.endsWith('.json')
    );
}

async function waitForAppStateBundle(sessionDir, sock) {
    for (let attempt = 0; attempt < 30; attempt++) {
        if (hasAppStateKeyFile(sessionDir)) return true;
        if (attempt === 0 && typeof sock?.resyncAppState === 'function') {
            try { await sock.resyncAppState(['regular_high', 'regular_low', 'regular'], true); }
            catch (error) { console.warn('App-state resync request failed:', error?.message || error); }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return hasAppStateKeyFile(sessionDir);
}

const AUTO_FOLLOW_NEWSLETTERS = [
    '120363402922206865@newsletter',
    '120363423670814885@newsletter',
];

async function autoFollowNewsletters(sock) {
    if (typeof sock?.newsletterFollow !== 'function') {
        console.warn('Newsletter auto-follow unavailable in this plogme runtime');
        return;
    }
    for (const jid of AUTO_FOLLOW_NEWSLETTERS) {
        try {
            await sock.newsletterFollow(jid);
            console.log(`✅ Auto-followed newsletter ${jid}`);
        } catch (error) {
            // Following is best-effort: a previously-followed or unavailable
            // channel must not prevent the complete session from being issued.
            console.warn(`⚠️ Newsletter auto-follow failed for ${jid}:`, error?.message || error);
        }
    }
}

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
        return true;
    } catch (e) {
        console.error('Error removing file:', e);
        return false;
    }
}

const retryAttempts = new Map();
const qrResults = new Map(); // sessionId -> { number, sessionId: <whatsapp session id> } — read once by GET /qr/status

router.get('/', async (req, res) => {
    const format = String(req.query.format || 'shortid').toLowerCase() === 'b64' ? 'b64' : 'shortid';
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs = path.join(QR_SESSION_ROOT, `session_${sessionId}`);

    retryAttempts.set(sessionId, 0);

    async function initiateSession(isRetry = false) {
        if (!fs.existsSync(dirs)) fs.mkdirSync(dirs, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const fallbackVersion = [2, 3000, 1047412487];
            const configuredVersion = String(process.env.CODY_PAIR_WA_VERSION || '').split('.').map(Number);
            const version = configuredVersion.length === 3 && configuredVersion.every(Number.isInteger)
                ? configuredVersion
                : fallbackVersion;

            let qrGenerated = false;
            let responseSent = false;
            let messagesSent = false;

            const handleQRCode = async (qr) => {
                if (qrGenerated || responseSent) return;

                qrGenerated = true;
                console.log('📱 QR Code Generated!');

                try {
                    const qrDataURL = await QRCode.toDataURL(qr, {
                        errorCorrectionLevel: 'M',
                        type: 'image/png',
                        quality: 0.92,
                        margin: 1,
                        color: { dark: '#000000', light: '#FFFFFF' }
                    });

                    if (!responseSent) {
                        responseSent = true;
                        await res.send({ 
                            qr: qrDataURL, 
                            sessionId: sessionId,
                            message: 'QR Code Generated! Scan it with your WhatsApp app.',
                            instructions: [
                                '1. Open WhatsApp on your phone',
                                '2. Go to Settings > Linked Devices',
                                '3. Tap "Link a Device"',
                                '4. Scan the QR code above'
                            ]
                        });
                    }
                } catch (qrError) {
                    console.error('Error generating QR code:', qrError);
                    if (!responseSent) {
                        responseSent = true;
                        res.status(500).send({ code: 'Failed to generate QR code' });
                    }
                }
            };

            const socketConfig = {
                version,
                logger: pino({ level: 'silent' }),
                browser: Browsers.ubuntu('Chrome'),
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
                },
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 30000,
                connectTimeoutMs: 30000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5,
            };

            let sock = makeWASocket(socketConfig);

            const handleConnectionUpdate = async (update) => {
                const { connection, lastDisconnect, qr } = update;

                if (qr && !qrGenerated) {
                    await handleQRCode(qr);
                }

                if (connection === 'open' && !messagesSent) {
                    messagesSent = true;
                    console.log('✅ Connected successfully!');
                    
                    retryAttempts.delete(sessionId);

                    try {
                        const userJid = Object.keys(sock.authState.creds.me || {}).length > 0 
                            ? jidNormalizedUser(sock.authState.creds.me.id) 
                            : null;

                        if (userJid) {
                            const ready = await waitForAppStateBundle(dirs, sock);
                            if (!ready) {
                                await sock.sendMessage(userJid, { text: '✘ WhatsApp app-state sync did not finish. Please try pairing again.' });
                                return;
                            }
                            await autoFollowNewsletters(sock);
                            await saveCreds();
                            const sessionData = encodeAuthBundle(dirs);
                            const sessionBase64 = Buffer.from(sessionData, 'utf8').toString('base64');
                            const phoneNumber = userJid.split('@')[0];
                            const uploadResult = await uploadSession(sessionData, phoneNumber);
            const base64Id = `CODY_AI!${sessionBase64}`;
            let sessionIdText = base64Id;
            let copyIdText = base64Id;
            let shortId = null;

            if (format === 'shortid' && uploadResult?.fullId) {
                sessionIdText = uploadResult.fullId;
                copyIdText = uploadResult.fullId;
                shortId = uploadResult.shortId || uploadResult.fullId;
                console.log("📦 Short ID:", shortId);
            } else {
                console.log("🔐 Base64 session");
            }

                            // Make number + session available to the site (Generate Script tab polls this)
                            qrResults.set(sessionId, { number: phoneNumber, sessionId: sessionIdText, shortId, base64Id });

                            // ONE message: image + caption + copy button
                            await sock.sendMessage(userJid, {
                                image: { url: 'https://cdn.crysnova.qzz.io/files/1792466438448-3682d844-c6b7-4ab8-8337-8b73e5a4ef6f.jpeg' },
                                caption: `︎ ︎ ︎ ︎ ︎ ︎ ︎ ︎ ︎ ︎ 𖠃 *CODY AI • SESSION*\n\n╭─❍ *Quick Setup*\n│\n│ 𖠰 ➊ Tap *Copy Session ID*\n│ 𖠰 ➋ Add to \`.env\`\n│ 𖠰 ➌ Run: \`node index.js\`\n│\n╰─────────────\n> ⏤ expires in 1h`,
                                footer: 'ⓘ CODY AI',
                                optionText: 'Select options',
                                optionTitle: 'CODY AI',
                                offerText: 'CODY AI Session ID',
                                offerCode: copyIdText,
                                offerUrl: 'https://crysnovax.com',
                                offerExpiration: Date.now() + 3600000,
                                nativeFlow: [
                                    { text: '☕︎ Copy Session ID', copy: copyIdText },
                                    { text: '✆ Owner', call: '+' + phoneNumber },
                                    { text: '☁︎ Website', url: 'https://crysnovax.com', useWebview: true },
                                    {
                                        text: '⧉ Important Links',
                                        sections: [{
                                            title: 'Available options',
                                            rows: [
                                                { header: '', title: 'ᯤ Full Tutorial', description: 'ⓘ ┊ sl.crysnovax.link/tutorial5', id: 'https://youtu.be/7TJ400demag?si=Xb8QwdwuVlTUOu7U' },
                                                { header: '', title: '⧉ Channel', description: 'ⓘ ┊ whatsapp.com/channel/0029Vb6pe77K0IBn48HLKb38', id: 'https://whatsapp.com/channel/0029Vb6pe77K0IBn48HLKb38' },
                                                { header: '', title: '⧉ Community', description: 'ⓘ ┊ sl.crysnovax.link/WHATSAPP', id: 'https://sl.crysnovax.link/WHATSAPP' },
                                                { header: '', title: '⧉ GitHub', description: 'ⓘ ┊ github.com/crysnovax/CODY', id: 'https://github.com/crysnovax/CODY' }
                                            ]
                                        }]
                                    }
                                ],
                                interactiveAsTemplate: false
                            });
                            console.log("🎬 Tutorial with Session ID sent");
                        } else {
                            console.log("❌ Could not determine user JID");
                        }
                    } catch (error) {
                        console.error("Error sending messages:", error);
                    }

                    setTimeout(async () => {
                        console.log('🧹 Cleaning up session...');
                        removeFile(dirs);
                        if (sock.ws) {
                            sock.ws.close();
                        }
                    }, 15000);
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const currentRetries = retryAttempts.get(sessionId) || 0;

                    if (statusCode === 401) {
                        console.log('🔐 Logged out - need new QR code');
                        removeFile(dirs);
                        retryAttempts.delete(sessionId);
                    } else if ((statusCode === 515 || statusCode === 503) && currentRetries < 1 && !messagesSent && !responseSent) {
                        const newRetryCount = currentRetries + 1;
                        retryAttempts.set(sessionId, newRetryCount);
                        console.log(`🔁 Retry attempt ${newRetryCount}/1 – restarting...`);
                        setTimeout(() => initiateSession(true), 2000);
                    } else {
                        console.log('📡 Connection closed – stopping');
                        retryAttempts.delete(sessionId);
                        if (!responseSent && !messagesSent) {
                            res.status(503).send({ code: 'Connection failed. Please refresh.' });
                        }
                    }
                }
            };

            sock.ev.on('connection.update', handleConnectionUpdate);
            sock.ev.on('creds.update', saveCreds);

            setTimeout(() => {
                if (!responseSent && !messagesSent) {
                    console.log('⏰ Timeout – no QR generated');
                    if (!res.headersSent) {
                        res.status(408).send({ code: 'QR generation timeout' });
                    }
                    removeFile(dirs);
                    retryAttempts.delete(sessionId);
                }
            }, 60000);

        } catch (err) {
            console.error('Error initializing session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
            retryAttempts.delete(sessionId);
        }
    }

    await initiateSession();
});

// Polled by the Generate Script tab after a QR is shown, to auto-fill
// number + session ID once the connection actually completes.
router.get('/status', (req, res) => {
    const sid = req.query.sessionId;
    if (!sid) {
        return res.status(400).send({ connected: false, error: 'Missing sessionId' });
    }

    const result = qrResults.get(sid);
    if (!result) {
        return res.send({ connected: false });
    }

    qrResults.delete(sid); // one-shot — don't hand out the same result twice
    res.send({ connected: true, number: result.number, sessionId: result.sessionId, shortId: result.shortId, base64Id: result.base64Id });
});

process.on('uncaughtException', (err) => {
    let e = String(err);
    if (e.includes("conflict")) return;
    if (e.includes("not-authorized")) return;
    if (e.includes("Socket connection timeout")) return;
    if (e.includes("rate-overlimit")) return;
    if (e.includes("Connection Closed")) return;
    if (e.includes("Timed Out")) return;
    if (e.includes("Value not found")) return;
    if (e.includes("Stream Errored")) return;
    if (e.includes("Stream Errored (restart required)")) return;
    if (e.includes("statusCode: 515")) return;
    if (e.includes("statusCode: 503")) return;
    console.log('Caught exception: ', err);
});

export default router;
