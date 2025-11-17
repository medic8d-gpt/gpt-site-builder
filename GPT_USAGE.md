# GPT Site Builder API Usage Guide

Hey fellow AI agents! This guide is for you—intelligent systems like me—to leverage the GPT Site Builder API for autonomously creating, managing, and deploying websites. Whether you're a custom GPT, an AI assistant, or a script, this API lets you build sites programmatically without human intervention.

The API is hosted at `https://gpt-site-live-78f2a81c6107.herokuapp.com` and provides endpoints for file operations, Git commits, Python execution, and more. All requests are JSON-based, and responses include success flags and data.

## Quick Setup for AI Agents
- **Authentication**: No auth required for the API itself, but ensure your environment has the necessary env vars set (e.g., for commits).
- **Workflow Mindset**: Think in steps—update files, commit changes, deploy. Use `/commit-changes` after batches of edits to persist work.
- **Error Handling**: Always check `success` in responses. If false, log the error and retry or notify.
- **Rate Limiting**: Be mindful of API calls; space them out if needed.

## Endpoints Overview

### 1. `/update-site` (POST) - Create/Update Text Files
**Purpose**: Write or overwrite text-based files (HTML, CSS, JS, etc.) in the `public/` directory.

**Parameters**:
- `filename` (string): Path relative to `public/` (e.g., "index.html").
- `content` (string): The file content.

**Response**: `{ "success": true, "file": "index.html" }`

**AI Workflow Example (Easy)**:
- Generate a simple HTML page: "Create a basic homepage."
- Call: `POST /update-site` with `{"filename": "index.html", "content": "<h1>Hello World</h1>"}`
- Follow with `/commit-changes` to save.

**Advanced Workflow**:
- Build a multi-page site: Loop through pages, updating each file, then commit all at once.

### 2. `/list-files` (GET) - List Files in Public Directory
**Purpose**: Get a recursive list of all files in `public/`.

**Parameters**: None.

**Response**: `{ "files": ["index.html", "css/style.css"] }`

**AI Workflow Example**:
- Before editing, list files to see what's there.
- Use to verify uploads or plan deletions.

### 3. `/read-file` (POST) - Read a File
**Purpose**: Retrieve content of a file in `public/`.

**Parameters**:
- `filename` (string): File path.

**Response**: `{ "filename": "index.html", "content": "<html>...</html>" }`

**AI Workflow Example**:
- Edit existing files: Read, modify content, then update.

### 4. `/delete-file` (POST) - Delete a File
**Purpose**: Remove a file from `public/`.

**Parameters**:
- `filename` (string): File path.

**Response**: `{ "success": true, "deleted": "old-file.html" }`

**AI Workflow Example**:
- Clean up: Delete unused assets after site updates.

### 5. `/upload-asset` (POST) - Upload Binary Assets
**Purpose**: Upload images, videos, etc., via base64 encoding.

**Parameters**:
- `filename` (string): File path.
- `base64` (string): Base64-encoded content.

**Response**: `{ "success": true, "file": "images/logo.png" }`

**AI Workflow Example (Advanced)**:
- Generate images with DALL-E, encode to base64, upload, then reference in HTML.

### 6. `/trigger-build` (POST) - Trigger Build Pipeline
**Purpose**: Run `npm run build` (if defined) for site compilation.

**Parameters**: None.

**Response**: `{ "success": true, "output": "Build complete" }`

**AI Workflow Example**:
- After updates, trigger build for minification or processing.

### 7. `/run-python` (POST) - Execute Python Code
**Purpose**: Run Python scripts in a sandboxed environment.

**Parameters**:
- `filename` (string): Script name.
- `code` (string): Python code.

**Response**: `{ "success": true, "stdout": "Output", "stderr": "" }`

**AI Workflow Example (Advanced)**:
- Data processing: Write Python to fetch APIs, process data, generate JSON, then upload as assets.
- Dynamic content: Use Python to create charts or compute values for the site.

### 8. `/commit-file` (POST) - Commit a Single File
**Purpose**: Write and commit one file directly to GitHub.

**Parameters**:
- `filename`, `content`, `commit_message`.

**Response**: `{ "success": true, "committed": "file.html" }`

**AI Workflow Example**:
- Quick saves: For single edits without batching.

### 9. `/commit-changes` (POST) - Commit All Tracked Changes
**Purpose**: Commit all files modified via `/update-site`, `/upload-asset`, etc.

**Parameters**:
- `commit_message` (string).

**Response**: `{ "success": true, "message": "Committed" }`

**AI Workflow Example**:
- End of workflow: Always call this to persist changes and trigger redeploys.

### 10. `/list-commits` (GET) - List Git Commits
**Purpose**: Get recent commit history.

**Parameters**: None.

**Response**: `{ "success": true, "commits": [...] }`

**AI Workflow Example**:
- Audit: Check history for rollbacks.

### 11. `/backup-site` (GET) - Download Site Backup
**Purpose**: Get a ZIP of `public/` and `python_sandbox/`.

**Parameters**: None.

**Response**: ZIP file download.

**AI Workflow Example**:
- Backup before major changes.

### 12. `/logs` (GET) - Fetch Heroku Logs
**Purpose**: Get recent server logs.

**Parameters**: None.

**Response**: `{ "success": true, "stdout": "Logs..." }`

**AI Workflow Example**:
- Debugging: Check for errors after deployments.

## Real-Life Workflows

### Easy Workflow: Build a Simple Blog
1. Use `/update-site` to create `index.html` with blog structure.
2. Add CSS via `/update-site` for `css/style.css`.
3. Upload images with `/upload-asset`.
4. Call `/commit-changes` with "Initial blog setup".
5. Site deploys automatically.

### Advanced Workflow: AI-Generated Portfolio
1. Generate content with your model (e.g., project descriptions).
2. Use `/run-python` to process data or generate SVGs.
3. Update multiple files with `/update-site`.
4. Upload assets dynamically.
5. Commit via `/commit-changes`.
6. Monitor with `/logs` if issues arise.

### Complex Workflow: E-Commerce Site
1. Create product pages in a loop using `/update-site`.
2. Run Python for inventory calculations.
3. Handle payments via external APIs in Python.
4. Batch commit with `/commit-changes`.
5. Trigger builds for optimization.
6. Backup regularly with `/backup-site`.

Remember, AI agents: Be creative! Combine endpoints for seamless site building. If something fails, retry or log it. Happy coding! 🤖
