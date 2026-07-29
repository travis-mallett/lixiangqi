/** Assign a listener to Module.listen before creating the module. */
if (!Module['listen']) Module['listen'] = data => console.log(data);

/** Assign an error handler to Module.onError before creating the module. */
if (!Module['onError']) Module['onError'] = data => console.error(data);

Module['getRecommendedNnue'] = () => UTF8ToString(_getRecommendedNnue()) || undefined;

Module['setNnueBuffer'] = function (buffer) {
  if (!buffer?.byteLength) throw new Error('Pikafish NNUE buffer is empty');
  const heapBuffer = _malloc(buffer.byteLength);
  if (!heapBuffer) throw new Error(`Could not allocate ${buffer.byteLength} NNUE bytes`);
  growMemViews();
  Module['HEAPU8'].set(buffer, heapBuffer);
  _setNnueBuffer(heapBuffer, buffer.byteLength);
};

Module['uci'] = function (command) {
  const size = lengthBytesUTF8(command) + 1;
  const utf8 = _malloc(size);
  if (!utf8) throw new Error(`Could not allocate ${size} UCI bytes`);
  stringToUTF8(command, utf8, size);
  _uci(utf8);
};

Module['print'] = data => Module['listen']?.(data);
Module['printErr'] = data => Module['onError']?.(data);
