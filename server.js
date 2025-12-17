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

const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// --- MEMORIA TEMPORAL ---
let globalVoiceStates = {};   // Quién está hablando/muteado
let lastMinecraftData = null; // Posiciones del juego
let lastUpdateTime = null;    

// NUEVO: Memoria para saber si están conectados a la llamada
// Formato: { "Gamertag": true/false }
let globalConnectionStates = {}; 

// =========================================================
// 1. ENDPOINT STATUS (Corregido para GET y POST)
// =========================================================

// A. Para que TÚ puedas ver los datos desde el navegador (Debugging)
app.get('/status', (req, res) => {
    res.json({
        info: "Estado de conexión de jugadores (Buzón)",
        states: globalConnectionStates
    });
});

// B. Para que la WEB envíe el estado (Esto usa tu GameRoom.jsx)
app.post('/status', (req, res) => {
    const { player, inVoice } = req.body;
    
    if (player) {
        // Guardamos el estado en memoria
        globalConnectionStates[player] = inVoice;
        console.log(`📡 Status Update: ${player} está en llamada? ${inVoice}`);
    }
    
    // NOTA: Quitamos 'minecraftSocket' porque no existe aquí.
    // Minecraft leerá esto cuando haga su petición a /minecraft-data
    
    res.sendStatus(200);
});

// =========================================================
// OTROS ENDPOINTS
// =========================================================

app.get('/minecraft-data', (req, res) => {
  res.json({
    status: 'online',
    last_update_time: lastUpdateTime,
    voice_states_memory: globalVoiceStates, 
    connection_states_memory: globalConnectionStates, // <--- Añadido para debug
    minecraft_data_memory: lastMinecraftData 
  });
});

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

app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  res.json({ success: true });
});

// 3. ENDPOINT: Datos de Minecraft (EL PUNTO CLAVE)
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // A. Enviar a LiveKit
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
    if (error.status !== 404 && error.code !== 'not_found') {
       console.error("Error LiveKit:", error);
    }
  }

  // B. Responder al Addon con TODO (Voz + Conexión)
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));

  // NUEVO: Convertimos el mapa de conexión a array para el addon
  // El Addon debe leer esto para saber si poner el icono de "Desconectado"
  const connectionStatesArray = Object.keys(globalConnectionStates).map(key => ({
      gamertag: key,
      connected: globalConnectionStates[key]
  }));
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray,
      connectionStates: connectionStatesArray // <--- AQUÍ LE AVISAMOS A MINECRAFT
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
