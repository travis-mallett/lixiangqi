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
      engine.cwrap('pikajieqi_initialize', null, [])();
      command = engine.cwrap('pikajieqi_command', null, ['string']);
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
