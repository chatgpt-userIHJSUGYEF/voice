const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store connected users
const users = new Map();
const rooms = new Map();

// Serve static files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint for render.com
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    
    // Generate username
    const username = `User_${Math.random().toString(36).substr(2, 6)}`;
    
    // Add user to users map
    users.set(socket.id, {
        id: socket.id,
        username: username,
        speaking: false,
        joinedAt: new Date()
    });

    // Join default room
    const defaultRoom = 'general';
    socket.join(defaultRoom);
    
    if (!rooms.has(defaultRoom)) {
        rooms.set(defaultRoom, new Set());
    }
    rooms.get(defaultRoom).add(socket.id);

    // Notify user of successful connection
    socket.emit('connect-success', {
        userId: socket.id,
        username: username
    });

    // Send current participants to new user
    const roomParticipants = Array.from(rooms.get(defaultRoom) || [])
        .map(userId => users.get(userId))
        .filter(user => user && user.id !== socket.id);
    
    socket.emit('participants-update', roomParticipants);

    // Notify others of new user
    socket.to(defaultRoom).emit('user-joined', {
        userId: socket.id,
        username: username
    });

    // Handle audio data
    socket.on('audio-data', (audioData) => {
        try {
            // Broadcast audio to all other users in the room
            socket.to(defaultRoom).emit('audio-data', {
                audioData: audioData,
                userId: socket.id,
                timestamp: Date.now()
            });
        } catch (error) {
            console.error('Error handling audio data:', error);
        }
    });

    // Handle user speaking status
    socket.on('user-speaking', () => {
        const user = users.get(socket.id);
        if (user) {
            user.speaking = true;
            socket.to(defaultRoom).emit('user-speaking', socket.id);
        }
    });

    socket.on('user-stopped-speaking', () => {
        const user = users.get(socket.id);
        if (user) {
            user.speaking = false;
            socket.to(defaultRoom).emit('user-stopped-speaking', socket.id);
        }
    });

    // Handle room joining (for future expansion)
    socket.on('join-room', (roomName) => {
        // Leave current rooms
        Array.from(socket.rooms).forEach(room => {
            if (room !== socket.id) {
                socket.leave(room);
                if (rooms.has(room)) {
                    rooms.get(room).delete(socket.id);
                }
            }
        });

        // Join new room
        socket.join(roomName);
        if (!rooms.has(roomName)) {
            rooms.set(roomName, new Set());
        }
        rooms.get(roomName).add(socket.id);

        // Send participants in new room
        const roomParticipants = Array.from(rooms.get(roomName) || [])
            .map(userId => users.get(userId))
            .filter(user => user && user.id !== socket.id);
        
        socket.emit('participants-update', roomParticipants);
        socket.to(roomName).emit('user-joined', {
            userId: socket.id,
            username: users.get(socket.id)?.username
        });
    });

    // Handle disconnect
    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
        
        // Remove from all rooms
        Array.from(socket.rooms).forEach(room => {
            if (rooms.has(room)) {
                rooms.get(room).delete(socket.id);
                socket.to(room).emit('user-left', socket.id);
            }
        });

        // Remove from users map
        users.delete(socket.id);
    });

    // Handle errors
    socket.on('error', (error) => {
        console.error(`Socket error for ${socket.id}:`, error);
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Express error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Voice call server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        console.log('Process terminated');
    });
});

// Keep track of server stats (optional)
setInterval(() => {
    console.log(`Server stats - Connected users: ${users.size}, Active rooms: ${rooms.size}`);
}, 300000); // Log every 5 minutes

