---
description: Rebuild the React production bundle and restart the backend application on port 4006
---

// turbo-all

1. Advance the version.
```powershell
node scripts/advance_version.js
```

2. Build the production bundle.
```powershell
npm run build
```

3. Clear any existing processes on port 4006.
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 4006 -ErrorAction SilentlyContinue).OwningProcess -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
```

4. Start the backend on port 4006.
```powershell
$env:PORT=4006; cmd.exe /c "node server/server.js"
```
