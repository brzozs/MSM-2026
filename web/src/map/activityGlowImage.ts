export function createActivityGlowImage(): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create the activity glow image.');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [radius, opacity] of [[0, 0.72], [0.15, 0.55], [0.35, 0.28], [0.6, 0.09], [0.85, 0.015], [1, 0]]) {
    gradient.addColorStop(radius, `rgba(248,202,124,${opacity})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return context.getImageData(0, 0, 128, 128);
}
