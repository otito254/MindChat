#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

async function buildClient() {
  console.log('🔨 Building client...');
  
  try {
    // Ensure public directory exists
    const publicDir = path.join(process.cwd(), 'public');
    await fs.mkdir(publicDir, { recursive: true });
    
    // Ensure audio directory exists
    const audioDir = path.join(publicDir, 'audio');
    await fs.mkdir(audioDir, { recursive: true });
    
    // Ensure icons directory exists
    const iconsDir = path.join(publicDir, 'icons');
    await fs.mkdir(iconsDir, { recursive: true });
    
    // Create placeholder audio files if they don't exist
    const audioFiles = [
      'breathing-basics-64k.mp3',
      'thought-challenging-64k.mp3',
      'sleep-preparation-64k.mp3',
      'anxiety-relief-64k.mp3',
      'crisis-calm-64k.mp3'
    ];
    
    for (const audioFile of audioFiles) {
      const audioPath = path.join(audioDir, audioFile);
      try {
        await fs.access(audioPath);
      } catch {
        // Create empty file if it doesn't exist
        await fs.writeFile(audioPath, '');
        console.log(`Created placeholder: ${audioFile}`);
      }
    }
    
    // Create placeholder icons if they don't exist
    const iconSizes = [72, 96, 128, 144, 152, 192, 384, 512];
    
    for (const size of iconSizes) {
      const iconPath = path.join(iconsDir, `icon-${size}x${size}.png`);
      try {
        await fs.access(iconPath);
      } catch {
        // Create empty file if it doesn't exist
        await fs.writeFile(iconPath, '');
        console.log(`Created placeholder icon: icon-${size}x${size}.png`);
      }
    }
    
    console.log('✅ Client build completed');
  } catch (error) {
    console.error('❌ Client build failed:', error);
    process.exit(1);
  }
}

buildClient();