// -----------------------------------------------------
// Moonshit Architect — Full AI DevOps Backend
// -----------------------------------------------------

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const archiver = require("archiver");
const os = require("os");
const { Octokit } = require("@octokit/rest");

// ---- FIX: Load env vars BEFORE anything uses them ----
const GITHUB_USER = process.env.GITHUB_USER;
const GITHUB_EMAIL = process.env.GITHUB_EMAIL;
const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "username/repo"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const HEROKU_APP = process.env.HEROKU_APP;
const HEROKU_API_KEY = process.env.HEROKU_API_KEY;

// Directory constants
const PUBLIC_DIR = path.join(__dirname, "public");
const PYTHON_DIR = path.join(__dirname, "python_sandbox");
const LOGS_DIR = path.join(__dirname, "logs");

// Track changed files for batch commits
const changedFiles = new Set();

// GitHub API client
const octokit = new Octokit({ auth: GITHUB_TOKEN });

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
  const [owner, repo] = GITHUB_REPO.split('/');
  // Get latest commit SHA
  const { data: ref } = await octokit.git.getRef({ owner, repo, ref: 'heads/main' });
  const latestCommitSha = ref.object.sha;
  // Get commit and tree
  const { data: commit } = await octokit.git.getCommit({ owner, repo, sha: latestCommitSha });
  const baseTreeSha = commit.tree.sha;
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
  const { data: newTree } = await octokit.git.createTree({ owner, repo, base_tree: baseTreeSha, tree });
  // Create commit
  const { data: newCommit } = await octokit.git.createCommit({ owner, repo, message: commitMessage, tree: newTree.sha, parents: [latestCommitSha] });
  // Update ref
  await octokit.git.updateRef({ owner, repo, ref: 'heads/main', sha: newCommit.sha });
  // Log
  const logEntry = `${new Date().toISOString()} - Committed changes: ${commitMessage} - Files: ${Array.from(changedFiles).join(', ')}\n`;
  fs.appendFileSync(path.join(LOGS_DIR, 'commits.log'), logEntry);
  changedFiles.clear();
}

// ------------------------------------------------------------
// 1. update-site  (Create/overwrite text files)
// ------------------------------------------------------------

app.post("/update-site", (req, res) => {
  const { filename, content } = req.body;

  if (!filename || !content)
    return res.status(400).json({ error: "Missing filename or content." });

  const filePath = path.join(PUBLIC_DIR, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);

  changedFiles.add(filename);

  res.json({ success: true, file: filename });
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
    const [owner, repo] = GITHUB_REPO.split('/');
    const filePath = path.join(__dirname, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: filename,
      message: commit_message,
      content: Buffer.from(content).toString('base64'),
    });

    const logEntry = `${new Date().toISOString()} - Committed file: ${filename} - ${commit_message}\n`;
    fs.appendFileSync(path.join(LOGS_DIR, 'commits.log'), logEntry);

    res.json({ success: true, committed: filename });
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
    const [owner, repo] = GITHUB_REPO.split('/');
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
