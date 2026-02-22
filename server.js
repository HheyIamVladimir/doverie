const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Порт для Render или локалки
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'database.json');

// --- ГИБКАЯ РАБОТА С БАЗОЙ ---
let db = { users: [], messages: [], lastId: 1000 };

function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            console.log("[DB] База успешно загружена из файла");
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("[DB] Ошибка чтения (использую пустую базу):", e.message);
    }
    return { users: [], messages: [], lastId: 1000 };
}

function saveDB() {
    try {
        const data = JSON.stringify(db, null, 2);
        // Пытаемся записать, но если не выйдет — сервер не упадет
        fs.writeFile(DATA_FILE, data, (err) => {
            if (err) console.error("[DB] Внимание: данные не сохранены на диск (Render Disk Limit)");
            else console.log("[DB] Данные синхронизированы с файлом");
        });
    } catch (e) {
        console.error("[DB] Ошибка сериализации:", e.message);
    }
}

// Инициализация
db = loadDB();

// --- ЭНДПОИНТЫ ---

app.post('/api/register', (req, res) => {
    try {
        const { username, password, platform } = req.body;
        if (!username || !password) return res.status(400).json({ success: false, error: 'Заполни поля!' });

        db.lastId++;
        const newId = db.lastId.toString();
        const prefix = platform === 'app' ? '[app]' : '[site]';
        
        const newUser = { id: newId, username: `${prefix} ${username}`, password };
        db.users.push(newUser);
        
        saveDB(); // Пытаемся сохранить
        console.log(`[REG] Создан: ${newUser.username} (#${newId})`);
        res.json({ success: true, id: newId });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Ошибка на стороне сервера' });
    }
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = db.users.find(u => u.id === id.toString() && u.password === password);
    
    if (user) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false, error: 'Неверный ID или пароль' });
    }
});

app.get('/api/users/:id', (req, res) => {
    const user = db.users.find(u => u.id === req.params.id.toUpperCase());
    if (user) res.json({ success: true, id: user.id, username: user.username });
    else res.json({ success: false });
});

app.post('/api/messages', (req, res) => {
    const { fromId, toId, text } = req.body;
    if (!text) return res.json({ success: false });

    db.messages.push({ fromId, toId, text, time: Date.now() });
    saveDB();
    res.json({ success: true });
});

app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const chat = db.messages.filter(m => 
        (m.fromId === myId && m.toId === otherId) || (m.fromId === otherId && m.toId === myId)
    );
    res.json(chat);
});

app.get('/api/chats/:myId', (req, res) => {
    const myId = req.params.myId;
    const chattedIds = new Set();
    db.messages.forEach(m => {
        if (m.fromId === myId) chattedIds.add(m.toId);
        if (m.toId === myId) chattedIds.add(m.fromId);
    });
    const active = db.users.filter(u => chattedIds.has(u.id)).map(u => ({ id: u.id, username: u.username }));
    res.json(active);
});

app.post('/api/lambda', (req, res) => {
    const user = db.users.find(u => u.id === req.body.id);
    if (user && !user.username.includes('λ')) {
        user.username += ' λ';
        saveDB();
        res.json({ success: true });
    } else res.json({ success: false });
});

app.listen(PORT, () => {
    console.log(`=== SERVER LIVE ON PORT ${PORT} ===`);
});

