// public/js/admin.js
// Frontend logic for the admin dashboard with WebRTC broadcasting and audio check.

document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // DOM Elements
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
    const historyList = document.getElementById('history-list');
    const shareLinkContainer = document.getElementById('share-link-container');
    const shareLinkInput = document.getElementById('share-link-input');
    const copyLinkBtn = document.getElementById('copy-link-btn');

    // State
    let ytPlayer;
    let currentParty = null;
    let syncInterval;
    
    // WebRTC State
    let localStream;
    const peerConnections = {}; // Key: viewerId, Value: RTCPeerConnection
    const rtcConfig = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // Public STUN server
    };

    // --- Player Initialization ---
    window.onYouTubeIframeAPIReady = () => {};
    
    function initializeYoutubePlayer(videoId) {
        if (ytPlayer) ytPlayer.destroy();
        ytPlayer = new YT.Player('youtube-player', {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: { 'autoplay': 1, 'controls': 1, 'rel': 0 },
            events: {
                'onReady': onPlayerReady,
                'onStateChange': onPlayerStateChange
            }
        });
    }

    // --- Event Handlers ---
    startStreamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMessage.textContent = '';
        const formData = new FormData(startStreamForm);
        const streamType = formData.get('type');

        if (streamType === 'screenShare') {
            try {
                // Request both video and audio. The browser will ask the user.
                localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

                // **YENİ KOD: Ses izninin alınıp alınmadığını kontrol et**
                if (localStream.getAudioTracks().length === 0) {
                    // If no audio track, alert the admin.
                    alert("Ekran paylaşımı başlatıldı ancak ses kaynağı bulunamadı.\n\nLütfen paylaşım yaparken 'Sekme sesini paylaş' (Share tab audio) seçeneğini işaretlediğinizden emin olun.");
                }

                // Stop sharing when the user clicks the browser's "Stop sharing" button
                localStream.getVideoTracks()[0].onended = () => {
                    if (currentParty) endBtn.click();
                };
            } catch (err) {
                errorMessage.textContent = "Ekran paylaşımı başlatılamadı. İzin verdiğinizden emin olun.";
                console.error("getDisplayMedia error:", err);
                return;
            }
        }

        try {
            const response = await fetch('/admin/stream/start', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.message);
            
            updateUIForNewStream(result.stream);
        } catch (error) {
            errorMessage.textContent = error.message;
        }
    });

    endBtn.addEventListener('click', async () => {
        if (!currentParty) return;
        if (confirm('Mevcut partiyi bitirmek istediğinizden emin misiniz?')) {
            try {
                const response = await fetch('/admin/stream/end', { 
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ partyId: currentParty.id })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.message);
                
                if (localStream) {
                    localStream.getTracks().forEach(track => track.stop());
                    localStream = null;
                }
                Object.values(peerConnections).forEach(pc => pc.close());

                resetToDefaultState();
                fetchStatus();
            } catch (error) {
                errorMessage.textContent = error.message;
            }
        }
    });
    
    copyLinkBtn.addEventListener('click', () => {
        shareLinkInput.select();
        document.execCommand('copy');
        copyLinkBtn.textContent = 'Kopyalandı!';
        setTimeout(() => { copyLinkBtn.textContent = 'Bağlantıyı Kopyala'; }, 2000);
    });

    playPauseBtn.addEventListener('click', () => {
        if (!currentParty) return;
        if (currentParty.type === 'youtube' && ytPlayer) {
            ytPlayer.getPlayerState() === YT.PlayerState.PLAYING ? ytPlayer.pauseVideo() : ytPlayer.playVideo();
        } else if (currentParty.type === 'video') {
            videoPlayer.paused ? videoPlayer.play() : videoPlayer.pause();
        }
    });

    seekBar.addEventListener('input', () => {
        if (!currentParty) return;
        const time = parseFloat(seekBar.value);
        if (currentParty.type === 'youtube' && ytPlayer) {
            ytPlayer.seekTo(time, true);
        } else if (currentParty.type === 'video') {
            videoPlayer.currentTime = time;
        }
    });

    // --- UI Update Functions ---
    function updateUIForNewStream(stream) {
        currentParty = stream;
        socket.emit('join-party', currentParty.id); // Admin joins their own room
        
        currentStreamInfo.textContent = `Tür: ${stream.type} | Başlık: ${stream.title}`;
        startStreamForm.parentElement.classList.add('hidden');
        endBtn.classList.remove('hidden');
        errorMessage.textContent = '';

        const partyURL = `${window.location.origin}/party/${stream.id}`;
        shareLinkInput.value = partyURL;
        shareLinkContainer.classList.remove('hidden');

        youtubePlayerEl.classList.add('hidden');
        videoPlayer.classList.add('hidden');
        playerContainer.classList.add('hidden');
        
        clearInterval(syncInterval);

        if (stream.type === 'screenShare') {
            playerContainer.classList.remove('hidden');
            videoPlayer.classList.remove('hidden');
            videoPlayer.srcObject = localStream;
            videoPlayer.play();
            globalControls.classList.add('hidden'); // Hide sync controls for screen share
        } else if (stream.type === 'youtube') {
            playerContainer.classList.remove('hidden');
            youtubePlayerEl.classList.remove('hidden');
            initializeYoutubePlayer(stream.source);
            globalControls.classList.remove('hidden');
        } else if (stream.type === 'video') {
            playerContainer.classList.remove('hidden');
            videoPlayer.classList.remove('hidden');
            videoPlayer.src = stream.source;
            videoPlayer.load();
            videoPlayer.play();
            setupVideoPlayerEvents();
            globalControls.classList.remove('hidden');
        }
        seekBar.disabled = false;
    }

    function resetToDefaultState() {
        currentParty = null;
        currentStreamInfo.textContent = 'Aktif yayın yok.';
        startStreamForm.parentElement.classList.remove('hidden');
        endBtn.classList.add('hidden');
        playerContainer.classList.add('hidden');
        globalControls.classList.add('hidden');
        shareLinkContainer.classList.add('hidden');
        seekBar.disabled = true;
        seekBar.value = 0;
        timeDisplay.textContent = "00:00 / 00:00";
        if (ytPlayer) { ytPlayer.destroy(); ytPlayer = null; }
        videoPlayer.src = "";
        videoPlayer.srcObject = null;
        clearInterval(syncInterval);
    }

    function updateHistory(history) {
        historyList.innerHTML = history.length === 0 ? '<li>Bu oturumda geçmiş yayın yok.</li>' :
            history.map(item => `<li>${item.title} (Bitiş: ${new Date(item.endTime).toLocaleTimeString()})</li>`).join('');
    }
    
    function updatePlayPauseButton(isPlaying) {
        if (isPlaying) {
            playPauseBtn.textContent = 'Duraklat';
            playPauseBtn.className = 'px-4 py-2 bg-yellow-500 rounded hover:bg-yellow-600';
        } else {
            playPauseBtn.textContent = 'Oynat';
            playPauseBtn.className = 'px-4 py-2 bg-green-500 rounded hover:bg-green-600';
        }
    }

    function formatTime(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function updateTimeDisplay(current, duration) {
        if (isNaN(current) || isNaN(duration)) return;
        timeDisplay.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
        seekBar.value = current;
        seekBar.max = duration;
    }

    // --- Player Logic & Syncing ---
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
        } else {
            return;
        }
        
        socket.emit('admin-control', {
            partyId: currentParty.id,
            time: time,
            isPlaying: isPlaying,
        });
    }
    
    // --- WebRTC Signaling (Admin Side) ---
    socket.on('new-viewer', async ({ viewerId }) => {
        if (!localStream) return;
        console.log(`New viewer ${viewerId} wants to connect.`);
        
        const pc = new RTCPeerConnection(rtcConfig);
        peerConnections[viewerId] = pc;

        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

        pc.onicecandidate = event => {
            if (event.candidate) {
                socket.emit('webrtc-ice-candidate', { to: viewerId, candidate: event.candidate });
            }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { to: viewerId, offer });
    });

    socket.on('webrtc-answer', async ({ from, answer }) => {
        console.log(`Received answer from ${from}`);
        const pc = peerConnections[from];
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        }
    });

    socket.on('webrtc-ice-candidate', ({ from, candidate }) => {
        const pc = peerConnections[from];
        if (pc) {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding ICE candidate", e));
        }
    });

    socket.on('user-disconnected', ({ viewerId }) => {
        console.log(`Viewer ${viewerId} disconnected.`);
        if (peerConnections[viewerId]) {
            peerConnections[viewerId].close();
            delete peerConnections[viewerId];
        }
    });
    
    // --- Initial Load ---
    async function fetchStatus() {
        try {
            const response = await fetch('/admin/status');
            const data = await response.json();
            if (data.currentStream) {
                updateUIForNewStream(data.currentStream);
            } else {
                resetToDefaultState();
            }
            updateHistory(data.streamHistory);
        } catch (error) {
            errorMessage.textContent = 'Sunucu durumu alınamadı.';
        }
    }

    fetchStatus();
});
