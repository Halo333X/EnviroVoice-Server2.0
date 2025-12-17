import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(cors({ 
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'] 
}));
app.use(express.json());

const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// MEMORIA (Guardamos las claves siempre en minúsculas para evitar errores)
let globalVoiceStates = {};   
let lastMinecraftData = null; 
let lastUpdateTime = null;    
let globalConnectionStates = {}; 

// --- GARBAGE COLLECTOR ---
setInterval(() => {
    const now = Date.now();
    Object.keys(globalConnectionStates).forEach(key => { // 'key' ya estará en minúsculas
        if (globalConnectionStates[key].connected) {
            if (now - globalConnectionStates[key].lastHeartbeat > 20000) {
                console.log(`💀 [TIMEOUT] ${key} desconectado.`);
                globalConnectionStates[key].connected = false;
            }
        }
    });
}, 5000);

// --- ENDPOINTS ---

app.post('/status', (req, res) => {
    const { player, inVoice } = req.body;
    
    if (player) {
        // LOG DE DEPURACIÓN
        console.log(`💓 Heartbeat recibido: ${player} (Conectado: ${inVoice})`);

        // GUARDAMOS EN MINÚSCULAS
        globalConnectionStates[player.toLowerCase()] = {
            connected: inVoice,
            lastHeartbeat: Date.now()
        };
    } else {
        console.warn("⚠️ Heartbeat recibido SIN JUGADOR");
    }
    res.sendStatus(200);
});

app.post('/voice-status', (req, res) => {
    const { gamertag, isTalking, isMuted } = req.body;
    if (gamertag) {
        // GUARDAMOS EN MINÚSCULAS
        globalVoiceStates[gamertag.toLowerCase()] = { isTalking, isMuted };
    }
    res.json({ success: true });
});

// EL CORAZÓN DEL SISTEMA
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // A. Enviar a LiveKit
  try {
    const strData = JSON.stringify({ type: 'minecraft-update', data: mcBody.data, config: mcBody.config });
    const encoder = new TextEncoder();
    await roomService.sendData('minecraft-global', encoder.encode(strData), DataPacket_Kind.RELIABLE);
  } catch (error) {}

  // B. COMPARACIÓN INTELIGENTE (Case Insensitive)
  // Obtenemos la lista de jugadores REALES que están en el servidor de Minecraft
  const playersInWorld = Object.keys(mcBody.data || {});
  
  const finalStates = [];

  playersInWorld.forEach(gamertag => {
      // 1. Convertimos el nombre real de Minecraft a minúsculas para buscar en nuestra "base de datos"
      const lowerTag = gamertag.toLowerCase();

      // 2. Buscamos datos usando la llave en minúsculas
      const voiceState = globalVoiceStates[lowerTag] || { isTalking: false, isMuted: false };
      const connectionData = globalConnectionStates[lowerTag];
      const isConnectedToCall = connectionData ? connectionData.connected : false;

      // 3. Respondemos usando 'gamertag' (el nombre original con mayúsculas)
      // Esto es CRUCIAL para que el Addon pueda encontrar al jugador en su propio mapa.
      finalStates.push({
          gamertag: gamertag, 
          isTalking: voiceState.isTalking,
          isMuted: voiceState.isMuted,
          isDisconnected: !isConnectedToCall // Si no lo encontramos o es false -> Desconectado
      });
  });
  
  res.json({ 
      success: true,
      states: finalStates 
  });
});

// ... (El endpoint /token se queda igual) ...
app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;
  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, { identity: participantName });
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  res.json({ token: await at.toJwt(), wsUrl: LK_URL });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});


