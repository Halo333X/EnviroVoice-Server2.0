// server.js (EN RENDER)
import express from 'express';
import cors from 'cors';
// IMPORTANTE: Añadimos DataPacket_Kind a los imports
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// --- CORRECCIÓN CORS EXTREMA ---
// Permitimos todo para desarrollo.
app.use(cors({
  origin: '*', // Permitir cualquier origen
  methods: ['GET', 'POST', 'OPTIONS'], // Permitir estos métodos
  allowedHeaders: ['Content-Type', 'Authorization'] // Permitir estos headers
}));

// ELIMINADO: La línea app.options('*', cors()) causaba el error de "Missing parameter name"
// El app.use de arriba ya maneja esto automáticamente.

app.use(express.json());

// Credenciales
const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// MEMORIA TEMPORAL: Guardamos el estado de voz de cada jugador aquí.
let globalVoiceStates = {};

// ---------------------------------------------------------
// 1. ENDPOINT: Generar Token
// ---------------------------------------------------------
app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, {
    identity: participantName,
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  const token = await at.toJwt();
  res.json({ token, wsUrl: LK_URL });
});

// ---------------------------------------------------------
// 2. ENDPOINT: Estado de Voz
// ---------------------------------------------------------
app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  
  res.json({ success: true });
});

// ---------------------------------------------------------
// 3. ENDPOINT: Datos de Minecraft
// ---------------------------------------------------------
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  
  // A. Reenviar datos de MC a LiveKit
  try {
    const strData = JSON.stringify({
      type: 'minecraft-update',
      data: mcBody.data,
      config: mcBody.config
    });
    
    const encoder = new TextEncoder();
    const payload = encoder.encode(strData);

    // Usamos DataPacket_Kind.RELIABLE
    await roomService.sendData(
        'minecraft-global',      
        payload,                 
        DataPacket_Kind.RELIABLE 
    );

  } catch (error) {
    // Si el error es 404 (Room not found), lo ignoramos silenciosamente
    // porque significa que no hay nadie conectado en la web.
    if (error.status === 404 || error.code === 'not_found') {
       // Nada que hacer, sala vacía
    } else {
       console.error("Error enviando a LiveKit:", error);
    }
  }

  // B. Responder al Addon
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Server corriendo en puerto ${PORT}`);
});
