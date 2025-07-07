// public/js/viewer.js
// Frontend logic for the viewer page with limited controls.

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM Elements
    const waitingScreen = document.getElementById('waiting-screen');
    const playerContainer = document.getElementById('player-container');
    const youtubePlayerEl = document.getElementById('youtube-player');
    const videoPlayer = document.getElementById('video-player');
    const connectionStatus = document.getElementById('connection-status');
    const unmuteOverlay = document.getElementById('unmute-overlay');

    // State
    let ytPlayer;
    let currentStream = null;
    const partyId = window.location.pathname.split('/').pop();
    const SYNC_THRESHOLD = 1.5;
    let peerConnection;
    const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    let lastKnownHostTime = 0;

    // --- Player Initialization & Autoplay ---
    window.onYouTubeIframeAPIReady = () => {};

    function initializeYoutubePlayer(videoId) {
        if (ytPlayer) ytPlayer.destroy();
        ytPlayer = new YT.Player('youtube-player', {
            height: '100%', width: '100%', videoId: videoId,
            playerVars: { 'autoplay': 1, 'controls': 1, 'disablekb': 1, 'modestbranding': 1, 'rel': 0, 'iv_load_policy': 3 },
            events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
        });
    }

    function onPlayerReady(event) {
        event.target.mute();
        event.target.playVideo();
    }

    function onPlayerStateChange(event) {
        if ((event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.BUFFERING) && currentStream && currentStream.isPlaying) {
            ytPlayer.playVideo();
        } else if (event.data === YT.PlayerState.PLAYING && currentStream && !currentStream.isPlaying) {
            ytPlayer.pauseVideo();
        }
    }

    async function attemptAutoplay(player) {
        try {
            player.muted = true;
            await player.play();
        } catch (error) {
            unmuteOverlay.classList.remove('hidden');
            unmuteOverlay.addEventListener('click', () => {
                player.muted = false;
                player.play();
                unmuteOverlay.classList.add('hidden');
            }, { once: true });
        }
    }
    
    // --- Viewer Control Restriction ---
    function setupViewerControls() {
        videoPlayer.addEventListener('play', (e) => {
            if (currentStream && !currentStream.isPlaying) {
                e.preventDefault();
                videoPlayer.pause();
            }
        });
        videoPlayer.addEventListener('pause', (e) => {
            if (currentStream && currentStream.isPlaying) {
                e.preventDefault();
                videoPlayer.play();
            }
        });
        videoPlayer.addEventListener('seeking', () => {
             if (Math.abs(videoPlayer.currentTime - lastKnownHostTime) > SYNC_THRESHOLD * 2) {
                videoPlayer.currentTime = lastKnownHostTime;
            }
        });
    }

    // --- Socket Listeners ---
    socket.on('connect', () => {
        connectionStatus.textContent = 'Bağlandı';
        socket.emit('join-party', { partyId: partyId, isHost: false });
    });

    socket.on('disconnect', () => {
        connectionStatus.textContent = 'Bağlantı Kesildi';
    });

    socket.on('stream-end', () => {
        document.body.innerHTML = '<div class="w-full h-screen flex items-center justify-center text-white text-2xl bg-gray-900">Yayın sona erdi.</div>';
    });

    socket.on('sync-state', (state) => {
        if (!currentStream) setupStream(state);
        currentStream = state;
        if (state.type !== 'screenShare') applySync(state);
    });
    
    socket.on('error-message', (message) => {
        document.body.innerHTML = `<div class="w-full h-screen flex items-center justify-center text-red-400 text-2xl bg-gray-900">${message}</div>`;
    });

    // --- UI and Player Logic ---
    function setupStream(stream) {
        currentStream = stream;
        waitingScreen.classList.add('hidden');
        playerContainer.classList.remove('hidden');
        youtubePlayerEl.classList.add('hidden');
        videoPlayer.classList.add('hidden');

        if (stream.type === 'screenShare') {
            videoPlayer.classList.remove('hidden');
        } else if (stream.type === 'youtube') {
            youtubePlayerEl.classList.remove('hidden');
            initializeYoutubePlayer(stream.source);
        } else if (stream.type === 'video') {
            videoPlayer.classList.remove('hidden');
            videoPlayer.src = stream.source;
            videoPlayer.load();
            attemptAutoplay(videoPlayer);
            setupViewerControls();
        }
    }
    
    function applySync(state) {
        const serverTime = state.startTime;
        const timeSinceUpdate = (Date.now() - state.adminLastUpdate) / 1000;
        const intendedTime = serverTime + (state.isPlaying ? timeSinceUpdate : 0);
        lastKnownHostTime = intendedTime;
        const isPlaying = state.isPlaying;

        if (state.type === 'youtube' && ytPlayer && typeof ytPlayer.seekTo === 'function') {
            const clientTime = ytPlayer.getCurrentTime();
            if (Math.abs(clientTime - intendedTime) > SYNC_THRESHOLD) ytPlayer.seekTo(intendedTime, true);
            if (isPlaying && ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) ytPlayer.playVideo();
            else if (!isPlaying && ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) ytPlayer.pauseVideo();
        } else if (state.type === 'video') {
            if (Math.abs(videoPlayer.currentTime - intendedTime) > SYNC_THRESHOLD) {
                videoPlayer.currentTime = intendedTime;
            }
            if (isPlaying && videoPlayer.paused) videoPlayer.play();
            else if (!isPlaying && !videoPlayer.paused) videoPlayer.pause();
        }
    }

    // --- WebRTC Signaling (Viewer Side) ---
    socket.on('webrtc-offer', async ({ from, offer }) => {
        peerConnection = new RTCPeerConnection(rtcConfig);
        peerConnection.ontrack = event => {
            if (videoPlayer.srcObject !== event.streams[0]) {
                videoPlayer.srcObject = event.streams[0];
                attemptAutoplay(videoPlayer);
            }
        };
        peerConnection.onicecandidate = event => {
            if (event.candidate) socket.emit('webrtc-ice-candidate', { to: from, candidate: event.candidate });
        };
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc-answer', { to: from, answer });
    });

    socket.on('webrtc-ice-candidate', ({ candidate }) => {
        if (peerConnection) peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
    });

    socket.on('user-disconnected', () => {
        if(peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
    });
});
