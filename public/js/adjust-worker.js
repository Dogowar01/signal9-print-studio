import { applyAdjustments } from './adjust.js';

self.onmessage = (e) => {
  const { id, buffer, width, height, adj, opts } = e.data;
  try {
    const data = new Uint8ClampedArray(buffer);
    applyAdjustments(data, width, height, adj, opts);
    self.postMessage({ id, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
