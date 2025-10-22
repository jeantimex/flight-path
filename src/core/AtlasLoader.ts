/**
 * Atlas Loader
 * Loads multiple SVG/image files and packs them into a single WebGPU texture atlas
 */

export interface AtlasConfig {
  columns: number;
  rows: number;
  tileSize: number; // Size of each tile in pixels
  images: string[]; // Paths to images
}

export interface AtlasResult {
  texture: GPUTexture;
  columns: number;
  rows: number;
  count: number;
}

/**
 * Load an image from a URL
 */
async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Create atlas texture from multiple images
 */
export async function createAtlas(
  device: GPUDevice,
  config: AtlasConfig,
): Promise<AtlasResult> {
  const { columns, rows, tileSize, images } = config;
  const atlasWidth = columns * tileSize;
  const atlasHeight = rows * tileSize;

  // Load all images
  console.log(`Loading ${images.length} images for atlas...`);
  const loadedImages = await Promise.all(images.map(loadImage));
  console.log(`✅ All ${images.length} images loaded`);

  // Create offscreen canvas for compositing
  const canvas = new OffscreenCanvas(atlasWidth, atlasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get 2D context for atlas');
  }

  // Clear canvas
  ctx.clearRect(0, 0, atlasWidth, atlasHeight);

  // Draw each image into its tile
  loadedImages.forEach((img, index) => {
    if (index >= columns * rows) return; // Skip excess images

    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = col * tileSize;
    const y = row * tileSize;

    // Draw image centered in tile
    ctx.drawImage(img, x, y, tileSize, tileSize);
  });

  // Get image data
  const imageData = ctx.getImageData(0, 0, atlasWidth, atlasHeight);

  // Create WebGPU texture
  const texture = device.createTexture({
    size: { width: atlasWidth, height: atlasHeight },
    format: 'rgba8unorm',
    usage:
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // Upload image data to texture
  device.queue.writeTexture(
    { texture },
    imageData.data,
    { bytesPerRow: atlasWidth * 4 },
    { width: atlasWidth, height: atlasHeight },
  );

  console.log(`✅ Atlas texture created (${atlasWidth}x${atlasHeight}, ${images.length} tiles)`);

  return {
    texture,
    columns,
    rows,
    count: images.length,
  };
}
