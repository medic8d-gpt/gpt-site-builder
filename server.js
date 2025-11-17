const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PUBLIC_DIR = path.join(__dirname, "public");

// Ensure /public exists
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}

/* ================================
   1. UPDATE / CREATE FILE
================================ */
app.post("/update-site", (req, res) => {
  const { filename, content } = req.body;

  if (!filename || !content) {
    return res.status(400).json({ error: "Missing filename or content." });
  }

  const filePath = path.join(PUBLIC_DIR, filename);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  fs.writeFile(filePath, content, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, file: filename });
  });
});


/* ================================
   2. LIST FILES
================================ */
app.get("/list-files", (req, res) => {
  const walk = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);

    list.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        results = results.concat(walk(filePath));
      } else {
        results.push(path.relative(PUBLIC_DIR, filePath));
      }
    });

    return results;
  };

  try {
    res.json({ files: walk(PUBLIC_DIR) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


/* ================================
   3. READ FILE
================================ */
app.post("/read-file", (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res.status(400).json({ error: "Missing filename." });
  }

  const filePath = path.join(PUBLIC_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found." });
  }

  const content = fs.readFileSync(filePath, "utf8");
  res.json({ filename, content });
});


/* ================================
   4. DELETE FILE
================================ */
app.post("/delete-file", (req, res) => {
  const { filename } = req.body;

  if (!filename) {
    return res.status(400).json({ error: "Missing filename." });
  }

  const filePath = path.join(PUBLIC_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found." });
  }

  fs.unlinkSync(filePath);
  res.json({ success: true, deleted: filename });
});


/* ================================
   5. UPLOAD ASSET (BINARY BASE64)
================================ */
app.post("/upload-asset", (req, res) => {
  const { filename, base64 } = req.body;

  if (!filename || !base64) {
    return res.status(400).json({ error: "Missing filename or base64 data." });
  }

  const filePath = path.join(PUBLIC_DIR, filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const buffer = Buffer.from(base64, "base64");

  fs.writeFile(filePath, buffer, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, file: filename });
  });
});


/* ================================
   6. TRIGGER BUILD (optional)
================================ */
app.post("/trigger-build", (req, res) => {
  exec("npm run build", (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }

    res.json({ success: true, output: stdout });
  });
});


// START SERVER
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
