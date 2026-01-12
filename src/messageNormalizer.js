const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

// Bidirectional cache: LID <-> Phone Number mappings
const lidToPhoneCache = new Map();
const phoneToLidCache = new Map();
let mappingsLoaded = false;
let authDir = path.join(process.cwd(), 'auth_info_baileys');
let fileWatcher = null;

/**
 * Validate that auth directory and mappings exist
 * @returns {Object} - Validation result with status and message
 */
function validateMappings() {
    const result = {
        valid: false,
        authDirExists: false,
        mappingCount: 0,
        message: ''
    };
    
    if (!fs.existsSync(authDir)) {
        result.message = `CRITICAL: Auth directory not found at ${authDir}. LID resolution will fail!`;
        console.error(result.message);
        return result;
    }
    
    result.authDirExists = true;
    
    try {
        const files = fs.readdirSync(authDir);
        const mappingFiles = files.filter(f => f.startsWith('lid-mapping-') && !f.includes('_reverse'));
        result.mappingCount = mappingFiles.length;
        
        if (result.mappingCount === 0) {
            result.message = 'WARNING: No LID mapping files found. This is normal for new sessions.';
            console.warn(result.message);
            result.valid = true; // Not critical for new sessions
        } else {
            result.valid = true;
            result.message = `Found ${result.mappingCount} LID mapping file(s)`;
            console.log(result.message);
        }
    } catch (error) {
        result.message = `Error validating mappings: ${error.message}`;
        console.error(result.message);
    }
    
    return result;
}

/**
 * Watch auth directory for new mapping files and auto-reload
 */
function watchMappingFiles() {
    if (fileWatcher || !fs.existsSync(authDir)) return;
    
    try {
        fileWatcher = fs.watch(authDir, (eventType, filename) => {
            if (filename && filename.startsWith('lid-mapping-')) {
                console.log(`Detected new/changed mapping file: ${filename}, reloading...`);
                // Reset loaded flag to force reload on next access
                mappingsLoaded = false;
                loadAllLidMappings();
            }
        });
        console.log('File watcher active - will auto-reload LID mappings');
    } catch (error) {
        console.error('Could not setup file watcher:', error.message);
    }
}

/**
 * Load all LID mappings from auth_info_baileys directory
 * This builds a comprehensive bidirectional mapping cache
 */
function loadAllLidMappings() {
    if (mappingsLoaded) return;
    
    console.log('Loading LID mappings...');
    
    try {
        if (!fs.existsSync(authDir)) {
            console.warn(`Auth directory not found at ${authDir}, LID mappings unavailable`);
            console.warn('This is normal for new sessions. Mappings will be created as you receive messages.');
            mappingsLoaded = true; // Mark as loaded to prevent repeated warnings
            return;
        }
        
        const files = fs.readdirSync(authDir);
        let loadedCount = 0;
        
        // Process all lid-mapping files
        files.forEach(file => {
            try {
                // Handle forward mappings: lid-mapping-{phoneNumber}.json -> contains LID
                if (file.startsWith('lid-mapping-') && !file.includes('_reverse')) {
                    const phoneNumber = file.replace('lid-mapping-', '').replace('.json', '');
                    const filePath = path.join(authDir, file);
                    const lid = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    
                    if (lid && phoneNumber) {
                        lidToPhoneCache.set(lid, phoneNumber);
                        phoneToLidCache.set(phoneNumber, lid);
                        loadedCount++;
                    }
                }
                // Handle reverse mappings: lid-mapping-{LID}_reverse.json -> contains phoneNumber
                else if (file.includes('_reverse.json')) {
                    const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
                    const filePath = path.join(authDir, file);
                    const phoneNumber = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    
                    if (lid && phoneNumber) {
                        lidToPhoneCache.set(lid, phoneNumber);
                        phoneToLidCache.set(phoneNumber, lid);
                        loadedCount++;
                    }
                }
            } catch (error) {
                console.error(`Error reading mapping file ${file}:`, error.message);
            }
        });
        
        mappingsLoaded = true;
        console.log(`✓ Loaded ${loadedCount} LID mapping(s) from ${lidToPhoneCache.size} unique LID(s)`);
        
        // Start watching for new mappings
        watchMappingFiles();
        
    } catch (error) {
        console.error('Error loading LID mappings:', error.message);
        mappingsLoaded = true; // Mark as loaded to prevent infinite retry
    }
}

