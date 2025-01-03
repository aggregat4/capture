import sharp from 'sharp';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get current directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base SVG with our icon
const SVG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#ff9f43"/>
  <path d="M50 10 C30 10 20 25 20 40 C20 55 30 65 50 65 C70 65 80 55 80 40 C80 25 70 10 50 10 M50 65 L50 85 M35 75 L65 75" 
        fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
  <circle cx="50" cy="35" r="10" fill="#FFD700"/>
</svg>`;

// Icon sizes needed for PWA
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

// iOS splash screen configurations
const SPLASH_SCREENS = [
  { width: 2048, height: 2732, name: 'apple-splash-2048-2732.png' }, // 12.9" iPad Pro
  { width: 1668, height: 2388, name: 'apple-splash-1668-2388.png' }, // 11" iPad Pro
  { width: 1536, height: 2048, name: 'apple-splash-1536-2048.png' }, // 9.7" iPad
  { width: 1125, height: 2436, name: 'apple-splash-1125-2436.png' }, // iPhone X/XS
  { width: 828, height: 1792, name: 'apple-splash-828-1792.png' }    // iPhone XR
];

// Ensure directories exist
async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

// Generate PWA icons
async function generateIcons() {
  const iconDir = join(__dirname, '../client/public/icons');
  await ensureDir(iconDir);

  // Create SVG buffer
  const svgBuffer = Buffer.from(SVG_ICON);

  // Generate icons for each size
  for (const size of ICON_SIZES) {
    const fileName = `icon-${size}x${size}.png`;
    console.log(`Generating ${fileName}...`);
    
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(iconDir, fileName));
  }

  // Generate Apple touch icon (180x180)
  await sharp(svgBuffer)
    .resize(180, 180)
    .png()
    .toFile(join(iconDir, 'apple-touch-icon.png'));

  // Generate new document icon
  const newDocSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#ff9f43"/>
    <path d="M30 20h40v60H30z" fill="#fff"/>
    <path d="M45 40h10M45 50h10M45 60h10" stroke="#ff9f43" stroke-width="2"/>
  </svg>`;

  await sharp(Buffer.from(newDocSvg))
    .resize(96, 96)
    .png()
    .toFile(join(iconDir, 'new-doc-96x96.png'));
}

// Generate splash screens
async function generateSplashScreens() {
  const splashDir = join(__dirname, '../client/public/splash');
  await ensureDir(splashDir);

  // Create base splash screen SVG
  const splashSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#ff9f43"/>
    <g transform="scale(0.5) translate(50 50)">
      <path d="M50 10 C30 10 20 25 20 40 C20 55 30 65 50 65 C70 65 80 55 80 40 C80 25 70 10 50 10 M50 65 L50 85 M35 75 L65 75" 
            fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
      <circle cx="50" cy="35" r="10" fill="#FFD700"/>
    </g>
  </svg>`;

  const svgBuffer = Buffer.from(splashSvg);

  // Generate each splash screen
  for (const screen of SPLASH_SCREENS) {
    console.log(`Generating ${screen.name}...`);
    
    await sharp(svgBuffer)
      .resize(screen.width, screen.height, {
        fit: 'contain',
        background: { r: 255, g: 159, b: 67 } // #ff9f43
      })
      .png()
      .toFile(join(splashDir, screen.name));
  }
}

// Main execution
async function main() {
  try {
    console.log('Generating PWA icons...');
    await generateIcons();
    
    console.log('Generating splash screens...');
    await generateSplashScreens();
    
    console.log('All assets generated successfully!');
  } catch (error) {
    console.error('Error generating assets:', error);
    process.exit(1);
  }
}

main(); 