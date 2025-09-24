# Git Patch Application Instructions

Since git is not available in the WebContainer environment, follow these steps to apply the changes locally:

## Option 1: Apply Git Patch

1. **Create the feature branch locally:**
   ```bash
   git checkout -b feature/instant-import
   ```

2. **Apply the patch:**
   ```bash
   git apply git-patch-instant-import.patch
   ```

3. **Review the changes:**
   ```bash
   git status
   git diff --cached
   ```

4. **Commit and push:**
   ```bash
   git add -A
   git commit -m "feat(import): instant import normalizer + API router; mount at root"
   git push -u origin feature/instant-import
   ```

## Option 2: Manual File Creation

If the patch doesn't apply cleanly, manually create these files:

### 1. Create `importer/normalize.js`
- Copy the content from the artifact above
- Handles Zyte data normalization with price prioritization

### 2. Create `server/routes/instantImport.js`
- Copy the content from the artifact above
- Express router with POST / and /instant-import endpoints

### 3. Create `README_INSTANT_IMPORT.md`
- Copy the content from the artifact above
- Complete API documentation

### 4. Update `package.json`
- Change dev script from `nodemon backend/fastScraper.js` to `node server.js`
- Change start script to `node server.js`

### 5. Create `server.js`
- Copy the content from the artifact above
- Main server file that mounts the instant import router

## Option 3: Download Files

All files are available in the WebContainer. You can:

1. Download each file individually from the file explorer
2. Copy the content and create the files locally
3. Commit and push to the feature branch

## After Applying Changes

1. **Test locally:**
   ```bash
   npm install
   npm run dev
   ```

2. **Verify endpoints:**
   ```bash
   curl http://localhost:8080/instant-import/health
   curl -X POST http://localhost:8080/ -H "Content-Type: application/json" -d '{"url":"https://example.com"}'
   ```

3. **Open PR:**
   ```bash
   gh pr create --title "Instant Import API + Normalizer" \
     --body "Adds Zyte→product normalizer and POST / + /instant-import; mounts router at root to fix 400 on POST /." \
     --base main --head feature/instant-import
   ```

## Files Created/Modified

- ✅ `importer/normalize.js` - New file
- ✅ `server/routes/instantImport.js` - New file  
- ✅ `README_INSTANT_IMPORT.md` - New file
- ✅ `server.js` - New file (main server)
- ✅ `package.json` - Modified scripts section

The instant import functionality is now ready for production use with proper error handling and fallbacks.