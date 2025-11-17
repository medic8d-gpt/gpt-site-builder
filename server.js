// -----------------------------------------------------
// Moonshit Architect — Full AI DevOps Backend
// -----------------------------------------------------

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const archiver = require("archiver");
const os = require("os");

// ---- FIX: Load env vars BEFORE anything uses them ----
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_EMAIL = process.env.GITHUB_EMAIL;
const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "username/repo"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const HEROKU_APP = process.env.HEROKU_APP;
const HEROKU_API_KEY = process.env.HEROKU_API_KEY;

if (!GITHUB_REPO || !GITHUB_TOKEN) {
  console.error("Missing GITHUB_REPO or GITHUB_TOKEN at startup.");
} else {
  console.log(`Loaded GITHUB_REPO: ${GITHUB_REPO}`);
}

// Directory constants
const PUBLIC_DIR = path.join(__dirname, "public");
const PYTHON_DIR = path.join(__dirname, "python_sandbox");
const LOGS_DIR = path.join(__dirname, "logs");

// Track changed files for batch commits
const changedFiles = new Set();

// Metrics
let requestCount = 0;
let commitCount = 0;
let startTime = Date.now();

const { Octokit } = require("@octokit/rest");
// GitHub API client
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

const app = express();
const PORT = process.env.PORT || 3000;

// Skip local git setup — Octokit handles commits directly
console.log("Skipping simple-git setup (no git binary in environment)");

// Middleware --------------------------------------------------

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Ensure directories exist
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(PYTHON_DIR)) fs.mkdirSync(PYTHON_DIR, { recursive: true });
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// Function to commit all changes via GitHub API
async function commitAllChanges(commitMessage) {
  const [owner, repo] = process.env.GITHUB_REPO.split('/');
  let latestCommitSha = null;
  let baseTreeSha = null;

  try {
    // Try to get the latest commit
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    latestCommitSha = ref.object.sha;
    const { data: commit } = await octokit.git.getCommit({ owner, repo, sha: latestCommitSha });
    baseTreeSha = commit.tree.sha;
  } catch (err) {
    if (err.status !== 404) throw err;
    // Repo is empty, no ref yet
    console.log('Repo appears empty, creating initial commit');
  }

  // Create tree entries for changed files
  const tree = [];
  for (const filename of changedFiles) {
    const filePath = path.join(PUBLIC_DIR, filename);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      const { data: blob } = await octokit.git.createBlob({ owner, repo, content, encoding: 'utf-8' });
      tree.push({ path: filename, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  if (tree.length === 0) {
    throw new Error('No changes to commit');
  }

  // Create new tree
  const treeOptions = baseTreeSha ? { owner, repo, base_tree: baseTreeSha, tree } : { owner, repo, tree };
  const { data: newTree } = await octokit.git.createTree(treeOptions);

  // Create commit
  const commitOptions = {
    owner,
    repo,
    message: commitMessage,
    tree: newTree.sha,
    parents: latestCommitSha ? [latestCommitSha] : []
  };
  const { data: newCommit } = await octokit.git.createCommit(commitOptions);

  // Update or create ref
  try {
    await octokit.git.updateRef({ owner, repo, ref: 'heads/main', sha: newCommit.sha });
  } catch (err) {
    if (err.status === 422) {
      // Ref doesn't exist, create it
      await octokit.git.createRef({ owner, repo, ref: 'refs/heads/main', sha: newCommit.sha });
    } else {
      throw err;
    }
  }

  // Log
  const logEntry = `${new Date().toISOString()} - Committed changes: ${commitMessage} - Files: ${Array.from(changedFiles).join(', ')}\n`;
  fs.appendFileSync(path.join(LOGS_DIR, 'commits.log'), logEntry);
  changedFiles.clear();
}

// Middleware for metrics
app.use((req, res, next) => {
  requestCount++;
  next();
});

// ------------------------------------------------------------
// 1. /file - Create/Update/Read/Delete files
// ------------------------------------------------------------

app.route('/file')
  .post((req, res) => {
    const { filename, content, base64 = false } = req.body;
    if (!filename) return res.status(400).json({ error: "Missing filename." });

    const filePath = path.join(PUBLIC_DIR, filename);
    if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
      return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (base64) {
      const buffer = Buffer.from(content, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      fs.writeFileSync(filePath, content);
    }
    changedFiles.add(filename);
    res.json({ success: true, file: filename });
  })
  .get((req, res) => {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: "Missing filename." });

    const filePath = path.join(PUBLIC_DIR, filename);
    if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
      return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
    }

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
    const content = fs.readFileSync(filePath, 'utf8');
    res.json({ filename, content });
  })
  .delete((req, res) => {
    const filename = req.query.filename;
    if (!filename) return res.status(400).json({ error: "Missing filename." });

    const filePath = path.join(PUBLIC_DIR, filename);
    if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
      return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
    }

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });
    fs.unlinkSync(filePath);
    changedFiles.add(filename);
    res.json({ success: true, deleted: filename });
  });

