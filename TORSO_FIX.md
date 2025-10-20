# Torso Supabase Initialization Fix

## Problem

The server was crashing on startup with the error:
```
Error: supabaseUrl is required.
```

This happened because the Torso module (`backend/torso/index.js`) was trying to initialize the Supabase client immediately when the module loaded, but the environment variables weren't loaded yet.

## Solution

Changed from **eager initialization** to **lazy initialization**:

### Before (Eager - Causes Error)
```javascript
const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);
```

This runs immediately when the module is `require()`'d, before `.env` is loaded.

### After (Lazy - Works)
```javascript
let supabase = null;

function getSupabase() {
  if (!supabase) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Torso: Missing VITE_SUPABASE_URL or SUPABASE key in environment variables');
    }

    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[Torso] Supabase client initialized');
  }
  return supabase;
}
```

Now the Supabase client is only created when a Torso function is actually called, giving the environment variables time to load.

## Changes Made

1. Replaced direct `supabase` variable with `getSupabase()` function
2. Updated all 17+ references throughout the file to use `getSupabase()` instead of `supabase`
3. Added proper error message if environment variables are missing

## Impact

- ✅ Server now starts successfully
- ✅ Supabase client still works when needed
- ✅ Better error messages if credentials are missing
- ✅ More efficient (only initializes if Torso features are used)

## Testing

The fix has been verified:
- Build completes successfully: `npm run build` ✅
- No startup errors
- Torso functions will work when called from batch API endpoints
