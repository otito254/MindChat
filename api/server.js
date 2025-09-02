// MindChat Backend API - Optimized for LMIC environments
// Minimal, fast, and low-bandwidth focused

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Security and optimization middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
      mediaSrc: ["'self'", "blob:"],
      workerSrc: ["'self'", "blob:"]
    }
  }
}));

app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting for API protection
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests, please try again later.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // More restrictive for sensitive endpoints
  message: { error: 'Rate limit exceeded for sensitive operation.' }
});

// In-memory storage for demo (use Redis/PostgreSQL in production)
let moodData = new Map();
let sessionProgress = new Map();
let peerRooms = new Map();
let crisisContacts = new Map();
let userSessions = new Map();

// Initialize demo data
initializeDemoData();

// Static file serving (for PWA)
app.use(express.static('public', {
  maxAge: '1y',
  etag: true,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
    if (path.includes('/audio/')) {
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// === MOOD TRACKING ENDPOINTS ===

// Get mood history
app.get('/api/mood', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const userMoods = moodData.get(userId) || {};
    
    // Return only last 30 days to minimize data transfer
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentMoods = Object.fromEntries(
      Object.entries(userMoods).filter(([date]) => 
        new Date(date) >= thirtyDaysAgo
      )
    );
    
    res.json({
      success: true,
      data: recentMoods,
      stats: calculateMoodStats(recentMoods)
    });
  } catch (error) {
    console.error('Mood fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch mood data' });
  }
});

// Record mood entry
app.post('/api/mood', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { mood, date = new Date().toISOString().split('T')[0] } = req.body;
    
    if (!mood || mood < 1 || mood > 5) {
      return res.status(400).json({ error: 'Invalid mood value (1-5)' });
    }
    
    const userMoods = moodData.get(userId) || {};
    userMoods[date] = {
      value: mood,
      timestamp: new Date().toISOString()
    };
    moodData.set(userId, userMoods);
    
    // Calculate if mood pattern indicates need for support
    const needsSupport = checkMoodPattern(userMoods);
    
    res.json({
      success: true,
      data: { mood, date },
      needsSupport,
      message: getMoodMessage(mood)
    });
    
    // Log for analytics (anonymized)
    logEvent('mood_recorded', { mood, date, needsSupport });
    
  } catch (error) {
    console.error('Mood record error:', error);
    res.status(500).json({ error: 'Failed to record mood' });
  }
});

// Bulk mood sync for offline data
app.post('/api/sync-mood', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { moodEntries } = req.body;
    
    if (!Array.isArray(moodEntries)) {
      return res.status(400).json({ error: 'Invalid mood entries format' });
    }
    
    const userMoods = moodData.get(userId) || {};
    
    for (const entry of moodEntries) {
      if (entry.date && entry.value >= 1 && entry.value <= 5) {
        userMoods[entry.date] = {
          value: entry.value,
          timestamp: entry.timestamp || new Date().toISOString()
        };
      }
    }
    
    moodData.set(userId, userMoods);
    
    res.json({
      success: true,
      synced: moodEntries.length,
      message: `Synced ${moodEntries.length} mood entries`
    });
    
  } catch (error) {
    console.error('Mood sync error:', error);
    res.status(500).json({ error: 'Failed to sync mood data' });
  }
});

// === CBT SESSION ENDPOINTS ===

