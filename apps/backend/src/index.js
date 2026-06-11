require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const app = express();

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/datasets', require('./routes/datasets'));
app.use('/reports', require('./routes/reports'));

app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
