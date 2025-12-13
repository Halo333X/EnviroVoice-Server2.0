// server.js (EN RENDER)
import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// Configuración CORS Simple y Robusta
app.use(cors({
  origin: '*', // Permitir todo (Ngrok, Localhost, Vercel)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Tus credenciales de LiveKit
const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// Memoria temporal para el estado de voz (Quién habla, quién está muteado)
let globalVoiceStates = {};

// 1. ENDPOINT: Generar Token
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

// 2. ENDPOINT: Estado de Voz (Recibe desde la Web)
app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  
  res.json({ success: true });
});

// 3. ENDPOINT: Datos de Minecraft (Recibe Addon -> Manda LiveKit -> Responde Addon)
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  
  // A. Enviar a LiveKit (Sala React)
  try {
    const strData = JSON.stringify({
      type: 'minecraft-update',
      data: mcBody.data,
      config: mcBody.config
    });
    
    const encoder = new TextEncoder();
    const payload = encoder.encode(strData);

    await roomService.sendData(
        'minecraft-global',
        payload,
        DataPacket_Kind.RELIABLE // <--- Importante: Usar el Enum correcto
    );

  } catch (error) {
    // Ignoramos error 404 si la sala está vacía
    if (error.status !== 404 && error.code !== 'not_found') {
       console.error("Error LiveKit:", error);
    }
  }

  // B. Responder al Addon con los estados de voz
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
  console.log(`🚀 Server running on port ${PORT}`);
});