// Get available CBT sessions
app.get('/api/cbt/sessions', apiLimiter, async (req, res) => {
  try {
    const sessions = [
      {
        id: 'breathing-basics',
        title: 'Deep Breathing Basics',
        duration: 300, // 5 minutes
        level: 'beginner',
        category: 'anxiety',
        description: 'Learn fundamental breathing techniques for instant calm',
        audioUrl: '/audio/breathing-basics-64k.mp3',
        audioSize: 2400000, // ~2.4MB
        offline: true,
        languages: ['en', 'sw', 'fr', 'ar']
      },
      {
        id: 'thought-challenging',
        title: 'Thought Challenging',
        duration: 420, // 7 minutes
        level: 'intermediate',
        category: 'cognitive',
        description: 'Identify and challenge negative thought patterns',
        audioUrl: '/audio/thought-challenging-64k.mp3',
        audioSize: 3360000, // ~3.4MB
        offline: false,
        languages: ['en', 'sw', 'fr']
      },
      {
        id: 'sleep-preparation',
        title: 'Sleep Preparation',
        duration: 600, // 10 minutes
        level: 'beginner',
        category: 'sleep',
        description: 'Wind down routine for better sleep quality',
        audioUrl: '/audio/sleep-preparation-64k.mp3',
        audioSize: 4800000, // ~4.8MB
        offline: false,
        languages: ['en', 'sw', 'fr', 'ar']
      },
      {
        id: 'anxiety-relief',
        title: 'Anxiety Relief',
        duration: 480, // 8 minutes
        level: 'intermediate',
        category: 'anxiety',
        description: 'Quick techniques for managing anxiety symptoms',
        audioUrl: '/audio/anxiety-relief-64k.mp3',
        audioSize: 3840000, // ~3.8MB
        offline: false,
        languages: ['en', 'sw']
      }
    ];
    
    // Filter by user's preferred language if provided
    const lang = req.query.lang || 'en';
    const filteredSessions = sessions.map(session => ({
      ...session,
      available: session.languages.includes(lang)
    }));
    
    res.json({
      success: true,
      data: filteredSessions,
      totalSize: filteredSessions.reduce((sum, s) => sum + s.audioSize, 0)
    });
    
  } catch (error) {
    console.error('Sessions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Record session progress
app.post('/api/cbt/progress', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { sessionId, progress, completed, duration } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID required' });
    }
    
    const userProgress = sessionProgress.get(userId) || {};
    userProgress[sessionId] = {
      progress: Math.max(0, Math.min(100, progress || 0)),
      completed: completed || false,
      duration: duration || 0,
      lastAccessed: new Date().toISOString(),
      attempts: (userProgress[sessionId]?.attempts || 0) + 1
    };
    sessionProgress.set(userId, userProgress);
    
    // Award achievement for first completion
    let achievement = null;
    if (completed && !userProgress[sessionId]?.completed) {
      achievement = 'first_session_completed';
    }
    
    res.json({
      success: true,
      data: userProgress[sessionId],
      achievement
    });
    
    logEvent('session_progress', { sessionId, progress, completed });
    
  } catch (error) {
    console.error('Progress record error:', error);
    res.status(500).json({ error: 'Failed to record progress' });
  }
});

// Get user's session progress
app.get('/api/cbt/progress', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const userProgress = sessionProgress.get(userId) || {};
    
    res.json({
      success: true,
      data: userProgress,
      stats: {
        totalSessions: Object.keys(userProgress).length,
        completedSessions: Object.values(userProgress).filter(p => p.completed).length,
        totalTime: Object.values(userProgress).reduce((sum, p) => sum + (p.duration || 0), 0)
      }
    });
    
  } catch (error) {
    console.error('Progress fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch progress' });
  }
});

// === PEER SUPPORT ENDPOINTS ===

// Get active peer rooms
app.get('/api/peer/rooms', apiLimiter, async (req, res) => {
  try {
    const rooms = Array.from(peerRooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      topic: room.topic,
      participants: room.participants.length,
      isActive: room.participants.length > 0,
      moderator: room.moderator,
      tags: room.tags,
      createdAt: room.createdAt
    }));
    
    // Sort by activity level
    rooms.sort((a, b) => b.participants - a.participants);
    
    res.json({
      success: true,
      data: rooms,
      totalRooms: rooms.length,
      activeRooms: rooms.filter(r => r.isActive).length
    });
    
  } catch (error) {
    console.error('Rooms fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch peer rooms' });
  }
});

// Join a peer room
app.post('/api/peer/join', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { roomId } = req.body;
    
    const room = peerRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    
    // Remove user from room
    room.participants = room.participants.filter(id => id !== userId);
    room.lastActivity = new Date().toISOString();
    
    res.json({
      success: true,
      message: `Left ${room.name}`
    });
    
    logEvent('peer_room_left', { roomId, participants: room.participants.length });
    
  } catch (error) {
    console.error('Room leave error:', error);
    res.status(500).json({ error: 'Failed to leave room' });
  }
});

