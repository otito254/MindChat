#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

async function buildApi() {
  console.log('🔧 Building API...');
  
  try {
    // Ensure api directory exists
    const apiDir = path.join(process.cwd(), 'api');
    await fs.mkdir(apiDir, { recursive: true });
    
    // Check if server.js exists
    const serverPath = path.join(apiDir, 'server.js');
    try {
      await fs.access(serverPath);
      console.log('✅ API server file found');
    } catch {
      console.log('⚠️  API server file not found - this is expected for frontend-only deployments');
    }
    
    console.log('✅ API build completed');
  } catch (error) {
    console.error('❌ API build failed:', error);
    process.exit(1);
  }
}

buildApi();