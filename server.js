const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

const PORT = process.env.PORT || 8080;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// --- Инициализация БД ---
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, messages: [] }));
}

function readDB() {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// --- API: Регистрация и Вход ---
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    db.users[id] = { id, username, password };
    writeDB(db);
    res.json({ success: true, id, username });
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const db = readDB();
    const user = db.users[id];
    if (user && user.password === password) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false, error: 'Неверный ID или пароль' });
    }
});

// --- API: Поиск и Чаты ---
app.get('/api/users/:id', (req, res) => {
    const db = readDB();
    const user = db.users[req.params.id];
    if (user) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(404).json({ success: false, error: 'ID не найден' });
    }
});

// НОВОЕ: Эндпоинт для получения списка контактов (Sidebar)
app.get('/api/chats/:id', (req, res) => {
    const db = readDB();
    const myId = req.params.id;
    const interlocutors = new Set();

    // Сканируем сообщения, чтобы найти всех собеседников
    db.messages.forEach(m => {
        if (m.fromId === myId) interlocutors.add(m.toId);
        if (m.toId === myId) interlocutors.add(m.fromId);
    });

    const chatList = Array.from(interlocutors).map(id => ({
        id,
        username: db.users[id] ? db.users[id].username : "Unknown User"
    }));
    res.json(chatList);
});

// --- API: Сообщения ---
app.post('/api/messages', (req, res) => {
    const { fromId, toId, text } = req.body;
    const db = readDB();
    const msg = { fromId, toId, text, time: new Date().toISOString() };
    db.messages.push(msg);
    writeDB(db);
    res.json({ success: true, message: msg });
});

app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    const db = readDB();
    const chat = db.messages.filter(m => 
        (m.fromId === user1 && m.toId === user2) || 
        (m.fromId === user2 && m.toId === user1)
    );
    res.json(chat);
});

// --- Обработка путей ---
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n[SYSTEM]: Мессенджер "Доверие" в эфире.`);
    console.log(`[LINK]: http://localhost:${PORT}\n`);
});

