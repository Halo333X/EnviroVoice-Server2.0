import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json());

const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// MEMORIA SIMPLE (Solo para estados de voz: Muteado/Hablando)
let globalVoiceStates = {};   
let lastMinecraftData = null; 
let lastUpdateTime = null;    

// --- ENDPOINTS ---

app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;
  if (!roomName || !participantName) return res.status(400).json({ error: 'Faltan datos' });

  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, { identity: participantName });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  res.json({ token: await at.toJwt(), wsUrl: LK_URL });
});

// Recibe: "Estoy hablando" / "Me callé"
app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  res.json({ success: true });
});

// Recibe datos de Minecraft -> Envía a Web -> Responde a Minecraft
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // 1. Enviar posiciones a la Web (LiveKit Data)
  try {
    const strData = JSON.stringify({
      type: 'minecraft-update',
      data: mcBody.data,
      config: mcBody.config
    });
    const encoder = new TextEncoder();
    await roomService.sendData('minecraft-global', encoder.encode(strData), DataPacket_Kind.RELIABLE);
  } catch (error) {
     // Ignoramos errores de envío si no hay nadie conectado para no ensuciar logs
  }

  // 2. Responder al Addon con los estados de VOZ (Solo Talking/Muted)
  // Ya no enviamos "connectionStates", el addon debe asumir que si no hay voz, es neutral.
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
