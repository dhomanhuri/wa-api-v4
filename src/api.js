const express = require('express');
const bodyParser = require('body-parser');
const qrcode = require('qrcode');
const { getSocket, getQrCode } = require('./whatsapp');
const config = require('./config');

const router = express.Router();

router.use(bodyParser.json());

// Send Message Endpoint
router.post('/send-message', async (req, res) => {
    const sock = getSocket();
    const { jid, message } = req.body; // jid: '1234567890@s.whatsapp.net', message: { text: 'Hello' }

    if (!sock) {
        return res.status(503).json({ error: 'WhatsApp client not initialized' });
    }

    if (!jid || !message) {
        return res.status(400).json({ error: 'Missing jid or message' });
    }

    try {
        // Handle Image Message Helpers
        if (message.image) {
            // If image is a string (URL or Base64)
            if (typeof message.image === 'string') {
                if (message.image.startsWith('http')) {
                    message.image = { url: message.image };
                } else {
                    // Assume Base64
                    // Remove data:image/xxx;base64, prefix if present
                    const base64Data = message.image.replace(/^data:image\/\w+;base64,/, "");
                    message.image = Buffer.from(base64Data, 'base64');
                }
            }
        }

        const result = await sock.sendMessage(jid, message);
        res.json({ success: true, result });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message', details: error.message });
    }
});

// Status Endpoint
router.get('/status', (req, res) => {
    const sock = getSocket();
    const qr = getQrCode();
    
    if (sock && sock.user) {
        res.json({ status: 'connected', user: sock.user });
    } else if (qr) {
        res.json({ status: 'scan_qr', qr_code: qr });
    } else {
        res.json({ status: 'connecting' });
    }
});

// QR Code HTML Endpoint
router.get('/qr', async (req, res) => {
    const qr = getQrCode();
    if (!qr) {
        const sock = getSocket();
        if (sock && sock.user) {
            return res.send('<html><body><h1>Already Connected</h1></body></html>');
        }
        return res.send('<html><body><h1>QR Code not available yet, please refresh</h1></body></html>');
    }

    try {
        const qrImage = await qrcode.toDataURL(qr);
        res.send(`<html><body><h1>Scan QR Code</h1><img src="${qrImage}" /></body></html>`);
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

module.exports = router;
