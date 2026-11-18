# davidsavage.xyz

The homepage of David Savage. Node + Express, deploys to Railway.

## Run it
```
npm install
ADMIN_PASSWORD=pick-something npm start
```
Open http://localhost:3000 for the site and http://localhost:3000/edit for the editor.

## Railway variables
| Variable | What it does |
|---|---|
| `ADMIN_PASSWORD` | Password for `/edit`. Required. |
| `SESSION_SECRET` | Optional. Any long random string. Signs your login cookie. |
| `DATABASE_URL` | Set automatically if you add Railway Postgres. Otherwise data saves to `DATA_DIR`. |
| `DATA_DIR` | Folder for the JSON data file. Point it at a Railway volume (e.g. `/data`). |
| `PUBLIC_URL` | Optional. Full site URL for link previews, e.g. `https://davidsavage.xyz`. |

## Files
- `server.js` — API, login, guestbook, DavidGPT questions
- `lib/store.js` — saves data to Postgres or a JSON file
- `lib/defaults.js` — starting content (everything is editable in `/edit`)
- `public/index.html`, `public/js/home.js`, `public/js/render.js`, `public/css/home.css` — the site
- `public/edit/index.html`, `public/js/edit.js`, `public/css/edit.css` — the editor
- `public/css/base.css` — shared glass styles + fonts
- `public/logo.svg`, `favicon.svg`, `og.png`, icons — branding