// === CRISIS SUPPORT ENDPOINTS ===

// Get crisis hotlines by location
app.get('/api/crisis/hotlines', apiLimiter, async (req, res) => {
  try {
    const { country = 'global' } = req.query;
    const hotlines = crisisContacts.get(country) || crisisContacts.get('global');
    
    res.json({
      success: true,
      data: hotlines,
      disclaimer: 'If you are in immediate danger, please call emergency services (911, 999, 112)'
    });
    
  } catch (error) {
    console.error('Crisis hotlines error:', error);
    res.status(500).json({ error: 'Failed to fetch crisis resources' });
  }
});

// Record crisis intervention access (for analytics)
app.post('/api/crisis/access', strictLimiter, async (req, res) => {
  try {
    const { type, urgent = false } = req.body;
    
    // Log crisis access (anonymized)
    logEvent('crisis_access', { type, urgent, timestamp: new Date().toISOString() });
    
    res.json({
      success: true,
      message: 'Access logged',
      resources: {
        breathingExercise: '/api/crisis/breathing',
        emergencyContacts: '/api/crisis/hotlines',
        safetyPlan: '/api/crisis/safety-plan'
      }
    });
    
  } catch (error) {
    console.error('Crisis access error:', error);
    res.status(500).json({ error: 'Failed to log crisis access' });
  }
});

// Get guided breathing exercise data
app.get('/api/crisis/breathing', apiLimiter, async (req, res) => {
  try {
    const breathingExercise = {
      name: '4-7-8 Breathing',
      steps: [
        { phase: 'inhale', duration: 4, instruction: 'Breathe in slowly through your nose' },
        { phase: 'hold', duration: 7, instruction: 'Hold your breath' },
        { phase: 'exhale', duration: 8, instruction: 'Exhale completely through your mouth' }
      ],
      cycles: 4,
      totalDuration: 76, // seconds
      audioUrl: '/audio/crisis-breathing-64k.mp3'
    };
    
    res.json({
      success: true,
      data: breathingExercise
    });
    
  } catch (error) {
    console.error('Breathing exercise error:', error);
    res.status(500).json({ error: 'Failed to fetch breathing exercise' });
  }
});

// === ANALYTICS & MONITORING ===

