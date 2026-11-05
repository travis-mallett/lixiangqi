// SPDX-License-Identifier: GPL-3.0-or-later
// LiXiangQi browser integration, updated 2026-11-03.
#pragma once

#include <condition_variable>
#include <cstdlib>
#include <emscripten.h>
#include <memory>
#include <mutex>
#include <queue>
#include <streambuf>
#include <string>

struct Command : public std::streambuf {
    enum Type { UCI, NNUE } type;
    std::string              uci;
    std::shared_ptr<void>    ptr = nullptr;

    explicit Command(const char* text) :
        type(UCI),
        uci(text) {
        std::free(const_cast<char*>(text));
    }

    Command(char* buffer, std::size_t size) :
        type(NNUE),
        ptr(buffer, std::free) {
        setg(buffer, buffer, buffer + size);
    }

    pos_type seekpos(pos_type position, std::ios_base::openmode mode) override {
        if (type != NNUE || position != 0 || !(mode & std::ios_base::in))
            return pos_type(off_type(-1));
        setg(eback(), eback(), egptr());
        return 0;
    }
    pos_type seekoff(off_type offset, std::ios_base::seekdir direction,
                     std::ios_base::openmode mode) override {
        return direction == std::ios_base::beg ? seekpos(pos_type(offset), mode) : pos_type(off_type(-1));
    }
};

struct CommandQueue {
    std::mutex              mutex;
    std::queue<Command>     commands;
    std::condition_variable available;

    void push(Command command) {
        std::unique_lock lock(mutex);
        // Match lila-stockfish-web's stream-buffer queue semantics so the NNUE
        // get area remains readable on the engine thread.
        commands.push(command);
        lock.unlock();
        available.notify_one();
    }

    Command pop() {
        std::unique_lock lock(mutex);
        available.wait(lock, [this] { return !commands.empty(); });
        Command command = std::move(commands.front());
        commands.pop();
        return command;
    }
};
