const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, 'database.json');

app.use(express.json());
app.use(express.static(__dirname));

// База данных
let db = { users: [], messages: [], groups: [], lastId: 1000 };
if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function save() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// РЕГИСТРАЦИЯ И ВХОД
app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    const newId = (++db.lastId).toString();
    const prefix = platform === 'app' ? '[app] ' : '[site] ';
    db.users.push({ id: newId, username: prefix + username, password });
    save();
    res.json({ success: true, id: newId });
});

app.post('/api/login', (req, res) => {
    const user = db.users.find(u => u.id === req.body.id && u.password === req.body.password);
    if (user) res.json({ success: true, id: user.id, username: user.username });
    else res.status(401).json({ success: false });
});

// ГРУППЫ
app.post('/api/groups/create', (req, res) => {
    const { name, creatorId } = req.body;
    const groupId = "G-" + Math.floor(1000 + Math.random() * 8999);
    db.groups.push({ id: groupId, name: name, members: [creatorId] });
    save();
    res.json({ success: true, groupId });
});

app.post('/api/groups/join', (req, res) => {
    const { groupId, userId } = req.body;
    const group = db.groups.find(g => g.id === groupId);
    if (group && !group.members.includes(userId)) {
        group.members.push(userId);
        save();
        res.json({ success: true });
    } else res.status(404).json({ success: false });
});

// СООБЩЕНИЯ И ОПРОСЫ
app.post('/api/messages', (req, res) => {
    const msg = { 
        ...req.body, 
        id: Date.now() + Math.random(), 
        time: new Date().toISOString() 
    };
    if (msg.type === 'poll') {
        msg.votes = new Array(msg.options.length).fill(0);
    }
    db.messages.push(msg);
    save();
    res.json({ success: true });
});

app.post('/api/poll/vote', (req, res) => {
    const { msgId, optionIdx } = req.body;
    const msg = db.messages.find(m => m.id === msgId);
    if (msg && msg.type === 'poll' && msg.votes) {
        msg.votes[optionIdx]++;
        save();
        res.json({ success: true });
    } else res.status(400).json({ success: false });
});

app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const isGroup = otherId.startsWith('G-');
    
    const history = db.messages.filter(m => {
        if (isGroup) return m.toId === otherId;
        return (m.fromId === myId && m.toId === otherId) || (m.fromId === otherId && m.toId === myId);
    });
    res.json(history);
});

// СПИСОК ЧАТОВ И ГРУПП
app.get('/api/chats/:myId', (req, res) => {
    const myId = req.params.myId;
    const chatIds = new Set();
    
    db.messages.forEach(m => {
        if (m.fromId === myId) chatIds.add(m.toId);
        if (m.toId === myId) chatIds.add(m.fromId);
    });

    const activeUsers = db.users
        .filter(u => chatIds.has(u.id))
        .map(u => ({ id: u.id, username: u.username }));

    const myGroups = db.groups
        .filter(g => g.members.includes(myId))
        .map(g => ({ id: g.id, username: "👥 " + g.name }));

    res.json([...activeUsers, ...myGroups]);
});

// Lambda (заглушка для расширений)
app.post('/api/lambda', (req, res) => {
    console.log(`Lambda activated for ${req.body.id}`);
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Trust Messenger Server v1.3.0 running on port ${PORT}`));