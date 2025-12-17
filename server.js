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

// MEMORIA
let globalVoiceStates = {};   
let lastMinecraftData = null; 
let lastUpdateTime = null;    

// { "Gamertag": { connected: true, lastHeartbeat: 1234567890 } }
let globalConnectionStates = {}; 

// --- GARBAGE COLLECTOR (Limpieza automática) ---
// Si un jugador no manda señal en 20s, lo marcamos como desconectado
setInterval(() => {
    const now = Date.now();
    Object.keys(globalConnectionStates).forEach(player => {
        if (globalConnectionStates[player].connected) {
            // Si pasaron más de 20s desde el último latido
            if (now - globalConnectionStates[player].lastHeartbeat > 20000) {
                console.log(`💀 [TIMEOUT] ${player} desconectado por inactividad.`);
                globalConnectionStates[player].connected = false;
            }
        }
    });
}, 5000);

// --- ENDPOINTS ---

// 1. La Web manda el Heartbeat aquí
app.post('/status', (req, res) => {
    const { player, inVoice } = req.body;
    
    if (player) {
        globalConnectionStates[player] = {
            connected: inVoice,
            lastHeartbeat: Date.now() // Actualizamos la hora
        };
    }
    res.sendStatus(200);
});

// 2. El Addon lee todo aquí
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // Enviar datos posicionales a LiveKit (Web)
  try {
    const strData = JSON.stringify({ type: 'minecraft-update', data: mcBody.data, config: mcBody.config });
    const encoder = new TextEncoder();
    await roomService.sendData('minecraft-global', encoder.encode(strData), DataPacket_Kind.RELIABLE);
  } catch (error) {}

  // Preparar respuesta para el Addon
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));

  // Enviamos solo el estado true/false al addon
  const connectionStatesArray = Object.keys(globalConnectionStates).map(key => ({
      gamertag: key,
      connected: globalConnectionStates[key].connected
  }));
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray,
      connectionStates: connectionStatesArray // <--- INFO VITAL PARA EL ADDON
  });
});

// ... (Resto de endpoints /token y /voice-status igual que antes) ...
app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;
  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, { identity: participantName });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  res.json({ token: await at.toJwt(), wsUrl: LK_URL });
});

app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  if (gamertag) globalVoiceStates[gamertag] = { isTalking, isMuted };
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
