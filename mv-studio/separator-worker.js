import * as ort from 'onnxruntime-web';
import { DemucsProcessor, CONSTANTS } from 'demucs-web';
import wasmUrl from './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';
import wasmModuleUrl from './node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
let processor;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') {
      processor = new DemucsProcessor({ ort, sessionOptions: { executionProviders: ['wasm'] }, onProgress: p => self.postMessage({ type: 'progress', ...p }) });
      const url = CONSTANTS.DEFAULT_MODEL_URL;
      let cache;
      try { cache = await caches.open('mv-studio-model-v1'); } catch {}
      let response = await cache?.match(url);
      if (!response) {
        response = await fetch(url);
        if (!response.ok) throw new Error(`模型下載失敗 (${response.status})`);
        try { await cache?.put(url, response.clone()); } catch {}
      }
      self.postMessage({ type: 'status', text: '模型已下載，正在初始化…' });
      await processor.loadModel(await response.arrayBuffer());
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'separate') {
      const stems = await processor.separate(data.left, data.right);
      self.postMessage({ type: 'result', stems }, Object.values(stems).flatMap(s => [s.left.buffer, s.right.buffer]));
    }
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
