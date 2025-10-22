# bermuda-import-calculator

## Runtime

This project runs on **Node.js 20**.

### Railway Deployment

When deploying to Railway, set the following environment variable:

```
NIXPACKS_NODE_VERSION=20
```

This ensures Railway uses Node 20 for building and running the application.

### Local Development

Ensure you have Node.js 20 installed:

```bash
node --version  # Should output v20.x.x
```

Install dependencies and run:

```bash
npm install
npm start
```