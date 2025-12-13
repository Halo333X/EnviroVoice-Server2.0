// server.js (EN RENDER)
import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
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
// Formato: { "Steve": { isTalking: true, isMuted: false }, "Alex": ... }
let globalVoiceStates = {};

// ---------------------------------------------------------
// 1. ENDPOINT: Generar Token (Para que React entre a la sala)
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
// 2. ENDPOINT: Estado de Voz (React le avisa al server)
// ---------------------------------------------------------
// React llama a esto cada vez que el usuario empieza/deja de hablar o se mutea
app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
    // Opcional: console.log(`🎤 ${gamertag}: ${isTalking ? 'Hablando' : 'Silencio'}`);
  }
  
  res.json({ success: true });
});

// ---------------------------------------------------------
// 3. ENDPOINT: Datos de Minecraft (Addon <-> Server <-> React)
// ---------------------------------------------------------
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; // { data: {...}, config: { maxDistance: 15 } }
  
  // A. Reenviar datos de MC a LiveKit (Para que React sepa si hay cueva)
  try {
    const strData = JSON.stringify({
      type: 'minecraft-update',
      data: mcBody.data,
      config: mcBody.config // Pasamos también la config a React
    });
    
    const encoder = new TextEncoder();
    const payload = encoder.encode(strData);

    await roomService.sendData('minecraft-global', payload, {
      reliable: true
    });
  } catch (error) {
    console.error("Error enviando a LiveKit:", error);
  }

  // B. Responder al Addon con los estados de voz (Para actualizar Nametags)
  // Convertimos el objeto de memoria a un array limpio
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));

  // Limpiamos estados muy viejos si quisieras, pero por ahora lo dejamos simple.
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray // El addon leerá esto en Socket.js
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Server corriendo en puerto ${PORT}`);
});
