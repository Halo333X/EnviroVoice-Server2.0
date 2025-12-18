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

// Inicializamos el cliente de la sala
const roomService = new RoomServiceClient(LK_URL, LK_API_KEY, LK_API_SECRET);

// -------------------------------------------------------------------------
// ALMACENAMIENTO EN MEMORIA
// -------------------------------------------------------------------------
let globalVoiceStates = {};   
let lastMinecraftData = null; 
let lastUpdateTime = null;    

// -------------------------------------------------------------------------
// ENDPOINTS
// -------------------------------------------------------------------------

// Health Check
app.get('/status', (req, res) => {
  res.status(200).send('OK');
});

/**
 * Generación de Tokens de Acceso
 */
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
    res.status(500).json({ error: 'Error interno al generar token' });
  }
});

/**
 * Recepción de Estado de Voz (Web -> Server)
 */
app.post('/voice-status', (req, res) => {
  const { gamertag, isTalking, isMuted } = req.body;
  
  if (gamertag) {
    globalVoiceStates[gamertag] = { isTalking, isMuted };
  }
  
  res.json({ success: true });
});

/**
 * Puente de Datos (Minecraft -> Server -> Web)
 */
app.post('/minecraft-data', async (req, res) => {
  const mcBody = req.body; 
  
  // Guardamos caché
  lastMinecraftData = mcBody;
  lastUpdateTime = new Date().toISOString();

  // A. Reenvío a LiveKit (Data Packet)
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
     // Ignoramos errores de sala vacía
  }

  // B. Respuesta al Addon (Con cálculo de conexión)
  const voiceStatesArray = Object.keys(globalVoiceStates).map(key => ({
      gamertag: key,
      ...globalVoiceStates[key]
  }));

  // Aquí está la magia que arregla el icono rojo
  const connectionStatesArray = Object.keys(globalVoiceStates).map(gamertag => {
      // ¿Este usuario de la web está también en el mundo de Minecraft?
      const isInGame = mcBody.data && mcBody.data[gamertag] !== undefined;
      
      return {
          gamertag: gamertag,
          connected: isInGame
      };
  });
  
  res.json({ 
      success: true,
      voiceStates: voiceStatesArray,
      connectionStates: connectionStatesArray 
  });
});

// 2. NUEVO: MÉTODO GET (Visor de Depuración)
app.get('/minecraft-data', (req, res) => {
    
    const usersInWeb = Object.keys(globalVoiceStates);
    const usersInGame = lastMinecraftData && lastMinecraftData.data 
                        ? Object.keys(lastMinecraftData.data) 
                        : [];

    const comparisonDebug = usersInWeb.map(gamertag => {
        const isConnected = usersInGame.includes(gamertag);
        
        return {
            gamertag: gamertag,
            icon_result: isConnected ? "✅ CONNECTED" : "🔌 DISCONNECTED",
            details: {
                in_web_call: true,
                in_minecraft_world: isConnected
            }
        };
    });

    res.json({
        info: "Depuración de Lógica de Conexión",
        last_update_from_game: lastUpdateTime || "Esperando datos...",
        
        comparison_result: comparisonDebug,

        debug_raw_lists: {
            web_users: usersInWeb,
            minecraft_players: usersInGame
        }
    });
});

// -------------------------------------------------------------------------
// INICIO
// -------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
