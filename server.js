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
let globalVoiceStates = {};   // { "Gamertag": { isTalking: true, isMuted: false } }
let globalConnectionStates = {}; // { "Gamertag": { connected: true, lastHeartbeat: 123 } }

// --- GARBAGE COLLECTOR (Limpieza automática de conexiones de voz) ---
setInterval(() => {
    const now = Date.now();
    Object.keys(globalConnectionStates).forEach(player => {
        if (globalConnectionStates[player].connected) {
            // Si pasaron más de 20s sin latido, lo desconectamos de la voz
            if (now - globalConnectionStates[player].lastHeartbeat > 20000) {
                console.log(`💀 [TIMEOUT] ${player} desconectado de VOZ.`);
                globalConnectionStates[player].connected = false;
            }
        }
    });
}, 5000);

// --- ENDPOINTS ---

// 1. LATIDO: La web dice "Estoy en la llamada"
app.post('/status', (req, res) => {
    const { player, inVoice } = req.body;
    if (player) {
        globalConnectionStates[player] = {
            connected: inVoice,
            lastHeartbeat: Date.now()
        };
    }
    res.sendStatus(200);
});

// 2. MINECRAFT DATA: El Addon envía posiciones y recibe estados
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; // { data: { "Steve": {...}, "Alex": {...} }, config: ... }
  
  // A. Enviar posiciones a LiveKit (Para Audio 3D en Web)
  try {
    const strData = JSON.stringify({ type: 'minecraft-update', data: mcBody.data, config: mcBody.config });
    const encoder = new TextEncoder();
    await roomService.sendData('minecraft-global', encoder.encode(strData), DataPacket_Kind.RELIABLE);
  } catch (error) {}

  // B. CALCULAR ESTADOS PARA EL ADDON (AQUÍ ESTÁ LA LÓGICA QUE PEDISTE)
  
  // Lista de jugadores que están ACTUALMENTE en el mundo (según el Addon)
  const playersInWorld = Object.keys(mcBody.data || {});
  
  const finalStates = [];

  playersInWorld.forEach(gamertag => {
      // 1. Estado de Voz (Hablando/Muteado)
      const voiceState = globalVoiceStates[gamertag] || { isTalking: false, isMuted: false };
      
      // 2. Estado de Conexión (¿Está en la llamada?)
      // Buscamos si existe en la lista de conexiones y si está marcado como true
      const connectionData = globalConnectionStates[gamertag];
      const isConnectedToCall = connectionData ? connectionData.connected : false;

      // 3. Empaquetamos todo para el Addon
      // El Addon leerá 'isDisconnected' para poner el icono rojo
      finalStates.push({
          gamertag: gamertag,
          isTalking: voiceState.isTalking,
          isMuted: voiceState.isMuted,
          isDisconnected: !isConnectedToCall // TRUE si NO está en la llamada
      });
  });
  
  // Enviamos al Addon SOLO lo que necesita saber de los jugadores presentes
  res.json({ 
      success: true,
      states: finalStates 
  });
});

// ... (Resto de endpoints /token y /voice-status igual) ...
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
