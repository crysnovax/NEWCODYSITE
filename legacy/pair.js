import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, delay, makeCacheableSignalKeyStore, Browsers, jidNormalizedUser } from 'plogme';
import pn from 'awesome-phonenumber';
import { uploadSession } from './id.js';

const router = express.Router();
const SESSION_ROOT = path.resolve(process.env.CODY_PAIR_SESSION_DIR || path.join(os.tmpdir(), 'cody-pair-sessions'));
fs.mkdirSync(SESSION_ROOT, { recursive: true });

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
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

// ── Pairing lifecycle ──────────────────────────────────────────────────────
// A pair code only links while ONE companion socket stays connected from
// `companion_hello` (when we ask for the code) until the phone answers with
// `companion_finish`. plogme derives that exchange from the session's
// pairingEphemeralKeyPair, so reconnecting with the same creds is fine — but
// asking for a second code invalidates the one already on the user's screen.
// Every guard below protects that single socket/code pair, and every exit
// path closes the socket so the number is free for the next attempt.
const ATTEMPT_TTL_MS = Number(process.env.CODY_PAIR_ATTEMPT_TTL_MS) || 3 * 60 * 1000;   // hard cap for one pairing attempt
const HELLO_TIMEOUT_MS = 45 * 1000;     // guard around sending the pairing iq
const MAX_HELLO_ATTEMPTS = 3;
const MAX_SOCKET_RETRIES = 3;
const RETRYABLE_STATUS = [405, 408, 428, 500, 502, 503, 515];