// ------------------------------------------------------------
// 2. /files - List files in /public
// ------------------------------------------------------------

app.get('/files', (req, res) => {
  const filter = req.query.filter;
  const dir = req.query.dir;

  function walk(dirPath, relPath = '') {
    let results = [];
    if (!fs.existsSync(dirPath)) return results;
    const list = fs.readdirSync(dirPath);
    for (let file of list) {
      const full = path.join(dirPath, file);
      const rel = path.join(relPath, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        results = results.concat(walk(full, rel));
      } else {
        if (!filter || rel.endsWith(filter)) {
          results.push(rel);
        }
      }
    }
    return results;
  }

  let startDir = PUBLIC_DIR;
  if (dir) {
    startDir = path.join(PUBLIC_DIR, dir);
    if (!path.resolve(startDir).startsWith(path.resolve(PUBLIC_DIR))) {
      return res.status(400).json({ error: "Invalid dir." });
    }
  }
  const files = walk(startDir);
  res.json({ files });
});

// ------------------------------------------------------------
// 3. /commit - Commit changes to GitHub
// ------------------------------------------------------------

app.post('/commit', async (req, res) => {
  const { commit_message, dry_run = false } = req.body;
  if (!commit_message) return res.status(400).json({ error: "Missing commit_message." });

  if (dry_run) {
    return res.json({ success: true, changes: Array.from(changedFiles) });
  }

  try {
    await commitAllChanges(commit_message);
    commitCount++;
    res.json({ success: true, message: "Changes committed and pushed." });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 4. /build - Run build command (npm run build)
// ------------------------------------------------------------

app.post('/build', (req, res) => {
  exec('npm run build', { cwd: __dirname }, (err, stdout, stderr) => {
    res.json({
      success: !err,
      stdout: stdout || "",
      stderr: stderr || ""
    });
  });
});

// ------------------------------------------------------------
// 5. /run-python - Execute Python
// ------------------------------------------------------------

app.post('/run-python', (req, res) => {
  const { filename, code, timeout = 30 } = req.body;
  if (!filename || !code) return res.status(400).json({ error: "Missing filename or code." });

  const safeName = filename.endsWith('.py') ? filename : filename + '.py';
  const filePath = path.join(PYTHON_DIR, safeName);
  if (!path.resolve(filePath).startsWith(path.resolve(PYTHON_DIR))) {
    return res.status(400).json({ error: "Invalid filename." });
  }

  fs.writeFileSync(filePath, code);
  const cmd = `timeout ${timeout}s python3 -I -B -E -s "${filePath}"`;

  exec(cmd, { cwd: PYTHON_DIR }, (err, stdout, stderr) => {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({
      success: !err,
      filename: safeName,
      stdout: stdout || "",
      stderr: stderr || ""
    });
  });
});

// ------------------------------------------------------------
// 6. /logs - Fetch logs
// ------------------------------------------------------------

app.get('/logs', async (req, res) => {
  const lines = parseInt(req.query.lines) || 100;
  const type = req.query.type || 'commits';
  const search = req.query.search;

  if (type === 'commits') {
    const logPath = path.join(LOGS_DIR, 'commits.log');
    if (!fs.existsSync(logPath)) return res.json({ logs: [] });
    let logs = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l).reverse().slice(0, lines);
    if (search) logs = logs.filter(l => l.includes(search));
    res.json({ logs });
  } else if (type === 'system') {
    try {
      const sessionResponse = await fetch(`https://api.heroku.com/apps/${process.env.HEROKU_APP}/log-sessions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.HEROKU_API_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.heroku+json; version=3'
        },
        body: JSON.stringify({ lines })
      });
      if (!sessionResponse.ok) throw new Error(`API error: ${sessionResponse.status}`);
      const session = await sessionResponse.json();
      const logsResponse = await fetch(session.logplex_url);
      let logs = await logsResponse.text();
      logs = logs.split('\n').filter(l => l).reverse().slice(0, lines);
      if (search) logs = logs.filter(l => l.includes(search));
      res.json({ logs });
    } catch (err) {
      res.json({ error: err.message });
    }
  } else {
    res.status(400).json({ error: "Invalid type." });
  }
});

// ------------------------------------------------------------
// 7. /backup - Download backup
// ------------------------------------------------------------

app.get('/backup', (req, res) => {
  const zipPath = path.join(os.tmpdir(), "backup.zip");
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip");

  archive.pipe(output);
  archive.directory(PUBLIC_DIR, "public");
  archive.directory(PYTHON_DIR, "python_sandbox");

  const manifest = { fileCount: 0, totalSize: 0, timestamp: new Date().toISOString() };
  function countFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const list = fs.readdirSync(dir);
    for (let file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) countFiles(full);
      else { manifest.fileCount++; manifest.totalSize += stat.size; }
    }
  }
  countFiles(PUBLIC_DIR);
  countFiles(PYTHON_DIR);
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

  archive.finalize();
  output.on("close", () => {
    res.download(zipPath, "backup.zip");
  });
});

// ------------------------------------------------------------
// 8. /env - Manage environment variables
// ------------------------------------------------------------

app.route('/env')
  .get((req, res) => {
    const env = Object.keys(process.env).filter(k => !k.toLowerCase().includes('secret') && !k.toLowerCase().includes('key')).map(k => ({
      key: k,
      value: k.toLowerCase().includes('token') ? '***' : process.env[k]
    }));
    res.json({ env });
  })
  .post((req, res) => {
    for (const [key, value] of Object.entries(req.body)) {
      process.env[key] = value;
    }
    res.json({ success: true, message: "Env vars updated in memory." });
  });

// ------------------------------------------------------------
// 9. /status - System status
// ------------------------------------------------------------

app.get('/status', (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const uptimeStr = `${hours}h ${minutes}m`;
  res.json({
    uptime: uptimeStr,
    node_version: process.version,
    git_connected: !!process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPO
  });
});

// ------------------------------------------------------------
// 10. /diff - Compare local vs GitHub
// ------------------------------------------------------------

app.get('/diff', async (req, res) => {
  try {
    const [owner, repo] = process.env.GITHUB_REPO.split('/');
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
    const { data: commit } = await octokit.git.getCommit({ owner, repo, sha: ref.object.sha });
    const { data: tree } = await octokit.git.getTree({ owner, repo, tree_sha: commit.tree.sha, recursive: true });

    const githubFiles = new Set(tree.tree.filter(item => item.type === 'blob' && item.path.startsWith('public/')).map(item => item.path.slice(7)));
    const localFiles = new Set();

    function walk(dir, rel = '') {
      if (!fs.existsSync(dir)) return;
      const list = fs.readdirSync(dir);
      for (let file of list) {
        const full = path.join(dir, file);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walk(full, path.join(rel, file));
        else localFiles.add(path.join(rel, file));
      }
    }
    walk(PUBLIC_DIR);

    const added = [...localFiles].filter(f => !githubFiles.has(f));
    const deleted = [...githubFiles].filter(f => !localFiles.has(f));
    const modified = [...changedFiles];
    res.json({ added, deleted, modified });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 11. /exec - Run safe shell commands
// ------------------------------------------------------------

const safeCommands = ['ls', 'pwd', 'df -h', 'free -h', 'uptime', 'whoami', 'date'];
app.post('/exec', (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "Missing command." });

  const cmd = command.split(' ')[0];
  if (!safeCommands.includes(cmd)) return res.status(400).json({ error: "Command not allowed." });

  exec(command, (err, stdout, stderr) => {
    res.json({
      success: !err,
      stdout: stdout || "",
      stderr: stderr || ""
    });
  });
});

// ------------------------------------------------------------
// 12. /health - Readiness probe
// ------------------------------------------------------------

app.get('/health', async (req, res) => {
  try {
    const [owner, repo] = process.env.GITHUB_REPO.split('/');
    await octokit.repos.get({ owner, repo });
    res.json({ status: 'healthy', git_connected: true });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ------------------------------------------------------------
// 13. /repo - Repo info and sync
// ------------------------------------------------------------

app.route('/repo')
  .get(async (req, res) => {
    try {
      const [owner, repo] = process.env.GITHUB_REPO.split('/');
      const { data: commits } = await octokit.repos.listCommits({ owner, repo, per_page: 1 });
      res.json({ latest_commit: commits[0] });
    } catch (err) {
      res.json({ error: err.message });
    }
  })
  .post(async (req, res) => {
    try {
      const [owner, repo] = process.env.GITHUB_REPO.split('/');
      const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
      const { data: commit } = await octokit.git.getCommit({ owner, repo, sha: ref.object.sha });
      const { data: tree } = await octokit.git.getTree({ owner, repo, tree_sha: commit.tree.sha, recursive: true });

      for (const item of tree.tree) {
        if (item.type === 'blob' && item.path.startsWith('public/')) {
          const localPath = path.join(__dirname, item.path);
          if (!path.resolve(localPath).startsWith(path.resolve(PUBLIC_DIR))) continue;
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          const { data: blob } = await octokit.git.getBlob({ owner, repo, file_sha: item.sha });
          fs.writeFileSync(localPath, Buffer.from(blob.content, 'base64'));
        }
      }
      res.json({ success: true, message: "Synced from GitHub." });
    } catch (err) {
      res.json({ success: false, error: err.message });
    }
  });

// ------------------------------------------------------------
// 14. /metrics - System metrics
// ------------------------------------------------------------

app.get('/metrics', (req, res) => {
  const uptime = process.uptime();
  res.json({
    uptime_seconds: uptime,
    requests_served: requestCount,
    commits_made: commitCount,
    node_version: process.version,
    repo: process.env.GITHUB_REPO
  });
});

// ------------------------------------------------------------
// 2. list-files
// ------------------------------------------------------------

app.get("/list-files", (req, res) => {
  function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    for (let file of list) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) results = results.concat(walk(full));
      else results.push(path.relative(PUBLIC_DIR, full));
    }
    return results;
  }
  res.json({ files: walk(PUBLIC_DIR) });
});

// ------------------------------------------------------------
// 3. read-file
// ------------------------------------------------------------

app.post("/read-file", (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "Missing filename." });

  const filePath = path.join(PUBLIC_DIR, filename);
  // Security check: ensure filePath is within PUBLIC_DIR
  if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
    return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
  }

  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File not found." });

  const content = fs.readFileSync(filePath, "utf8");
  res.json({ filename, content });
});

// ------------------------------------------------------------
// 4. delete-file
// ------------------------------------------------------------

app.post("/delete-file", (req, res) => {
  const { filename } = req.body;
  if (!filename) return res.status(400).json({ error: "Missing filename." });

  const filePath = path.join(PUBLIC_DIR, filename);
  // Security check: ensure filePath is within PUBLIC_DIR
  if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
    return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
  }

  if (!fs.existsSync(filePath))
    return res.status(404).json({ error: "File not found." });

  fs.unlinkSync(filePath);
  res.json({ success: true, deleted: filename });

  changedFiles.add(filename);
});

// ------------------------------------------------------------
// 5. upload-asset  (base64 upload)
// ------------------------------------------------------------

app.post("/upload-asset", (req, res) => {
  const { filename, base64 } = req.body;

  if (!filename || !base64)
    return res.status(400).json({ error: "Missing filename or base64." });

  const filePath = path.join(PUBLIC_DIR, filename);
  // Security check: ensure filePath is within PUBLIC_DIR
  if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
    return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const buffer = Buffer.from(base64, "base64");
  fs.writeFileSync(filePath, buffer);

  changedFiles.add(filename);

  res.json({ success: true, file: filename });
});

// ------------------------------------------------------------
// 6. trigger-build
// ------------------------------------------------------------

app.post("/trigger-build", (req, res) => {
  exec("npm run build", (err, stdout, stderr) => {
    if (err) return res.json({ success: false, error: stderr || err.message });
    res.json({ success: true, output: stdout });
  });
});

// ------------------------------------------------------------
// 7. run-python  (sandboxed Python execution)
// ------------------------------------------------------------

app.post("/run-python", (req, res) => {
  const { filename, code } = req.body;
  if (!filename || !code)
    return res.status(400).json({ error: "Missing filename or code." });

  const safeName = filename.endsWith(".py") ? filename : filename + ".py";
  const filePath = path.join(PYTHON_DIR, safeName);
  // Security check: ensure filePath is within PYTHON_DIR
  if (!path.resolve(filePath).startsWith(path.resolve(PYTHON_DIR))) {
    return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
  }

  fs.writeFileSync(filePath, code);

  const cmd = `python3 -I -B -E -s "${filePath}"`;

  exec(cmd, { cwd: PYTHON_DIR }, (err, stdout, stderr) => {
    res.json({
      success: !err,
      filename: safeName,
      stdout: stdout || "",
      stderr: stderr || "",
    });
  });
});

// ------------------------------------------------------------
// 8. commit-file  (single file commit to GitHub)
// ------------------------------------------------------------

app.post("/commit-file", async (req, res) => {
  const { filename, content, commit_message } = req.body;

  if (!filename || !content || !commit_message)
    return res.status(400).json({ error: "Missing fields." });

  try {
    const [owner, repo] = process.env.GITHUB_REPO.split('/');
    const filePath = path.join(PUBLIC_DIR, filename);
    // Security check: ensure filePath is within PUBLIC_DIR
    if (!path.resolve(filePath).startsWith(path.resolve(PUBLIC_DIR))) {
      return res.status(400).json({ error: "Invalid filename: path traversal not allowed." });
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "public/" + filename,
      message: commit_message,
      content: Buffer.from(content).toString('base64'),
    });

    const logEntry = `${new Date().toISOString()} - Committed file: public/${filename} - ${commit_message}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, 'commits.log'), logEntry);

    res.json({ success: true, committed: "public/" + filename });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 9. commit-multiple
// ------------------------------------------------------------

app.post("/commit-multiple", async (req, res) => {
  res.json({ success: false, error: "Git not available in this environment. Use /commit-file or /commit-changes instead." });
});

// ------------------------------------------------------------
// 10. commit-changes  (Commit all current changes to GitHub)
// ------------------------------------------------------------

app.post("/commit-changes", async (req, res) => {
  const { commit_message } = req.body;

  if (!commit_message)
    return res.status(400).json({ error: "Missing commit_message." });

  try {
    await commitAllChanges(commit_message);
    res.json({ success: true, message: "Changes committed and pushed." });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 11. list-commits
// ------------------------------------------------------------

app.get("/list-commits", async (req, res) => {
  try {
    const [owner, repo] = process.env.GITHUB_REPO.split('/');
    const { data: commits } = await octokit.repos.listCommits({ owner, repo, per_page: 50 });
    res.json({ success: true, commits });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 12. restore-commit
// ------------------------------------------------------------

app.post("/restore-commit", async (req, res) => {
  res.json({ success: false, error: "Git not available in this environment. Use GitHub API directly for restores." });
});

// ------------------------------------------------------------
// 13. backup-site
// ------------------------------------------------------------

// ------------------------------------------------------------
// 13. backup-site
// ------------------------------------------------------------

app.get("/backup-site", (req, res) => {
  const zipPath = path.join(os.tmpdir(), "backup.zip");
  const output = fs.createWriteStream(zipPath);
  const archive = archiver("zip");

  archive.pipe(output);
  archive.directory(PUBLIC_DIR, "public");
  archive.directory(PYTHON_DIR, "python_sandbox");
  archive.finalize();

  output.on("close", () => {
    res.download(zipPath, "backup.zip");
  });
});

// ------------------------------------------------------------
// 14. logs
// ------------------------------------------------------------

app.get("/logs", async (req, res) => {
  try {
    // Create a log session
    const sessionResponse = await fetch(`https://api.heroku.com/apps/${process.env.HEROKU_APP}/log-sessions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HEROKU_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.heroku+json; version=3'
      },
      body: JSON.stringify({ lines: 200 })
    });

    if (!sessionResponse.ok) {
      throw new Error(`Heroku API error: ${sessionResponse.status}`);
    }

    const session = await sessionResponse.json();

    // Fetch the logs
    const logsResponse = await fetch(session.logplex_url);
    const logs = await logsResponse.text();

    res.json({
      success: true,
      stdout: logs,
      stderr: "",
    });
  } catch (err) {
    res.json({
      success: false,
      stdout: "",
      stderr: err.message,
    });
  }
});

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Moonshit Architect server running on port ${PORT}`);
});
