// SPDX-License-Identifier: GPL-3.0-or-later
// LiXiangQi browser integration, updated 2026-11-03.
#include "glue.hpp"

#include <istream>
#include <iostream>
#include <memory>
#include <streambuf>
#include <string>
#include <vector>

#include "evaluate.h"
#include "external/zstd.h"
#include "uci.h"

extern Stockfish::UCIEngine* uci_global;

CommandQueue inputQueue;

namespace {
// Network::load reads sequentially. Feed it bounded decompression windows instead
// of retaining a second, fully expanded network in a growing stringstream. WASM
// memory cannot shrink afterwards, so the old temporary raised every game's heap.
class NnueStream : public std::streambuf {
    std::istream compressed;
    std::vector<char> inputBuffer{std::vector<char>(ZSTD_DStreamInSize())};
    std::vector<char> outputBuffer{std::vector<char>(ZSTD_DStreamOutSize())};
    std::unique_ptr<ZSTD_DCtx, decltype(&ZSTD_freeDCtx)> context{ZSTD_createDCtx(), ZSTD_freeDCtx};
    ZSTD_inBuffer input{inputBuffer.data(), 0, 0};
    std::size_t remaining = 1;
    bool ended = false;
    bool failed = false;

    // The network replication API rewinds before loading each replica. Support
    // that operation by restarting decompression, without retaining output.
    pos_type seekpos(pos_type position, std::ios_base::openmode mode) override {
        if (position != 0 || !(mode & std::ios_base::in) || !context)
            return pos_type(off_type(-1));
        compressed.clear();
        compressed.seekg(0);
        input.size = input.pos = 0;
        remaining = 1;
        ended = false;
        failed = !compressed || ZSTD_isError(ZSTD_DCtx_reset(context.get(), ZSTD_reset_session_only));
        setg(nullptr, nullptr, nullptr);
        return failed ? pos_type(off_type(-1)) : pos_type(0);
    }
    pos_type seekoff(off_type offset, std::ios_base::seekdir direction,
                     std::ios_base::openmode mode) override {
        return direction == std::ios_base::beg ? seekpos(pos_type(offset), mode) : pos_type(off_type(-1));
    }

    int_type underflow() override {
        if (gptr() && gptr() < egptr())
            return traits_type::to_int_type(*gptr());
        if (!context || failed || ended)
            return traits_type::eof();
        while (true)
        {
            if (input.pos == input.size)
            {
                compressed.read(inputBuffer.data(), inputBuffer.size());
                input.size = static_cast<std::size_t>(compressed.gcount());
                input.pos = 0;
                if (!input.size)
                {
                    ended = true;
                    failed = remaining != 0;
                    return traits_type::eof();
                }
            }
            ZSTD_outBuffer output{outputBuffer.data(), outputBuffer.size(), 0};
            remaining = ZSTD_decompressStream(context.get(), &output, &input);
            if (ZSTD_isError(remaining))
            {
                failed = true;
                return traits_type::eof();
            }
            if (output.pos)
            {
                setg(outputBuffer.data(), outputBuffer.data(), outputBuffer.data() + output.pos);
                return traits_type::to_int_type(*gptr());
            }
        }
    }
  public:
    explicit NnueStream(Command& command) : compressed(&command) {}
    bool valid() const { return context && ended && !failed; }
};
}  // namespace

extern "C" {
EMSCRIPTEN_KEEPALIVE void uci(const char* utf8) { inputQueue.push(Command(utf8)); }

EMSCRIPTEN_KEEPALIVE void setNnueBuffer(char* buffer, std::size_t size) {
    inputQueue.push(Command(buffer, size));
}

EMSCRIPTEN_KEEPALIVE const char* getRecommendedNnue() { return EvalFileDefaultName; }
}

EMSCRIPTEN_KEEPALIVE std::string js_getline() {
    auto command = inputQueue.pop();
    if (command.type == Command::UCI)
        return command.uci;
    if (command.ptr)
    {
        // Official Pikafish networks are distributed as Zstandard streams.
        // Network::load expects the decompressed NNUE bytes.
        NnueStream buffer(command);
        std::istream input(&buffer);
        if (!uci_global->engine.load_network(input) || !buffer.valid())
        {
            std::cerr << "Pikafish could not initialize the NNUE network" << std::endl;
            return "quit";
        }
    }
    return "";
}
