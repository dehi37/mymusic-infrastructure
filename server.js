require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const { connectToDatabase } = require('./src/index');

const { ensureDatabaseSchema } = require('./src/backend/routes/checkdb');
const { getAllMusiques, createMusique } = require('./src/backend/routes/musiques');
const { getProfile, deleteMusique } = require('./src/backend/routes/profile');
const { trackDownload } = require('./src/backend/routes/downloads');
const { toggleLike } = require('./src/backend/routes/likes');
const { handleUpload } = require('./src/backend/routes/upload');
const { register, verifyOtp, login } = require('./src/backend/routes/auth');

const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;
const frontendDir = path.join(__dirname, 'src', 'frontend');
const MAX_JSON_BODY_SIZE = 1024 * 1024 * 100;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4'
};

function sendFile(req, res, filePath, statusCode = 200) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[extension] || 'application/octet-stream';

  fs.stat(filePath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        send404(res);
      } else {
        send500(res, err);
      }
      return;
    }

    const totalLength = stats.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalLength - 1;

      if (start >= totalLength || end >= totalLength) {
        res.writeHead(416, {
          'Content-Range': `bytes */${totalLength}`
        });
        return res.end();
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${totalLength}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType
      });
      fileStream.pipe(res);
    } else {
      res.writeHead(statusCode, {
        'Content-Type': contentType,
        'Content-Length': totalLength,
        'Accept-Ranges': 'bytes'
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 - Page introuvable');
}

function send500(res, err) {
  console.error(err);
  res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('500 - Erreur serveur');
}

// ============================================
// HEALTH CHECK - AJOUTÉ
// ============================================
function handleHealthCheck(req, res) {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
      status: 'healthy', 
      timestamp: new Date().toISOString() 
    }));
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  // ============================================
  // HEALTH CHECK - PREMIÈRE ROUTE
  // ============================================
  if (handleHealthCheck(req, res)) return;

  const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  req.query = Object.fromEntries(requestUrl.searchParams.entries());

  const isPostApi = req.method === 'POST' && (
    pathname === '/api/musiques' || 
    pathname === '/api/auth/register' || 
    pathname === '/api/auth/verify-otp' || 
    pathname === '/api/auth/login' ||
    pathname === '/api/downloads' ||
    pathname === '/api/likes'
  );

  if (isPostApi) {
    let body = '';
    let receivedSize = 0;

    req.on('data', (chunk) => {
      receivedSize += chunk.length;
      if (receivedSize > MAX_JSON_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Payload trop volumineux pour l\'API.' }));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', async () => {
      try {
        req.body = body ? JSON.parse(body) : {};
        
        if (pathname === '/api/musiques') {
          await createMusique(req, res);
        } else if (pathname === '/api/downloads') {
          await trackDownload(req, res);
        } else if (pathname === '/api/likes') {
          await toggleLike(req, res);
        } else if (pathname === '/api/auth/register') {
          await register(req, res);
        } else if (pathname === '/api/auth/verify-otp') {
          await verifyOtp(req, res);
        } else if (pathname === '/api/auth/login') {
          await login(req, res);
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'JSON invalide ou erreur de traitement.' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/musiques') {
    await getAllMusiques(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/profile') {
    await getProfile(req, res);
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/profile/')) {
    const segments = pathname.split('/').filter(Boolean);
    req.params = { id: segments[2] || null };
    await deleteMusique(req, res);
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    sendFile(req, res, path.join(frontendDir, 'index.html'));
    return;
  }

  if (pathname === '/profile' || pathname === '/profile.html') {
    sendFile(req, res, path.join(frontendDir, 'profile.html'));
    return;
  }

  if (pathname === '/api/checkdb') {
    try {
      const result = await ensureDatabaseSchema();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: error.message }));
    }
    return;
  }

  // Traitement direct de POST /api/upload via le handler interne (avec busboy)
  if (req.method === 'POST' && pathname === '/api/upload') {
    handleUpload(req, res);
    return;
  }

  // Servir directement les fichiers multimédias stockés dans uploads/ à la racine
  if (pathname.startsWith('/uploads/')) {
    const relativePath = pathname.substring(9); // après '/uploads/'
    const normalizedPath = path.normalize(relativePath).replace(/^([.][.][/\\])+/g, '');
    const filePath = path.join(__dirname, 'uploads', normalizedPath);
    const uploadDir = path.join(__dirname, 'uploads');
    
    if (filePath.startsWith(uploadDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(req, res, filePath);
      return;
    }
    send404(res);
    return;
  }

  const normalizedPath = path.normalize(pathname).replace(/^([.][.][/\\])+/g, '');
  const filePath = path.join(frontendDir, normalizedPath);

  if (filePath.startsWith(frontendDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sendFile(req, res, filePath);
    return;
  }

  send404(res);
});

connectToDatabase()
  .catch((error) => {
    console.error('Le serveur continue malgré l\'échec de connexion à la base de données.', error.message);
  });

server.listen(port, hostname, () => {
  console.log(`Serveur lancé sur http://${hostname}:${port}`);
});
