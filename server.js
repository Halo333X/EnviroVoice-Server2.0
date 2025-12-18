import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// CONFIGURACIÓN LIVEKIT
const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// ALMACENAMIENTO EN MEMORIA
let globalVoiceStates = {};   
let lastMinecraftData = null; 
let lastUpdateTime = null;    

// ENDPOINTS

app.get('/status', (req, res) => {
  res.status(200).send('OK');
});

app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
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
  } catch (error) {
    console.error("Error generando token:", error);
    res.status(500).json({ error: 'Error interno' });
  }
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
  
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // A. Reenvío a LiveKit
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
        DataPacket_Kind.RELIABLE 
    );
  } catch (error) {
     // Ignorar error de sala vacía
  }

  // B. Respuesta al Addon (LIMPIA: Solo estados de voz)
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));
  
  // Eliminada la lógica de connectionStates
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray
  });
});

app.get('/minecraft-data', (req, res) => {
    res.json({
        status: "active",
        last_updated: lastUpdateTime || "Never",
        active_voice_users: Object.keys(globalVoiceStates).length,
        users_list: Object.keys(globalVoiceStates)
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
