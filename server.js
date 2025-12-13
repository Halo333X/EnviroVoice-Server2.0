// server.js (EN RENDER)
import express from 'express';
import cors from 'cors';
// 1. IMPORTANTE: Añadimos DataPacket_Kind a los imports
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
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

    // 2. CORRECCIÓN AQUÍ: Usamos DataPacket_Kind.RELIABLE en lugar del objeto {reliable:true}
    await roomService.sendData(
        'minecraft-global',      // Sala
        payload,                 // Datos (Uint8Array)
        DataPacket_Kind.RELIABLE // Tipo de paquete (Enum correcto)
    );

  } catch (error) {
    console.error("Error enviando a LiveKit:", error);
    // No detenemos la respuesta al addon aunque LiveKit falle
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
