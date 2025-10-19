# Routing Fix for Admin Calculator

## Issue
The admin calculator was returning a 404 error when accessed via the redirect from the root route.

## Root Cause
The original implementation had:
1. Root route (`/`) serving `index.html` without authentication
2. `index.html` attempting to redirect to `/frontend/admin-calculator.html`
3. The path `/frontend/admin-calculator.html` doesn't exist as a route (only `/admin-calculator` exists)
4. The `/admin-calculator` route requires authentication, but the redirect from an unauthenticated page was failing

## Solution

### Backend Fix (backend/fastScraper.js)
Changed the root route to do a server-side redirect instead of serving index.html:

**Before:**
```javascript
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend', 'index.html');
  res.sendFile(frontendPath, ...);
});
```

**After:**
```javascript
app.get('/', (req, res) => {
  res.redirect('/admin-calculator');
});
```

### Frontend Fix (frontend/index.html)
Updated the client-side redirect to use the correct route:

**Before:**
```javascript
window.location.replace('/frontend/admin-calculator.html');
```

**After:**
```javascript
window.location.replace('/admin-calculator');
```

## Benefits
1. **Server-side redirect**: The server immediately redirects to `/admin-calculator` at the HTTP level
2. **Proper authentication flow**: When the browser hits `/admin-calculator`, it encounters the 401 and triggers HTTP Basic Auth
3. **Client-side backup**: The JavaScript redirect in index.html serves as a fallback
4. **Cleaner routing**: Uses the proper Express route instead of trying to access files directly

## Testing
- Navigate to `/` → redirects to `/admin-calculator` → prompts for authentication
- After authentication (admin:1064) → loads admin calculator
- Direct access to `/admin-calculator` → prompts for authentication → loads calculator

## Files Modified
1. `backend/fastScraper.js` - Changed root route to redirect
2. `frontend/index.html` - Fixed redirect path to `/admin-calculator`
