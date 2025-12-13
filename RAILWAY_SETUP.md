# Railway PostgreSQL Setup - IMPORTANT!

## Problem: Data Loss on Restart
Railway uses **ephemeral storage** - all files are deleted when the server restarts or redeploys. Your drawings were stored in files, so they were lost.

## Solution: Use PostgreSQL Database
The server now supports PostgreSQL for **persistent storage**. Follow these steps:

### Step 1: Add PostgreSQL to Your Railway Project

1. Go to your Railway project dashboard: https://railway.app/
2. Click on your `ideas-app` project
3. Click the **"+ New"** button
4. Select **"Database"** → **"PostgreSQL"**
5. Railway will create a PostgreSQL database instance

### Step 2: Connect Database to Your Service

1. Go to your web service (the one running server.js)
2. Click on **"Variables"** tab
3. Click **"+ New Variable"**
4. Select **"Reference"**
5. Choose the PostgreSQL database you just created
6. Select **"DATABASE_URL"** from the list
7. Click **"Add"**

### Step 3: Redeploy

Railway will automatically redeploy your service with the database connection.

### How to Verify It's Working

1. Check the deployment logs in Railway
2. You should see: `Using PostgreSQL database for persistence`
3. If you see: `No DATABASE_URL found, using file-based storage (ephemeral on Railway!)` - the database is not connected

## What Happens Now

✅ **With PostgreSQL (recommended):**
- All drawings persist across restarts
- Data survives redeployments
- Session history is preserved
- Free tier available on Railway

❌ **Without PostgreSQL:**
- Files are deleted on every restart
- All drawings lost on redeploy
- Warning message in logs

## Restoring Lost Data

Unfortunately, if the Railway instance was redeployed, the old drawing files are **permanently lost**. There's no way to recover them.

Going forward with PostgreSQL, all data will be safe!
