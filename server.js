// server.js (EN RENDER)
import express from 'express';
import cors from 'cors';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Tus credenciales de LiveKit (Configúralas en las Variables de Entorno de Render)
const LK_API_KEY = process.env.LIVEKIT_API_KEY;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LK_URL = process.env.LIVEKIT_URL; // wss://tu-proyecto.livekit.cloud

// Cliente para mandar mensajes a la sala desde el servidor
const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// 1. ENDPOINT: Generar Token (El frontend llama a esto)
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
  res.json({ token, wsUrl: LK_URL }); // Devolvemos el token Y la URL de LiveKit
});

// 2. ENDPOINT: Recibir datos de Minecraft
app.post('/minecraft-data', async (req, res) => {
  const mcData = req.body; // { players: [...], ... }
  
  // Aquí ocurre la magia: Enviamos estos datos a TODOS en la sala LiveKit
  try {
    const strData = JSON.stringify({
      type: 'minecraft-update',
      data: mcData
    });
    
    // Codificar a Uint8Array para LiveKit
    const encoder = new TextEncoder();
    const payload = encoder.encode(strData);

    // Enviar a la sala "minecraft-global" (o hazlo dinámico si quieres)
    await roomService.sendData('minecraft-global', payload, {
      reliable: true // Asegura que llegue el paquete
    });

    console.log("📦 Datos de MC re-enviados a LiveKit");
    res.json({ success: true });
  } catch (error) {
    console.error("Error enviando datos a LiveKit:", error);
    res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Auth Server corriendo en puerto ${PORT}`);
});