const attempts = new Map();     // num -> attempt — one live companion socket per number
const pairResults = new Map();  // num -> { number, sessionId } — read once by GET /pair/status
const pairFailures = new Map(); // num -> { reason, at }        — read once by GET /pair/status

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Pairing code ───────────────────────────────────────────────────────────
// WhatsApp lets us choose the code. Keep the original CODY_PAIR experience by
// defaulting to CRYSNOVA, while allowing deployments to override it explicitly.
// CODY_PAIR_CODE must be an eight-character alphanumeric value.
const DEFAULT_PAIR_CODE = 'CRYSNOVA';
const configuredPairCode = String(process.env.CODY_PAIR_CODE || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
const FIXED_PAIR_CODE = configuredPairCode.length === 8 ? configuredPairCode : DEFAULT_PAIR_CODE;

function generatePairCode() {
    return FIXED_PAIR_CODE;
}

// ── WhatsApp Web revision ──────────────────────────────────────────────────
// plogme's own version helper reads https://web.crysnovax.link, which serves a
// landing page instead of the revision file, so it silently falls back to a
// pinned revision. WhatsApp then refuses the companion handshake and the phone
// sits on “Logging in” until it gives up ("Couldn't link device"). Read the
// upstream file directly, and only cache a version that really parsed.
const WA_VERSION_URL = 'https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/index.ts';
const FALLBACK_WA_VERSION = [2, 3000, 1043857760];
let cachedWaVersion = null;

function parseWaVersion(text) {
    const match = String(text).match(/const version = \[(\d+),\s*(\d+),\s*(\d+)\]/);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

async function resolveWaVersion() {
    const override = String(process.env.CODY_PAIR_WA_VERSION || '').split('.').map(Number);
    if (override.length === 3 && override.every(Number.isInteger)) return override;
    if (cachedWaVersion) return cachedWaVersion;

    try {
        const response = await fetch(WA_VERSION_URL, { signal: AbortSignal.timeout(8000) });
        if (response.ok) {
            const version = parseWaVersion(await response.text());
            if (version) {
                cachedWaVersion = version;
                return version;
            }
        }
    } catch (err) {
        console.warn(`WhatsApp Web revision lookup failed (${err?.message || err})`);
    }

    return FALLBACK_WA_VERSION;
}

function endAttempt(num, reason) {
    const attempt = attempts.get(num);
    if (!attempt) return;

    attempts.delete(num);
    attempt.done = true;
    clearTimeout(attempt.helloTimer);
    clearTimeout(attempt.deadlineTimer);

    // Always close the socket: a companion left connected keeps holding the
    // number, so the next attempt looks like a duplicate link to WhatsApp and
    // fails.
    try { attempt.sock?.ws?.close(); } catch { /* socket already gone */ }

    removeFile(attempt.dirs);

    if (reason) {
        pairFailures.set(num, { reason, at: Date.now() });
        console.log(`⚠️  Pairing failed for ${num}: ${reason}`);
    }
}

function isConflict(lastDisconnect) {
    const statusCode = Number(lastDisconnect?.error?.output?.statusCode);
    const message = String(lastDisconnect?.error?.message || '');
    return statusCode === 409 || statusCode === 440 || /conflict|replaced/i.test(message);
}

router.get('/', async (req, res) => {
    let num = String(req.query.number || '').replace(/[^0-9]/g, '');
    if (!num) return res.status(400).send({ code: 'Missing phone number' });

    const format = String(req.query.format || 'shortid').toLowerCase() === 'b64' ? 'b64' : 'shortid';
    const phone = pn('+' + num);
    if (!phone.isValid()) {
        if (!res.headersSent) {
            return res.status(400).send({ code: 'Invalid phone number' });
        }
        return;
    }
    num = phone.getNumber('e164').replace('+', '');

    // A new request replaces whatever is still pending for this number rather
    // than being rejected: two live companions for one number make WhatsApp
    // drop the link, and a stuck attempt must never lock the user out.
    const pending = attempts.get(num);
    if (pending) {
        console.log(`♻️  Superseding the pending pairing attempt for ${num}`);
        if (!pending.res.headersSent) {
            pending.res.status(409).send({ code: 'A newer pairing request replaced this one. Use the new code.' });
        }
        endAttempt(num);
    }
    pairResults.delete(num);
    pairFailures.delete(num);

    // Use an absolute writable root; deployment working directories are not stable.
    const dirs = path.join(SESSION_ROOT, num);
    await removeFile(dirs);
    fs.mkdirSync(dirs, { recursive: true });

    const customCode = generatePairCode();

    const attempt = {
        num,
        format,
        dirs,
        res,
        sock: null,
        saveCreds: null,
        code: null,
        codeDelivered: false,   // the user can see a code — never send another one
        helloInFlight: false,
        helloAttempts: 0,
        socketRetries: 0,
        sessionDelivered: false,
        done: false,
        helloTimer: null,
        deadlineTimer: null,
    };
    attempts.set(num, attempt);

    // No pairing may run forever: the window has to close so the number is
    // released and a fresh code can be requested.
    attempt.deadlineTimer = setTimeout(() => {
        if (attempt.done || attempt.sessionDelivered) return;
        console.log(`⏰ Pairing window expired for ${num}`);
        if (!attempt.res.headersSent) {
            attempt.res.status(408).send({ code: 'Connection timeout. Please generate a new code.' });
        }
        endAttempt(num, 'Pairing timed out. Generate a new code and try again.');
    }, ATTEMPT_TTL_MS);

    const scheduleHello = (ms) => {
        if (attempt.done || attempt.codeDelivered) return;
        clearTimeout(attempt.helloTimer);
        attempt.helloTimer = setTimeout(() => {
            attempt.helloTimer = null;
            requestPairingCodeOnce();
        }, ms);
    };

    const requestPairingCodeOnce = async () => {
        if (attempt.done || attempt.codeDelivered || attempt.helloInFlight) return;
        const sock = attempt.sock;
        if (!sock || sock.authState?.creds?.registered) return;
        if (attempt.helloAttempts >= MAX_HELLO_ATTEMPTS) return;

        attempt.helloInFlight = true;
        attempt.helloAttempts += 1;

        try {
            const code = await Promise.race([
                sock.requestPairingCode(num, customCode),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('Pairing-code request timed out')),
                    HELLO_TIMEOUT_MS
                ))
            ]);

            // Once the code is in the user's hands it stays the only pending
            // hello — a later one would break the link they are typing.
            attempt.code = code;
            attempt.codeDelivered = true;
            console.log('🔗 Pairing code issued for:', num);
            if (!attempt.res.headersSent) attempt.res.send({ code });
        } catch (error) {
            console.error('Error requesting pairing code:', error?.message || error);
            // A hello that never reached WhatsApp is harmless to retry; one
            // the user already saw is not.
            if (!attempt.codeDelivered && !attempt.done) {
                if (attempt.helloAttempts >= MAX_HELLO_ATTEMPTS) {
                    if (!attempt.res.headersSent) {
                        attempt.res.status(503).send({ code: 'Failed to get pairing code. Please try again.' });
                    }
                    endAttempt(num, 'Could not reach WhatsApp. Please try again.');
                } else {
                    scheduleHello(2500);
                }
            }
        } finally {
            attempt.helloInFlight = false;
        }
    };

    async function deliverSession() {
        attempt.sessionDelivered = true;
        console.log('✅ Connected successfully!');

        try {
            const userJid = jidNormalizedUser(num + '@s.whatsapp.net');
            const ready = await waitForAppStateBundle(attempt.dirs, attempt.sock);
            if (!ready) {
                await attempt.sock.sendMessage(userJid, { text: '✘ WhatsApp app-state sync did not finish. Please try pairing again.' });
                return;
            }
            await autoFollowNewsletters(attempt.sock);
            if (attempt.saveCreds) await attempt.saveCreds();
            const sessionData = encodeAuthBundle(attempt.dirs);
            const sessionBase64 = Buffer.from(sessionData, 'utf8').toString('base64');
            const uploadResult = await uploadSession(sessionData, num);
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
            pairResults.set(num, { number: num, sessionId: sessionIdText, shortId, base64Id });

            // ONE message: image + caption + copy button
            await attempt.sock.sendMessage(userJid, {
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
                    { text: '✆ Owner', call: '+' + num },
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
        } catch (error) {
            console.error("❌ Error sending messages:", error);
        } finally {
            await delay(1000);
            endAttempt(num);
            console.log("✅ Session cleaned up successfully");
        }
    }

    const handleConnectionUpdate = async (update) => {
        if (attempt.done) return;
        const { connection, lastDisconnect, isNewLogin, isOnline, qr } = update;

        // `qr` means the noise handshake finished, so the socket can carry the
        // pairing iq. It is only a hint — one delivered code per attempt.
        if (qr && !attempt.codeDelivered) await requestPairingCodeOnce();

        if (connection === 'open') {
            attempt.socketRetries = 0;
            if (attempt.sessionDelivered) return;

            if (attempt.sock?.authState?.creds?.registered) {
                await deliverSession();
                return;
            }

            // Socket is ready for the pairing iq: reset the send budget and
            // ask for the code (a no-op when the user already has one).
            attempt.helloAttempts = 0;
            await requestPairingCodeOnce();
            return;
        }

        if (isNewLogin) console.log("🔐 New login via pair code");
        if (isOnline) console.log("📶 Client is online");

        if (connection === 'close') {
            const statusCode = Number(lastDisconnect?.error?.output?.statusCode) || undefined;
            const registered = Boolean(attempt.sock?.authState?.creds?.registered);
            console.log(`📡 Connection closed (status: ${statusCode ?? 'unknown'}${registered ? ', registered' : ''})`);

            // A restart mid-link is expected and safe: the pairing keys live in
            // creds, so reconnecting with the same session keeps the handshake
            // alive. Never ask for a new code afterwards.
            const maxRetries = registered ? MAX_SOCKET_RETRIES + 2 : MAX_SOCKET_RETRIES;
            const retryable = RETRYABLE_STATUS.includes(statusCode)
                && !isConflict(lastDisconnect)
                && attempt.socketRetries < maxRetries;

            if (retryable) {
                attempt.socketRetries += 1;
                console.log(`🔁 Reconnecting (attempt ${attempt.socketRetries}/${maxRetries})...`);
                await sleep(3000);
                if (attempt.done) return;
                try {
                    await openSocket();
                } catch (err) {
                    console.error('Reconnect failed:', err?.message || err);
                    endAttempt(num, 'Connection lost before the link completed. Generate a new code and try again.');
                }
                return;
            }

            const reason = isConflict(lastDisconnect)
                ? 'This number already has a link in progress. Close other sessions and try again.'
                : 'Connection lost before the link completed. Generate a new code and try again.';

            if (!attempt.res.headersSent) {
                attempt.res.status(503).send({
                    code: 'Connection failed. Please try again.',
                    statusCode
                });
            }
            endAttempt(num, reason);
        }
    };

    async function openSocket() {
        const { state, saveCreds } = await useMultiFileAuthState(attempt.dirs);

        // A stale revision issues a valid-looking code but is rejected during
        // the companion handshake, so the phone never finishes linking.
        const version = await resolveWaVersion();
        console.log(`WhatsApp Web revision: ${version.join('.')}`);

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }).child({ level: "fatal" }),
            browser: Browsers.windows('Chrome'),
            markOnlineOnConnect: false,
            generateHighQualityLinkPreview: false,
            defaultQueryTimeoutMs: 30000,
            connectTimeoutMs: 30000,
            keepAliveIntervalMs: 30000,
            retryRequestDelayMs: 250,
            maxRetries: 5,
        });

        attempt.sock = sock;
        attempt.saveCreds = saveCreds;
        sock.ev.on('connection.update', handleConnectionUpdate);
        sock.ev.on('creds.update', saveCreds);
        return sock;
    }

    try {
        await openSocket();
        // Backstop for deployments where neither `open` nor `qr` arrives
        // before the socket is ready to send the pairing iq.
        scheduleHello(5000);
    } catch (err) {
        console.error('Error initializing session:', err);
        if (!attempt.res.headersSent) {
            attempt.res.status(503).send({ code: 'Service Unavailable' });
        }
        endAttempt(num, 'Could not start the pairing session. Please try again.');
    }
});

// Polled by the Generate Script tab after a pair code is shown, to auto-fill
// number + session ID once the connection actually completes — and to report a
// failed attempt instead of leaving the UI waiting forever.
router.get('/status', (req, res) => {
    const num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num) {
        return res.status(400).send({ connected: false, error: 'Missing number' });
    }

    const result = pairResults.get(num);
    if (result) {
        pairResults.delete(num); // one-shot — don't hand out the same result twice
        return res.send({ connected: true, number: result.number, sessionId: result.sessionId, shortId: result.shortId, base64Id: result.base64Id });
    }

    const failure = pairFailures.get(num);
    if (failure) {
        pairFailures.delete(num); // one-shot
        return res.send({ connected: false, failed: true, error: failure.reason });
    }

    res.send({ connected: false, pending: attempts.has(num) });
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
