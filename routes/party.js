// routes/party.js
// Handles routing for the viewer/party pages with a custom 404 page.

const express = require('express');
const router = express.Router();
const path = require('path');

router.get('/:id', (req, res) => {
    const { db } = req;
    const partyId = req.params.id;

    if (db.parties[partyId]) {
        res.sendFile(path.join(__dirname, '..', 'public', 'viewer.html'));
    } else {
        res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
    }
});

module.exports = router;
