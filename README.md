# Revo Dashboard Final

Full-stack Revo dashboard starter with:
- Discord OAuth2 login
- Bot presence/guild discovery
- MongoDB persistence per `guildId`
- Secure server-side secrets through `.env`
- Premium gating
- Server settings APIs
- Command registration toggles
- Dashboard SPA UI
- Modular structure for expanding every Revo system

## Run
1. Install Node.js 20+.
2. Copy `.env.example` to `.env`.
3. Fill the private values.
4. Run `npm install`.
5. Run `npm start`.
6. Open `http://localhost:3000`.

## Discord OAuth2
Add the exact callback from `DISCORD_REDIRECT_URI` to the Discord Developer Portal OAuth2 Redirects.

## Production
Use HTTPS and a real public callback URL. Keep `.env` private. Do not put bot token, OAuth secret, or MongoDB credentials in frontend code.

## JS.ORG
A static custom domain can point at GitHub Pages, but this full version needs a server/backend for OAuth2, MongoDB, and bot control. JS.ORG alone cannot safely run the backend.
