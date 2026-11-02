// Keep the engine's synchronous pthread initialization off the browser UI thread.
let engine;
let command;
let initializing = false;

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init' && !initializing) {
      initializing = true;
      const { default: createEngine } = await import(data.moduleUrl);
      engine = await createEngine({
        locateFile: () => data.wasmUrl,
        mainScriptUrlOrBlob: data.moduleUrl,
        print: line => self.postMessage({ type: 'line', line }),
        printErr: line => self.postMessage({ type: 'diagnostic', line }),
        onAbort: error => self.postMessage({ type: 'error', error: String(error) }),
      });
      if (data.networkUrl) {
        const response = await fetch(data.networkUrl);
        if (!response.ok) throw new Error(`${data.prefix} network download failed: ${response.status}`);
        engine.FS.writeFile('/' + data.networkFile, new Uint8Array(await response.arrayBuffer()));
        if (!engine.cwrap(`${data.prefix}_initialize`, 'number', [])()) throw new Error(`${data.prefix} network initialization failed`);
      } else engine.cwrap('pikajieqi_initialize', null, [])();
      command = engine.cwrap(`${data.prefix}_command`, null, ['string']);
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'command' && command) {
      if (data.command === 'quit') {
        engine.PThread.terminateAllThreads();
        self.close();
      } else command(data.command);
    }
  } catch (error) {
    engine?.PThread.terminateAllThreads();
    self.postMessage({ type: 'error', error: String(error) });
    self.close();
  }
};
