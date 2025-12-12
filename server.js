const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

// Create HTTP server that serves static files
const server = http.createServer((req, res) => {
    // Serve static files
    let filePath = '.' + req.url;
    if (filePath === './') {
        filePath = './index.html';
    }

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('Drawing WebSocket Server is running!\n');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + error.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
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
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket server ready for connections`);
});
