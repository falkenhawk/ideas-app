const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Drawing WebSocket Server is running!\n');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Store rooms: roomName -> Set of WebSocket connections
const rooms = new Map();

wss.on('connection', (ws) => {
    console.log('New client connected');
    let currentRoom = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'join') {
                // Join a room
                currentRoom = data.room;

                if (!rooms.has(currentRoom)) {
                    rooms.set(currentRoom, new Set());
                }

                rooms.get(currentRoom).add(ws);
                console.log(`Client joined room: ${currentRoom}, total in room: ${rooms.get(currentRoom).size}`);

                // Send confirmation
                ws.send(JSON.stringify({
                    type: 'joined',
                    room: currentRoom,
                    peers: rooms.get(currentRoom).size - 1
                }));

            } else if (data.type === 'stroke' || data.type === 'clear') {
                // Broadcast drawing data to all clients in the same room
                if (currentRoom && rooms.has(currentRoom)) {
                    const roomClients = rooms.get(currentRoom);
                    const messageStr = JSON.stringify(data);

                    roomClients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(messageStr);
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');

        // Remove from room
        if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).delete(ws);

            // Clean up empty rooms
            if (rooms.get(currentRoom).size === 0) {
                rooms.delete(currentRoom);
            }
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

server.listen(PORT, () => {
    console.log(`WebSocket server is running on port ${PORT}`);
});
