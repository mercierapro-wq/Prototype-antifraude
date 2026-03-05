import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { analyzeRouter } from './routes/analyze';

const app = express();
const PORT = process.env.PORT ?? 3002;
const API_KEY = process.env.API_KEY;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());

// ─── Authentification par clé API ────────────────────────────────────────────

function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    console.warn('⚠️  API_KEY non configurée dans .env — endpoint non protégé');
    next();
    return;
  }
  const provided = req.headers['x-api-key'];
  if (provided !== API_KEY) {
    res.status(401).json({ error: 'Clé API invalide ou manquante (en-tête x-api-key requis)' });
    return;
  }
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api', requireApiKey, analyzeRouter);

// Health check — non protégé (monitoring externe)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'finovox-antifraude', version: '2.0.0' });
});

app.get('/', (_req, res) => res.json({ service: 'finovox-antifraude', docs: '/health' }));
app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => res.status(204).end());

// ─── Démarrage ────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Finovox Anti-Fraude API — http://localhost:${PORT}`);
  console.log(`  POST http://localhost:${PORT}/api/analyze  (multipart/form-data · champ "file" · en-tête x-api-key)`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  if (API_KEY) {
    console.log(`  🔑 Clé API configurée (${API_KEY.length} caractères)`);
  } else {
    console.warn(`  ⚠️  API_KEY non définie dans .env — endpoint non protégé`);
  }
});
