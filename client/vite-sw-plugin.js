import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {
    console.warn('Could not get git hash, using timestamp instead');
    return new Date().toISOString().replace(/[^0-9]/g, '').slice(0, -3);
  }
}

export function serviceWorkerPlugin() {
  return {
    name: 'service-worker-plugin',
    buildEnd() {
      const gitHash = getGitHash();
      const timestamp = new Date().toISOString().split('T')[0];
      const version = `${timestamp}-${gitHash}`;
      
      // Read the original service worker file
      const swPath = resolve(__dirname, 'public/sw.js');
      let swContent = readFileSync(swPath, 'utf-8');
      
      // Replace the version constant
      swContent = swContent.replace(
        /const CACHE_VERSION = '.*?'/,
        `const CACHE_VERSION = '${version}'`
      );
      
      // Write the modified content to the build output
      writeFileSync(resolve(__dirname, '../dist/sw.js'), swContent);
    }
  };
} 