// socket/handler.js
// Manages real-time communication. Host disconnect no longer deletes files.
const fs = require('fs');
const path = require('path');

function socketHandler(io, db) {
    io.on('connection', (socket) => {
        console.log('A user connected:', socket.id);

        socket.on('join-party', ({ partyId, isHost }) => {
            if (db.parties[partyId]) {
                socket.join(partyId);
                console.log(`Socket ${socket.id} joined party ${partyId}`);

                if (isHost) {
                    db.hostSocketMap[socket.id] = partyId;
                } else {
                    socket.to(partyId).emit('new-viewer', { viewerId: socket.id });
                }
                socket.emit('sync-state', db.parties[partyId]);
            } else {
                socket.emit('error-message', 'Party not found.');
            }
        });

        socket.on('admin-control', (data) => {
            const { partyId, time, isPlaying } = data;
            if (!partyId || !db.parties[partyId]) return;
            const party = db.parties[partyId];
            party.isPlaying = isPlaying;
            party.startTime = time;
            party.adminLastUpdate = Date.now();
            socket.to(partyId).emit('sync-state', party);
        });
        
        socket.on('request-sync', (partyId) => {
             if (db.parties[partyId]) socket.emit('sync-state', db.parties[partyId]);
        });

        socket.on('webrtc-offer', ({ offer, to }) => {
            io.to(to).emit('webrtc-offer', { offer, from: socket.id });
        });

        socket.on('webrtc-answer', ({ answer, to }) => {
            io.to(to).emit('webrtc-answer', { answer, from: socket.id });
        });

        socket.on('webrtc-ice-candidate', ({ candidate, to }) => {
            io.to(to).emit('webrtc-ice-candidate', { candidate, from: socket.id });
        });

        socket.on('disconnecting', () => {
            const partyId = db.hostSocketMap[socket.id];
            if (partyId && db.parties[partyId]) {
                console.log(`Host ${socket.id} of party ${partyId} is disconnecting. Ending party.`);
                
                io.to(partyId).emit('stream-end');
                delete db.parties[partyId];
                delete db.hostSocketMap[socket.id];
            } else {
                for (const room of socket.rooms) {
                    if (room !== socket.id) {
                        socket.to(room).emit('user-disconnected', { viewerId: socket.id });
                    }
                }
            }
        });

        socket.on('disconnect', () => {
            console.log('User disconnected:', socket.id);
        });
    });
}
module.exports = socketHandler;
