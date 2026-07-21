require('dotenv').config();
process.on('unhandledRejection', (err) => console.error('UnhandledRejection:', err));
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
// SEC-003: /uploads is NOT served statically — files served via authenticated GET /datasets/:id/file

const routes = [
  ['/auth', require('./routes/auth')],
  ['/admin', require('./routes/admin')],
  ['/org', require('./routes/org')],
  ['/areas', require('./routes/areas')],
  ['/datasets', require('./routes/datasets')],
  ['/reports', require('./routes/reports')],
  ['/notifications', require('./routes/notifications')],
  ['/worker', require('./routes/worker')],
];
for (const [path, router] of routes) {
  app.use(path, router);
  app.use(`/api${path}`, router);
}

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
