// server.js
// Main entry point for the application with cookie-parser.

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser'); // Added cookie-parser
const mainRoutes = require('./routes/main');
const partyRoutes = require('./routes/party');
const socketHandler = require('./socket/handler');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// In-memory "database"
const db = {
    parties: {}, // Key: partyId, Value: stream object
    hostSocketMap: {}, // { socketId: partyId }
    // Maps a unique token to a video file path for rejoining
    videoTokens: {} // { token: { path: '/uploads/file.mp4', title: 'file.mp4' } }
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser()); // Use cookie-parser middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Pass db and io to routes and socket handlers
app.use((req, res, next) => {
    req.db = db;
    req.io = io;
    next();
});

// Routes
app.use('/', mainRoutes); 
app.use('/party', partyRoutes);

// Socket.IO connection handler
socketHandler(io, db);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
