# WhatsApp Pairing Server

A WhatsApp pairing code generator using Baileys + Express.js

## API Usage

```
GET /pair?number=923001234567
```

### Response
```json
{
  "error": false,
  "code": "ABCD-1234",
  "number": "923001234567",
  "message": "Pairing code generated successfully"
}
```

## Deploy on Render

1. Push this code to GitHub
2. Go to render.com → New → Web Service
3. Connect your GitHub repo
4. Set:
   - Build Command: `npm install`
   - Start Command: `node index.js`
5. Deploy!

## Local Run

```bash
npm install
node index.js
```

Visit: http://localhost:3000
