require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');
const pinoHttp = require('pino-http');

const logger = require('./utils/logger');
const { apiLimiter } = require('./middleware/rateLimit');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const uploadsRoutes = require('./routes/uploads');
const notificationsRoutes = require('./routes/notifications');
const orgAdminRoutes = require('./routes/org-admin');
const superAdminRoutes = require('./routes/super-admin');

const app = express();
app.set('trust proxy', 1); // behind Nginx -- needed for correct req.ip / rate limiting

const server = http.createServer(app);

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true }
});

// ===== Security middleware =====
app.use(helmet({
  contentSecurityPolicy: false // the frontend is a separate static site; CSP is configured there / at the Nginx layer
}));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' })); // request-size limit; large payloads (e.g. images) go through multer instead
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
app.use('/api/', apiLimiter);

// Routes that need the `io` instance to emit real-time events after DB writes
const friendsRoutes = require('./routes/friends')(io);
const chatRoutes = require('./routes/chat')(io);
const tripsRoutes = require('./routes/trips')(io);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/trips', tripsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/org-admin', orgAdminRoutes);
app.use('/api/super-admin', superAdminRoutes);
app.use('/api/uploads', uploadsRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Structured error handler -- never leaks stack traces, passwords, or tokens to the client.
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request payload too large' });
  }
  req.log?.error({ err }, 'Unhandled request error');
  logger.error({ err: { message: err.message, stack: err.stack } }, 'Unhandled request error');
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

require('./sockets')(io);

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  // In production under PM2, let it restart the process cleanly rather than limping on.
  process.exit(1);
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  logger.info(`RideMesh API + WebSocket server listening on ${HOST}:${PORT}`);
});
