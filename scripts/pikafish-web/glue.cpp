#include "glue.hpp"

#include <istream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include "evaluate.h"
#include "external/zstd.h"
#include "uci.h"

extern Stockfish::UCIEngine* uci_global;

CommandQueue inputQueue;

namespace {
std::stringstream decompressNnue(Command& command) {
    std::istream      compressed(&command);
    std::stringstream decompressed;
    std::vector<char> inputBuffer(ZSTD_DStreamInSize());
    std::vector<char> outputBuffer(ZSTD_DStreamOutSize());
    auto              contextDeleter = [](ZSTD_DCtx* context) {
        if (context)
            ZSTD_freeDCtx(context);
    };
    std::unique_ptr<ZSTD_DCtx, decltype(contextDeleter)> context(
      ZSTD_createDCtx(), contextDeleter);
    if (!context)
        return decompressed;

    while (compressed.read(inputBuffer.data(), inputBuffer.size()) || compressed.gcount() > 0)
    {
        ZSTD_inBuffer input = {
          inputBuffer.data(), static_cast<std::size_t>(compressed.gcount()), 0};
        while (input.pos < input.size)
        {
            ZSTD_outBuffer output = {outputBuffer.data(), outputBuffer.size(), 0};
            const auto result = ZSTD_decompressStream(context.get(), &output, &input);
            if (ZSTD_isError(result))
                return {};
            decompressed.write(outputBuffer.data(), output.pos);
        }
    }
    return decompressed;
}
}  // namespace

extern "C" {
EMSCRIPTEN_KEEPALIVE void uci(const char* utf8) { inputQueue.push(Command(utf8)); }

EMSCRIPTEN_KEEPALIVE void setNnueBuffer(char* buffer, std::size_t size) {
    inputQueue.push(Command(buffer, size));
}

EMSCRIPTEN_KEEPALIVE const char* getRecommendedNnue() { return EvalFileDefaultNameBig; }
}

EMSCRIPTEN_KEEPALIVE std::string js_getline() {
    auto command = inputQueue.pop();
    if (command.type == Command::UCI)
        return command.uci;
    if (command.ptr)
    {
        // Official Pikafish networks are distributed as Zstandard streams.
        // Network::load expects the decompressed NNUE bytes.
        auto input = decompressNnue(command);
        uci_global->engine.load_big_network(input);
    }
    return "";
}
