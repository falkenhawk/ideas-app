const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DRAWINGS_DIR = path.join(__dirname, 'drawings');

// Create drawings directory if it doesn't exist
if (!fs.existsSync(DRAWINGS_DIR)) {
    fs.mkdirSync(DRAWINGS_DIR, { recursive: true });
}

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

// Helper functions for persistence
function getRoomFilePath(roomName) {
    const safeName = roomName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    return path.join(DRAWINGS_DIR, `${safeName}.json`);
}

function loadRoomDrawing(roomName) {
    const filePath = getRoomFilePath(roomName);
    try {
        if (fs.existsSync(filePath)) {
            const data = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading room drawing:', error);
    }
    return { strokes: [] };
}

function saveStroke(roomName, stroke) {
    const filePath = getRoomFilePath(roomName);
    try {
        const drawing = loadRoomDrawing(roomName);
        drawing.strokes.push(stroke);
        fs.writeFileSync(filePath, JSON.stringify(drawing, null, 2));
    } catch (error) {
        console.error('Error saving stroke:', error);
    }
}

function clearRoomDrawing(roomName) {
    const filePath = getRoomFilePath(roomName);
    try {
        fs.writeFileSync(filePath, JSON.stringify({ strokes: [] }, null, 2));
    } catch (error) {
        console.error('Error clearing room drawing:', error);
    }
}

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

                // Load and send previous drawing
                const drawing = loadRoomDrawing(currentRoom);

                // Send confirmation with drawing history
                ws.send(JSON.stringify({
                    type: 'joined',
                    room: currentRoom,
                    peers: rooms.get(currentRoom).size - 1,
                    strokes: drawing.strokes
                }));

            } else if (data.type === 'stroke') {
                // Save stroke to file
                if (currentRoom) {
                    saveStroke(currentRoom, {
                        x1: data.x1,
                        y1: data.y1,
                        x2: data.x2,
                        y2: data.y2,
                        color: data.color,
                        size: data.size,
                        tool: data.tool
                    });
                }

                // Broadcast to other clients
                if (currentRoom && rooms.has(currentRoom)) {
                    const roomClients = rooms.get(currentRoom);
                    const messageStr = JSON.stringify(data);

                    roomClients.forEach((client) => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            client.send(messageStr);
                        }
                    });
                }
            } else if (data.type === 'clear') {
                // Clear saved drawing
                if (currentRoom) {
                    clearRoomDrawing(currentRoom);
                }

                // Broadcast clear to other clients
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
