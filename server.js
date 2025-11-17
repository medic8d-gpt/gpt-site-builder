// -----------------------------------------------------
// Moonshit Architect — Full AI DevOps Backend
// -----------------------------------------------------

const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const archiver = require("archiver");
const simpleGit = require("simple-git");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

// Git Setup --------------------------------------------------

const git = simpleGit({
  baseDir: __dirname,
  binary: "git",
  maxConcurrentProcesses: 1,
});

const GITHUB_USER = process.env.GH_USER;
const GITHUB_EMAIL = process.env.GH_EMAIL;
const GITHUB_TOKEN = process.env.GH_TOKEN;
const GITHUB_REPO = process.env.GH_REPO; // e.g. "username/repo"
const PUBLIC_DIR = path.join(__dirname, "public");
const PYTHON_DIR = path.join(__dirname, "python_sandbox");

// Middleware --------------------------------------------------

app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Ensure directories exist
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(PYTHON_DIR)) fs.mkdirSync(PYTHON_DIR, { recursive: true });

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
    const filePath = path.join(__dirname, filename);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);

    await git.add(filePath);
    await git.commit(commit_message);
    await git.push("origin", "main");

    res.json({ success: true, committed: filename });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 9. commit-multiple
// ------------------------------------------------------------

app.post("/commit-multiple", async (req, res) => {
  const { files, commit_message } = req.body;

  if (!files || !commit_message)
    return res.status(400).json({ error: "Missing fields." });

  try {
    for (let f of files) {
      const filePath = path.join(__dirname, f.filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, f.content);
      await git.add(filePath);
    }
    await git.commit(commit_message);
    await git.push("origin", "main");

    res.json({ success: true, committed: files.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 10. list-commits
// ------------------------------------------------------------

app.get("/list-commits", async (req, res) => {
  try {
    const logs = await git.log({ maxCount: 50 });
    res.json({ success: true, commits: logs.all });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 11. restore-commit
// ------------------------------------------------------------

app.post("/restore-commit", async (req, res) => {
  const { commit_hash, filename } = req.body;

  if (!commit_hash || !filename)
    return res.status(400).json({ error: "Missing fields." });

  try {
    await git.checkout(commit_hash, [filename]);
    await git.add(filename);
    await git.commit(`Restore ${filename} from ${commit_hash}`);
    await git.push("origin", "main");

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ------------------------------------------------------------
// 12. backup-site
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
// 13. logs
// ------------------------------------------------------------

app.get("/logs", (req, res) => {
  exec("heroku logs --num 200 --app $HEROKU_APP", (err, stdout, stderr) => {
    res.json({
      success: !err,
      stdout: stdout || "",
      stderr: stderr || "",
    });
  });
});

// ------------------------------------------------------------
// START SERVER
// ------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`Moonshit Architect server running on port ${PORT}`);
});
