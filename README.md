# GPT Site Builder

```
   ____ ____ _____ ___ _   _ _____ ____  ____
  / ___|  _ \_   _|_ _| \ | | ____|  _ \/ ___|
 | |  _| |_) || |  | ||  \| |  _| | |_) \___ \
 | |_| |  __/ | |  | || |\  | |___|  _ < ___) |
  \____|_|    |_| |___|_| \_|_____|_| \_\____/
```

Welcome to the future of web development—where AI takes the wheel. This repo powers a backend API that lets custom GPTs, AI agents, and other intelligent systems autonomously build, tweak, and deploy websites. No more manual coding; just prompts, actions, and APIs doing the heavy lifting.

## What's This All About?

Imagine telling your AI: "Build me a portfolio site with a contact form and some cool animations." With this setup, the AI can:

- **Craft Content**: Generate HTML, CSS, JS, and more via file creation APIs.
- **Handle Assets**: Upload images, videos, or any files seamlessly.
- **Run Code**: Execute Python scripts in a sandbox for dynamic features like data processing or API integrations.
- **Version Control**: Commit changes to GitHub, manage history, and restore if needed.
- **Deploy & Monitor**: Trigger builds, download backups, and check logs—all through simple API calls.

It's built for AI agents that use action APIs (like OpenAI's GPT Actions) to interact with the world. Your custom GPT can be the architect, and this is its toolbox.

## Key Features

- **File Ops**: Update, read, delete files in the public directory.
- **Asset Management**: Base64 uploads for media and binaries.
- **Python Execution**: Safe sandbox for running scripts.
- **Git Magic**: Commit, push, and manage repos directly.
- **Backup & Logs**: Download ZIPs of your site or pull Heroku logs.
- **RESTful API**: Clean endpoints for easy integration with AI prompts.

## Quick Start

1. **Clone & Deploy**: Push to GitHub, connect to Heroku for hosting.
2. **Set Env Vars**: Configure `GH_USER`, `GH_EMAIL`, `GH_TOKEN`, `GH_REPO` on Heroku.
3. **Enable Auto-Deploy**: Let Heroku redeploy on every Git push.
4. **Prompt Your AI**: Use endpoints like `/update-site` and `/commit-changes` in your GPT's actions.

## API Overview

Check `openapi.json` for the full spec. Highlights:

- `POST /update-site`: Write text files.
- `POST /upload-asset`: Upload binaries.
- `POST /run-python`: Execute Python code.
- `POST /commit-changes`: Save everything to Git.

## Why This Matters

In the age of AI, tools like this bridge the gap between ideas and reality. Custom GPTs can now "act" on the web—creating sites, managing content, even running experiments. It's not just code; it's AI-driven DevOps.

Got ideas? Fork, tweak, and let your AI loose. The repo's open for collaboration—because the best builds come from smart machines and smarter humans.

---

*Built with Node.js, Express, and a dash of moonshot thinking.*
