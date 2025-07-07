// routes/admin.js
const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const crypto = require('crypto');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

router.use(session({
    secret: 'a-very-secret-key-for-watch-party',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

const checkAuth = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.redirect('/admin');
};

router.get('/', (req, res) => {
    if (req.session.isAdmin) res.redirect('/admin/dashboard');
    else res.sendFile(path.join(__dirname, '..', 'public', 'admin-login.html'));
});

router.post('/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.send('Invalid credentials. <a href="/admin">Try again</a>');
    }
});

router.get('/dashboard', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin-dashboard.html'));
});

router.post('/stream/start', checkAuth, upload.single('videoFile'), (req, res) => {
    const { db } = req;
    const { type, youtubeLink } = req.body;
    
    if (req.session.partyId && db.parties[req.session.partyId]) {
         return res.status(400).json({ success: false, message: 'You already have an active stream. Please end it first.' });
    }

    const partyId = crypto.randomUUID();
    let newStream = { id: partyId, type, source: null, title: 'N/A', startTime: 0, isPlaying: false, adminLastUpdate: Date.now() };

    switch (type) {
        case 'youtube':
            if (!youtubeLink || !youtubeLink.includes('youtube.com/watch?v=')) return res.status(400).json({ success: false, message: 'Invalid YouTube link.' });
            newStream.source = new URL(youtubeLink).searchParams.get('v');
            newStream.title = `YouTube: ${newStream.source}`;
            break;
        case 'video':
            if (!req.file) return res.status(400).json({ success: false, message: 'No video file uploaded.' });
            newStream.source = `/uploads/${req.file.filename}`;
            newStream.title = `Local Video: ${req.file.originalname}`;
            break;
        case 'screenShare':
            newStream.title = `Admin's Screen Share`;
            // Source is null because it's a live WebRTC stream
            break;
        default:
            return res.status(400).json({ success: false, message: 'Invalid stream type.' });
    }

    db.parties[partyId] = newStream;
    req.session.partyId = partyId;
    res.json({ success: true, message: 'Party started!', partyId: partyId, stream: newStream });
});

router.post('/stream/end', checkAuth, (req, res) => {
    const { db, io } = req;
    const { partyId } = req.body;

    if (!partyId || !db.parties[partyId]) return res.status(400).json({ success: false, message: 'No active stream found.' });

    db.streamHistory.unshift({ ...db.parties[partyId], endTime: new Date().toISOString() });
    if (db.streamHistory.length > 10) db.streamHistory.pop();

    delete db.parties[partyId];
    delete req.session.partyId;

    io.to(partyId).emit('stream-end');
    res.json({ success: true, message: 'Stream ended.' });
});

router.get('/status', checkAuth, (req, res) => {
    const { db } = req;
    const partyId = req.session.partyId;
    const currentParty = partyId ? db.parties[partyId] : null;
    res.json({ currentStream: currentParty, streamHistory: db.streamHistory });
});

module.exports = router;
