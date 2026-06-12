const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers
} = require('@whiskeysockets/baileys')
const express = require('express')
const pino = require('pino')
const path = require('path')
const fs = require('fs')

const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// ─── Active sessions store ───────────────────────────────────────────────────
const sessions = {}

// ─── Helper: clean phone number ──────────────────────────────────────────────
function cleanNumber(number) {
  return number.replace(/[^0-9]/g, '')
}

// ─── Helper: delete session folder ───────────────────────────────────────────
function deleteSession(sessionId) {
  const dir = path.join(__dirname, 'sessions', sessionId)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  delete sessions[sessionId]
}

// ─── MAIN PAIRING ROUTE ───────────────────────────────────────────────────────
// GET /pair?number=923001234567
app.get('/pair', async (req, res) => {
  const rawNumber = req.query.number
  if (!rawNumber) {
    return res.json({ error: true, message: 'Number parameter required. Use: /pair?number=923001234567' })
  }

  const number = cleanNumber(rawNumber)
  if (number.length < 10) {
    return res.json({ error: true, message: 'Invalid phone number. Include country code (e.g. 923001234567)' })
  }

  // If session already active for this number, destroy it and start fresh
  if (sessions[number]) {
    try { sessions[number].sock?.end() } catch (_) {}
    deleteSession(number)
  }

  const sessionDir = path.join(__dirname, 'sessions', number)
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })

  try {
    const { version } = await fetchLatestBaileysVersion()
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir)

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
      },
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Chrome'),
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    })

    sessions[number] = { sock, pairingCode: null, connected: false }

    sock.ev.on('creds.update', saveCreds)

    // ── Request pairing code once connecting ──────────────────────────────
    let codeSent = false
    const pairingCodePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout: Could not generate pairing code')), 30000)

      sock.ev.on('connection.update', async (update) => {
        const { connection, qr, lastDisconnect } = update

        if ((connection === 'connecting' || qr) && !codeSent) {
          codeSent = true
          try {
            const code = await sock.requestPairingCode(number)
            sessions[number].pairingCode = code
            clearTimeout(timeout)
            resolve(code)
          } catch (err) {
            clearTimeout(timeout)
            reject(err)
          }
        }

        if (connection === 'open') {
          sessions[number].connected = true
          console.log(`✅ ${number} connected successfully`)
        }

        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.statusCode
          if (reason === DisconnectReason.loggedOut) {
            deleteSession(number)
          }
        }
      })
    })

    const code = await pairingCodePromise

    // Format code as XXXX-XXXX
    const formatted = code.match(/.{1,4}/g)?.join('-') || code

    return res.json({
      error: false,
      message: 'Pairing code generated successfully',
      number: number,
      code: formatted,
      instructions: [
        'Open WhatsApp on your phone',
        'Go to Settings → Linked Devices',
        'Tap "Link a Device"',
        'Tap "Link with phone number instead"',
        `Enter the code: ${formatted}`
      ]
    })

  } catch (err) {
    console.error('Pairing error:', err.message)
    deleteSession(number)
    return res.json({
      error: true,
      message: err.message || 'Failed to generate pairing code. Try again.'
    })
  }
})

// ─── STATUS ROUTE ─────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  const number = cleanNumber(req.query.number || '')
  if (!number) return res.json({ error: true, message: 'Number required' })

  const session = sessions[number]
  if (!session) return res.json({ connected: false, message: 'No active session' })

  return res.json({
    connected: session.connected,
    code: session.pairingCode,
    message: session.connected ? 'Device linked successfully!' : 'Waiting for pairing...'
  })
})

// ─── HOME ROUTE ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Pairing Server running on port ${PORT}`)
  console.log(`📱 Pair API: http://localhost:${PORT}/pair?number=923001234567`)
})
