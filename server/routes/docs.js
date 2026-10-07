const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

const openapiPath = path.join(__dirname, '../docs/openapi.json');

function getUserGuidePath() {
  const possiblePaths = [
    path.resolve(__dirname, '../docs/API_DOCUMENTATION.md'),
    path.resolve(__dirname, '../../API_DOCUMENTATION.md'),
    path.resolve(__dirname, '../API_DOCUMENTATION.md'),
    path.resolve(process.cwd(), 'server/docs/API_DOCUMENTATION.md'),
    path.resolve(process.cwd(), 'API_DOCUMENTATION.md')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(__dirname, '../docs/API_DOCUMENTATION.md');
}

// Controller to stream or download the complete API User Guide
const handleGetUserGuide = (req, res) => {
  try {
    const guidePath = getUserGuidePath();
    if (!fs.existsSync(guidePath)) {
      return res.status(404).json({ error: 'API User Guide file not found on server' });
    }

    const content = fs.readFileSync(guidePath, 'utf8');
    const format = (req.query.format || (req.body && req.body.format) || '').toLowerCase();
    const isDownload = req.query.download !== 'false';

    // JSON response if requested by client
    if (format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json') && format !== 'markdown' && format !== 'raw')) {
      return res.json({
        title: 'QualityCheck REST API & AI Agent Integration Guide',
        filename: 'QualityCheck_API_User_Guide.md',
        contentType: 'text/markdown; charset=utf-8',
        requestedBy: req.user ? {
          userId: req.user.userId,
          username: req.user.username,
          role: req.user.role,
          isApiKey: !!req.user.isApiKey
        } : undefined,
        content: content
      });
    }

    // Default: Download / stream markdown file
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    if (isDownload) {
      res.setHeader('Content-Disposition', 'attachment; filename="QualityCheck_API_User_Guide.md"');
    }
    return res.send(content);
  } catch (error) {
    console.error('Error serving user guide:', error);
    return res.status(500).json({ error: 'Failed to retrieve API User Guide' });
  }
};

// Direct authenticated API user guide download routes
router.get('/get_user_guide', authenticateToken, handleGetUserGuide);
router.post('/get_user_guide', authenticateToken, handleGetUserGuide);
router.get('/user-guide', authenticateToken, handleGetUserGuide);
router.post('/user-guide', authenticateToken, handleGetUserGuide);

// Serve the raw OpenAPI JSON specification
router.get('/openapi.json', (req, res) => {
  try {
    const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/openapi.json'), 'utf8'));
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load OpenAPI specification' });
  }
});

router.get('/swagger.json', (req, res) => {
  try {
    const spec = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/openapi.json'), 'utf8'));
    res.json(spec);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load OpenAPI specification' });
  }
});

// Serve interactive Swagger UI (or user guide if say=get_user_guide query is passed)
router.get('/', (req, res) => {
  const say = (req.query.say || req.query.action || req.query.command || '').trim().toLowerCase();
  if (say === 'get_user_guide' || say === 'get-user-guide') {
    return authenticateToken(req, res, () => handleGetUserGuide(req, res));
  }
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>QualityCheck API Documentation</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <link rel="icon" type="image/svg+xml" href="/logo.svg" />
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .topbar {
      display: none !important;
    }
    .custom-header {
      background: #1e293b;
      border-bottom: 1px solid #334155;
      padding: 1rem 2rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .custom-header h1 {
      margin: 0;
      font-size: 1.4rem;
      color: #38bdf8;
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .custom-header .badge {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .custom-header a {
      color: #94a3b8;
      text-decoration: none;
      font-size: 0.9rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .custom-header a:hover {
      color: #38bdf8;
    }
    .swagger-ui {
      max-width: 1300px;
      margin: 0 auto;
      padding: 1.5rem 1rem;
    }
    /* Dark theme tweaks for Swagger UI */
    .swagger-ui .info .title {
      color: #f1f5f9;
    }
    .swagger-ui .info p, .swagger-ui .info li {
      color: #cbd5e1;
    }
    .swagger-ui .scheme-container {
      background: #1e293b;
      box-shadow: none;
      border: 1px solid #334155;
      border-radius: 8px;
      margin-bottom: 1.5rem;
    }
    .swagger-ui .opblock .opblock-summary-operation-id,
    .swagger-ui .opblock .opblock-summary-path,
    .swagger-ui .opblock .opblock-summary-path__deprecated {
      color: #f8fafc;
    }
    .swagger-ui .opblock-description-wrapper p {
      color: #cbd5e1;
    }
    .swagger-ui .btn.authorize {
      color: #38bdf8;
      border-color: #38bdf8;
    }
    .swagger-ui .btn.authorize svg {
      fill: #38bdf8;
    }
  </style>
</head>
<body>
  <div class="custom-header">
    <h1>
      <span>⚡</span> QualityCheck API Documentation
      <span class="badge">OpenAPI 3.0</span>
    </h1>
    <div style="display: flex; gap: 0.85rem; align-items: center; flex-wrap: wrap;">
      <span id="auth-status-badge" style="display: none; background: rgba(72, 187, 120, 0.2); color: #48bb78; border: 1px solid rgba(72, 187, 120, 0.4); padding: 0.25rem 0.65rem; border-radius: 9999px; font-size: 0.8rem; font-weight: 600;">
        🔒 Web Session Active
      </span>
      <a
        id="download-user-guide-btn"
        href="/api/docs/get_user_guide"
        style="background: #0284c7; color: #ffffff; padding: 0.45rem 0.9rem; border-radius: 6px; font-weight: 500; font-size: 0.85rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.4rem; border: 1px solid #38bdf8; cursor: pointer;"
        title="Download QualityCheck API User Guide (.md)"
      >
        <span>📥</span> Download User Guide (.md)
      </a>
      <a href="/admin">← Back to Admin Panel</a>
    </div>
  </div>

  <div id="swagger-ui"></div>

  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      // 1. Resolve token from query string, localStorage, or cookies
      let token = '';
      const params = new URLSearchParams(window.location.search);
      token = params.get('token') || params.get('auth_token') || params.get('api_key') || params.get('apiKey') || '';

      if (!token) {
        try {
          token = localStorage.getItem('token') || '';
        } catch (e) {}
      }

      if (!token && document.cookie) {
        const match = document.cookie.match(/(?:^|;\s*)(?:token|auth_token|api_key)=([^;]+)/);
        if (match) {
          token = decodeURIComponent(match[1]);
        }
      }

      // Update badge if session is active
      const badge = document.getElementById('auth-status-badge');
      if (token && badge) {
        badge.style.display = 'inline-flex';
        badge.title = token.startsWith('qc_') ? 'Active API Key Authenticated' : 'Logged-in Web User Token Active';
        badge.innerHTML = token.startsWith('qc_') ? '🔑 API Key Active' : '🔒 Logged-in Web Session Active';
      }

      // 2. Wire up the Download User Guide button
      const downloadBtn = document.getElementById('download-user-guide-btn');
      if (downloadBtn) {
        if (token) {
          const qParam = token.startsWith('qc_') ? 'api_key' : 'token';
          downloadBtn.href = '/api/docs/get_user_guide?' + qParam + '=' + encodeURIComponent(token);
        }
        downloadBtn.onclick = function(e) {
          if (token) {
            e.preventDefault();
            const headers = token.startsWith('qc_')
              ? { 'X-API-Key': token }
              : { 'Authorization': 'Bearer ' + token };

            fetch('/api/docs/get_user_guide', {
              headers: headers,
              credentials: 'include'
            })
            .then(function(res) {
              if (!res.ok) throw new Error('Download failed: ' + res.status);
              return res.blob();
            })
            .then(function(blob) {
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'QualityCheck_API_User_Guide.md';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              window.URL.revokeObjectURL(url);
            })
            .catch(function(err) {
              const qParam = token.startsWith('qc_') ? 'api_key' : 'token';
              window.location.href = '/api/docs/get_user_guide?' + qParam + '=' + encodeURIComponent(token);
            });
          }
        };
      }

      // 3. Initialize Swagger UI with requestInterceptor and pre-authorization
      const ui = SwaggerUIBundle({
        url: "/api/docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "BaseLayout",
        requestInterceptor: function(req) {
          req.credentials = 'include';
          if (token) {
            if (token.startsWith('qc_')) {
              req.headers['X-API-Key'] = token;
            } else if (!req.headers['Authorization']) {
              req.headers['Authorization'] = 'Bearer ' + token;
            }
          }
          return req;
        },
        onComplete: function() {
          if (token) {
            if (token.startsWith('qc_')) {
              ui.preauthorizeApiKey('ApiKeyAuth', token);
            } else {
              ui.preauthorizeApiKey('BearerAuth', token);
            }
          }
        }
      });
      window.ui = ui;
    };
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// Support POST on /api/docs with { "say": "get_user_guide" }
router.post('/', (req, res) => {
  const say = (req.body?.say || req.body?.action || req.body?.command || req.query?.say || req.query?.action || '').trim().toLowerCase();
  if (say === 'get_user_guide' || say === 'get-user-guide') {
    return authenticateToken(req, res, () => handleGetUserGuide(req, res));
  }
  return res.status(400).json({ error: 'Unknown action or command. To download the user guide, send say: "get_user_guide"' });
});

router.handleGetUserGuide = handleGetUserGuide;
module.exports = router;
