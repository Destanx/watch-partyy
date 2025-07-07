// public/js/main.js
// Frontend logic for the host page with cookie-based rejoin.

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM Elements
    const startContainer = document.getElementById('start-container');
    const activePartyContainer = document.getElementById('active-party-container');
    const currentStreamInfo = document.getElementById('current-stream-info');
    const playerContainer = document.getElementById('player-container');
    const youtubePlayerEl = document.getElementById('youtube-player');
    const videoPlayer = document.getElementById('video-player');
    const globalControls = document.getElementById('global-controls');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const seekBar = document.getElementById('seek-bar');
    const timeDisplay = document.getElementById('time-display');
    const startStreamForm = document.getElementById('start-stream-form');
    const endBtn = document.getElementById('end-btn');
    const errorMessage = document.getElementById('error-message');
    const shareLinkContainer = document.getElementById('share-link-container');
    const shareLinkInput = document.getElementById('share-link-input');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    // State
    let ytPlayer;
    let currentParty = null;
    let syncInterval;
    let localStream;
    const peerConnections = {};
    const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

    // --- Rejoin Logic ---
    async function checkRejoinPossibility() {
        try {
            const response = await fetch('/stream/check-rejoin', { method: 'POST' });
            const data = await response.json();

            if (data.success) {
                const videoTitle = data.video.title;
                if (confirm(`Daha önce yüklediğiniz '${videoTitle}' videosuyla bir partiye devam etmek ister misiniz?`)) {
                    const rejoinResponse = await fetch('/stream/rejoin', { method: 'POST' });
                    const rejoinData = await rejoinResponse.json();
                    if (rejoinData.success) {
                        showActivePartyView(rejoinData.stream);
                    } else {
                        throw new Error(rejoinData.message);
                    }
                } else {
                    await fetch('/stream/clear-rejoin', { method: 'POST' });
                }
            }
        } catch (error) {
            errorMessage.textContent = error.message || "Yeniden katılma oturumu kontrol edilirken bir hata oluştu.";
        }
    }

    // --- Event Handlers ---
    startStreamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.textContent = '';
        const formData = new FormData(startStreamForm);
        const streamType = formData.get('type');

        if (streamType === 'screenShare') {
            try {
                localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                if (localStream.getAudioTracks().length === 0) {
                    alert("Ekran paylaşımı başlatıldı ancak ses kaynağı bulunamadı.\nLütfen paylaşım yaparken 'Sekme sesini paylaş' seçeneğini işaretlediğinizden emin olun.");
                }
                localStream.getVideoTracks()[0].onended = () => { if (currentParty) endBtn.click(); };
            } catch (err) {
                errorMessage.textContent = "Ekran paylaşımı başlatılamadı. İzin verdiğinizden emin olun.";
                return;
            }
        }

        try {
            const response = await fetch('/stream/start', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            showActivePartyView(result.stream);
        } catch (error) {
            errorMessage.textContent = error.message;
        }
    });

    endBtn.addEventListener('click', async () => {
        if (!currentParty) return;
        if (confirm('Mevcut partiyi bitirmek istediğinizden emin misiniz? Bu işlem yüklenen videoyu sunucudan kalıcı olarak silecektir.')) {
            try {
                await fetch('/stream/end', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ partyId: currentParty.id })
                });
                
                if (localStream) {
                    localStream.getTracks().forEach(track => track.stop());
                    localStream = null;
                }
                Object.values(peerConnections).forEach(pc => pc.close());
                showStartView();
            } catch (error) {
                errorMessage.textContent = error.message;
            }
        }
    });

    copyLinkBtn.addEventListener('click', () => {
        shareLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Kopyalandı!';
        setTimeout(() => { copyLinkBtn.textContent = 'Kopyala'; }, 2000);
    });

    // --- UI State Changers ---
    function showStartView() {
        activePartyContainer.classList.add('hidden');
        startContainer.classList.remove('hidden');
        document.title = "Yeni İzleme Partisi";
        currentParty = null;
        if (ytPlayer) { ytPlayer.destroy(); ytPlayer = null; }
        videoPlayer.src = "";
        videoPlayer.srcObject = null;
        clearInterval(syncInterval);
    }

    function showActivePartyView(stream) {
        currentParty = stream;
        socket.emit('join-party', { partyId: currentParty.id, isHost: true });
        
        startContainer.classList.add('hidden');
        activePartyContainer.classList.remove('hidden');
        document.title = `Yönetici: ${stream.title}`;

        currentStreamInfo.textContent = `Tür: ${stream.type} | Başlık: ${stream.title}`;
        const partyURL = `${window.location.origin}/party/${stream.id}`;
        shareLinkInput.value = partyURL;
        
        playerContainer.classList.remove('hidden');
        youtubePlayerEl.classList.add('hidden');
        videoPlayer.classList.add('hidden');
        globalControls.classList.add('hidden');

        if (stream.type === 'screenShare') {
            videoPlayer.classList.remove('hidden');
            videoPlayer.srcObject = localStream;
            videoPlayer.play();
        } else {
            globalControls.classList.remove('hidden');
            if (stream.type === 'youtube') {
                youtubePlayerEl.classList.remove('hidden');
                initializeYoutubePlayer(stream.source);
            } else if (stream.type === 'video') {
                videoPlayer.classList.remove('hidden');
                videoPlayer.src = stream.source;
                videoPlayer.load();
                videoPlayer.play();
                setupVideoPlayerEvents();
            }
        }
    }

    // --- Player Logic & Syncing ---
    function initializeYoutubePlayer(videoId) {
        if (ytPlayer) ytPlayer.destroy();
        ytPlayer = new YT.Player('youtube-player', {
            height: '100%', width: '100%', videoId: videoId,
            playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0 },
            events: { 'onReady': onPlayerReady, 'onStateChange': onPlayerStateChange }
        });
    }

    function onPlayerReady(event) {
        event.target.playVideo();
        startSyncing();
    }

    function onPlayerStateChange(event) {
        updatePlayPauseButton(event.data === YT.PlayerState.PLAYING);
        sendSync();
    }

    function setupVideoPlayerEvents() {
        videoPlayer.onplay = () => { updatePlayPauseButton(true); sendSync(); };
        videoPlayer.onpause = () => { updatePlayPauseButton(false); sendSync(); };
        videoPlayer.onseeked = () => sendSync();
        videoPlayer.ondurationchange = () => startSyncing();
        videoPlayer.ontimeupdate = () => updateTimeDisplay(videoPlayer.currentTime, videoPlayer.duration);
    }

    function startSyncing() {
        clearInterval(syncInterval);
        syncInterval = setInterval(sendSync, 1000);
    }

    function sendSync() {
        if (!currentParty || currentParty.type === 'screenShare') return;
        let time, isPlaying;
        if (currentParty.type === 'youtube' && ytPlayer && typeof ytPlayer.getCurrentTime === 'function') {
            time = ytPlayer.getCurrentTime();
            isPlaying = ytPlayer.getPlayerState() === YT.PlayerState.PLAYING;
            updateTimeDisplay(time, ytPlayer.getDuration());
        } else if (currentParty.type === 'video' && videoPlayer.duration) {
            time = videoPlayer.currentTime;
            isPlaying = !videoPlayer.paused;
        } else { return; }
        socket.emit('admin-control', { partyId: currentParty.id, time, isPlaying });
    }

    function updatePlayPauseButton(isPlaying) {
        playPauseBtn.textContent = isPlaying ? 'Duraklat' : 'Oynat';
    }

    function updateTimeDisplay(current, duration) {
        if (isNaN(current) || isNaN(duration)) return;
        timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
        seekBar.value = current;
        seekBar.max = duration;
    }

    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    // --- WebRTC Signaling (Host Side) ---
    socket.on('new-viewer', async ({ viewerId }) => {
        if (!localStream) return;
        const pc = new RTCPeerConnection(rtcConfig);
        peerConnections[viewerId] = pc;
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
        pc.onicecandidate = event => {
            if (event.candidate) socket.emit('webrtc-ice-candidate', { to: viewerId, candidate: event.candidate });
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { to: viewerId, offer });
    });

    socket.on('webrtc-answer', async ({ from, answer }) => {
        const pc = peerConnections[from];
        if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
        const pc = peerConnections[from];
        if (pc) pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error(e));
    });

    socket.on('user-disconnected', ({ viewerId }) => {
        if (peerConnections[viewerId]) {
            peerConnections[viewerId].close();
            delete peerConnections[viewerId];
        }
    });

    // Run the check when the page loads
    checkRejoinPossibility();
});
