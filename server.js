const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(__dirname));

// Инициализация базы данных
let db = { users: [], messages: [], lastId: 1000 };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("[DB] Ошибка загрузки, создаю новую базу.");
    }
    return { users: [], messages: [], lastId: 1000 };
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("[DB] Ошибка записи (возможно, Read-Only на Render):", e.message);
    }
}

db = loadDB();

// --- API ЭНДПОИНТЫ ---

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    if (!username || !password) return res.status(400).json({ success: false });

    db.lastId++;
    const newId = db.lastId.toString();
    const finalName = (platform === 'app' ? '[app] ' : '[site] ') + username;

    db.users.push({ id: newId, username: finalName, password });
    saveDB();
    res.json({ success: true, id: newId });
});

// Вход
app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = db.users.find(u => u.id === id && u.password === password);
    if (user) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false });
    }
});

// Список чатов (кто писал мне или кому писал я)
app.get('/api/chats/:myId', (req, res) => {
    const myId = req.params.myId;
    const chattedIds = new Set();
    
    db.messages.forEach(m => {
        if (m.fromId === myId) chattedIds.add(m.toId);
        if (m.toId === myId) chattedIds.add(m.fromId);
    });

    const activeChats = db.users
        .filter(u => chattedIds.has(u.id))
        .map(u => ({ id: u.id, username: u.username }));
    
    res.json(activeChats);
});

// Сообщения
app.post('/api/messages', (req, res) => {
    const { fromId, toId, text } = req.body;
    if (!text) return res.json({ success: false });

    db.messages.push({ fromId, toId, text, time: Date.now() });
    saveDB();
    res.json({ success: true });
});

app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const history = db.messages.filter(m => 
        (m.fromId === myId && m.toId === otherId) || 
        (m.fromId === otherId && m.toId === myId)
    );
    res.json(history);
});

// Лямбда
app.post('/api/lambda', (req, res) => {
    const user = db.users.find(u => u.id === req.body.id);
    if (user && !user.username.includes('λ')) {
        user.username += ' λ';
        saveDB();
        res.json({ success: true });
    } else res.json({ success: false });
});

app.listen(PORT, () => {
    console.log(`
    ======================================
    СЕРВЕР "ДОВЕРИЕ" v1.2.7 ЗАПУЩЕН
    Порт: ${PORT}
    Память: 500MB Limit Ready
    ======================================
    `);
});

