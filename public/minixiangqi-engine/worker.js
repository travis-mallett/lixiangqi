// Classic worker: this Emscripten build exposes the Stockfish factory globally.
let engine;
let initializing = false;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init' && !initializing) {
      initializing = true;
      importScripts(data.moduleUrl);
      engine = await Stockfish({
        mainScriptUrlOrBlob: data.moduleUrl,
        locateFile: file => file.endsWith('.wasm') ? data.wasmUrl : data.workerUrl,
        onAbort: error => self.postMessage({ type: 'error', error: String(error) }),
      });
      engine.addMessageListener(line => self.postMessage({ type: 'line', line }));
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'command' && engine) {
      if (data.command === 'quit') { engine.terminate(); self.close(); }
      else engine.postMessage(data.command);
    }
  } catch (error) {
    engine?.terminate();
    self.postMessage({ type: 'error', error: String(error) });
    self.close();
  }
};