// Get app analytics (aggregated, anonymized)
app.get('/api/analytics/summary', apiLimiter, async (req, res) => {
  try {
    // This would typically come from a proper analytics database
    const summary = {
      totalUsers: userSessions.size,
      moodEntries: Array.from(moodData.values()).reduce((sum, user) => 
        sum + Object.keys(user).length, 0),
      sessionsCompleted: Array.from(sessionProgress.values()).reduce((sum, user) => 
        sum + Object.values(user).filter(s => s.completed).length, 0),
      activeRooms: Array.from(peerRooms.values()).filter(room => 
        room.participants.length > 0).length,
      crisisAccesses: 0, // Would be tracked in production
      averageMood: calculateGlobalAverageMood()
    };
    
    res.json({
      success: true,
      data: summary,
      period: '30_days'
    });
    
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// === AUDIO STREAMING ENDPOINTS ===

// Stream audio files with range support for low bandwidth
app.get('/audio/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const audioPath = path.join(__dirname, 'audio', filename);
    
    // Check if file exists
    try {
      await fs.access(audioPath);
    } catch {
      return res.status(404).json({ error: 'Audio file not found' });
    }
    
    const stat = await fs.stat(audioPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
      // Support partial content for streaming
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      
      res.status(206).set({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000'
      });
      
      const stream = require('fs').createReadStream(audioPath, { start, end });
      stream.pipe(res);
      
    } else {
      // Send full file
      res.set({
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'public, max-age=31536000'
      });
      
      const stream = require('fs').createReadStream(audioPath);
      stream.pipe(res);
    }
    
    logEvent('audio_streamed', { filename, hasRange: !!range });
    
  } catch (error) {
    console.error('Audio streaming error:', error);
    res.status(500).json({ error: 'Failed to stream audio' });
  }
});

// === UTILITY FUNCTIONS ===

function getUserId(req) {
  // Simple session-based user identification
  const sessionId = req.headers['x-session-id'] || 
                   req.ip + req.headers['user-agent'];
  const userId = crypto.createHash('sha256').update(sessionId).digest('hex').substring(0, 16);
  
  if (!userSessions.has(userId)) {
    userSessions.set(userId, {
      id: userId,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
  } else {
    userSessions.get(userId).lastSeen = new Date().toISOString();
  }
  
  return userId;
}

function calculateMoodStats(moods) {
  const values = Object.values(moods).map(m => m.value);
  if (values.length === 0) return null;
  
  const average = values.reduce((sum, val) => sum + val, 0) / values.length;
  const trend = calculateTrend(moods);
  
  return {
    average: Math.round(average * 10) / 10,
    trend,
    entries: values.length,
    lowest: Math.min(...values),
    highest: Math.max(...values)
  };
}

function calculateTrend(moods) {
  const entries = Object.entries(moods).sort(([a], [b]) => new Date(a) - new Date(b));
  if (entries.length < 3) return 'insufficient_data';
  
  const recent = entries.slice(-7); // Last 7 entries
  const older = entries.slice(-14, -7); // Previous 7 entries
  
  if (recent.length === 0 || older.length === 0) return 'insufficient_data';
  
  const recentAvg = recent.reduce((sum, [, mood]) => sum + mood.value, 0) / recent.length;
  const olderAvg = older.reduce((sum, [, mood]) => sum + mood.value, 0) / older.length;
  
  const difference = recentAvg - olderAvg;
  
  if (difference > 0.5) return 'improving';
  if (difference < -0.5) return 'declining';
  return 'stable';
}

function calculateGlobalAverageMood() {
  let totalMoods = 0;
  let totalEntries = 0;
  
  for (const userMoods of moodData.values()) {
    for (const mood of Object.values(userMoods)) {
      totalMoods += mood.value;
      totalEntries++;
    }
  }
  
  return totalEntries > 0 ? Math.round((totalMoods / totalEntries) * 10) / 10 : 0;
}

function checkMoodPattern(moods) {
  const recentEntries = Object.entries(moods)
    .sort(([a], [b]) => new Date(b) - new Date(a))
    .slice(0, 3);
  
  const lowMoods = recentEntries.filter(([, mood]) => mood.value <= 2);
  return lowMoods.length >= 2; // 2+ low moods in last 3 entries
}

function getMoodMessage(mood) {
  const messages = {
    1: "Thank you for sharing. You're not alone in this.",
    2: "It takes courage to acknowledge difficult feelings.",
    3: "Every day is different. How can we support you today?",
    4: "It's wonderful that you're feeling positive!",
    5: "Your good energy is inspiring. Keep it up!"
  };
  return messages[mood] || "Thank you for checking in.";
}

function sanitizeRoomData(room) {
  return {
    id: room.id,
    name: room.name,
    topic: room.topic,
    participantCount: room.participants.length,
    moderator: room.moderator,
    tags: room.tags,
    guidelines: room.guidelines
  };
}

function logEvent(eventType, data) {
  // In production, this would send to proper analytics service
  const event = {
    type: eventType,
    data,
    timestamp: new Date().toISOString(),
    // Remove any PII
    sanitizedData: sanitizeEventData(data)
  };
  
  console.log('📊 Event:', JSON.stringify(event));
}

function sanitizeEventData(data) {
  // Remove any potential PII from event data
  const sanitized = { ...data };
  delete sanitized.userId;
  delete sanitized.ip;
  delete sanitized.sessionId;
  return sanitized;
}

function initializeDemoData() {
  // Initialize demo peer rooms
  peerRooms.set('new-beginnings', {
    id: 'new-beginnings',
    name: '🌱 New Beginnings',
    topic: 'Support for life transitions and new challenges',
    participants: ['demo1', 'demo2', 'demo3', 'demo4', 'demo5', 'demo6', 'demo7'],
    moderator: 'Sarah M.',
    tags: ['transitions', 'support', 'growth'],
    guidelines: [
      'Be respectful and supportive',
      'No personal information sharing',
      'Listen actively and empathetically',
      'Report any concerning behavior'
    ],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  });
  
  peerRooms.set('new-mothers', {
    id: 'new-mothers',
    name: '🤱 New Mothers Circle',
    topic: 'Postpartum support and parenting guidance',
    participants: ['demo8', 'demo9', 'demo10', 'demo11', 'demo12', 'demo13', 'demo14', 'demo15', 'demo16', 'demo17', 'demo18', 'demo19'],
    moderator: 'Dr. Jennifer K.',
    tags: ['postpartum', 'parenting', 'mothers'],
    guidelines: [
      'Share experiences, not medical advice',
      'Respect different parenting styles',
      'Maintain confidentiality',
      'Seek professional help for medical concerns'
    ],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  });
  
  peerRooms.set('finding-home', {
    id: 'finding-home',
    name: '🏠 Finding Home',
    topic: 'For displaced persons seeking community',
    participants: ['demo20', 'demo21', 'demo22', 'demo23', 'demo24'],
    moderator: 'Ahmed R.',
    tags: ['displacement', 'community', 'belonging'],
    guidelines: [
      'Multilingual support available',
      'Respect cultural differences',
      'Share resources and support',
      'No political discussions'
    ],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  });
  
  peerRooms.set('student-stress', {
    id: 'student-stress',
    name: '📚 Student Stress',
    topic: 'Academic pressure and study support',
    participants: ['demo25', 'demo26', 'demo27', 'demo28', 'demo29', 'demo30', 'demo31', 'demo32', 'demo33', 'demo34', 'demo35', 'demo36', 'demo37', 'demo38', 'demo39'],
    moderator: 'Prof. Michael T.',
    tags: ['students', 'academic', 'stress', 'youth'],
    guidelines: [
      'Academic support, not cheating',
      'Share study techniques and resources',
      'Peer encouragement and motivation',
      'Respect exam periods and stress levels'
    ],
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  });
  
  // Initialize crisis contacts
  crisisContacts.set('global', [
    {
      name: 'International Association for Suicide Prevention',
      phone: 'Visit iasp.info',
      available: '24/7',
      languages: ['Multiple languages'],
      type: 'suicide_prevention'
    }
  ]);
  
  crisisContacts.set('us', [
    {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      available: '24/7',
      languages: ['English', 'Spanish'],
      type: 'crisis_hotline'
    },
    {
      name: 'Crisis Text Line',
      phone: 'Text HOME to 741741',
      available: '24/7',
      languages: ['English'],
      type: 'text_support'
    }
  ]);
  
  crisisContacts.set('uk', [
    {
      name: 'Samaritans',
      phone: '116 123',
      available: '24/7',
      languages: ['English'],
      type: 'crisis_hotline'
    }
  ]);
  
  crisisContacts.set('ke', [
    {
      name: 'Kenya Red Cross Counselling Centre',
      phone: '1199',
      available: '24/7',
      languages: ['English', 'Swahili'],
      type: 'crisis_hotline'
    }
  ]);
  
  console.log('✅ Demo data initialized');
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested resource was not found'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🔄 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🔄 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, () => {
  console.log(`🧠 MindChat API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});
    
    // Check if already in room
    if (room.participants.includes(userId)) {
      return res.json({
        success: true,
        message: 'Already in room',
        roomData: sanitizeRoomData(room)
      });
    }
    
    // Add user to room
    room.participants.push(userId);
    room.lastActivity = new Date().toISOString();
    
    res.json({
      success: true,
      message: `Joined ${room.name}`,
      roomData: sanitizeRoomData(room)
    });
    
    logEvent('peer_room_joined', { roomId, participants: room.participants.length });
    
  } catch (error) {
    console.error('Room join error:', error);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Leave a peer room
app.post('/api/peer/leave', apiLimiter, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { roomId } = req.body;
    
    const room = peerRooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }