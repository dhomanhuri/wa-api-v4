const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const axios = require('axios');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { normalizeMessage, preloadLidMappings, validateMappings } = require('./messageNormalizer');

let sock;
let qrCodeData = null; // Store QR code data
const processedMessages = new Set(); // Cache for processed message IDs

// Clean up processed messages cache periodically
setInterval(() => {
    if (processedMessages.size > 5000) {
        processedMessages.clear();
        console.log('Cleared processed messages cache');
    }
}, 60 * 60 * 1000); // Clear every hour

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    
    console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), // silent to avoid noise
        printQRInTerminal: false, // We handle it manually
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
        },
        browser: ['WA-API-V4', 'Chrome', '1.0.0'],
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrCodeData = qr;
            console.log('QR Code received, scan it!');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✓ WhatsApp connection opened');
            qrCodeData = null;
            
            // Validate and preload LID mappings to ensure phone numbers are always resolved
            console.log('\n=== LID Mapping Validation ===');
            const validation = validateMappings();
            if (validation.authDirExists) {
                preloadLidMappings();
                console.log('✓ Ready to resolve LIDs to phone numbers');
            } else {
                console.error('⚠ LID resolution may fail - auth directory missing!');
            }
            console.log('==============================\n');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        // console.log(JSON.stringify(m, undefined, 2));

        if (config.webhookUrl) {
            try {
                // Only send if it's a notify message (real message)
                if (m.type === 'notify') {
                    for (const msg of m.messages) {
                        if (!msg.key.fromMe) { // Don't send own messages to webhook loop
                            const messageId = msg.key.id;
                            
                            // Check if message already processed
                            if (processedMessages.has(messageId)) {
                                console.log(`Skipping duplicate message: ${messageId}`);
                                continue;
                            }
                            
                            processedMessages.add(messageId);

                            // Log incoming message
                            const sender = msg.key.remoteJid;
                            const msgType = Object.keys(msg.message || {})[0];
                            console.log(`\n[New Message] From: ${sender} | Type: ${msgType}`);

                             console.log('Sending message to webhook:', config.webhookUrl);
                             
                             const normalizedMessage = normalizeMessage(msg, sock);
                             
                             await axios.post(config.webhookUrl, {
                                 event: 'message.received',
                                 timestamp: Date.now(),
                                 data: normalizedMessage
                             });
                        }
                    }
                }
            } catch (error) {
                console.error('Error sending webhook:', error.message);
            }
        }
    });
}

function getSocket() {
    return sock;
}

function getQrCode() {
    return qrCodeData;
}

module.exports = {
    connectToWhatsApp,
    getSocket,
    getQrCode
};
