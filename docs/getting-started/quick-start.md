# Quick Start

Get MatchZy Auto Tournament running in 5 minutes!

---

## Prerequisites

!!! requirements "What You Need"
    - **Node.js 18+** or Bun runtime
    - **CS2 dedicated server(s)** with MatchZy plugin installed
    - **10 minutes** for setup

---

## Installation

### Option 1: Docker (Recommended for Production)

```bash
# Clone the repository
git clone https://github.com/yourusername/matchzy-auto-tournament.git
cd matchzy-auto-tournament

# Copy and configure environment file
cp .env.example .env
nano .env  # Edit with your tokens

# Start with Docker Compose
docker-compose up -d --build
```

!!! success "Access Your Dashboard"
    Everything is now available at **`http://localhost:3069`**
    
    - 🎨 Web UI: `http://localhost:3069/`
    - 📖 API: `http://localhost:3069/api`
    - 📚 API Docs: `http://localhost:3069/api-docs`

### Option 2: Local Development

```bash
# Clone and install
git clone https://github.com/yourusername/matchzy-auto-tournament.git
cd matchzy-auto-tournament
npm install

# Configure environment
cp .env.example .env
nano .env  # Edit with your tokens

# Run in development mode
npm run dev
```

!!! info "Development URLs"
    - 📖 API: `http://localhost:3000`
    - 🎨 Frontend: `http://localhost:5173`
    - 📚 API Docs: `http://localhost:3000/api-docs`

---

## Configuration

### Generate Secure Tokens

```bash
# Generate random tokens for API_TOKEN and SERVER_TOKEN
openssl rand -hex 32
```

### Required Environment Variables

```bash title=".env"
# Admin authentication (for Web UI login)
API_TOKEN=your-secure-admin-token-here

# CS2 server authentication (for MatchZy webhooks)
SERVER_TOKEN=your-secure-server-token-here

# URL where CS2 servers can reach this API
WEBHOOK_URL=http://192.168.1.100:3000  # Use your server's IP
```

!!! warning "WEBHOOK_URL Configuration"
    - **Local testing:** `http://localhost:3000`
    - **Same network:** `http://192.168.1.100:3000` (your machine's local IP)
    - **Production:** `https://yourdomain.com`
    
    CS2 servers must be able to reach this URL to send events!

### Optional Variables

```bash
STEAM_API_KEY=your-key       # For Steam vanity URL resolution
PORT=3000                    # Server port (default: 3000)
NODE_ENV=production          # Environment mode
```

---

## First Login

1. **Navigate to:** `http://localhost:3069` (Docker) or `http://localhost:5173` (Dev)
2. **Click "Login"**
3. **Enter your API_TOKEN** from `.env`
4. **You're in!** 🎉

---

## Next Steps

Now that you're running, follow the **[First Tournament Guide](first-tournament.md)** to:

1. ✅ Add your CS2 servers
2. ✅ Create teams
3. ✅ Generate a bracket
4. ✅ Start your first tournament

---

## Troubleshooting

!!! failure "Can't access the dashboard?"
    - Check if the containers/processes are running
    - Verify port 3069 (Docker) or 5173 (dev) isn't blocked
    - Check Docker logs: `docker-compose logs -f`

!!! failure "Can't login?"
    - Verify `API_TOKEN` is set correctly in `.env`
    - Check browser console for errors (F12)
    - Try regenerating the token with `openssl rand -hex 32`

!!! failure "CS2 servers not connecting?"
    - Verify `WEBHOOK_URL` is reachable from CS2 servers
    - Check `SERVER_TOKEN` matches in both `.env` and MatchZy config
    - See [MatchZy Webhook Setup](../matchzy/webhook-setup.md)

---

**Ready to run your first tournament?** Continue to **[First Tournament →](first-tournament.md)**

