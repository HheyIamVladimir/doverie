const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(__dirname));

let db = { users: [], messages: [], lastId: 1000 };

app.post('/api/register', (req, res) => {
    const { username, password, platform } = req.body;
    db.lastId++;
    const newId = db.lastId.toString();
    const finalName = (platform === 'app' ? '[app] ' : '[site] ') + username;
    db.users.push({ id: newId, username: finalName, password });
    res.json({ success: true, id: newId });
});

app.post('/api/login', (req, res) => {
    const { id, password } = req.body;
    const user = db.users.find(u => u.id === id && u.password === password);
    if (user) res.json({ success: true, id: user.id, username: user.username });
    else res.json({ success: false });
});

app.post('/api/messages', (req, res) => {
    db.messages.push({ ...req.body, time: Date.now() });
    res.json({ success: true });
});

app.get('/api/messages/:myId/:otherId', (req, res) => {
    const { myId, otherId } = req.params;
    const history = db.messages.filter(m => 
        (m.fromId === myId && m.toId === otherId) || (m.fromId === otherId && m.toId === myId)
    );
    res.json(history);
});

app.listen(PORT, () => console.log(`Server Rollback to v1.2 live on ${PORT}`));