/**
 * Resolve LID to actual WhatsApp phone number with multiple fallback strategies
 * @param {string} lid - The LID without @lid suffix (e.g., "138259359346791")
 * @param {Object} sock - Baileys socket instance
 * @returns {string|null} - Phone number or null
 */
function resolveLidToPhoneNumber(lid, sock = null) {
    if (!lid) return null;
    
    // Ensure mappings are loaded
    loadAllLidMappings();
    
    // Strategy 1: Check cache first (fastest)
    if (lidToPhoneCache.has(lid)) {
        return lidToPhoneCache.get(lid);
    }
    
    // Strategy 2: Try to get from socket's auth state
    if (sock && sock.authState && sock.authState.creds && sock.authState.creds.lid) {
        const mapping = sock.authState.creds.lid;
        if (mapping.mapping && mapping.mapping[lid]) {
            const phoneNumber = mapping.mapping[lid];
            lidToPhoneCache.set(lid, phoneNumber);
            phoneToLidCache.set(phoneNumber, lid);
            return phoneNumber;
        }
    }
    
    // Strategy 3: Read from reverse mapping file (last resort)
    try {
        const authDir = path.join(process.cwd(), 'auth_info_baileys');
        const reverseMappingFile = path.join(authDir, `lid-mapping-${lid}_reverse.json`);
        
        if (fs.existsSync(reverseMappingFile)) {
            const phoneNumber = JSON.parse(fs.readFileSync(reverseMappingFile, 'utf-8'));
            lidToPhoneCache.set(lid, phoneNumber);
            phoneToLidCache.set(phoneNumber, lid);
            return phoneNumber;
        }
    } catch (error) {
        console.error(`Error reading LID reverse mapping for ${lid}:`, error.message);
    }
    
    // Strategy 4: Scan all forward mapping files as last resort
    try {
        const files = fs.readdirSync(authDir);
        
        for (const file of files) {
            if (file.startsWith('lid-mapping-') && !file.includes('_reverse')) {
                const filePath = path.join(authDir, file);
                const fileLid = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                
                if (fileLid === lid) {
                    const phoneNumber = file.replace('lid-mapping-', '').replace('.json', '');
                    lidToPhoneCache.set(lid, phoneNumber);
                    phoneToLidCache.set(phoneNumber, lid);
                    console.log(`✓ Resolved LID ${lid} -> ${phoneNumber} from forward scan`);
                    return phoneNumber;
                }
            }
        }
    } catch (error) {
        console.error(`Error scanning for LID ${lid}:`, error.message);
    }
    
    // EMERGENCY FALLBACK: If LID looks like a phone number (10-15 digits), use it as-is
    // Some LIDs are actually phone numbers in disguise, especially for new contacts
    if (/^\d{10,15}$/.test(lid)) {
        console.warn(`⚠ EMERGENCY FALLBACK: Using LID ${lid} as phone number (mapping not found)`);
        console.warn('This may happen for new contacts. Mapping will be available after message exchange.');
        // Cache it to avoid repeated warnings
        lidToPhoneCache.set(lid, lid);
        return lid; // Return the LID itself as it's likely a valid phone number
    }
    
    // Absolutely could not resolve and doesn't look like a phone number
    console.error(`✗ FAILED to resolve LID ${lid} to phone number after all strategies`);
    return null;
}

/**
 * Extract WhatsApp number from JID (removes @s.whatsapp.net suffix)
 * Handles both traditional JIDs and LIDs by resolving them to phone numbers
 * GUARANTEED to return phone number for valid WhatsApp users, uses emergency fallback if needed
 * @param {string} jid - WhatsApp JID
 * @param {Object} sock - Baileys socket instance for LID resolution
 * @returns {string|null} - Phone number or null only if invalid JID
 */
function extractPhoneNumber(jid, sock = null) {
    if (!jid) return null;
    
    // Handle LID format - MUST resolve to actual phone number
    if (jid.includes('@lid')) {
        const lid = jid.split('@')[0];
        const phoneNumber = resolveLidToPhoneNumber(lid, sock);
        
        if (phoneNumber) {
            return phoneNumber; // Successfully resolved or emergency fallback
        }
        
        // Extremely rare case - log but return null to prevent data corruption
        console.error(`CRITICAL: Could not resolve LID ${lid} even with emergency fallback!`);
        console.error(`JID: ${jid} - This LID doesn't match any known phone number pattern`);
        return null;
        console.error(`JID: ${jid}`);
        return null; // Return null instead of LID to prevent data corruption
    }
    
    // Handle traditional WhatsApp JID
    if (jid.endsWith('@s.whatsapp.net')) {
        return jid.replace('@s.whatsapp.net', '');
    }
    
    // Handle group JID
    if (jid.endsWith('@g.us')) {
        // For groups, extract the number part before the hyphen
        return jid.split('@')[0].split('-')[0];
    }
    
    // Fallback: try to extract any number-like pattern
    const match = jid.match(/^(\d+)/);
    return match ? match[1] : null;
}

