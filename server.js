// server.js (EN RENDER)
import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// --- CONFIGURACIÓN CORS PERMISIVA ---
app.use(cors({
  origin: true, // Refleja el origen de la petición (permite cualquiera)
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true, // Permite cookies/headers autorizados
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Preflight global explícito
app.options('*', cors());

app.use(express.json());

// Credenciales
const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

let globalVoiceStates = {};

app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;
  if (!roomName || !participantName) return res.status(400).json({ error: 'Faltan datos' });

  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, { identity: participantName });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

  const token = await at.toJwt();
  res.json({ token, wsUrl: LK_URL });
});

app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  res.json({ success: true });
});

app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  try {
    const strData = JSON.stringify({
      type: 'minecraft-update',
      data: mcBody.data,
      config: mcBody.config
    });
    const encoder = new TextEncoder();
    const payload = encoder.encode(strData);

    await roomService.sendData('minecraft-global', payload, DataPacket_Kind.RELIABLE);
  } catch (error) {
    if (error.status !== 404 && error.code !== 'not_found') {
       console.error("Error enviando a LiveKit:", error);
    }
  }

  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));
  
  res.json({ success: true, voiceStates: voiceStatesArray });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Server corriendo en puerto ${PORT}`);
});
