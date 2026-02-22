const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = './database.json';

// --- РАБОТА С БАЗОЙ ДАННЫХ ---
function loadDB() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error("Ошибка чтения базы данных:", e);
    }
    // Если файла нет или он пустой, создаем начальную структуру
    return { users: [], messages: [], lastId: 1000 };
}

function saveDB() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error("Ошибка сохранения в файл:", e);
    }
}

let db = loadDB();

// --- ЭНДПОИНТЫ ---

// Регистрация
app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ success: false, error: 'Заполни все поля!' });
    }

    db.lastId++;
    const newId = db.lastId.toString();
    
    // Формируем ник с меткой платформы
    const prefix = platform === 'app' ? '[app]' : '[site]';
    const finalName = `${prefix} ${username}`;

    const newUser = { id: newId, username: finalName, password };
    db.users.push(newUser);
    saveDB();

    console.log(`[REG] Новый пользователь: ${finalName} ID: ${newId}`);
    res.json({ success: true, id: newId });
});

// Активация Лямбды
app.post('/api/lambda', (req, res) => {
    const { id } = req.body;
    const user = db.users.find(u => u.id === id);
    if (user) {
        if (!user.username.includes('λ')) {
            user.username += ' λ';
            saveDB();
            res.json({ success: true });
        } else {
            res.json({ success: true, msg: 'Уже активировано' });
        }
    } else {
        res.status(404).json({ success: false, error: 'Пользователь не найден' });
    }
});

// Вход в систему
app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = db.users.find(u => u.id === id && u.password === password);
    
    if (user) {
        console.log(`[LOGIN] Зашел: ${user.username}`);
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.status(401).json({ success: false, error: 'Неверный ID или пароль' });
    }
});

// Поиск пользователя по ID
app.get('/api/users/:id', (req, res) => {
    const user = db.users.find(u => u.id === req.params.id.toUpperCase());
    if (user) {
        res.json({ success: true, id: user.id, username: user.username });
    } else {
        res.json({ success: false });
    }
});

// Отправка сообщения
app.post('/api/messages', (req, res) => {
    const { fromId, toId, text } = req.body;
    if (!text) return res.status(400).json({ success: false });

    const newMessage = { fromId, toId, text, time: Date.now() };
    db.messages.push(newMessage);
    saveDB();
    res.json({ success: true });
});

// Получение истории переписки
app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const history = db.messages.filter(m => 
        (m.fromId === myId && m.toId === otherId) || 
        (m.fromId === otherId && m.toId === myId)
    );
    res.json(history);
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

// Запуск
app.listen(PORT, () => {
    console.log(`
    ======================================
    СЕРВЕР "ДОВЕРИЕ" v1.2.1 ЗАПУЩЕН
    Порт: ${PORT}
    База данных готова к работе.
    ======================================
    `);
});

