/**
 * Normalize message data into a consistent structure
 * @param {Object} msg - Raw Baileys message object
 * @returns {Object} - Normalized message structure
 */
function normalizeMessage(msg) {
    const normalized = {
        messageId: msg.key.id,
        timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
        from: msg.key.remoteJid,
        fromMe: msg.key.fromMe || false,
        participant: msg.key.participant || null, // For group messages
        isGroup: msg.key.remoteJid.endsWith('@g.us'),
        messageType: null,
        content: null,
        caption: null,
        quotedMessage: null,
        mentions: [],
        hasMedia: false,
        mediaUrl: null,
        mimeType: null,
        fileName: null,
        fileSize: null,
        duration: null, // For audio/video
        location: null,
        contacts: null,
        pollData: null,
        reactionData: null,
        rawMessage: msg.message || {} // Keep raw for debugging
    };

    // Extract the actual message content
    const messageContent = msg.message;
    if (!messageContent) {
        normalized.messageType = 'unknown';
        return normalized;
    }

    // Handle different message types
    if (messageContent.conversation) {
        normalized.messageType = 'text';
        normalized.content = messageContent.conversation;
    } 
    else if (messageContent.extendedTextMessage) {
        normalized.messageType = 'text';
        normalized.content = messageContent.extendedTextMessage.text;
        
        // Handle quoted messages
        if (messageContent.extendedTextMessage.contextInfo?.quotedMessage) {
            normalized.quotedMessage = {
                messageId: messageContent.extendedTextMessage.contextInfo.stanzaId,
                participant: messageContent.extendedTextMessage.contextInfo.participant,
                content: extractQuotedContent(messageContent.extendedTextMessage.contextInfo.quotedMessage)
            };
        }
        
        // Handle mentions
        if (messageContent.extendedTextMessage.contextInfo?.mentionedJid) {
            normalized.mentions = messageContent.extendedTextMessage.contextInfo.mentionedJid;
        }
    }
    else if (messageContent.imageMessage) {
        normalized.messageType = 'image';
        normalized.hasMedia = true;
        normalized.caption = messageContent.imageMessage.caption || null;
        normalized.mimeType = messageContent.imageMessage.mimetype;
        normalized.fileSize = messageContent.imageMessage.fileLength;
        normalized.mediaUrl = messageContent.imageMessage.url || null;
    }
    else if (messageContent.videoMessage) {
        normalized.messageType = 'video';
        normalized.hasMedia = true;
        normalized.caption = messageContent.videoMessage.caption || null;
        normalized.mimeType = messageContent.videoMessage.mimetype;
        normalized.fileSize = messageContent.videoMessage.fileLength;
        normalized.duration = messageContent.videoMessage.seconds;
        normalized.mediaUrl = messageContent.videoMessage.url || null;
    }
    else if (messageContent.audioMessage) {
        normalized.messageType = messageContent.audioMessage.ptt ? 'voice' : 'audio';
        normalized.hasMedia = true;
        normalized.mimeType = messageContent.audioMessage.mimetype;
        normalized.fileSize = messageContent.audioMessage.fileLength;
        normalized.duration = messageContent.audioMessage.seconds;
        normalized.mediaUrl = messageContent.audioMessage.url || null;
    }
    else if (messageContent.documentMessage) {
        normalized.messageType = 'document';
        normalized.hasMedia = true;
        normalized.fileName = messageContent.documentMessage.fileName;
        normalized.mimeType = messageContent.documentMessage.mimetype;
        normalized.fileSize = messageContent.documentMessage.fileLength;
        normalized.caption = messageContent.documentMessage.caption || null;
        normalized.mediaUrl = messageContent.documentMessage.url || null;
    }
    else if (messageContent.stickerMessage) {
        normalized.messageType = 'sticker';
        normalized.hasMedia = true;
        normalized.mimeType = messageContent.stickerMessage.mimetype;
        normalized.fileSize = messageContent.stickerMessage.fileLength;
        normalized.mediaUrl = messageContent.stickerMessage.url || null;
    }
    else if (messageContent.locationMessage) {
        normalized.messageType = 'location';
        normalized.location = {
            latitude: messageContent.locationMessage.degreesLatitude,
            longitude: messageContent.locationMessage.degreesLongitude,
            name: messageContent.locationMessage.name || null,
            address: messageContent.locationMessage.address || null
        };
    }
    else if (messageContent.contactMessage) {
        normalized.messageType = 'contact';
        normalized.contacts = [{
            displayName: messageContent.contactMessage.displayName,
            vcard: messageContent.contactMessage.vcard
        }];
    }
    else if (messageContent.contactsArrayMessage) {
        normalized.messageType = 'contacts';
        normalized.contacts = messageContent.contactsArrayMessage.contacts.map(c => ({
            displayName: c.displayName,
            vcard: c.vcard
        }));
    }
    else if (messageContent.pollCreationMessage) {
        normalized.messageType = 'poll';
        normalized.pollData = {
            name: messageContent.pollCreationMessage.name,
            options: messageContent.pollCreationMessage.options.map(o => o.optionName),
            selectableCount: messageContent.pollCreationMessage.selectableOptionsCount
        };
    }
    else if (messageContent.reactionMessage) {
        normalized.messageType = 'reaction';
        normalized.reactionData = {
            emoji: messageContent.reactionMessage.text,
            targetMessageId: messageContent.reactionMessage.key.id
        };
    }
    else {
        // Unknown message type
        normalized.messageType = 'unsupported';
        normalized.content = Object.keys(messageContent)[0]; // Log which type it was
    }

    return normalized;
}

/**
 * Extract content from quoted message
 * @param {Object} quotedMsg - Quoted message object
 * @returns {string} - Text content of quoted message
 */
function extractQuotedContent(quotedMsg) {
    if (quotedMsg.conversation) return quotedMsg.conversation;
    if (quotedMsg.extendedTextMessage) return quotedMsg.extendedTextMessage.text;
    if (quotedMsg.imageMessage) return quotedMsg.imageMessage.caption || '[Image]';
    if (quotedMsg.videoMessage) return quotedMsg.videoMessage.caption || '[Video]';
    if (quotedMsg.audioMessage) return '[Audio]';
    if (quotedMsg.documentMessage) return quotedMsg.documentMessage.fileName || '[Document]';
    if (quotedMsg.stickerMessage) return '[Sticker]';
    if (quotedMsg.locationMessage) return '[Location]';
    if (quotedMsg.contactMessage) return '[Contact]';
    return '[Unknown]';
}

module.exports = {
    normalizeMessage
};