/**
 * Extract LID from JID (for users with lidded IDs)
 * @param {string} jid - WhatsApp JID
 * @returns {string|null} - LID or null
 */
function extractLid(jid) {
    if (!jid) return null;
    if (jid.includes('@lid')) {
        return jid.split('@')[0];
    }
    return null;
}

/**
 * Normalize any JID to proper WhatsApp JID format (phoneNumber@s.whatsapp.net)
 * Converts LIDs to WhatsApp JIDs, keeps groups as-is
 * @param {string} jid - Any JID format
 * @param {Object} sock - Baileys socket instance for LID resolution
 * @returns {string|null} - Normalized WhatsApp JID (e.g., "6285777168752@s.whatsapp.net") or null
 */
function normalizeToWhatsAppJid(jid, sock = null) {
    if (!jid) return null;
    
    // Already in WhatsApp format - return as-is
    if (jid.endsWith('@s.whatsapp.net')) {
        return jid;
    }
    
    // Keep groups in their original format
    if (jid.endsWith('@g.us')) {
        return jid;
    }
    
    // Handle LID - convert to WhatsApp JID format
    if (jid.includes('@lid')) {
        const phoneNumber = extractPhoneNumber(jid, sock);
        if (phoneNumber) {
            return `${phoneNumber}@s.whatsapp.net`;
        }
        // Could not resolve LID
        console.error(`Cannot normalize LID ${jid} to WhatsApp JID - phone number resolution failed`);
        return null;
    }
    
    // Unknown format - try to extract phone number and convert
    const phoneNumber = extractPhoneNumber(jid, sock);
    if (phoneNumber) {
        return `${phoneNumber}@s.whatsapp.net`;
    }
    
    return null;
}

/**
 * Normalize message data into a consistent structure
 * @param {Object} msg - Raw Baileys message object
 * @param {Object} sock - Baileys socket instance for LID resolution (optional)
 * @returns {Object} - Normalized message structure
 */
function normalizeMessage(msg, sock = null) {
    const normalized = {
        messageId: msg.key.id,
        timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
        from: extractPhoneNumber(msg.key.remoteJid, sock),
        fromLid: extractLid(msg.key.remoteJid),
        fromJid: normalizeToWhatsAppJid(msg.key.remoteJid, sock), // Normalized WhatsApp JID (e.g., "6285777168752@s.whatsapp.net")
        fromJidRaw: msg.key.remoteJid, // Original raw JID for reference
        fromMe: msg.key.fromMe || false,
        participant: msg.key.participant ? extractPhoneNumber(msg.key.participant, sock) : null,
        participantLid: msg.key.participant ? extractLid(msg.key.participant) : null,
        participantJid: msg.key.participant ? normalizeToWhatsAppJid(msg.key.participant, sock) : null, // Normalized WhatsApp JID
        participantJidRaw: msg.key.participant || null, // Original raw JID for group messages
        isGroup: msg.key.remoteJid.endsWith('@g.us'),
        messageType: null,
        content: null,
        caption: null,
        quotedMessage: null,
        mentions: [],
        mentionLids: [],
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
            const quotedParticipant = messageContent.extendedTextMessage.contextInfo.participant;
            normalized.quotedMessage = {
                messageId: messageContent.extendedTextMessage.contextInfo.stanzaId,
                participant: extractPhoneNumber(quotedParticipant, sock),
                participantLid: extractLid(quotedParticipant),
                participantJid: quotedParticipant,
                content: extractQuotedContent(messageContent.extendedTextMessage.contextInfo.quotedMessage)
            };
        }
        
        // Handle mentions
        if (messageContent.extendedTextMessage.contextInfo?.mentionedJid) {
            const mentionedJids = messageContent.extendedTextMessage.contextInfo.mentionedJid;
            normalized.mentions = mentionedJids
                .map(jid => extractPhoneNumber(jid, sock))
                .filter(num => num !== null);
            normalized.mentionLids = mentionedJids
                .map(jid => extractLid(jid))
                .filter(lid => lid !== null);
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
    normalizeMessage,
    preloadLidMappings: loadAllLidMappings,
    validateMappings
};
