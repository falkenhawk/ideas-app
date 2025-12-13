const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL;

// PostgreSQL connection pool (if DATABASE_URL is set)
let pool = null;
let useDatabase = false;

if (DATABASE_URL) {
    pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    useDatabase = true;
    console.log('Using PostgreSQL database for persistence');

    // Initialize database tables
    initDatabase();
} else {
    console.log('No DATABASE_URL found, using file-based storage (ephemeral on Railway!)');
    const DRAWINGS_DIR = path.join(__dirname, 'drawings');
    if (!fs.existsSync(DRAWINGS_DIR)) {
        fs.mkdirSync(DRAWINGS_DIR, { recursive: true });
    }
}

async function initDatabase() {
    try {
        // Create table with basic structure
        await pool.query(`
            CREATE TABLE IF NOT EXISTS strokes (
                id SERIAL PRIMARY KEY,
                room_name VARCHAR(255) NOT NULL,
                session_id VARCHAR(50) NOT NULL,
                x1 REAL NOT NULL,
                y1 REAL NOT NULL,
                x2 REAL NOT NULL,
                y2 REAL NOT NULL,
                color VARCHAR(20) NOT NULL,
                size INTEGER NOT NULL,
                tool VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add stroke_index column if it doesn't exist (migration)
        try {
            await pool.query(`
                ALTER TABLE strokes ADD COLUMN IF NOT EXISTS stroke_index INTEGER
            `);

            // Set stroke_index for existing rows (use id as fallback)
            await pool.query(`
                UPDATE strokes SET stroke_index = id WHERE stroke_index IS NULL
            `);

            // Make stroke_index NOT NULL after setting values
            await pool.query(`
                ALTER TABLE strokes ALTER COLUMN stroke_index SET NOT NULL
            `);
        } catch (error) {
            console.log('stroke_index migration completed or not needed');
        }

        // Add deleted column if it doesn't exist (migration)
        try {
            await pool.query(`
                ALTER TABLE strokes ADD COLUMN IF NOT EXISTS deleted BOOLEAN DEFAULT FALSE
            `);

            // Set deleted = FALSE for existing rows
            await pool.query(`
                UPDATE strokes SET deleted = FALSE WHERE deleted IS NULL
            `);
        } catch (error) {
            console.log('deleted column migration completed or not needed');
        }

        // Create indices
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_room_session ON strokes (room_name, session_id)
        `);

        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_room_session_active ON strokes (room_name, session_id, deleted)
        `);

        console.log('Database tables initialized and migrated');
    } catch (error) {
        console.error('Error initializing database:', error);
        console.log('Falling back to file-based storage');
        useDatabase = false;
    }
}

// Create HTTP server that serves static files and API
const server = http.createServer(async (req, res) => {
    // API endpoints
    if (req.url.startsWith('/api/')) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');

        if (req.url === '/api/rooms' && req.method === 'GET') {
            // List all rooms
            const rooms = await listAllRooms();
            res.writeHead(200);
            res.end(JSON.stringify({ rooms }));
            return;
        }

        const sessionsMatch = req.url.match(/^\/api\/rooms\/([^\/]+)\/sessions$/);
        if (sessionsMatch && req.method === 'GET') {
            // List sessions for a room
            const roomName = decodeURIComponent(sessionsMatch[1]);
            const sessions = await listRoomSessions(roomName);
            res.writeHead(200);
            res.end(JSON.stringify({ sessions }));
            return;
        }

        const drawingMatch = req.url.match(/^\/api\/drawings\/([^\/]+)\/([^\/]+)$/);
        if (drawingMatch && req.method === 'GET') {
            // Get a specific drawing
            const roomName = decodeURIComponent(drawingMatch[1]);
            const sessionId = decodeURIComponent(drawingMatch[2]);
            const drawing = await loadRoomDrawing(roomName, sessionId);
            res.writeHead(200);
            res.end(JSON.stringify(drawing));
            return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
    }

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

// Store current session for each room: roomName -> sessionId (timestamp)
const currentSessions = new Map();

// Helper functions for persistence (DATABASE)
async function getCurrentSessionId(roomName) {
    if (!currentSessions.has(roomName)) {
        // Check if there are existing sessions for this room
        const sessions = await listRoomSessions(roomName);
        if (sessions.length > 0) {
            // Use the most recent session
            currentSessions.set(roomName, sessions[0]);
        } else {
            // Create new session
            currentSessions.set(roomName, Date.now().toString());
        }
    }
    return currentSessions.get(roomName);
}

async function listRoomSessions(roomName) {
    if (useDatabase && pool) {
        try {
            const result = await pool.query(
                'SELECT DISTINCT session_id FROM strokes WHERE room_name = $1 ORDER BY session_id DESC',
                [roomName]
            );
            return result.rows.map(row => row.session_id);
        } catch (error) {
            console.error('Error listing sessions:', error);
            return [];
        }
    } else {
        // File-based fallback
        const safeName = getSafeRoomName(roomName);
        const prefix = `${safeName}_`;
        const DRAWINGS_DIR = path.join(__dirname, 'drawings');

        try {
            const files = fs.readdirSync(DRAWINGS_DIR);
            const sessions = files
                .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
                .map(f => f.replace(prefix, '').replace('.json', ''))
                .sort((a, b) => parseInt(b) - parseInt(a));
            return sessions;
        } catch (error) {
            return [];
        }
    }
}

async function listAllRooms() {
    if (useDatabase && pool) {
        try {
            const result = await pool.query(
                'SELECT DISTINCT room_name FROM strokes ORDER BY room_name'
            );
            return result.rows.map(row => row.room_name);
        } catch (error) {
            console.error('Error listing rooms:', error);
            return [];
        }
    } else {
        // File-based fallback
        const DRAWINGS_DIR = path.join(__dirname, 'drawings');
        try {
            const files = fs.readdirSync(DRAWINGS_DIR);
            const rooms = new Set();

            files.forEach(f => {
                if (f.endsWith('.json')) {
                    const lastUnderscore = f.lastIndexOf('_');
                    if (lastUnderscore > 0) {
                        rooms.add(f.substring(0, lastUnderscore));
                    }
                }
            });

            return Array.from(rooms);
        } catch (error) {
            return [];
        }
    }
}

async function loadRoomDrawing(roomName, sessionId = null) {
    const actualSessionId = sessionId || await getCurrentSessionId(roomName);

    if (useDatabase && pool) {
        try {
            const result = await pool.query(
                'SELECT stroke_index, x1, y1, x2, y2, color, size, tool FROM strokes WHERE room_name = $1 AND session_id = $2 AND deleted = FALSE ORDER BY stroke_index ASC',
                [roomName, actualSessionId]
            );
            return { strokes: result.rows };
        } catch (error) {
            console.error('Error loading drawing:', error);
            return { strokes: [] };
        }
    } else {
        // File-based fallback
        const filePath = getRoomFilePath(roomName, actualSessionId);
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
}

async function saveStroke(roomName, stroke, strokeIndex) {
    const sessionId = await getCurrentSessionId(roomName);

    if (useDatabase && pool) {
        try {
            await pool.query(
                'INSERT INTO strokes (room_name, session_id, stroke_index, x1, y1, x2, y2, color, size, tool) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
                [roomName, sessionId, strokeIndex, stroke.x1, stroke.y1, stroke.x2, stroke.y2, stroke.color, stroke.size, stroke.tool]
            );
        } catch (error) {
            console.error('Error saving stroke:', error);
        }
    } else {
        // File-based fallback
        const filePath = getRoomFilePath(roomName, sessionId);
        try {
            const drawing = await loadRoomDrawing(roomName, sessionId);
            drawing.strokes.push({ ...stroke, stroke_index: strokeIndex });
            fs.writeFileSync(filePath, JSON.stringify(drawing, null, 2));
        } catch (error) {
            console.error('Error saving stroke:', error);
        }
    }
}

async function undoStroke(roomName, strokeIndex) {
    const sessionId = await getCurrentSessionId(roomName);

    if (useDatabase && pool) {
        try {
            await pool.query(
                'UPDATE strokes SET deleted = TRUE WHERE room_name = $1 AND session_id = $2 AND stroke_index = $3',
                [roomName, sessionId, strokeIndex]
            );
        } catch (error) {
            console.error('Error undoing stroke:', error);
        }
    } else {
        // File-based fallback - mark as deleted in JSON
        const filePath = getRoomFilePath(roomName, sessionId);
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const drawing = JSON.parse(data);
            const stroke = drawing.strokes.find(s => s.stroke_index === strokeIndex);
            if (stroke) {
                stroke.deleted = true;
            }
            fs.writeFileSync(filePath, JSON.stringify(drawing, null, 2));
        } catch (error) {
            console.error('Error undoing stroke:', error);
        }
    }
}

async function redoStroke(roomName, strokeIndex) {
    const sessionId = await getCurrentSessionId(roomName);

    if (useDatabase && pool) {
        try {
            await pool.query(
                'UPDATE strokes SET deleted = FALSE WHERE room_name = $1 AND session_id = $2 AND stroke_index = $3',
                [roomName, sessionId, strokeIndex]
            );
        } catch (error) {
            console.error('Error redoing stroke:', error);
        }
    } else {
        // File-based fallback
        const filePath = getRoomFilePath(roomName, sessionId);
        try {
            const data = fs.readFileSync(filePath, 'utf8');
            const drawing = JSON.parse(data);
            const stroke = drawing.strokes.find(s => s.stroke_index === strokeIndex);
            if (stroke) {
                stroke.deleted = false;
            }
            fs.writeFileSync(filePath, JSON.stringify(drawing, null, 2));
        } catch (error) {
            console.error('Error redoing stroke:', error);
        }
    }
}

async function createNewSession(roomName) {
    const newSessionId = Date.now().toString();
    currentSessions.set(roomName, newSessionId);

    if (useDatabase && pool) {
        // Database will auto-create on first insert
        console.log(`Created new session ${newSessionId} for room ${roomName}`);
    } else {
        // File-based fallback
        const filePath = getRoomFilePath(roomName, newSessionId);
        try {
            fs.writeFileSync(filePath, JSON.stringify({ strokes: [] }, null, 2));
        } catch (error) {
            console.error('Error creating new session:', error);
        }
    }

    return newSessionId;
}

// File-based helper functions (fallback)
function getSafeRoomName(roomName) {
    return roomName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

function getRoomFilePath(roomName, sessionId) {
    const safeName = getSafeRoomName(roomName);
    const DRAWINGS_DIR = path.join(__dirname, 'drawings');
    return path.join(DRAWINGS_DIR, `${safeName}_${sessionId}.json`);
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    let currentRoom = null;

    ws.on('message', async (message) => {
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
                const drawing = await loadRoomDrawing(currentRoom);

                // Send confirmation with drawing history
                ws.send(JSON.stringify({
                    type: 'joined',
                    room: currentRoom,
                    peers: rooms.get(currentRoom).size - 1,
                    strokes: drawing.strokes
                }));

            } else if (data.type === 'stroke') {
                // Save stroke to database/file with stroke_index
                if (currentRoom) {
                    await saveStroke(currentRoom, {
                        x1: data.x1,
                        y1: data.y1,
                        x2: data.x2,
                        y2: data.y2,
                        color: data.color,
                        size: data.size,
                        tool: data.tool
                    }, data.strokeIndex);
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
            } else if (data.type === 'undo') {
                // Undo stroke in database
                if (currentRoom) {
                    await undoStroke(currentRoom, data.strokeIndex);
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
            } else if (data.type === 'redo') {
                // Redo stroke in database
                if (currentRoom) {
                    await redoStroke(currentRoom, data.strokeIndex);
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
                // Create new session instead of clearing
                if (currentRoom) {
                    const newSessionId = await createNewSession(currentRoom);
                    console.log(`Created new session for room ${currentRoom}: ${newSessionId}`);
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
    console.log(`Storage: ${useDatabase ? 'PostgreSQL (persistent)' : 'Files (ephemeral)'}`);
});
