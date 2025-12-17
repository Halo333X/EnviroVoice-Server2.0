import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------------------
// CONFIGURACIÓN DEL SERVIDOR
// -------------------------------------------------------------------------
const app = express();

app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// -------------------------------------------------------------------------
// CONFIGURACIÓN LIVEKIT
// -------------------------------------------------------------------------
const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL;

const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// -------------------------------------------------------------------------
// ALMACENAMIENTO EN MEMORIA
// -------------------------------------------------------------------------
// Almacena el estado de voz (hablando/muteado) reportado por la Web App
let globalVoiceStates = {};   
let lastMinecraftData = null; 
let lastUpdateTime = null;    

// -------------------------------------------------------------------------
// ENDPOINTS
// -------------------------------------------------------------------------

/**
 * Generación de Tokens de Acceso para LiveKit.
 * Recibe: nombre de sala y nombre de participante.
 * Retorna: Token JWT y URL del servidor WebSocket.
 */
app.post('/token', async (req, res) => {
  const { roomName, participantName } = req.body;

  if (!roomName || !participantName) {
    return res.status(400).json({ error: 'Faltan datos requeridos (roomName, participantName)' });
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
    res.status(500).json({ error: 'Error interno al generar token' });
  }
});

/**
 * Recepción de Estado de Voz desde la Web.
 * Actualiza si un jugador está hablando o muteado.
 */
app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  
  res.json({ success: true });
});

/**
 * Puente de Datos Minecraft <-> LiveKit.
 * 1. Recibe posiciones desde el Addon (Minecraft).
 * 2. Reenvía esas posiciones a la Web App vía LiveKit Data Packet.
 * 3. Responde al Addon con el estado de voz actual de los jugadores.
 */
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // A. Reenvío de datos a la sala de LiveKit (Para Audio 3D en Web)
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
     // Se ignoran errores de envío si la sala está vacía para evitar spam en logs
  }

  // B. Respuesta al Addon (Solo estados de voz necesarios para Nametags)
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray
  });
});

// -------------------------------------------------------------------------
// INICIO DEL SERVIDOR
// -------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
