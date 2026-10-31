// The rules and Max-n engine are compiled from modules/threeKingdomsCore by Scala.js.
self.onmessage = async ({ data }) => {
  try {
    const { ThreeKingdoms } = await import(data.moduleUrl);
    const result = ThreeKingdoms.analyze(data.position, data.depth, data.nodes, data.multiPv, result => {
      self.postMessage({ id: data.id, result, final: false });
    });
    self.postMessage({ id: data.id, result, final: true });
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error) });
  }
};
