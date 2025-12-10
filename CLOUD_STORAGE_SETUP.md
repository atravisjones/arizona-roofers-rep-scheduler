# Cloud Storage Setup Guide

## Problem
The Google Sheets API requires OAuth2 authentication for write operations. API keys only work for reading data, not writing.

## Solution
Use Google Apps Script as a web service to handle writes server-side, while using the Sheets API for reads.

## Setup Steps

### 1. Open Your Storage Spreadsheet
Open this spreadsheet: https://docs.google.com/spreadsheets/d/1Jn_7K25iMJ35h0FGtWaz4FS4u2bfiKzJQmFEPyA3hdk/edit

### 2. Open Apps Script Editor
1. Click **Extensions** → **Apps Script**
2. You'll see the script editor

### 3. Add the Save/Load Script
1. Delete any existing code in the editor
2. Copy the entire contents of `google-apps-script/SaveLoadAPI.gs`
3. Paste it into the Apps Script editor
4. Click **File** → **Save** (or Ctrl+S)
5. Name your project "Storage API" or similar

### 4. Deploy as Web App
1. Click **Deploy** → **New deployment**
2. Click the gear icon ⚙️ next to "Select type"
3. Choose **Web app**
4. Configure the deployment:
   - **Description**: "Storage API for Rep Scheduler"
   - **Execute as**: Me (your email)
   - **Who has access**: Anyone
5. Click **Deploy**
6. You may need to authorize the script:
   - Click **Authorize access**
   - Choose your Google account
   - Click **Advanced** → **Go to [project name] (unsafe)**
   - Click **Allow**
7. **Copy the Web app URL** - it will look like:
   `https://script.google.com/macros/s/SOME_LONG_ID_HERE/exec`

### 5. Update Your Code
1. Open `services/cloudStorageServiceSheets.ts`
2. Find this line:
   ```typescript
   const STORAGE_API_URL = "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec";
   ```
3. Replace `YOUR_DEPLOYMENT_ID_HERE` with the deployment ID from step 4
4. Save the file

### 6. Test It
1. The dev server should auto-reload
2. Try saving data to the cloud using the "Upload to Cloud" button
3. Check your spreadsheet - you should see the data appear

## Troubleshooting

### "Failed to fetch" or CORS errors
- Make sure you set "Who has access" to "Anyone" in the deployment settings
- Redeploy the script if you made changes

### 403 Permission Errors
- Make sure the spreadsheet is publicly viewable (for reads)
- Make sure you authorized the script with your account

### Data not saving
- Check the browser console for error messages
- Try running the `testAPI()` function in the Apps Script editor to verify it works

### Still creating duplicates
- The old duplicates were created before the fix - you need to manually delete them
- The Apps Script properly handles deduplication by checking for existing dates before saving

## How It Works

**Reading (Fast)**: Uses Google Sheets API directly with API key
**Writing (Secure)**: Uses Apps Script web app which handles authentication server-side

This hybrid approach gives us:
- Fast reads with API key
- Secure writes without exposing OAuth credentials
- No CORS issues
- Built-in duplicate prevention
