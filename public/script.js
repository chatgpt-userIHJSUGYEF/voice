class VoiceCallApp {
    constructor() {
        this.socket = null;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioStream = null;
        this.participants = new Map();
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.isConnected = false;
        
        this.initElements();
        this.connectToServer();
    }

    initElements() {
        this.micButton = document.getElementById('micButton');
        this.statusElement = document.getElementById('status');
        this.participantCount = document.getElementById('participantCount');
        this.participantsList = document.getElementById('participantsList');
        this.waveContainer = document.querySelector('.wave-container');
        
        this.micButton.addEventListener('click', () => this.toggleRecording());
    }

    async connectToServer() {
        try {
            // Use the current domain for the socket connection
            const serverUrl = window.location.origin;
            
            this.socket = io(serverUrl);
            
            this.socket.on('connect', () => {
                this.isConnected = true;
                this.updateStatus('متصل شد', 'connected');
                this.requestMicrophonePermission();
            });

            this.socket.on('disconnect', () => {
                this.isConnected = false;
                this.updateStatus('اتصال قطع شد', 'disconnected');
                this.micButton.disabled = true;
            });

            this.socket.on('connect_error', (error) => {
                console.error('Connection error:', error);
                this.isConnected = false;
                this.updateStatus('خطا در اتصال', 'error');
                this.micButton.disabled = true;
            });

            this.socket.on('user-joined', (data) => {
                this.addParticipant(data.userId, data.username);
                this.updateParticipantCount();
            });

            this.socket.on('user-left', (userId) => {
                this.removeParticipant(userId);
                this.updateParticipantCount();
            });

            this.socket.on('participants-update', (participants) => {
                this.updateParticipantsList(participants);
            });

            this.socket.on('audio-data', (data) => {
                this.playAudio(data.audioData, data.userId);
            });

            this.socket.on('user-speaking', (userId) => {
                this.showUserSpeaking(userId);
            });

            this.socket.on('user-stopped-speaking', (userId) => {
                this.hideUserSpeaking(userId);
            });

        } catch (error) {
            console.error('Connection error:', error);
            this.updateStatus('خطا در اتصال', 'error');
        }
    }

    async requestMicrophonePermission() {
        if (!this.isConnected) {
            this.updateStatus('در انتظار اتصال...', 'connecting');
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            this.audioStream = stream;
            this.setupAudioAnalyzer();
            this.updateStatus('آماده برای صحبت', 'ready');
            this.micButton.disabled = false;
            
        } catch (error) {
            console.error('Microphone permission denied:', error);
            this.updateStatus('دسترسی به میکروفون رد شد', 'error');
            this.micButton.disabled = true;
        }
    }

    setupAudioAnalyzer() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.analyser = this.audioContext.createAnalyser();
        const source = this.audioContext.createMediaStreamSource(this.audioStream);
        
        source.connect(this.analyser);
        this.analyser.fftSize = 256;
        this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        
        this.visualizeAudio();
    }

    visualizeAudio() {
        const animate = () => {
            if (this.isRecording) {
                this.analyser.getByteFrequencyData(this.dataArray);
                const average = this.dataArray.reduce((a, b) => a + b) / this.dataArray.length;
                
                if (average > 30) {
                    this.waveContainer.classList.add('active');
                } else {
                    this.waveContainer.classList.remove('active');
                }
            }
            requestAnimationFrame(animate);
        };
        animate();
    }

    async toggleRecording() {
        if (!this.isConnected) {
            this.updateStatus('لطفا صبر کنید...', 'connecting');
            return;
        }

        if (!this.audioStream) {
            await this.requestMicrophonePermission();
            return;
        }

        if (this.isRecording) {
            this.stopRecording();
        } else {
            this.startRecording();
        }
    }

    startRecording() {
        if (!this.audioStream || !this.isConnected) return;

        try {
            this.mediaRecorder = new MediaRecorder(this.audioStream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            const audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                this.sendAudioData(audioBlob);
            };

            this.mediaRecorder.start(100); // Send data every 100ms
            this.isRecording = true;
            
            this.micButton.classList.add('active');
            this.micButton.querySelector('.button-text').textContent = 'در حال ضبط...';
            this.waveContainer.classList.add('active');
            
            this.socket.emit('user-speaking');

        } catch (error) {
            console.error('Recording error:', error);
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        this.isRecording = false;
        this.micButton.classList.remove('active');
        this.micButton.querySelector('.button-text').textContent = 'فشار دهید';
        this.waveContainer.classList.remove('active');
        
        if (this.socket && this.isConnected) {
            this.socket.emit('user-stopped-speaking');
        }
    }

    sendAudioData(audioBlob) {
        if (!this.socket || !this.isConnected) return;
        
        const reader = new FileReader();
        reader.onload = () => {
            const arrayBuffer = reader.result;
            this.socket.emit('audio-data', arrayBuffer);
        };
        reader.readAsArrayBuffer(audioBlob);
    }

    async playAudio(audioData, userId) {
        try {
            const audioBlob = new Blob([audioData], { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            audio.play().catch(error => {
                console.error('Audio play error:', error);
            });

            // Clean up URL after playing
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
            };

        } catch (error) {
            console.error('Play audio error:', error);
        }
    }

    updateStatus(message, type) {
        this.statusElement.textContent = message;
        this.statusElement.className = `status ${type}`;
    }

    addParticipant(userId, username) {
        this.participants.set(userId, { username, speaking: false });
        this.renderParticipants();
    }

    removeParticipant(userId) {
        this.participants.delete(userId);
        this.renderParticipants();
    }

    updateParticipantsList(participants) {
        this.participants.clear();
        participants.forEach(participant => {
            this.participants.set(participant.id, {
                username: participant.username,
                speaking: false
            });
        });
        this.renderParticipants();
    }

    renderParticipants() {
        this.participantsList.innerHTML = '';
        
        this.participants.forEach((participant, userId) => {
            const participantElement = document.createElement('div');
            participantElement.className = `participant ${participant.speaking ? 'speaking' : ''}`;
            participantElement.innerHTML = `
                <div class="participant-indicator"></div>
                <span>${participant.username || `کاربر ${userId.slice(-4)}`}</span>
            `;
            this.participantsList.appendChild(participantElement);
        });
    }

    updateParticipantCount() {
        this.participantCount.textContent = this.participants.size;
    }

    showUserSpeaking(userId) {
        if (this.participants.has(userId)) {
            this.participants.get(userId).speaking = true;
            this.renderParticipants();
        }
    }

    hideUserSpeaking(userId) {
        if (this.participants.has(userId)) {
            this.participants.get(userId).speaking = false;
            this.renderParticipants();
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.voiceApp = new VoiceCallApp();
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden && window.voiceApp && window.voiceApp.isRecording) {
        window.voiceApp.stopRecording();
    }
});