const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const axios = require('axios');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { normalizeMessage } = require('./messageNormalizer');

let sock;
let qrCodeData = null; // Store QR code data

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
            console.log('opened connection');
            qrCodeData = null;
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
                             console.log('Sending message to webhook:', config.webhookUrl);
                             
                             const normalizedMessage = normalizeMessage(msg);
                             
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
