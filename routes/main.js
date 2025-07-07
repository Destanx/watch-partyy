// routes/main.js
// Handles all routing for creating and managing parties with cookie logic.
const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Check if a rejoin token is valid
router.post('/stream/check-rejoin', (req, res) => {
    const { db } = req;
    const { rejoinToken } = req.cookies;

    if (rejoinToken && db.videoTokens[rejoinToken]) {
        res.json({ success: true, video: db.videoTokens[rejoinToken] });
    } else {
        res.json({ success: false });
    }
});

// Start a new stream/party
router.post('/stream/start', upload.single('videoFile'), (req, res) => {
    const { db } = req;
    const { type, youtubeLink } = req.body;
    
    const partyId = crypto.randomUUID();
    let newStream = { id: partyId, type, source: null, title: 'N/A' };

    switch (type) {
        case 'youtube':
            if (!youtubeLink || !youtubeLink.includes('youtube.com/watch?v=')) return res.status(400).json({ success: false, message: 'Geçersiz YouTube bağlantısı.' });
            newStream.source = new URL(youtubeLink).searchParams.get('v');
            newStream.title = `YouTube: ${newStream.source}`;
            break;
        case 'video':
            if (!req.file) return res.status(400).json({ success: false, message: 'Video dosyası yüklenmedi.' });
            
            const videoToken = crypto.randomUUID();
            const videoPath = `/uploads/${req.file.filename}`;
            
            db.videoTokens[videoToken] = { path: videoPath, title: req.file.originalname };
            res.cookie('rejoinToken', videoToken, { maxAge: 3600000, httpOnly: true }); // 1 hour expiry

            newStream.source = videoPath;
            newStream.title = `Yerel Video: ${req.file.originalname}`;
            break;
        case 'screenShare':
            newStream.title = `Ekran Paylaşımı`;
            break;
        default:
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(400).json({ success: false, message: 'Geçersiz yayın türü.' });
    }

    db.parties[partyId] = newStream;
    res.json({ success: true, partyId, stream: newStream });
});

// Rejoin a party with an existing video
router.post('/stream/rejoin', (req, res) => {
    const { db } = req;
    const { rejoinToken } = req.cookies;

    if (!rejoinToken || !db.videoTokens[rejoinToken]) {
        return res.status(400).json({ success: false, message: 'Geçerli bir devam etme oturumu bulunamadı.' });
    }

    const videoInfo = db.videoTokens[rejoinToken];
    const partyId = crypto.randomUUID();
    const newStream = { id: partyId, type: 'video', source: videoInfo.path, title: `Yerel Video: ${videoInfo.title}` };
    
    db.parties[partyId] = newStream;
    res.json({ success: true, partyId, stream: newStream });
});

// End a party and clean up resources
router.post('/stream/end', (req, res) => {
    const { db, io } = req;
    const { partyId } = req.body;

    if (!partyId || !db.parties[partyId]) return res.status(400).json({ success: false, message: 'Aktif yayın bulunamadı.' });
    
    const party = db.parties[partyId];

    if (party.type === 'video') {
        const videoPath = path.join(__dirname, '..', party.source);
        const tokenToDelete = Object.keys(db.videoTokens).find(token => db.videoTokens[token].path === party.source);
        if (tokenToDelete) delete db.videoTokens[tokenToDelete];
        
        if (fs.existsSync(videoPath)) {
            fs.unlink(videoPath, (err) => {
                if (err) console.error("Error deleting video file:", err);
            });
        }
    }

    delete db.parties[partyId];
    for (const socketId in db.hostSocketMap) {
        if (db.hostSocketMap[socketId] === partyId) {
            delete db.hostSocketMap[socketId];
        }
    }

    res.clearCookie('rejoinToken');
    io.to(partyId).emit('stream-end');
    res.json({ success: true, message: 'Yayın sonlandırıldı.' });
});

// Clear a rejoin cookie and delete the associated file
router.post('/stream/clear-rejoin', (req, res) => {
    const { db } = req;
    const { rejoinToken } = req.cookies;

    if (rejoinToken && db.videoTokens[rejoinToken]) {
        const videoInfo = db.videoTokens[rejoinToken];
        const videoPath = path.join(__dirname, '..', videoInfo.path);
        if (fs.existsSync(videoPath)) {
            fs.unlink(videoPath, (err) => {
                if (err) console.error("Error deleting video file:", err);
            });
        }
        delete db.videoTokens[rejoinToken];
    }
    
    res.clearCookie('rejoinToken');
    res.json({ success: true });
});

module.exports = router;
