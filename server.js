const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

// База данных в оперативной памяти (для стабильности на Render)
let db = { users: [], messages: [], lastId: 1000 };

// --- РЕГИСТРАЦИЯ ---
app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Заполни поля!' });

    db.lastId++;
    const newId = db.lastId.toString();
    const finalName = (platform === 'app' ? '[app] ' : '[site] ') + username;
    
    db.users.push({ id: newId, username: finalName, password });
    console.log(`[REG] Новый юзер: ${finalName} ID: ${newId}`);
    res.json({ success: true, id: newId });
});

// --- ВХОД ---
app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = db.users.find(u => u.id === id && u.password === password);
    if (user) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false });
    }
});

// --- ОТПРАВКА СООБЩЕНИЯ ---
app.post('/api/messages', (req, res) => {
    const { fromId, toId, text } = req.body;
    db.messages.push({ fromId, toId, text, time: Date.now() });
    res.json({ success: true });
});

// --- ПОЛУЧЕНИЕ ПЕРЕПИСКИ ---
app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const history = db.messages.filter(m => 
        (m.fromId === myId && m.toId === otherId) || 
        (m.fromId === otherId && m.toId === myId)
    );
    res.json(history);
});

// --- СПИСОК АКТИВНЫХ ЧАТОВ (НОВОЕ) ---
app.get('/api/chats/:myId', (req, res) => {
    const myId = req.params.myId;
    const chattedIds = new Set();
    
    // Ищем все ID, с которыми был контакт
    db.messages.forEach(m => {
        if (m.fromId === myId) chattedIds.add(m.toId);
        if (m.toId === myId) chattedIds.add(m.fromId);
    });

    // Находим данные этих пользователей
    const activeChats = db.users
        .filter(u => chattedIds.has(u.id))
        .map(u => ({ id: u.id, username: u.username }));
    
    res.json(activeChats);
});

// --- АКТИВАЦИЯ ЛЯМБДЫ (НОВОЕ) ---
app.post('/api/lambda', (req, res) => {
    const { id } = req.body;
    const user = db.users.find(u => u.id === id);
    if (user && !user.username.includes('λ')) {
        user.username += ' λ';
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.listen(PORT, () => {
    console.log(`
    ======================================
    СЕРВЕР v1.2.5 ЗАПУЩЕН
    Режим: In-Memory (Стабильный)
    ======================================
    `);
});

